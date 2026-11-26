using CloudinaryClone.Shared;
using Processor;
using SkiaSharp;

namespace UnitTests;

public class ImagingTests
{
    static readonly Transform Fit = Transform.Parse("w_300,h_300,c_fit,f_webp");
    static readonly Transform Fill = Transform.Parse("w_300,h_300,c_fill,f_webp");
    static readonly Transform Width = Transform.Parse("w_300,f_webp");
    static readonly Transform Height = Transform.Parse("h_200,f_webp");

    [Theory]
    [InlineData(1200, 800, 300, 200)]   // width only
    [InlineData(800, 1200, 300, 450)]   // portrait, width only
    public void Width_drives_height(int sw, int sh, int tw, int th) =>
        Assert.Equal((tw, th), Imaging.TargetSize(sw, sh, Width));

    [Fact]
    public void Height_drives_width() =>
        Assert.Equal((300, 200), Imaging.TargetSize(1200, 800, Height));

    [Fact]
    public void Fit_preserves_aspect_inside_box() =>
        Assert.Equal((300, 200), Imaging.TargetSize(1200, 800, Fit));

    [Fact]
    public void Fill_hits_exact_box() =>
        Assert.Equal((300, 300), Imaging.TargetSize(1200, 800, Fill));

    [Fact]
    public void Scaled_decode_stays_at_or_above_the_target()
    {
        using var bitmap = new SKBitmap(6000, 4000);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, 80);
        using var codec = SKCodec.Create(new MemoryStream(data.ToArray()));

        var size = codec.GetScaledDimensions(1600f / 6000f);
        if (Math.Max(size.Width, size.Height) < 1600)
            size = codec.GetScaledDimensions(3200f / 6000f);

        Assert.True(Math.Max(size.Width, size.Height) >= 1600,
            $"scaled decode returned {size.Width}px for a 1600px target");
    }

    [Fact]
    public void Fill_keeps_its_ratio_when_the_source_is_smaller()
    {
        var hero = Transform.Parse("w_1920,h_1080,c_fill,f_webp");
        Assert.Equal((1200, 675), Imaging.TargetSize(1200, 800, hero));

        var card = Transform.Parse("w_480,h_320,c_fill,f_webp");
        Assert.Equal((480, 320), Imaging.TargetSize(1200, 800, card));
    }

    [Fact]
    public void Never_upscales_small_sources()
    {
        var wide = Transform.Parse("w_800,c_fit,f_webp");
        Assert.Equal((400, 300), Imaging.TargetSize(400, 300, wide));
        Assert.Equal((100, 100), Imaging.TargetSize(100, 100, Fill));
    }

    [Fact]
    public void Cover_rect_honours_gravity()
    {
        var east = Imaging.CoverRect(1200, 800, 300, 300, "east");
        Assert.Equal(400f, east.Left);
        Assert.Equal(0f, east.Top);
        Assert.Equal(800f, east.Width);

        var south = Imaging.CoverRect(800, 1200, 300, 300, "south");
        Assert.Equal(0f, south.Left);
        Assert.Equal(400f, south.Top);
        Assert.Equal(800f, south.Height);
    }

    [Fact]
    public void Pad_letterboxes_with_white()
    {
        using var source = new SKBitmap(4, 2);
        using (var canvas = new SKCanvas(source)) canvas.Clear(SKColors.Red);

        var bytes = Imaging.Render(source, Transform.Parse("w_8,h_8,c_pad,f_png"));
        using var decoded = SKBitmap.Decode(bytes);

        Assert.Equal(8, decoded.Width);
        Assert.Equal(8, decoded.Height);
        Assert.Equal(SKColors.White, decoded.GetPixel(0, 0));
        Assert.Equal(SKColors.Red, decoded.GetPixel(4, 4));
    }

    [Fact]
    public void Cover_rect_uses_short_side()
    {
        var rect = Imaging.CoverRect(1200, 800, 300, 300);
        Assert.Equal(800, rect.Width);
        Assert.Equal(0, rect.Top);
        Assert.Equal(800, rect.Height);
        Assert.Equal(200, rect.Left);
    }

    [Fact]
    public void Rotate_90cw_moves_top_left_to_top_right()
    {
        using var source = Square();
        using var rotated = Imaging.Orient(source, SKEncodedOrigin.RightTop);

        // (x,y) -> (h-1-y, x)
        Assert.Equal(SKColors.Red, rotated.GetPixel(1, 0));
        Assert.Equal(SKColors.Green, rotated.GetPixel(1, 1));
        Assert.Equal(SKColors.Blue, rotated.GetPixel(0, 0));
        Assert.Equal(SKColors.White, rotated.GetPixel(0, 1));
    }

    [Fact]
    public void Transpose_mirrors_across_diagonal()
    {
        using var source = Square();
        using var transposed = Imaging.Orient(source, SKEncodedOrigin.LeftTop);

        // (x,y) -> (y,x)
        Assert.Equal(SKColors.Red, transposed.GetPixel(0, 0));
        Assert.Equal(SKColors.Blue, transposed.GetPixel(1, 0));
        Assert.Equal(SKColors.Green, transposed.GetPixel(0, 1));
        Assert.Equal(SKColors.White, transposed.GetPixel(1, 1));
    }

    [Fact]
    public void Render_returns_webp_bytes()
    {
        using var source = Square();
        var bytes = Imaging.Render(source, Fill);

        Assert.True(bytes.Length > 0);
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        Assert.Equal("WEBP", System.Text.Encoding.ASCII.GetString(bytes, 8, 4));
    }

    static SKBitmap Square()
    {
        var bitmap = new SKBitmap(2, 2);
        bitmap.SetPixel(0, 0, SKColors.Red);
        bitmap.SetPixel(1, 0, SKColors.Green);
        bitmap.SetPixel(0, 1, SKColors.Blue);
        bitmap.SetPixel(1, 1, SKColors.White);
        return bitmap;
    }
}
