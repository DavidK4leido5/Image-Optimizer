using System.Text.Json;
using Api;
using CloudinaryClone.Shared;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceTelemetry("cloudinary-api");
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var cfg = AppConfig.FromEnvironment();
var db = Db.Create(cfg.DatabaseUrl);
var store = new BlobStore(StorageOptions.FromEnvironment());
var wakeHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };

var app = builder.Build();
await db.EnsureSchema();

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

app.MapPost("/v1/assets/{publicId}/complete", async (string publicId, CancellationToken ct) =>
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

    var variants = await Sql.Query(db.Source, "select object_key from variants where asset_id = @id", ct,
        r => r.GetString(0), ("id", asset.Id));

    foreach (var key in variants.Append(asset.Key))
        await store.Delete(key);

    await Sql.Exec(db.Source, "delete from assets where id = @id", ct, ("id", asset.Id));
    return Results.NoContent();
});

// Delivery hop. The Worker fronts this in production; locally the browser hits it directly.
app.MapGet("/i/{publicId}/{spec}", async (string publicId, string spec, HttpContext http, CancellationToken ct) =>
{
    var (raw, extension) = SplitSpec(spec);
    Transform transform;
    try
    {
        transform = Transform.Parse(raw);
        if (extension is not null) transform = transform with { F = extension };
    }
    catch (FormatException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }

    var key = await Sql.QueryOne(db.Source, """
        select v.object_key
        from variants v join assets a on a.id = v.asset_id
        where a.public_id = @public and v.transform = @transform
        """, ct, r => r.GetString(0), ("public", publicId), ("transform", transform.Canonical));

    if (key is not null)
    {
        http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.Redirect(store.PublicUrl(key));
    }

    var ids = await Sql.Query(db.Source, "select id from assets where public_id = @public", ct,
        r => r.GetGuid(0), ("public", publicId));

    if (ids.Count == 0) return Results.NotFound();

    await Jobs.EnqueueOnDemand(db.Source, ids[0], transform.Canonical, ct);
    Wake(cfg, wakeHttp, app.Logger);
    http.Response.Headers.CacheControl = "no-store";
    http.Response.Headers.RetryAfter = "2";
    return Results.Json(new { status = "processing", transform = transform.Canonical }, statusCode: 202);
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

sealed record CreateAssetRequest(string? FileName, string? ContentType, long Bytes, string[]? Transforms);

sealed record PendingAsset(Guid Id, string OriginalKey, string Status, string[] Transforms);

sealed record VariantDto(string Transform, string Url, long Bytes);

sealed record AssetDto(
    Guid Id, string PublicId, string Status, string? Error, long Bytes, int? Width, int? Height,
    DateTimeOffset CreatedAt, VariantDto[] Variants);
