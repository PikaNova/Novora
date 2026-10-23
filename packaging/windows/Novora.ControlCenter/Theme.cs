using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace Novora.ControlCenter;

/// <summary>明暗主题只替换令牌字典；读取系统偏好失败时一律退回浅色，不让外观问题影响启动。</summary>
public static class Theme
{
    private static readonly Uri LightSource = new("/Themes/Tokens.Light.xaml", UriKind.Relative);
    private static readonly Uri DarkSource = new("/Themes/Tokens.Dark.xaml", UriKind.Relative);
    private static bool? applied;

    public static bool IsDark { get; private set; }

    /// <summary>
    /// ClearType 的子像素抗锯齿在深色底上会给中文细笔画镶红蓝边，观感就是"发虚"；
    /// 深色改用灰度抗锯齿，浅色保留 ClearType 的边缘锐度。
    /// </summary>
    public static TextRenderingMode TextRenderMode => IsDark ? TextRenderingMode.Grayscale : TextRenderingMode.ClearType;

    public static void ApplyTextRendering(DependencyObject target) => TextOptions.SetTextRenderingMode(target, TextRenderMode);

    public static void Apply(bool dark)
    {
        if (applied == dark) return;
        var dictionaries = Application.Current?.Resources.MergedDictionaries;
        if (dictionaries is null || dictionaries.Count == 0) return;
        dictionaries[0] = new ResourceDictionary { Source = dark ? DarkSource : LightSource };
        applied = dark;
        IsDark = dark;
        // 主题在运行中翻转时（系统切深浅色），已开着的窗口要跟着换抗锯齿方式。
        var app = Application.Current;
        if (app is not null) foreach (Window window in app.Windows) ApplyTextRendering(window);
    }

    public static bool SystemPrefersDark()
    {
        // 只影响本进程的显式覆盖，便于验收两种主题；不写注册表、不改动用户系统外观。
        var requested = Environment.GetEnvironmentVariable("NOVORA_UI_THEME");
        if (!string.IsNullOrWhiteSpace(requested))
        {
            if (requested.Equals("dark", StringComparison.OrdinalIgnoreCase)) return true;
            if (requested.Equals("light", StringComparison.OrdinalIgnoreCase)) return false;
        }
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        {
            return false;
        }
    }
}
