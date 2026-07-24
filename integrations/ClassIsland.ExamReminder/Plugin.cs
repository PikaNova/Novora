using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Extensions.Registry;
using ClassIsland.ExamReminder.Services;
using ClassIsland.ExamReminder.Views;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClassIsland.ExamReminder;

[PluginEntrance]
public class Plugin : PluginBase
{
    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        services.AddSingleton<PluginSettingsStore>();
        services.AddSingleton<ExamBoardClient>();
        services.AddSingleton<ExternalUriLauncher>();
        services.AddSingleton<ExamReminderProvider>();
        services.AddSettingsPage<ExamReminderSettingsPage>();
        services.AddNotificationProvider<ExamReminderProvider>();
        services.AddSingleton<ExamSyncService>();
        services.AddSingleton<IHostedService>(provider => provider.GetRequiredService<ExamSyncService>());
    }
}
