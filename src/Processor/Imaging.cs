using CloudinaryClone.Shared;
using SkiaSharp;

namespace Processor;

/// <summary>SkiaSharp resize/encode. Kept separate so it can be tested without a queue or storage.</summary>
public static class Imaging
{
    public static (int Width, int Height) TargetSize(int sourceWidth, int sourceHeight, Transform t)
    {
        // Never upscale: a 200px source should not be blown up to a 1600px variant.
        if (t.W is int w && t.H is int h)
        {
            if (t.C == "pad") return (w, h);

            if (t.C == "fill")
            {
                // Shrink the target box, keeping its ratio, when the source is smaller.
                var ratio = Math.Min(1d, Math.Min(sourceWidth / (double)w, sourceHeight / (double)h));
                return (Math.Max(1, (int)Math.Round(w * ratio)), Math.Max(1, (int)Math.Round(h * ratio)));
            }

            var scale = Math.Min(1d, Math.Min(w / (double)sourceWidth, h / (double)sourceHeight));
            return (Math.Max(1, (int)Math.Round(sourceWidth * scale)), Math.Max(1, (int)Math.Round(sourceHeight * scale)));
        }

        if (t.W is int onlyWidth)
        {
            var width = Math.Min(onlyWidth, sourceWidth);
            var height = Math.Max(1, (int)Math.Round(sourceHeight * (width / (double)sourceWidth)));
            return (width, height);
        }

        var heightOnly = Math.Min(t.H!.Value, sourceHeight);
        return (Math.Max(1, (int)Math.Round(sourceWidth * (heightOnly / (double)sourceHeight))), heightOnly);
    }

    static (int Width, int Height) FitInside(int sourceWidth, int sourceHeight, int boxWidth, int boxHeight)
    {
        var scale = Math.Min(1d, Math.Min(boxWidth / (double)sourceWidth, boxHeight / (double)sourceHeight));
        return (Math.Max(1, (int)Math.Round(sourceWidth * scale)), Math.Max(1, (int)Math.Round(sourceHeight * scale)));
    }

    public static SKRect CoverRect(int sourceWidth, int sourceHeight, int targetWidth, int targetHeight,
        string gravity = "center")
    {
        var targetRatio = targetWidth / (double)targetHeight;
        var sourceRatio = sourceWidth / (double)sourceHeight;

        float width, height, left, top;
        if (sourceRatio > targetRatio)
        {
            width = (float)(sourceHeight * targetRatio);
            height = sourceHeight;
            left = gravity is "west" or "northwest" or "southwest" ? 0
                : gravity is "east" or "northeast" or "southeast" ? sourceWidth - width
                : (sourceWidth - width) / 2f;
            top = 0;
        }
        else
        {
            width = sourceWidth;
            height = (float)(sourceWidth / targetRatio);
            left = 0;
            top = gravity is "north" or "northeast" or "northwest" ? 0
                : gravity is "south" or "southeast" or "southwest" ? sourceHeight - height
                : (sourceHeight - height) / 2f;
        }

        return new SKRect(left, top, left + width, top + height);
    }

    public static byte[] Render(SKBitmap source, Transform t)
    {
        var (width, height) = TargetSize(source.Width, source.Height, t);

        using var output = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(output))
        {
            canvas.Clear(t.C == "pad" ? SKColors.White : SKColors.Transparent);

            var sampling = new SKSamplingOptions(SKCubicResampler.Mitchell);
            using var paint = new SKPaint { IsAntialias = true };

            if (t.C == "pad")
            {
                var (innerWidth, innerHeight) = FitInside(source.Width, source.Height, width, height);
                var left = (width - innerWidth) / 2f;
                var top = (height - innerHeight) / 2f;
                canvas.DrawBitmap(source, new SKRect(0, 0, source.Width, source.Height),
                    new SKRect(left, top, left + innerWidth, top + innerHeight), sampling, paint);
            }
            else if (t.C == "fill")
            {
                var crop = CoverRect(source.Width, source.Height, width, height, t.G);
                canvas.DrawBitmap(source, crop, new SKRect(0, 0, width, height), sampling, paint);
            }
            else
            {
                canvas.DrawBitmap(source, new SKRect(0, 0, source.Width, source.Height),
                    new SKRect(0, 0, width, height), sampling, paint);
            }
        }

        using var image = SKImage.FromBitmap(output);
        using var data = image.Encode(Format(t.F), t.Q);
        return data.ToArray();
    }

    /// <summary>Applies the EXIF orientation. Always returns a new bitmap.</summary>
    public static SKBitmap Orient(SKBitmap source, SKEncodedOrigin origin)
    {
        if (origin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default)
            return source.Copy();

        int w = source.Width, h = source.Height;
        var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;

        var output = new SKBitmap(swap ? h : w, swap ? w : h);
        using var canvas = new SKCanvas(output);
        canvas.Clear(SKColors.Transparent);

        switch (origin)
        {
            case SKEncodedOrigin.TopRight:      // mirror horizontal
                canvas.Scale(-1, 1, w / 2f, h / 2f);
                break;
            case SKEncodedOrigin.BottomRight:   // rotate 180
                canvas.RotateDegrees(180, w / 2f, h / 2f);
                break;
            case SKEncodedOrigin.BottomLeft:    // mirror vertical
                canvas.Scale(1, -1, w / 2f, h / 2f);
                break;
            case SKEncodedOrigin.RightTop:      // rotate 90 CW
                canvas.Translate(h, 0);
                canvas.RotateDegrees(90);
                break;
            case SKEncodedOrigin.LeftBottom:    // rotate 90 CCW
                canvas.Translate(0, w);
                canvas.RotateDegrees(-90);
                break;
            case SKEncodedOrigin.LeftTop:       // transpose
                canvas.RotateDegrees(90);
                canvas.Scale(1, -1);
                break;
            case SKEncodedOrigin.RightBottom:   // transverse
                canvas.Translate(h, w);
                canvas.RotateDegrees(-90);
                canvas.Scale(1, -1);
                break;
        }

        canvas.DrawBitmap(source, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest), null);
        return output;
    }

    static SKEncodedImageFormat Format(string format) => format switch
    {
        "webp" => SKEncodedImageFormat.Webp,
        "jpeg" => SKEncodedImageFormat.Jpeg,
        "png" => SKEncodedImageFormat.Png,
        _ => throw new NotSupportedException(format),
    };
}
