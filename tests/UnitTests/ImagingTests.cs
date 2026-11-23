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
