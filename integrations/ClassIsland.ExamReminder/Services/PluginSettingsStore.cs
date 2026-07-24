using ClassIsland.ExamReminder.Models;
using ClassIsland.Shared.Helpers;

namespace ClassIsland.ExamReminder.Services;

public sealed class PluginSettingsStore
{
    private readonly object _gate = new();
    private readonly string _path;

    public PluginSettingsStore(Plugin plugin)
    {
        _path = Path.Combine(plugin.PluginConfigFolder, "Settings.json");
        try
        {
            Settings = ConfigureFileHelper.LoadConfig<PluginSettings>(_path) ?? new PluginSettings();
        }
        catch
        {
            Settings = new PluginSettings();
        }

        Normalize(Settings);
        Save();
    }

    public PluginSettings Settings { get; }

    public event EventHandler? Changed;

    public void Update(Action<PluginSettings> update)
    {
        lock (_gate)
        {
            update(Settings);
            Normalize(Settings);
            SaveUnsafe();
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public bool HasCompletedAction(string key)
    {
        lock (_gate)
        {
            return Settings.CompletedActions.Contains(key, StringComparer.Ordinal);
        }
    }

    public void MarkCompletedAction(string key)
    {
        Update(settings =>
        {
            if (!settings.CompletedActions.Contains(key, StringComparer.Ordinal))
            {
                settings.CompletedActions.Add(key);
            }
            if (settings.CompletedActions.Count > 500)
            {
                settings.CompletedActions.RemoveRange(0, settings.CompletedActions.Count - 500);
            }
        });
    }

    private void Save()
    {
        lock (_gate)
        {
            SaveUnsafe();
        }
    }

    private void SaveUnsafe()
    {
        try
        {
            ConfigureFileHelper.SaveConfig(_path, Settings);
        }
        catch
        {
            // A transient write failure should not stop reminders in the current session.
        }
    }

    private static void Normalize(PluginSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.PluginInstanceId))
        {
            settings.PluginInstanceId = $"classisland-{Guid.NewGuid():N}";
        }
        if (string.IsNullOrWhiteSpace(settings.ClientSecret) || settings.ClientSecret.Length < 32)
        {
            settings.ClientSecret = PluginSettings.CreateSecret();
        }
        settings.BrowserLeadMinutes = Math.Clamp(settings.BrowserLeadMinutes, 20, 120);
        settings.CompletedActions ??= [];
    }
}
