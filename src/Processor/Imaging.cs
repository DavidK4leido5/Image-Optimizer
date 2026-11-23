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
            var cappedWidth = Math.Min(w, sourceWidth);
            var cappedHeight = Math.Min(h, sourceHeight);
            if (t.C == "fill") return (cappedWidth, cappedHeight);

            var scale = Math.Min(cappedWidth / (double)sourceWidth, cappedHeight / (double)sourceHeight);
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

    public static SKRect CoverRect(int sourceWidth, int sourceHeight, int targetWidth, int targetHeight)
    {
        var targetRatio = targetWidth / (double)targetHeight;
        var sourceRatio = sourceWidth / (double)sourceHeight;

        if (sourceRatio > targetRatio)
        {
            var width = sourceHeight * targetRatio;
            var left = (sourceWidth - width) / 2f;
            return new SKRect((float)left, 0, (float)(left + width), sourceHeight);
        }

        var height = sourceWidth / targetRatio;
        var top = (sourceHeight - height) / 2f;
        return new SKRect(0, (float)top, sourceWidth, (float)(top + height));
    }

    public static byte[] Render(SKBitmap source, Transform t)
    {
        var (width, height) = TargetSize(source.Width, source.Height, t);

        using var output = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(output))
        {
            canvas.Clear(SKColors.Transparent);

            var sampling = new SKSamplingOptions(SKCubicResampler.Mitchell);
            using var paint = new SKPaint { IsAntialias = true };

            if (t.C == "fill")
            {
                var crop = CoverRect(source.Width, source.Height, width, height);
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
