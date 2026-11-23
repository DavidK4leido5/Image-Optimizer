using System.Net;
using Amazon.S3;
using Amazon.S3.Model;

namespace CloudinaryClone.Shared;

public sealed record UploadTarget(
    string Url, string Method, IReadOnlyDictionary<string, string> Headers, DateTimeOffset ExpiresAt);

public sealed class StorageOptions
{
    public required Uri Endpoint { get; init; }
    public required Uri PublicEndpoint { get; init; }
    public required string Region { get; init; }
    public required string AccessKey { get; init; }
    public required string SecretKey { get; init; }
    public required string Bucket { get; init; }
    public required string PublicBase { get; init; }
    public bool PathStyle { get; init; } = true;

    public static StorageOptions FromEnvironment()
    {
        var endpoint = Env("S3_ENDPOINT", "http://localhost:9090");
        var pathStyle = !bool.TryParse(Environment.GetEnvironmentVariable("S3_PATH_STYLE"), out var ps) || ps;

        return new StorageOptions
        {
            Endpoint = new Uri(endpoint),
            PublicEndpoint = new Uri(Env("S3_PUBLIC_ENDPOINT", endpoint)),
            Region = Env("S3_REGION", "us-east-1"),
            AccessKey = Env("S3_ACCESS_KEY", "minioadmin"),
            SecretKey = Env("S3_SECRET_KEY", "minioadmin"),
            Bucket = Env("S3_BUCKET", "images"),
            PublicBase = Env("S3_PUBLIC_BASE", endpoint),
            PathStyle = pathStyle,
        };
    }

    static string Env(string name, string fallback) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : fallback;
}

/// <summary>
/// One S3 adapter for MinIO (local) and Supabase Storage (prod). Presigning uses the publicly
/// reachable endpoint so the browser can PUT straight to storage; the SDK talks to the internal one.
/// </summary>
public sealed class BlobStore
{
    readonly IAmazonS3 _s3;
    readonly IAmazonS3 _presigner;
    readonly string _bucket;
    readonly string _publicBase;

    public BlobStore(StorageOptions o)
    {
        _s3 = Create(o, o.Endpoint);
        _presigner = Create(o, o.PublicEndpoint);
        _bucket = o.Bucket;
        _publicBase = o.PublicBase.TrimEnd('/');
    }

    static IAmazonS3 Create(StorageOptions o, Uri endpoint) =>
        new AmazonS3Client(o.AccessKey, o.SecretKey, new AmazonS3Config
        {
            ServiceURL = endpoint.ToString(),
            ForcePathStyle = o.PathStyle,
            AuthenticationRegion = o.Region,
            UseHttp = endpoint.Scheme == Uri.UriSchemeHttp,
        });

    public async Task<UploadTarget> CreateUploadTarget(string key, string contentType, TimeSpan ttl)
    {
        var expires = DateTime.UtcNow.Add(ttl);
        var url = await _presigner.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = expires,
            ContentType = contentType,
            Protocol = _presigner.Config is AmazonS3Config { ServiceURL: not null } c &&
                       c.ServiceURL.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                ? Protocol.HTTP
                : Protocol.HTTPS,
        });

        return new UploadTarget(
            url, "PUT", new Dictionary<string, string> { ["Content-Type"] = contentType },
            new DateTimeOffset(expires, TimeSpan.Zero));
    }

    public async Task Put(string key, byte[] data, string contentType, string cacheControl)
    {
        using var stream = new MemoryStream(data);
        var request = new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            AutoCloseStream = false,
        };
        request.Headers.CacheControl = cacheControl;
        await _s3.PutObjectAsync(request);
    }

    public async Task<byte[]> GetBytes(string key)
    {
        using var response = await _s3.GetObjectAsync(_bucket, key);
        using var buffer = new MemoryStream();
        await response.ResponseStream.CopyToAsync(buffer);
        return buffer.ToArray();
    }

    public async Task<long?> Size(string key)
    {
        try
        {
            var meta = await _s3.GetObjectMetadataAsync(_bucket, key);
            return meta.ContentLength;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<bool> Exists(string key) => await Size(key) is not null;

    public async Task Delete(string key)
    {
        try
        {
            await _s3.DeleteObjectAsync(_bucket, key);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
        }
    }

    public string PublicUrl(string key) => $"{_publicBase}/{_bucket}/{key}";
}
