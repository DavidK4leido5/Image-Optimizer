using Npgsql;

namespace CloudinaryClone.Shared;

/// <summary>Owns the Npgsql data source and the (idempotent) schema.</summary>
public sealed class Db(NpgsqlDataSource source)
{
    public NpgsqlDataSource Source { get; } = source;

    public static Db Create(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(Normalize(connectionString));
        return new Db(builder.Build());
    }

    /// <summary>Accepts either a Npgsql key/value string or a postgres:// URI (Supabase, Render).</summary>
    public static string Normalize(string value)
    {
        if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            return value;

        var uri = new Uri(value);
        var userInfo = uri.UserInfo.Split(':', 2);

        return new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            SslMode = SslMode.Require,
            MaxPoolSize = 10,
            Timeout = 15,
            // Supavisor transaction mode does not tolerate the DISCARD ALL Npgsql sends
            // when returning a connection to its pool: the next query hangs.
            NoResetOnClose = true,
        }.ConnectionString;
    }

    public Task EnsureSchema(CancellationToken ct = default) => Sql.Exec(Source, Schema, ct);

    // ponytail: single shared schema, applied at boot. Move to versioned migrations when a second
    // deployable needs to change a table independently.
    const string Schema = """
        create table if not exists assets (
            id uuid primary key,
            public_id text not null unique,
            original_key text not null,
            content_type text not null,
            bytes bigint not null default 0,
            width int,
            height int,
            status text not null default 'pending',
            error text,
            transforms text[] not null default '{}',
            created_at timestamptz not null default now()
        );

        create table if not exists variants (
            asset_id uuid not null references assets(id) on delete cascade,
            transform text not null,
            object_key text not null,
            width int,
            height int,
            bytes bigint not null default 0,
            format text not null,
            primary key (asset_id, transform)
        );

        create table if not exists jobs (
            id bigserial primary key,
            asset_id uuid not null references assets(id) on delete cascade,
            transforms text[] not null,
            attempts int not null default 0,
            next_run_at timestamptz not null default now(),
            lease_until timestamptz,
            last_error text,
            created_at timestamptz not null default now()
        );

        create index if not exists jobs_ready on jobs (next_run_at) where lease_until is null;

        -- PostgREST exposure: RLS on, no policies. A publishable/anon key sees nothing.
        -- The services connect as the table owner, which bypasses RLS.
        alter table assets enable row level security;
        alter table variants enable row level security;
        alter table jobs enable row level security;
        """;
}
