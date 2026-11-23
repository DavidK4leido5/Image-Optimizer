namespace Processor;

public sealed record ProcConfig(string DatabaseUrl, string InternalKey)
{
    public static ProcConfig FromEnvironment() => new(
        Env("DATABASE_URL", "Host=localhost;Port=5432;Database=cloud;Username=postgres;Password=postgres"),
        Env("INTERNAL_KEY", "dev-internal-key"));

    static string Env(string name, string fallback) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : fallback;
}
