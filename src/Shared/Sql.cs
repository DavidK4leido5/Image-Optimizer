using Npgsql;

namespace CloudinaryClone.Shared;

/// <summary>Thin parameterised helpers over Npgsql. No ORM, no mapping layer.</summary>
public static class Sql
{
    public static async Task<int> Exec(
        NpgsqlDataSource db, string sql, CancellationToken ct, params (string Name, object? Value)[] args)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var cmd = Bind(new NpgsqlCommand(sql, conn), args);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    public static async Task<List<T>> Query<T>(
        NpgsqlDataSource db, string sql, CancellationToken ct, Func<NpgsqlDataReader, T> map,
        params (string Name, object? Value)[] args)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var cmd = Bind(new NpgsqlCommand(sql, conn), args);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var rows = new List<T>();
        while (await reader.ReadAsync(ct)) rows.Add(map(reader));
        return rows;
    }

    public static async Task<T?> QueryOne<T>(
        NpgsqlDataSource db, string sql, CancellationToken ct, Func<NpgsqlDataReader, T> map,
        params (string Name, object? Value)[] args)
    {
        var rows = await Query(db, sql, ct, map, args);
        return rows.Count == 0 ? default : rows[0];
    }

    static NpgsqlCommand Bind(NpgsqlCommand cmd, (string Name, object? Value)[] args)
    {
        foreach (var (name, value) in args)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }
}
