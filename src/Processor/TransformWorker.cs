using CloudinaryClone.Shared;
using SkiaSharp;

namespace Processor;

/// <summary>Claims one job at a time. Sequential on purpose: 512MB on the free tier.</summary>
public sealed class TransformWorker(
    Db db, BlobStore store, WakeSignal signal, ILogger<TransformWorker> log) : BackgroundService
{
    const long MaxPixels = 24_000_000;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Yield();
        log.LogInformation("transform worker started");

        while (!ct.IsCancellationRequested)
        {
            Job? job = null;
            try
            {
                job = await Jobs.Claim(db.Source, ct);

                if (job is null)
                {
                    await signal.WaitAsync(TimeSpan.FromSeconds(20), ct);
                    continue;
                }

                await Run(job, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "worker loop error");
                if (job is not null)
                {
                    try { await Jobs.Retry(db.Source, job, ex.Message, ct); }
                    catch (Exception retryEx) { log.LogError(retryEx, "retry failed"); }
                }

                await Task.Delay(2000, ct);
            }
        }
    }

    async Task Run(Job job, CancellationToken ct)
    {
        try
        {
            var originalKey = await Sql.QueryOne(db.Source, """
                select original_key from assets where id = @id
                """, ct, r => r.GetString(0), ("id", job.AssetId));

            if (originalKey is null)
            {
                await Jobs.Done(db.Source, job.Id, ct);
                return;
            }

            var original = await store.GetBytes(originalKey);

            using var stream = new MemoryStream(original);
            using var codec = SKCodec.Create(stream) ?? throw new InvalidOperationException("not a decodable image");

            if ((long)codec.Info.Width * codec.Info.Height > MaxPixels)
                throw new InvalidOperationException(
                    $"image is {codec.Info.Width}x{codec.Info.Height}, over the {MaxPixels} pixel cap");

            using var decoded = SKBitmap.Decode(codec) ?? throw new InvalidOperationException("decode failed");
            using var image = Imaging.Orient(decoded, codec.EncodedOrigin);

            foreach (var raw in job.Transforms)
            {
                var transform = Transform.Parse(raw);
                var bytes = Imaging.Render(image, transform);
                var key = $"v1/{job.AssetId:N}/{transform.Hash}.{transform.Extension}";

                await store.Put(key, bytes, transform.ContentType, "public, max-age=31536000, immutable");

                await Sql.Exec(db.Source, """
                    insert into variants (asset_id, transform, object_key, width, height, bytes, format)
                    values (@id, @transform, @key, @width, @height, @bytes, @format)
                    on conflict (asset_id, transform) do update
                    set object_key = excluded.object_key, width = excluded.width, height = excluded.height,
                        bytes = excluded.bytes, format = excluded.format
                    """, ct,
                    ("id", job.AssetId), ("transform", transform.Canonical), ("key", key),
                    ("width", (object?)transform.W ?? DBNull.Value), ("height", (object?)transform.H ?? DBNull.Value),
                    ("bytes", bytes.LongLength), ("format", transform.F));
            }

            await Sql.Exec(db.Source, """
                update assets set status = 'ready', error = null, width = @width, height = @height where id = @id
                """, ct, ("width", image.Width), ("height", image.Height), ("id", job.AssetId));

            await Jobs.Done(db.Source, job.Id, ct);
            log.LogInformation("asset {AssetId} ready ({Variants} variants)", job.AssetId, job.Transforms.Length);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (job.Attempts >= Jobs.MaxAttempts)
            {
                await Jobs.Abandon(db.Source, job, ex.Message, ct);
                log.LogError(ex, "job {JobId} abandoned after {Attempts} attempts", job.Id, job.Attempts);
            }
            else
            {
                await Jobs.Retry(db.Source, job, ex.Message, ct);
                log.LogWarning(ex, "job {JobId} attempt {Attempts} failed", job.Id, job.Attempts);
            }
        }
    }
}
