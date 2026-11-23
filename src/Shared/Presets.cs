namespace CloudinaryClone.Shared;

/// <summary>The only transforms a client may request on the delivery path. Names are the public contract.</summary>
public sealed record Preset(string Name, Transform Transform)
{
    public string Path => $"/i/{{publicId}}/{Name}.{Transform.Extension}";
}

public static class Presets
{
    public static readonly IReadOnlyList<Preset> All =
    [
        new("sm",   new Transform(320, null, "fit", "webp", 80)),
        new("md",   new Transform(480, null, "fit", "webp", 80)),
        new("lg",   new Transform(768, null, "fit", "webp", 80)),
        new("xl",   new Transform(1024, null, "fit", "webp", 80)),
        new("2xl",  new Transform(1280, null, "fit", "webp", 82)),
        new("3xl",  new Transform(1600, null, "fit", "webp", 82)),
        new("4xl",  new Transform(1920, null, "fit", "webp", 82)),
        new("thumb", new Transform(160, 160, "fill", "webp", 80)),
        new("card",  new Transform(480, 320, "fill", "webp", 80)),
        new("hero",  new Transform(1920, 1080, "fill", "webp", 82)),
    ];

    private static readonly Dictionary<string, Preset> Map =
        All.ToDictionary(preset => preset.Name, StringComparer.OrdinalIgnoreCase);

    public static Preset? Find(string name) => Map.GetValueOrDefault(name);
}
