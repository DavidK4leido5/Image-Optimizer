using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CloudinaryClone.Shared;

public static class Telemetry
{
    /// <summary>OpenTelemetry for both services. OTLP export stays off unless configured.</summary>
    public static WebApplicationBuilder AddServiceTelemetry(this WebApplicationBuilder builder, string serviceName)
    {
        var otlp = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT");
        var export = !string.IsNullOrWhiteSpace(otlp);

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(r => r.AddService(serviceName))
            .WithTracing(t =>
            {
                t.AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddNpgsql();
                if (export) t.AddOtlpExporter();
            })
            .WithMetrics(m =>
            {
                m.AddAspNetCoreInstrumentation()
                    .AddNpgsqlInstrumentation();
                if (export) m.AddOtlpExporter();
            });

        return builder;
    }
}
