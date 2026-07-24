using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Enums.SettingsWindow;
using ClassIsland.ExamReminder.Models;
using ClassIsland.ExamReminder.Services;

namespace ClassIsland.ExamReminder.Views;

[SettingsPageInfo(
    "classisland.exam-reminder.settings",
    "考试提醒",
    "\uE7C0",
    "\uE7C0",
    SettingsPageCategory.External)]
public sealed class ExamReminderSettingsPage : SettingsPageBase
{
    private readonly PluginSettingsStore _store;
    private readonly ExamBoardClient _client;
    private readonly ExamReminderProvider _provider;
    private readonly ExamSyncService _syncService;
    private readonly ExternalUriLauncher _uriLauncher;
    private readonly TextBox _urlBox;
    private readonly TextBlock _statusText;
    private readonly TextBlock _classText;
    private readonly TextBlock _syncText;
    private readonly TextBlock _nextExamText;
    private readonly ComboBox _leadTimeBox;
    private readonly CheckBox _autoOpenCheckBox;
    private readonly CheckBox _fifteenMinuteCheckBox;
    private readonly CheckBox _fiveMinuteCheckBox;
    private readonly CheckBox _startCheckBox;

    public ExamReminderSettingsPage(
        PluginSettingsStore store,
        ExamBoardClient client,
        ExamReminderProvider provider,
        ExamSyncService syncService,
        ExternalUriLauncher uriLauncher)
    {
        _store = store;
        _client = client;
        _provider = provider;
        _syncService = syncService;
        _uriLauncher = uriLauncher;

        _urlBox = new TextBox
        {
            Watermark = "https://exam.example.com",
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        _statusText = StatusText();
        _classText = ValueText();
        _syncText = ValueText();
        _nextExamText = ValueText();
        _leadTimeBox = new ComboBox
        {
            ItemsSource = new[] { 20, 25, 30, 45, 60, 90, 120 },
            MinWidth = 140,
        };
        _autoOpenCheckBox = new CheckBox { Content = "自动打开 Novora 看板" };
        _fifteenMinuteCheckBox = new CheckBox { Content = "开考前 15 分钟提醒" };
        _fiveMinuteCheckBox = new CheckBox { Content = "开考前 5 分钟提醒" };
        _startCheckBox = new CheckBox { Content = "开考时提醒" };

        var connectButton = new Button { Content = "连接并在浏览器中绑定" };
        connectButton.Click += async (_, _) => await ConnectAsync();
        var syncButton = new Button { Content = "立即同步" };
        syncButton.Click += (_, _) =>
        {
            _store.Update(value => value.LastStatus = "正在同步 Novora 看板…");
            _syncService.RequestImmediateSync();
        };
        var testButton = new Button { Content = "测试提醒" };
        testButton.Click += (_, _) => _provider.ShowTestReminder();
        var openButton = new Button { Content = "打开 Novora 看板" };
        openButton.Click += (_, _) => OpenBoard();

        _leadTimeBox.SelectionChanged += (_, _) =>
        {
            if (_leadTimeBox.SelectedItem is int minutes)
            {
                _store.Update(value => value.BrowserLeadMinutes = Math.Max(20, minutes));
            }
        };
        _autoOpenCheckBox.Click += (_, _) => SaveSwitches();
        _fifteenMinuteCheckBox.Click += (_, _) => SaveSwitches();
        _fiveMinuteCheckBox.Click += (_, _) => SaveSwitches();
        _startCheckBox.Click += (_, _) => SaveSwitches();

        Content = new ScrollViewer
        {
            Content = new StackPanel
            {
                Margin = new Thickness(20),
                Spacing = 16,
                Children =
                {
                    new TextBlock { Text = "考试提醒", FontSize = 24, FontWeight = FontWeight.SemiBold },
                    new TextBlock
                    {
                        Text = "连接学校 Novora 看板后，插件会同步当前浏览器绑定的班级，并在开考前提醒。",
                        TextWrapping = TextWrapping.Wrap,
                        Opacity = 0.72,
                    },
                    Section("Novora 看板连接", new StackPanel
                    {
                        Spacing = 10,
                        Children =
                        {
                            Label("Novora 网址"),
                            _urlBox,
                            new TextBlock
                            {
                                Text = "只需填写部署网址，接口、配对页和考试大屏路径会自动补全。",
                                TextWrapping = TextWrapping.Wrap,
                                FontSize = 12,
                                Opacity = 0.64,
                            },
                            ButtonRow(connectButton, openButton),
                            _statusText,
                        },
                    }),
                    Section("设备状态", new StackPanel
                    {
                        Spacing = 8,
                        Children =
                        {
                            KeyValue("绑定班级", _classText),
                            KeyValue("最近同步", _syncText),
                            KeyValue("下一场考试", _nextExamText),
                            ButtonRow(syncButton, testButton),
                        },
                    }),
                    Section("提醒与浏览器", new StackPanel
                    {
                        Spacing = 10,
                        Children =
                        {
                            new StackPanel
                            {
                                Orientation = Orientation.Horizontal,
                                Spacing = 12,
                                Children = { Label("提前打开"), _leadTimeBox, new TextBlock { Text = "分钟", VerticalAlignment = VerticalAlignment.Center } },
                            },
                            new TextBlock
                            {
                                Text = "提前时间不得少于 20 分钟，确保考试大屏能收到第一条 15 分钟提醒。",
                                TextWrapping = TextWrapping.Wrap,
                                FontSize = 12,
                                Opacity = 0.64,
                            },
                            _autoOpenCheckBox,
                            _fifteenMinuteCheckBox,
                            _fiveMinuteCheckBox,
                            _startCheckBox,
                        },
                    }),
                },
            },
        };

        _store.Changed += StoreOnChanged;
        Refresh();
    }

    private async Task ConnectAsync()
    {
        if (!ExamBoardUrls.TryNormalizeBaseUrl(_urlBox.Text ?? string.Empty, out var baseUrl, out var error))
        {
            _store.Update(value => value.LastStatus = error);
            return;
        }

        var pairToken = PluginSettings.CreateSecret();
        _store.Update(value =>
        {
            value.BaseUrl = baseUrl;
            value.IsPaired = false;
            value.BoundClassTag = string.Empty;
            value.PendingPairToken = pairToken;
            value.PairExpiresAt = DateTimeOffset.Now.AddMinutes(5);
            value.LastStatus = "正在创建浏览器配对…";
        });

        var settings = _store.Settings;
        var result = await _client.StartPairingAsync(
            settings.BaseUrl,
            settings.PluginInstanceId,
            settings.ClientSecret,
            pairToken);
        if (!result.IsSuccess || result.Value is null)
        {
            _store.Update(value =>
            {
                value.PendingPairToken = string.Empty;
                value.PairExpiresAt = null;
                value.LastStatus = result.Error ?? "无法创建浏览器配对";
            });
            return;
        }

        if (_uriLauncher.TryOpen(result.Value, out var launchError))
        {
            _store.Update(value => value.LastStatus = "请在浏览器中确认班级绑定");
            _syncService.RequestImmediateSync();
        }
        else
        {
            _store.Update(value => value.LastStatus = $"无法打开浏览器：{launchError}");
        }
    }

    private void SaveSwitches()
    {
        _store.Update(value =>
        {
            value.AutoOpenBoard = _autoOpenCheckBox.IsChecked == true;
            value.EnableFifteenMinuteReminder = _fifteenMinuteCheckBox.IsChecked == true;
            value.EnableFiveMinuteReminder = _fiveMinuteCheckBox.IsChecked == true;
            value.EnableStartReminder = _startCheckBox.IsChecked == true;
        });
    }

    private void OpenBoard()
    {
        var settings = _store.Settings;
        if (string.IsNullOrWhiteSpace(settings.BaseUrl))
        {
            _store.Update(value => value.LastStatus = "请先填写 Novora 网址");
            return;
        }
        if (!_uriLauncher.TryOpen(
                ExamBoardUrls.Board(settings.BaseUrl, settings.PluginInstanceId),
                out var launchError))
        {
            _store.Update(value => value.LastStatus = $"无法打开系统默认浏览器：{launchError}");
        }
    }

    private void StoreOnChanged(object? sender, EventArgs e) => Dispatcher.UIThread.Post(Refresh);

    private void Refresh()
    {
        var settings = _store.Settings;
        if (!_urlBox.IsFocused)
        {
            _urlBox.Text = settings.BaseUrl;
        }
        _statusText.Text = settings.LastStatus;
        _classText.Text = settings.IsPaired && !string.IsNullOrWhiteSpace(settings.BoundClassTag)
            ? settings.BoundClassTag
            : "尚未绑定";
        _syncText.Text = settings.LastSyncAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? "尚未同步";
        _nextExamText.Text = settings.NextExamStartAt is null
            ? "暂无考试"
            : $"{settings.NextExamName} · {settings.NextExamStartAt.Value.ToLocalTime():MM-dd HH:mm}";
        _leadTimeBox.SelectedItem = settings.BrowserLeadMinutes;
        _autoOpenCheckBox.IsChecked = settings.AutoOpenBoard;
        _fifteenMinuteCheckBox.IsChecked = settings.EnableFifteenMinuteReminder;
        _fiveMinuteCheckBox.IsChecked = settings.EnableFiveMinuteReminder;
        _startCheckBox.IsChecked = settings.EnableStartReminder;
    }

    private static Border Section(string title, Control content) => new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(6),
        Padding = new Thickness(16),
        Child = new StackPanel
        {
            Spacing = 12,
            Children =
            {
                new TextBlock { Text = title, FontSize = 16, FontWeight = FontWeight.SemiBold },
                content,
            },
        },
    };

    private static TextBlock Label(string text) => new() { Text = text, FontWeight = FontWeight.Medium };

    private static TextBlock ValueText() => new() { TextWrapping = TextWrapping.Wrap };

    private static TextBlock StatusText() => new() { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeight.Medium };

    private static StackPanel KeyValue(string key, Control value) => new()
    {
        Spacing = 3,
        Children = { new TextBlock { Text = key, FontSize = 12, Opacity = 0.6 }, value },
    };

    private static StackPanel ButtonRow(params Button[] buttons)
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
        };
        foreach (var button in buttons)
        {
            panel.Children.Add(button);
        }
        return panel;
    }
}
