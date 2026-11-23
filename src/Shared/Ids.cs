using System.Security.Cryptography;

namespace CloudinaryClone.Shared;

public static class Ids
{
    public static string New() => Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
}
