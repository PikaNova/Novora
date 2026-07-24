using System.Text.Json.Serialization;

namespace ClassIsland.ExamReminder.Models;

public sealed class ExamBoardExam
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("startAt")]
    public DateTimeOffset StartAt { get; set; }

    [JsonPropertyName("endAt")]
    public DateTimeOffset EndAt { get; set; }

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "major";

    [JsonPropertyName("sourceName")]
    public string SourceName { get; set; } = string.Empty;

    [JsonPropertyName("note")]
    public string Note { get; set; } = string.Empty;
}

public sealed class ExamBoardBinding
{
    [JsonPropertyName("classTag")]
    public string ClassTag { get; set; } = string.Empty;
}

public sealed class ExamBoardBootstrapResponse
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; }

    [JsonPropertyName("apiVersion")]
    public int ApiVersion { get; set; } = 1;

    [JsonPropertyName("capabilities")]
    public List<string> Capabilities { get; set; } = [];

    [JsonPropertyName("serverTime")]
    public DateTimeOffset ServerTime { get; set; }

    [JsonPropertyName("binding")]
    public ExamBoardBinding? Binding { get; set; }

    [JsonPropertyName("viewerOnline")]
    public bool ViewerOnline { get; set; }

    [JsonPropertyName("exams")]
    public List<ExamBoardExam> Exams { get; set; } = [];

    [JsonPropertyName("updatedAt")]
    public long UpdatedAt { get; set; }
}

public sealed class PairStatusResponse
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("paired")]
    public bool Paired { get; set; }

    [JsonPropertyName("apiVersion")]
    public int ApiVersion { get; set; } = 1;

    [JsonPropertyName("classTag")]
    public string? ClassTag { get; set; }

    [JsonPropertyName("pairExpiresAt")]
    public long? PairExpiresAt { get; set; }
}

public sealed record ClientResult<T>(T? Value, string? Error)
{
    public bool IsSuccess => Value is not null && Error is null;

    public static ClientResult<T> Success(T value) => new(value, null);

    public static ClientResult<T> Failure(string error) => new(default, error);
}
