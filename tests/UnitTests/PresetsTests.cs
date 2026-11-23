using CloudinaryClone.Shared;

namespace UnitTests;

public sealed class PresetsTests
{
    [Fact]
    public void Names_and_transforms_are_unique()
    {
        Assert.Equal(Presets.All.Count, Presets.All.Select(p => p.Name).Distinct().Count());
        Assert.Equal(Presets.All.Count, Presets.All.Select(p => p.Transform.Canonical).Distinct().Count());
    }

    [Fact]
    public void Width_presets_ascend_without_gaps_in_name()
    {
        var widths = Presets.All
            .Where(p => p.Transform.C == "fit")
            .Select(p => p.Transform.W!.Value)
            .ToArray();

        Assert.Equal(new[] { 320, 480, 768, 1024, 1280, 1600, 1920 }, widths);
    }

    [Fact]
    public void Ratio_presets_crop_to_fixed_boxes()
    {
        Assert.Equal("w_160,h_160,c_fill,f_webp,q_80", Presets.Find("thumb")!.Transform.Canonical);
        Assert.Equal("w_480,h_320,c_fill,f_webp,q_80", Presets.Find("card")!.Transform.Canonical);
        Assert.Equal("w_1920,h_1080,c_fill,f_webp,q_82", Presets.Find("hero")!.Transform.Canonical);
    }

    [Fact]
    public void Lookup_is_case_insensitive_and_rejects_unknown()
    {
        Assert.Equal("lg", Presets.Find("LG")!.Name);
        Assert.Null(Presets.Find("w_1234"));
    }

    [Fact]
    public void Every_preset_parses_back_from_its_canonical_form()
    {
        foreach (var preset in Presets.All)
        {
            var parsed = Transform.Parse(preset.Transform.Canonical);
            Assert.Equal(preset.Transform.Canonical, parsed.Canonical);
        }
    }
}
