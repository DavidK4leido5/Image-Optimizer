using System.Security.Cryptography;
using System.Text;

namespace CloudinaryClone.Shared;

public static class Secret
{
    /// <summary>Constant-time comparison, no length oracle.</summary>
    public static bool Matches(string? provided, string expected)
    {
        if (string.IsNullOrEmpty(provided) || string.IsNullOrEmpty(expected)) return false;

        var a = SHA256.HashData(Encoding.UTF8.GetBytes(provided));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
