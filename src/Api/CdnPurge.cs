using System.Net.Http.Headers;
using System.Net.Http.Json;
using CloudinaryClone.Shared;

namespace Api;

/// <summary>Cloudflare cache purge. Requires a zone; workers.dev URLs cannot be purged.</summary>
public static class CdnPurge
{
    public static async Task Purge(
        HttpClient http, AppConfig cfg, ILogger logger, string publicId,
        IEnumerable<string> transforms, CancellationToken ct)
    {
        if (cfg.CfZoneId is null || cfg.CfPurgeToken is null || cfg.CdnBaseUrl is null) return;

        var baseUrl = cfg.CdnBaseUrl.TrimEnd('/');
        var files = new List<string>();

        foreach (var raw in transforms)
        {
            Transform transform;
            try { transform = Transform.Parse(raw); }
            catch (FormatException) { continue; }
            files.Add($"{baseUrl}/i/{publicId}/{transform.Canonical}.{transform.Extension}");
        }

        foreach (var preset in Presets.All)
            files.Add($"{baseUrl}/i/{publicId}/{preset.Name}.{preset.Transform.Extension}");

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://api.cloudflare.com/client/v4/zones/{cfg.CfZoneId}/purge_cache");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.CfPurgeToken);
        request.Content = JsonContent.Create(new { files = files.Distinct().ToArray() });

        try
        {
            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning("cdn purge returned {Status}", (int)response.StatusCode);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "cdn purge failed");
        }
    }
}
