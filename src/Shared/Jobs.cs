using Npgsql;

namespace CloudinaryClone.Shared;

public sealed record Job(long Id, Guid AssetId, string[] Transforms, int Attempts);

/// <summary>Postgres is the queue. One worker claims one job at a time with SKIP LOCKED.</summary>
public static class Jobs
{
    public const int MaxAttempts = 3;

    public static Task<int> Enqueue(NpgsqlDataSource db, Guid assetId, string[] transforms, CancellationToken ct) =>
        Sql.Exec(db, """
            insert into jobs (asset_id, transforms)
            select @id, @transforms
            where not exists (select 1 from jobs where asset_id = @id)
            """, ct, ("id", assetId), ("transforms", transforms));

    public static Task<int> EnqueueOnDemand(
        NpgsqlDataSource db, Guid assetId, string transform, CancellationToken ct) =>
        Sql.Exec(db, """
            insert into jobs (asset_id, transforms)
            select @id, array[@transform]::text[]
            where not exists (select 1 from jobs where asset_id = @id and @transform = any(transforms))
            """, ct, ("id", assetId), ("transform", transform));

    public static async Task<Job?> Claim(NpgsqlDataSource db, CancellationToken ct)
    {
        var rows = await Sql.Query(db, """
            with claimed as (
                select id from jobs
                where (lease_until is null or lease_until < now()) and next_run_at <= now()
                order by next_run_at, id
                for update skip locked
                limit 1
            )
            update jobs j
            set attempts = j.attempts + 1, lease_until = now() + interval '3 minutes'
            from claimed c
            where j.id = c.id
            returning j.id, j.asset_id, j.transforms, j.attempts
            """, ct, r => new Job(r.GetInt64(0), r.GetGuid(1), r.GetFieldValue<string[]>(2), r.GetInt32(3)));

        return rows.Count == 0 ? null : rows[0];
    }

    public static Task<int> Done(NpgsqlDataSource db, long id, CancellationToken ct) =>
        Sql.Exec(db, "delete from jobs where id = @id", ct, ("id", id));

    public static Task<int> Retry(NpgsqlDataSource db, Job job, string error, CancellationToken ct)
    {
        var backoff = TimeSpan.FromSeconds(5 * Math.Pow(2, job.Attempts));
        return Sql.Exec(db, """
            update jobs
            set lease_until = null, last_error = @error, next_run_at = now() + @backoff
            where id = @id
            """, ct, ("error", error), ("backoff", backoff), ("id", job.Id));
    }

    public static Task<int> Abandon(NpgsqlDataSource db, Job job, string error, CancellationToken ct) =>
        Sql.Exec(db, """
            delete from jobs where id = @id;
            update assets set status = 'failed', error = @error where id = @asset;
            """, ct, ("id", job.Id), ("error", error), ("asset", job.AssetId));
}
