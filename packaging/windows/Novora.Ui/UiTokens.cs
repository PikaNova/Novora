namespace Novora.Ui;

/// <summary>
/// 与控制中心 Themes/Tokens.Light.xaml、Tokens.Dark.xaml 同源的令牌，供 GDI+ 自绘界面取色。
/// 只登记自绘界面真正用到的键，新增时保持两套取值同时补齐。
/// </summary>
public readonly struct UiTokens(
    Color card,
    Color hover,
    Color pressed,
    Color border,
    Color textPrimary,
    Color textSecondary,
    Color textTertiary,
    Color success,
    Color danger)
{
    public Color Card { get; } = card;
    public Color Hover { get; } = hover;
    public Color Pressed { get; } = pressed;
    public Color Border { get; } = border;
    public Color TextPrimary { get; } = textPrimary;
    public Color TextSecondary { get; } = textSecondary;
    public Color TextTertiary { get; } = textTertiary;
    public Color Success { get; } = success;
    public Color Danger { get; } = danger;

    public static UiTokens Light { get; } = new(
        card: Color.FromArgb(255, 255, 255),
        hover: Color.FromArgb(255, 241, 245, 249),
        pressed: Color.FromArgb(255, 230, 237, 246),
        border: Color.FromArgb(255, 221, 229, 238),
        textPrimary: Color.FromArgb(255, 20, 28, 38),
        textSecondary: Color.FromArgb(255, 90, 102, 117),
        textTertiary: Color.FromArgb(255, 139, 151, 166),
        success: Color.FromArgb(255, 22, 128, 60),
        danger: Color.FromArgb(255, 180, 35, 24));

    public static UiTokens Dark { get; } = new(
        card: Color.FromArgb(255, 35, 39, 43),
        hover: Color.FromArgb(255, 44, 50, 56),
        pressed: Color.FromArgb(255, 53, 60, 67),
        border: Color.FromArgb(255, 52, 58, 65),
        textPrimary: Color.FromArgb(255, 233, 235, 237),
        textSecondary: Color.FromArgb(255, 166, 174, 183),
        textTertiary: Color.FromArgb(255, 132, 141, 150),
        success: Color.FromArgb(255, 74, 222, 128),
        danger: Color.FromArgb(255, 248, 113, 113));
}
