using CloudinaryClone.Shared;
using Processor;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceTelemetry("cloudinary-processor");

var cfg = ProcConfig.FromEnvironment();
var db = Db.Create(cfg.DatabaseUrl);
var store = new BlobStore(StorageOptions.FromEnvironment());
var signal = new WakeSignal();

builder.Services.AddSingleton(db);
builder.Services.AddSingleton(store);
builder.Services.AddSingleton(signal);
builder.Services.AddHostedService<TransformWorker>();

var app = builder.Build();
await db.EnsureSchema();

app.MapGet("/health", async (CancellationToken ct) =>
{
    try
    {
        await Sql.Query(db.Source, "select 1", ct, _ => 1);
        return Results.Ok(new { status = "ok", service = "processor" });
    }
    catch (Exception ex)
    {
        return Results.Json(new { status = "degraded", detail = ex.Message }, statusCode: 503);
    }
});

app.MapPost("/wake", (HttpContext http, ILogger<Program> log) =>
{
    if (!Secret.Matches(http.Request.Headers["X-Internal-Key"].ToString(), cfg.InternalKey))
        return Results.Unauthorized();

    signal.Wake();
    log.LogInformation("woken");
    return Results.Accepted();
});

app.Run();
