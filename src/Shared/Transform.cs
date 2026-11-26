using System.Security.Cryptography;
using System.Text;

namespace CloudinaryClone.Shared;

/// <summary>Canonical transform spec, Cloudinary-style: w_400,h_300,c_fill,g_north,f_webp,q_80.</summary>
public sealed record Transform(int? W, int? H, string C, string F, int Q, string G = "center", bool U = false)
{
    public static readonly string[] Defaults =
    [
        "w_200,h_200,c_fill,f_webp,q_80",
        "w_800,c_fit,f_webp,q_80",
        "w_1600,c_fit,f_webp,q_82",
    ];

    public static readonly string[] Gravities =
    [
        "center", "north", "south", "east", "west",
        "northeast", "northwest", "southeast", "southwest",
    ];

    public static bool IsGravity(string value) => Gravities.Contains(value);

    public static Transform Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) throw new FormatException("empty transform");

        int? w = null, h = null, q = null;
        var c = "fit";
        var f = "webp";
        var g = "center";
        var u = false;

        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var kv = part.Split('_', 2);
            if (kv.Length != 2) throw new FormatException($"bad token '{part}'");

            switch (kv[0])
            {
                case "w": w = Int(kv[1], 1, 8000, "w"); break;
                case "h": h = Int(kv[1], 1, 8000, "h"); break;
                case "q": q = Int(kv[1], 1, 100, "q"); break;
                case "c":
                    if (kv[1] is not ("fit" or "fill" or "pad"))
                        throw new FormatException("c must be fit, fill or pad");
                    c = kv[1];
                    break;
                case "g":
                    if (!Gravities.Contains(kv[1]))
                        throw new FormatException("g must be center, north, south, east, west or a corner");
                    g = kv[1];
                    break;
                case "u":
                    if (kv[1] is not ("0" or "1"))
                        throw new FormatException("u must be 0 or 1");
                    u = kv[1] == "1";
                    break;
                case "f":
                    if (kv[1] is not ("webp" or "jpeg" or "png"))
                        throw new FormatException("f must be webp, jpeg or png");
                    f = kv[1];
                    break;
                default:
                    throw new FormatException($"unknown key '{kv[0]}'");
            }
        }

        if (w is null && h is null) throw new FormatException("w or h is required");
        if (g != "center" && c != "fill") throw new FormatException("g requires c_fill");
        if (c == "pad" && (w is null || h is null)) throw new FormatException("c_pad requires both w and h");
        return new Transform(w, h, c, f, q ?? 80, g, u);
    }

    /// <summary>Fixed parameter order, defaults filled in. This string is the cache identity.</summary>
    public string Canonical
    {
        get
        {
            var sb = new StringBuilder();
            void Add(string key, object? value)
            {
                if (value is null) return;
                if (sb.Length > 0) sb.Append(',');
                sb.Append(key).Append('_').Append(value);
            }

            Add("w", W);
            Add("h", H);
            Add("c", C);
            Add("g", G == "center" ? null : G);
            Add("u", U ? 1 : null);
            Add("f", F);
            Add("q", Q);
            return sb.ToString();
        }
    }

    public string Hash =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical)))[..16].ToLowerInvariant();

    public string ContentType => F switch
    {
        "webp" => "image/webp",
        "jpeg" => "image/jpeg",
        "png" => "image/png",
        _ => "application/octet-stream",
    };

    public string Extension => F == "jpeg" ? "jpg" : F;

    static int Int(string value, int min, int max, string name) =>
        int.TryParse(value, out var parsed) && parsed >= min && parsed <= max
            ? parsed
            : throw new FormatException($"{name} must be {min}..{max}");
}
