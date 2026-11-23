using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Api;
using CloudinaryClone.Shared;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceTelemetry("cloudinary-api");
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Retry-After")));

var cfg = AppConfig.FromEnvironment();
var db = Db.Create(cfg.DatabaseUrl);
var store = new BlobStore(StorageOptions.FromEnvironment());
var wakeHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
var grafanaHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
var purgeHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };

var app = builder.Build();
await db.EnsureSchema();

const int MaxQueueDepth = 50;

const string AssetSelect = """
    select a.id, a.public_id, a.status, a.error, a.bytes, a.width, a.height, a.created_at,
           coalesce(json_agg(json_build_object(
               'transform', v.transform, 'key', v.object_key, 'bytes', v.bytes) order by v.transform)
               filter (where v.asset_id is not null), '[]')::text as variants
    from assets a
    left join variants v on v.asset_id = a.id
    """;


app.UseCors();
app.Use(async (ctx, next) =>
{
    if (!ctx.Request.Path.StartsWithSegments("/v1"))
    {
        await next();
        return;
    }

    if (!Secret.Matches(ctx.Request.Headers["X-Api-Key"].ToString(), cfg.ApiKey))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    await next();
});

app.MapGet("/health", async (CancellationToken ct) =>
{
    try
    {
        await Sql.Query(db.Source, "select 1", ct, _ => 1);
        return Results.Ok(new { status = "ok", service = "api" });
    }
    catch (Exception ex)
    {
        return Results.Json(new { status = "degraded", detail = ex.Message }, statusCode: 503);
    }
});

app.MapPost("/v1/assets", async (CreateAssetRequest request, CancellationToken ct) =>
{
    var contentType = request.ContentType?.Trim().ToLowerInvariant();
    var extension = Extension(contentType);
    if (extension is null)
        return Results.BadRequest(new { error = "contentType must be image/jpeg, image/png, image/webp, image/avif or image/gif" });

    if (request.Bytes <= 0 || request.Bytes > cfg.MaxUploadBytes)
        return Results.BadRequest(new { error = $"bytes must be between 1 and {cfg.MaxUploadBytes}" });

    string[] transforms;
    try
    {
        transforms = (request.Transforms is { Length: > 0 } ? request.Transforms : Transform.Defaults)
            .Select(Transform.Parse)
            .Select(t => t.Canonical)
            .Distinct()
            .ToArray();
    }
    catch (FormatException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }

    var id = Guid.NewGuid();
    var publicId = Ids.New();
    var key = $"orig/{publicId}.{extension}";

    await Sql.Exec(db.Source, """
        insert into assets (id, public_id, original_key, content_type, status, transforms)
        values (@id, @public, @key, @type, 'pending', @transforms)
        """, ct,
        ("id", id), ("public", publicId), ("key", key), ("type", contentType), ("transforms", transforms));

    var target = await store.CreateUploadTarget(key, contentType!, TimeSpan.FromMinutes(10));

    return Results.Created($"/v1/assets/{publicId}", new
    {
        id,
        publicId,
        status = "pending",
        upload = new { url = target.Url, method = target.Method, headers = target.Headers },
        expiresAt = target.ExpiresAt,
    });
});

app.MapPost("/v1/assets/{publicId}/complete", async (string publicId, HttpContext http, CancellationToken ct) =>
{
    var asset = await Sql.QueryOne(db.Source, """
        select id, original_key, status, transforms from assets where public_id = @public
        """, ct, r => new PendingAsset(r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetFieldValue<string[]>(3)),
        ("public", publicId));

    if (asset is null) return Results.NotFound();

    if (asset.Status is "processing" or "ready")
        return Results.Accepted($"/v1/assets/{publicId}", new { status = asset.Status });

    var size = await store.Size(asset.OriginalKey);
    if (size is null)
        return Results.Conflict(new { error = "object not found in storage; PUT the file to the signed url first" });

    if (size > cfg.MaxUploadBytes)
    {
        await store.Delete(asset.OriginalKey);
        await Sql.Exec(db.Source, "update assets set status = 'failed', error = 'file too large' where id = @id", ct, ("id", asset.Id));
        return Results.Json(new { error = "file exceeds MAX_UPLOAD_BYTES" }, statusCode: 413);
    }

    // Backpressure: one worker on 0.1 CPU cannot drain an unbounded queue.
    var depth = await Sql.QueryOne(db.Source, "select count(*)::int from jobs", ct, r => r.GetInt32(0));
    if (depth >= MaxQueueDepth)
    {
        http.Response.Headers.RetryAfter = "10";
        return Results.Json(new { error = "queue is full, retry shortly", depth }, statusCode: 429);
    }

    await Sql.Exec(db.Source, "update assets set bytes = @bytes, status = 'processing' where id = @id", ct,
        ("bytes", size.Value), ("id", asset.Id));
    await Jobs.Enqueue(db.Source, asset.Id, asset.Transforms, ct);
    Wake(cfg, wakeHttp, app.Logger);

    return Results.Accepted($"/v1/assets/{publicId}", new { status = "processing" });
});

app.MapGet("/v1/assets", async (CancellationToken ct) =>
{
    var rows = await Sql.Query(db.Source, AssetSelect + " group by a.id order by a.created_at desc limit 100", ct, MapAsset);
    return Results.Ok(rows);
});

app.MapGet("/v1/assets/{publicId}", async (string publicId, CancellationToken ct) =>
{
    var row = await Sql.QueryOne(db.Source, AssetSelect + " where a.public_id = @public group by a.id", ct, MapAsset,
        ("public", publicId));
    return row is null ? Results.NotFound() : Results.Ok(row);
});

app.MapDelete("/v1/assets/{publicId}", async (string publicId, CancellationToken ct) =>
{
    var asset = await Sql.QueryOne(db.Source, """
        select id, original_key from assets where public_id = @public
        """, ct, r => new { Id = r.GetGuid(0), Key = r.GetString(1) }, ("public", publicId));

    if (asset is null) return Results.NotFound();

    var variants = await Sql.Query(db.Source, "select object_key, transform from variants where asset_id = @id", ct,
        r => (Key: r.GetString(0), Transform: r.GetString(1)), ("id", asset.Id));

    foreach (var variant in variants.Append((Key: asset.Key, Transform: string.Empty)))
        await store.Delete(variant.Key);

    await Sql.Exec(db.Source, "delete from assets where id = @id", ct, ("id", asset.Id));

    await CdnPurge.Purge(purgeHttp, cfg, app.Logger, publicId, variants.Select(v => v.Transform), ct);
    return Results.NoContent();
});

// Delivery hop. The Worker fronts this in production; locally the browser hits it directly.
// Named presets generate on demand. Arbitrary transforms are served only if they already exist.
app.MapGet("/i/{publicId}/{spec}", async (string publicId, string spec, HttpContext http, CancellationToken ct) =>
{
    var (raw, extension) = SplitSpec(spec);
    var preset = Presets.Find(raw);

    Transform transform;
    if (preset is not null)
    {
        transform = preset.Transform;
        if (extension is not null && !string.Equals(extension, transform.Extension, StringComparison.OrdinalIgnoreCase))
            return Results.NotFound();
    }
    else
    {
        try
        {
            transform = Transform.Parse(raw);
            if (extension is not null) transform = transform with { F = extension };
        }
        catch (FormatException)
        {
            return Results.NotFound();
        }
    }

    var asset = await Sql.QueryOne(db.Source, """
        select id, original_key, status from assets where public_id = @public
        """, ct, r => new DeliveryAsset(r.GetGuid(0), r.GetString(1), r.GetString(2)), ("public", publicId));

    if (asset is null || asset.Status == "failed") return Results.NotFound();

    var key = await Sql.QueryOne(db.Source, """
        select object_key from variants where asset_id = @id and transform = @transform
        """, ct, r => r.GetString(0), ("id", asset.Id), ("transform", transform.Canonical));

    if (key is not null)
    {
        http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.Redirect(store.PublicUrl(key));
    }

    // Never generate a size the caller invented; only the catalog is allowed to enqueue work.
    if (preset is null) return Results.NotFound();

    await Jobs.EnqueueOnDemand(db.Source, asset.Id, transform.Canonical, ct);
    Wake(cfg, wakeHttp, app.Logger);

    if (http.Request.Query["json"] == "1")
    {
        http.Response.Headers.CacheControl = "no-store";
        http.Response.Headers.RetryAfter = "2";
        return Results.Json(new { status = "processing", preset = preset.Name, transform = transform.Canonical }, statusCode: 202);
    }

    // Show the closest ready variant while the exact preset builds. This is a 202 with a
    // fallback URL rather than a redirect: Workers follows redirects, which would cache the
    // low-res image under the high-res URL for a year.
    var fallback = await Sql.QueryOne(db.Source, """
        select object_key from variants
        where asset_id = @id
        order by abs(coalesce(width, 0) - @width)
        limit 1
        """, ct, r => r.GetString(0), ("id", asset.Id), ("width", transform.W ?? 0));

    http.Response.Headers.CacheControl = "no-store";
    http.Response.Headers.RetryAfter = "2";
    http.Response.Headers["X-Fallback-Url"] = store.PublicUrl(fallback ?? asset.OriginalKey);
    return Results.Json(new { status = "processing", preset = preset.Name, transform = transform.Canonical }, statusCode: 202);
});

// Free-tier usage that we can measure with the credentials we already have.
app.MapGet("/v1/limits", async (CancellationToken ct) =>
{
    var dbBytes = await Sql.QueryOne(db.Source,
        "select pg_database_size(current_database())", ct, r => r.GetInt64(0));

    var originals = await Sql.QueryOne(db.Source,
        "select count(*)::int, coalesce(sum(bytes), 0)::bigint from assets", ct,
        r => new Usage(r.GetInt32(0), r.GetInt64(1))) ?? new Usage(0, 0);

    var variants = await Sql.QueryOne(db.Source,
        "select count(*)::int, coalesce(sum(bytes), 0)::bigint from variants", ct,
        r => new Usage(r.GetInt32(0), r.GetInt64(1))) ?? new Usage(0, 0);

    var queue = await Sql.QueryOne(db.Source, "select count(*)::int from jobs", ct, r => r.GetInt32(0));

    return Results.Ok(new
    {
        database = new { bytes = dbBytes, limit = 500L * 1024 * 1024 },
        storage = new
        {
            bytes = originals.Bytes + variants.Bytes,
            objects = originals.Count + variants.Count,
            limit = 1024L * 1024 * 1024,
        },
        queue = new { depth = queue, limit = MaxQueueDepth },
        assets = originals.Count,
        measuredAt = DateTimeOffset.UtcNow,
    });
});

// Metrics proxy. The Grafana token stays server side; the browser only ever sees this api.
app.MapGet("/v1/metrics", async (string q, long? start, long? end, string? step, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(cfg.GrafanaPromUrl) || string.IsNullOrWhiteSpace(cfg.GrafanaToken))
        return Results.Json(
            new { error = "grafana is not configured", needed = "GRAFANA_PROM_URL, GRAFANA_USER, GRAFANA_TOKEN" },
            statusCode: 503);

    string path;
    if (start is not null && end is not null)
    {
        if (start >= end) return Results.BadRequest(new { error = "start must be before end" });
        path = $"api/v1/query_range?query={Uri.EscapeDataString(q)}&start={start}&end={end}&step={Uri.EscapeDataString(step ?? "30s")}";
    }
    else
    {
        path = $"api/v1/query?query={Uri.EscapeDataString(q)}";
    }

    using var request = new HttpRequestMessage(HttpMethod.Get, $"{cfg.GrafanaPromUrl.TrimEnd('/')}/{path}");
    var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{cfg.GrafanaUser}:{cfg.GrafanaToken}"));
    request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);

    try
    {
        using var response = await grafanaHttp.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        return Results.Content(body, "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
        return Results.Json(new { error = "grafana unreachable", detail = ex.Message }, statusCode: 502);
    }
});

app.Run();

static string? Extension(string? contentType) => contentType switch
{
    "image/jpeg" => "jpg",
    "image/png" => "png",
    "image/webp" => "webp",
    "image/avif" => "avif",
    "image/gif" => "gif",
    _ => null,
};

static (string Raw, string? Extension) SplitSpec(string spec)
{
    var dot = spec.LastIndexOf('.');
    if (dot <= 0) return (spec, null);

    var extension = spec[(dot + 1)..].ToLowerInvariant();
    return extension switch
    {
        "webp" or "avif" or "png" => (spec[..dot], extension),
        "jpg" or "jpeg" => (spec[..dot], "jpeg"),
        _ => (spec, null),
    };
}

static AssetDto MapAsset(NpgsqlDataReader r)
{
    var publicId = r.GetString(1);
    using var variants = JsonDocument.Parse(r.GetString(8));

    var mapped = variants.RootElement.EnumerateArray().Select(v =>
    {
        var canonical = v.GetProperty("transform").GetString()!;
        var transform = Transform.Parse(canonical);
        return new VariantDto(canonical, $"/i/{publicId}/{canonical}.{transform.Extension}", v.GetProperty("bytes").GetInt64());
    }).ToArray();

    return new AssetDto(
        r.GetGuid(0), publicId, r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3),
        r.GetInt64(4), r.IsDBNull(5) ? null : r.GetInt32(5), r.IsDBNull(6) ? null : r.GetInt32(6),
        r.GetFieldValue<DateTimeOffset>(7), mapped);
}

static void Wake(AppConfig cfg, HttpClient http, ILogger logger)
{
    _ = Task.Run(async () =>
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{cfg.ProcessorUrl.TrimEnd('/')}/wake");
            request.Headers.Add("X-Internal-Key", cfg.InternalKey);
            using var response = await http.SendAsync(request);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "could not wake processor");
        }
    });
}

sealed record Usage(int Count, long Bytes);

sealed record DeliveryAsset(Guid Id, string OriginalKey, string Status);

sealed record CreateAssetRequest(string? FileName, string? ContentType, long Bytes, string[]? Transforms);

sealed record PendingAsset(Guid Id, string OriginalKey, string Status, string[] Transforms);

sealed record VariantDto(string Transform, string Url, long Bytes);

sealed record AssetDto(
    Guid Id, string PublicId, string Status, string? Error, long Bytes, int? Width, int? Height,
    DateTimeOffset CreatedAt, VariantDto[] Variants);
