using System.Security.Cryptography;

namespace ClassIsland.ExamReminder.Models;

public sealed class PluginSettings
{
    public string BaseUrl { get; set; } = string.Empty;
    public string PluginInstanceId { get; set; } = $"classisland-{Guid.NewGuid():N}";
    public string ClientSecret { get; set; } = CreateSecret();
    public string PendingPairToken { get; set; } = string.Empty;
    public DateTimeOffset? PairExpiresAt { get; set; }
    public string BoundClassTag { get; set; } = string.Empty;
    public bool IsPaired { get; set; }
    public int BrowserLeadMinutes { get; set; } = 20;
    public bool AutoOpenBoard { get; set; } = true;
    public bool EnableFifteenMinuteReminder { get; set; } = true;
    public bool EnableFiveMinuteReminder { get; set; } = true;
    public bool EnableStartReminder { get; set; } = true;
    public DateTimeOffset? LastSyncAt { get; set; }
    public string LastStatus { get; set; } = "请填写 Novora 网址并连接";
    public string NextExamName { get; set; } = string.Empty;
    public DateTimeOffset? NextExamStartAt { get; set; }
    public long ServerOffsetMilliseconds { get; set; }
    public List<string> CompletedActions { get; set; } = [];

    public static string CreateSecret() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
}
