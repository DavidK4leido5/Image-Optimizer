using CloudinaryClone.Shared;
using Npgsql;

namespace UnitTests;

public class TransformTests
{
    [Theory]
    [InlineData("f_webp,h_200,w_300", "w_300,h_200,c_fit,f_webp,q_80")]
    [InlineData("w_200,c_fill", "w_200,c_fill,f_webp,q_80")]
    [InlineData("w_800,f_png,q_60", "w_800,c_fit,f_png,q_60")]
    [InlineData("w_400,h_300,c_fill,f_webp,q_80", "w_400,h_300,c_fill,f_webp,q_80")]
    [InlineData("w_300,h_300,c_fill,g_north", "w_300,h_300,c_fill,g_north,f_webp,q_80")]
    [InlineData("w_300,h_300,c_fill,g_center", "w_300,h_300,c_fill,f_webp,q_80")]
    [InlineData("w_300,h_300,c_pad", "w_300,h_300,c_pad,f_webp,q_80")]
    public void Canonicalises(string input, string expected) =>
        Assert.Equal(expected, Transform.Parse(input).Canonical);

    [Fact]
    public void Hash_is_order_independent_and_short()
    {
        var a = Transform.Parse("w_200,h_200,c_fill");
        var b = Transform.Parse("c_fill,h_200,w_200");

        Assert.Equal(a.Hash, b.Hash);
        Assert.Equal(16, a.Hash.Length);
    }

    [Theory]
    [InlineData("")]
    [InlineData("w_0")]
    [InlineData("w_9000")]
    [InlineData("w_200,c_zoom")]
    [InlineData("w_200,f_gif")]
    [InlineData("z_1")]
    [InlineData("w")]
    [InlineData("w_300,c_fit,g_north")]
    [InlineData("w_300,c_pad")]
    [InlineData("w_300,h_300,c_fill,g_auto")]
    public void Rejects(string input) =>
        Assert.Throws<FormatException>(() => Transform.Parse(input));

    [Fact]
    public void Normalises_postgres_uri()
    {
        var connectionString = Db.Normalize("postgresql://app:p%40ss@db.example.com:6543/cloud?sslmode=require");
        var parsed = new NpgsqlConnectionStringBuilder(connectionString);

        Assert.Equal("db.example.com", parsed.Host);
        Assert.Equal(6543, parsed.Port);
        Assert.Equal("p@ss", parsed.Password);
        Assert.Equal("cloud", parsed.Database);
        Assert.Equal(SslMode.Require, parsed.SslMode);
    }
}
