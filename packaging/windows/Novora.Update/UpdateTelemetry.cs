using System.Text.Json;

namespace Novora.Update;

public sealed record TelemetrySettings(bool Enabled, string InstallationId);

/// <summary>Opt-in, anonymous update observations with a small per-user durable outbox.</summary>
public sealed class UpdateTelemetry(UpdateTrust trust, HttpMessageHandler? handler = null, string? optedInInstallationId = null, string? stateDirectory = null) : IDisposable
{
    private readonly string directoryPath = stateDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Novora", "update-telemetry");
    private string SettingsPath => Path.Combine(directoryPath, "settings.json");
    private readonly UpdateClient client = new(handler);
    private TelemetrySettings? EffectiveSettings => UpdateClient.IsUuid(optedInInstallationId ?? "")
        ? new(true, optedInInstallationId!) : ReadSettings();

    public TelemetrySettings? ReadSettings()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return null;
            var settings = JsonSerializer.Deserialize<TelemetrySettings>(UpdatePackage.ReadBounded(SettingsPath, 4096), UpdatePackage.Json);
            return settings is { Enabled: true } && UpdateClient.IsUuid(settings.InstallationId) ? settings : null;
        }
        catch (Exception error) when (error is IOException or InvalidDataException or JsonException or UnauthorizedAccessException) { return null; }
    }

    public void Configure(bool enabled)
    {
        if (!enabled)
        {
            if (File.Exists(SettingsPath)) File.Delete(SettingsPath);
            if (System.IO.Directory.Exists(directoryPath))
                foreach (var file in System.IO.Directory.EnumerateFiles(directoryPath, "*.json"))
                    if (!string.Equals(file, SettingsPath, StringComparison.OrdinalIgnoreCase)) File.Delete(file);
            return;
        }
        var current = ReadSettings();
        if (current is not null) return;
        UpdatePackage.WriteAtomic(SettingsPath, new TelemetrySettings(true, Guid.NewGuid().ToString()));
    }

    public bool Queue(string stage, string currentVersion, string? targetVersion = null, string? errorCode = null, string? attemptId = null, string? source = null)
    {
        var settings = EffectiveSettings;
        if (settings is null) return false;
        var evt = new UpdateEvent(Guid.NewGuid().ToString(), settings.InstallationId,
            attemptId ?? Guid.NewGuid().ToString(), stage, currentVersion, targetVersion, errorCode, source);
        if (!UpdateClient.IsValidEvent(evt)) return false;
        try
        {
            System.IO.Directory.CreateDirectory(directoryPath);
            if (System.IO.Directory.EnumerateFiles(directoryPath, "*.json").Count(x => Guid.TryParse(Path.GetFileNameWithoutExtension(x), out _)) >= 100) return false;
            UpdatePackage.WriteAtomic(Path.Combine(directoryPath, evt.EventId + ".json"), evt);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return false; }
    }

    public async Task FlushAsync(CancellationToken token = default)
    {
        var settings = EffectiveSettings;
        if (settings is null || !System.IO.Directory.Exists(directoryPath)) return;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            var paths = System.IO.Directory.EnumerateFiles(directoryPath, "*.json")
                .Where(x => Guid.TryParse(Path.GetFileNameWithoutExtension(x), out _)).OrderBy(File.GetLastWriteTimeUtc).Take(100).ToArray();
            foreach (var path in paths)
            {
                deadline.Token.ThrowIfCancellationRequested();
                UpdateEvent? evt;
                try { evt = JsonSerializer.Deserialize<UpdateEvent>(UpdatePackage.ReadBounded(path, 4096), UpdatePackage.Json); }
                catch (Exception error) when (error is IOException or InvalidDataException or JsonException or UnauthorizedAccessException) { continue; }
                if (evt is null || !UpdateClient.IsValidEvent(evt) || evt.InstallationId != settings.InstallationId) continue;
                await client.SendEventAsync(trust, evt, deadline.Token);
                File.Delete(path);
            }
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException or InvalidDataException or UnauthorizedAccessException)
        { /* Reporting is best effort; queued events remain for a later attempt. */ }
    }

    public void Dispose() => client.Dispose();
}
