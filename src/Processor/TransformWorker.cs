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

    /// <summary>Decode straight to the largest variant we need, not the full resolution.</summary>
    static SKBitmap Decode(SKCodec codec, int maxEdge)
    {
        var info = codec.Info;
        var longest = Math.Max(info.Width, info.Height);

        if (maxEdge <= 0 || longest <= maxEdge)
            return SKBitmap.Decode(codec) ?? throw new InvalidOperationException("decode failed");

        // Skia rounds the scale down, so ask for the next supported step up rather than
        // decoding smaller than the largest variant we need.
        var size = codec.GetScaledDimensions((float)maxEdge / longest);
        if (Math.Max(size.Width, size.Height) < maxEdge)
            size = codec.GetScaledDimensions(Math.Min(1f, 2f * maxEdge / longest));

        if (Math.Max(size.Width, size.Height) >= longest)
            return SKBitmap.Decode(codec) ?? throw new InvalidOperationException("decode failed");

        var target = new SKImageInfo(size.Width, size.Height, info.ColorType, info.AlphaType, info.ColorSpace);
        var bitmap = new SKBitmap(target);

        var result = codec.GetPixels(target, bitmap.GetPixels());
        if (result is not (SKCodecResult.Success or SKCodecResult.IncompleteInput))
        {
            bitmap.Dispose();
            throw new InvalidOperationException($"scaled decode failed: {result}");
        }

        return bitmap;
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

            // Smallest variants first, so the gallery has a thumbnail before the big encodes finish.
            var transforms = job.Transforms
                .Select(Transform.Parse)
                .OrderBy(t => (t.W ?? 0) * (t.H ?? 0))
                .ToArray();

            var maxEdge = transforms.Select(t => Math.Max(t.W ?? 0, t.H ?? 0)).DefaultIfEmpty(0).Max();
            using var decoded = Decode(codec, maxEdge);

            // Copy only when EXIF rotation actually requires it.
            using var rotated = codec.EncodedOrigin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default
                ? null
                : Imaging.Orient(decoded, codec.EncodedOrigin);
            var image = rotated ?? decoded;

            foreach (var transform in transforms)
            {
                var (variantWidth, variantHeight) = Imaging.TargetSize(image.Width, image.Height, transform);
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
                    ("width", variantWidth), ("height", variantHeight),
                    ("bytes", bytes.LongLength), ("format", transform.F));
            }

            // Report the encoded source dimensions, not the scaled decode size.
            var swap = codec.EncodedOrigin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
                or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;

            await Sql.Exec(db.Source, """
                update assets set status = 'ready', error = null, width = @width, height = @height where id = @id
                """, ct, ("width", swap ? codec.Info.Height : codec.Info.Width),
                ("height", swap ? codec.Info.Width : codec.Info.Height), ("id", job.AssetId));

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
