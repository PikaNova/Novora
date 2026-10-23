using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Composition.SystemBackdrops;
using Windows.UI;

namespace Novora.Launcher.WinUI;

internal static class FluentUi
{
    // Keep the launcher readable when it runs unpackaged.  The WinUI resource
    // dictionary can resolve theme brushes to white before a theme is applied,
    // which made headings disappear on the light surface.  These palette values
    // intentionally follow the light WinUI surface/ink contrast.
    public static Brush PrimaryBrush => Solid(Color.FromArgb(255, 31, 31, 31));
    public static Brush SecondaryBrush => Solid(Color.FromArgb(255, 91, 91, 91));
    public static Brush AccentBrush => Solid(Color.FromArgb(255, 0, 95, 184));
    public static Brush PageBackgroundBrush => Solid(Color.FromArgb(255, 243, 243, 243));
    public static Brush CardBackgroundBrush => Solid(Color.FromArgb(255, 255, 255, 255));
    public static Brush CardStrokeBrush => Solid(Color.FromArgb(255, 184, 184, 184));
    public static Brush LayerBrush => Solid(Color.FromArgb(255, 249, 249, 249));

    public static ContentDialog LightDialog(ContentDialog dialog)
    {
        dialog.RequestedTheme = ElementTheme.Light;
        dialog.Background = CardBackgroundBrush;
        dialog.Foreground = PrimaryBrush;
        return dialog;
    }

    public static TextBlock PageTitle(string text) => new()
    {
        Text = text,
        Style = (Style)Application.Current.Resources["TitleTextBlockStyle"],
        Foreground = PrimaryBrush,
        TextWrapping = TextWrapping.Wrap
    };

    public static TextBlock Secondary(string text) => new()
    {
        Text = text,
        Style = (Style)Application.Current.Resources["BodyTextBlockStyle"],
        Foreground = SecondaryBrush,
        TextWrapping = TextWrapping.Wrap
    };

    public static Border Card(UIElement content, Thickness padding) => new()
    {
        Child = content,
        Padding = padding,
        CornerRadius = new CornerRadius(6),
        BorderThickness = new Thickness(1),
        BorderBrush = CardStrokeBrush,
        Background = CardBackgroundBrush
    };

    public static Border Divider() => new()
    {
        Height = 1,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Background = CardStrokeBrush
    };

    public static void ApplyBackdrop(Window window)
    {
        if (Environment.OSVersion.Version.Build < 22000) return;
        try { window.SystemBackdrop = new MicaBackdrop { Kind = MicaKind.BaseAlt }; }
        catch { }
    }

    private static Brush Solid(Color color) => new SolidColorBrush(color);
}
