namespace Api;

public sealed record AppConfig(
    string DatabaseUrl,
    string ApiKey,
    string InternalKey,
    string ProcessorUrl,
    long MaxUploadBytes)
{
    public static AppConfig FromEnvironment() => new(
        Env("DATABASE_URL", "Host=localhost;Port=5432;Database=cloud;Username=postgres;Password=postgres"),
        Env("API_KEY", "dev-local-key"),
        Env("INTERNAL_KEY", "dev-internal-key"),
        Env("PROCESSOR_URL", "http://localhost:5081"),
        long.TryParse(Environment.GetEnvironmentVariable("MAX_UPLOAD_BYTES"), out var max) ? max : 20L * 1024 * 1024);

    static string Env(string name, string fallback) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : fallback;
}
