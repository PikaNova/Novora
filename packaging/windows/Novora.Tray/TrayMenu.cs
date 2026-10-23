using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Novora.Ui;

namespace Novora.Tray;

internal enum TrayItemKind
{
    Normal,
    Heading,
    Status,
    Danger
}

/// <summary>托盘菜单项：字形与语义角色由这里携带，渲染器据此画图标列和配色。</summary>
internal sealed class TrayMenuItem : ToolStripMenuItem
{
    public TrayMenuItem(string text, string glyph = "", TrayItemKind kind = TrayItemKind.Normal, Action? action = null)
        : base(text, null, action is null ? null : (_, _) => action())
    {
        Glyph = glyph;
        Kind = kind;
        if (kind != TrayItemKind.Heading) return;
        Name = "heading";
        Enabled = false;
        AccessibleRole = AccessibleRole.StaticText;
    }

    public string Glyph { get; init; }
    public TrayItemKind Kind { get; set; }
    public bool Healthy { get; set; }
}

/// <summary>
/// 保留 ToolStrip 的键盘导航、无障碍和屏幕边缘摆放，只替换外观：
/// Windows 11 交给 DWM 画圆角，更早版本退回圆角 Region，阴影一律由系统按窗口区域绘制。
/// </summary>
internal sealed class TrayMenu : ContextMenuStrip
{
    private readonly Font bodyFont;
    private readonly Font headingFont;

    public TrayMenuRenderer MenuRenderer { get; }

    public TrayMenu()
    {
        var menuFont = SystemFonts.MenuFont ?? SystemFonts.DefaultFont;
        bodyFont = new Font(menuFont.FontFamily, Math.Max(9F, menuFont.SizeInPoints));
        headingFont = new Font(bodyFont.FontFamily, Math.Max(8.25F, bodyFont.SizeInPoints - 0.75F));
        MenuRenderer = new TrayMenuRenderer(bodyFont);
        Font = bodyFont;
        Renderer = MenuRenderer;
        ShowImageMargin = MenuRenderer.IconsAvailable;
        ShowCheckMargin = false;
        ShowItemToolTips = true;
        AccessibleName = "Novora 托盘菜单";
    }

    protected override CreateParams CreateParams => PopupCorners.DecorateParams(base.CreateParams);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        TrayPopups.Bind(this);
    }

    protected override void OnOpening(System.ComponentModel.CancelEventArgs e)
    {
        base.OnOpening(e);
        MenuRenderer.RefreshTheme(DeviceDpi);
        StylePopup(this);
    }

    public void StylePopup(ToolStripDropDown popup)
    {
        int Scale(int value) => (int)Math.Round(value * popup.DeviceDpi / 96d);
        var tokens = MenuRenderer.Tokens;
        var iconColumn = MenuRenderer.IconsAvailable ? Scale(20) + Scale(4) : 0;
        popup.BackColor = tokens.Card;
        popup.ForeColor = tokens.TextPrimary;
        popup.Renderer = MenuRenderer;
        popup.Font = bodyFont;
        popup.ImageScalingSize = new Size(Scale(20), Scale(20));
        // 横向留白交给条目自己的内边距，否则条目比卡片窄，子菜单会按条目右缘定位而压进主菜单。
        popup.Padding = new Padding(0, Scale(5), 0, Scale(5));

        // 第一遍：定语义、按去掉助记符的文字量宽。
        var content = 0;
        var arrowColumn = 0;
        foreach (ToolStripItem item in popup.Items)
        {
            item.Margin = Padding.Empty;
            item.Font = bodyFont;
            item.ForeColor = tokens.TextPrimary;
            if (item is not TrayMenuItem entry)
            {
                item.Padding = new Padding(Scale(6), Scale(2), Scale(6), Scale(2));
                continue;
            }

            // 图标位只用来占列，真正的像素在 OnRenderItemText 里锚着文字矩形画，行高怎么变都不会错位。
            entry.Image = MenuRenderer.Blank(Scale(20));
            if (entry.Kind == TrayItemKind.Heading)
            {
                entry.Font = headingFont;
                entry.ForeColor = tokens.TextSecondary;
            }
            entry.Padding = new Padding(Scale(5), Scale(3), Scale(7), Scale(3));
            var text = TextRenderer.MeasureText(TrayMenuRenderer.StripMnemonic(entry.Text), entry.Font).Width;
            content = Math.Max(content, text + iconColumn + Scale(12));
            if (entry.HasDropDownItems) arrowColumn = Scale(16);
        }

        content += arrowColumn;

        // 第二遍：把条目宽度钉成同一个值，悬停胶囊才铺满整张卡片，右侧也不会留空列。
        var rows = 0;
        foreach (ToolStripItem item in popup.Items)
        {
            item.AutoSize = false;
            item.Width = item is ToolStripSeparator ? Math.Max(content, Scale(10)) : content;
            item.Height = item switch
            {
                ToolStripSeparator => Scale(7),
                TrayMenuItem { Kind: TrayItemKind.Heading } => Scale(22),
                _ => Scale(27)
            };
            rows += item.Height + item.Margin.Vertical;
        }

        popup.AutoSize = false;
        popup.Width = content + Scale(2);
        popup.Height = rows + popup.Padding.Vertical + Scale(4);

        foreach (ToolStripItem item in popup.Items)
        {
            if (item is not TrayMenuItem { HasDropDownItems: true } parent) continue;
            TrayPopups.Bind(parent.DropDown);
            StylePopup(parent.DropDown);
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        bodyFont.Dispose();
        headingFont.Dispose();
        MenuRenderer.DisposeResources();
    }
}

internal sealed class TrayMenuRenderer(Font bodyFont) : ToolStripProfessionalRenderer
{
    private const string GlyphFamily = "Segoe MDL2 Assets";
    private readonly Font glyphFont = new(GlyphFamily, Math.Max(10F, bodyFont.SizeInPoints));
    private readonly Dictionary<(int CodePoint, int Size, int Argb), Bitmap> icons = [];
    private readonly Dictionary<int, Bitmap> blanks = [];

    public UiTokens Tokens { get; private set; } = UiTokens.Light;
    public bool IconsAvailable { get; } = FontInstalled(GlyphFamily);

    public void RefreshTheme(int deviceDpi)
    {
        Tokens = ResolveTokens();
        foreach (var cached in icons.Values) cached.Dispose();
        icons.Clear();
    }

    /// <summary>字形按整数字号做灰度抗锯齿栅格化，并裁成紧贴水墨的位图；绘制位置由文字矩形决定。</summary>
    public Bitmap? Icon(string glyph, Color color, int size)
    {
        if (!IconsAvailable || string.IsNullOrEmpty(glyph)) return null;
        var key = (char.ConvertToUtf32(glyph, 0), size, color.ToArgb());
        if (icons.TryGetValue(key, out var cached)) return cached;
        var pixel = Math.Max(12, (int)Math.Round(size * 0.82f));
        using var font = new Font(glyphFont.FontFamily, pixel, GraphicsUnit.Pixel);
        var pad = size;
        using var cell = new Bitmap(size + pad * 2, size + pad * 2, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(cell))
        {
            graphics.Clear(Color.Transparent);
            // 必须走 GDI+：TextRenderer 在透明缓冲上把次像素抗锯齿写进 RGB、alpha 留成全不透明，
            // 贴到浅底上笔画会被补粗发糊，深底上则带蓝橙彩边。
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using var brush = new SolidBrush(color);
            using var layout = new StringFormat
            {
                Alignment = StringAlignment.Near,
                LineAlignment = StringAlignment.Near,
                FormatFlags = StringFormatFlags.NoWrap,
            };
            graphics.DrawString(glyph, font, brush, new RectangleF(pad, pad, size, size), layout);
        }

        var ink = InkBox(cell);
        // Clone 是逐像素拷贝，配最近邻绘制即不再产生第二次插值。
        var bitmap = cell.Clone(new Rectangle(ink.X, ink.Y, ink.Width, ink.Height), PixelFormat.Format32bppArgb);
        icons[key] = bitmap;
        return bitmap;
    }

    /// <summary>字形的水墨包围盒只能实测：不同图形的留白差别很大。</summary>
    private static Rectangle InkBox(Bitmap source)
    {
        var minX = int.MaxValue; var minY = int.MaxValue; var maxX = -1; var maxY = -1;
        for (var y = 0; y < source.Height; y++)
        {
            for (var x = 0; x < source.Width; x++)
            {
                if (source.GetPixel(x, y).A < 24) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        return maxX < 0 ? new Rectangle(0, 0, source.Width, source.Height) : new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    public Bitmap Blank(int size)
    {
        // 标题行占一个同尺寸空位，文字列就由 ToolStrip 按和其它项完全相同的路径算，任何 DPI 都对齐。
        if (blanks.TryGetValue(size, out var cached)) return cached;
        var bitmap = new Bitmap(size, size);
        blanks[size] = bitmap;
        return bitmap;
    }


    private static UiTokens ResolveTokens()
    {
        if (SystemInformation.HighContrast)
        {
            return new UiTokens(
                card: SystemColors.Menu,
                hover: SystemColors.Highlight,
                pressed: SystemColors.Highlight,
                border: SystemColors.WindowFrame,
                textPrimary: SystemColors.MenuText,
                textSecondary: SystemColors.GrayText,
                textTertiary: SystemColors.GrayText,
                success: SystemColors.MenuText,
                danger: SystemColors.MenuText);
        }
        return SystemPrefersDark() ? UiTokens.Dark : UiTokens.Light;
    }

    private static bool SystemPrefersDark()
    {
        // 与控制中心同一份验收开关，只影响本进程：两种主题都要能真机核对。
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
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or IOException or InvalidOperationException)
        {
            return false;
        }
    }

    private static bool FontInstalled(string family)
    {
        try
        {
            using var collection = new System.Drawing.Text.InstalledFontCollection();
            return collection.Families.Any(candidate => string.Equals(candidate.Name, family, StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception error) when (error is OutOfMemoryException or ArgumentException)
        {
            return false;
        }
    }

    private Color Foreground(ToolStripItem item) => item switch
    {
        TrayMenuItem { Kind: TrayItemKind.Heading } => Tokens.TextSecondary,
        TrayMenuItem { Kind: TrayItemKind.Danger } when item.Enabled => Tokens.Danger,
        _ when !item.Enabled => Tokens.TextTertiary,
        _ => item.Selected && SystemInformation.HighContrast ? SystemColors.HighlightText : Tokens.TextPrimary
    };

    private static int Scale(ToolStrip? strip, int value) => (int)Math.Round(value * (strip?.DeviceDpi ?? 96) / 96d);

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = CardShape.Rounded(e.AffectedBounds, Scale(e.ToolStrip, 8));
        using var brush = new SolidBrush(Tokens.Card);
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = CardShape.Rounded(Rectangle.Inflate(e.AffectedBounds, -1, -1), Scale(e.ToolStrip, 8));
        using var pen = new Pen(Tokens.Border);
        e.Graphics.DrawPath(pen, path);
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (e.Item is not TrayMenuItem entry || !entry.Enabled) return;
        if (!entry.Selected && !entry.Pressed) return;
        var bounds = new Rectangle(Scale(e.ToolStrip, 4), Scale(e.ToolStrip, 1),
            e.Item.Width - Scale(e.ToolStrip, 8), e.Item.Height - Scale(e.ToolStrip, 2));
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        var baseColor = entry.Pressed ? Tokens.Pressed : Tokens.Hover;
        var fill = entry.Kind == TrayItemKind.Danger ? Mix(baseColor, Tokens.Danger, 0.14f) : baseColor;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        if (SystemInformation.HighContrast)
        {
            using var plain = new SolidBrush(fill);
            e.Graphics.FillRectangle(plain, bounds);
            return;
        }
        using var path = CardShape.Rounded(bounds, Scale(e.ToolStrip, 5));
        using var brush = new SolidBrush(fill);
        e.Graphics.FillPath(brush, path);
    }

    /// <summary>图标和状态点都锚在文字矩形上：与文字同一垂直基准，且不受 ToolStrip 图片摆位影响。</summary>
    private void DrawLeadingIcon(ToolStripItemTextRenderEventArgs e)
    {
        if (e.Item is not TrayMenuItem entry) return;
        var dpi = e.ToolStrip?.DeviceDpi ?? 96;
        int S(int value) => (int)Math.Round(value * dpi / 96d);
        var slot = S(20);
        var box = e.TextRectangle;
        var columnLeft = box.X - slot - S(4);
        var middle = box.Y + (box.Height / 2);
        if (entry.Kind == TrayItemKind.Status)
        {
            var dot = S(8);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(entry.Healthy ? Tokens.Success : Tokens.Danger);
            e.Graphics.FillEllipse(brush, columnLeft + (slot - dot) / 2, middle - (dot / 2) - S(1), dot, dot);
            return;
        }

        if (entry.Kind == TrayItemKind.Heading || !IconsAvailable || string.IsNullOrEmpty(entry.Glyph)) return;
        var color = !entry.Enabled ? Tokens.TextTertiary
            : entry.Kind == TrayItemKind.Danger ? Tokens.Danger : Tokens.TextPrimary;
        var ink = Icon(entry.Glyph, color, slot);
        if (ink is null) return;
        e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
        e.Graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.None;
        e.Graphics.SmoothingMode = SmoothingMode.None;
        e.Graphics.DrawImage(ink, new Rectangle(columnLeft + Math.Max(1, slot / 16), middle - (ink.Height / 2) - S(1), ink.Width, ink.Height));
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        DrawLeadingIcon(e);
        e.TextColor = Foreground(e.Item);
        // 访问键照常可用，只按 Windows 11 的默认样式不画 "&" 和下划线。
        TextRenderer.DrawText(e.Graphics, StripMnemonic(e.Text), e.TextFont, e.TextRectangle, e.TextColor,
            e.TextFormat | TextFormatFlags.NoPrefix);
    }

    internal static string StripMnemonic(string? text)
    {
        if (string.IsNullOrEmpty(text) || !text.Contains('&', StringComparison.Ordinal)) return text ?? string.Empty;
        var builder = new System.Text.StringBuilder(text.Length);
        for (var index = 0; index < text.Length; index++)
        {
            if (text[index] != '&')
            {
                builder.Append(text[index]);
                continue;
            }
            if (index + 1 < text.Length && text[index + 1] == '&')
            {
                builder.Append('&');
                index++;
            }
        }
        return builder.ToString();
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        var inset = Scale(e.ToolStrip, 12);
        using var pen = new Pen(Tokens.Border);
        e.Graphics.DrawLine(pen, inset, e.Item.Height / 2, Math.Max(inset, e.Item.Width - inset), e.Item.Height / 2);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var color = e.Item is null ? Tokens.TextSecondary : Foreground(e.Item);
        using var pen = new Pen(color, 1.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        var center = new Point(e.ArrowRectangle.Left + e.ArrowRectangle.Width / 2, e.ArrowRectangle.Top + e.ArrowRectangle.Height / 2);
        var arm = Math.Max(3, e.ArrowRectangle.Height / 4);
        PointF[] chevron =
        [
            new PointF(center.X - arm / 2f, center.Y - arm),
            new PointF(center.X + arm / 2f, center.Y),
            new PointF(center.X - arm / 2f, center.Y + arm)
        ];
        e.Graphics.DrawLines(pen, chevron);
    }

    private static Color Mix(Color back, Color front, float amount) => Color.FromArgb(
        (int)Math.Round(back.R + (front.R - back.R) * amount),
        (int)Math.Round(back.G + (front.G - back.G) * amount),
        (int)Math.Round(back.B + (front.B - back.B) * amount));

    // ToolStripRenderer 的 Dispose(bool) 在 .NET 8 是 private protected，这里只能自备一份清理入口。
    public void DisposeResources()
    {
        glyphFont.Dispose();
        foreach (var cached in icons.Values) cached.Dispose();
        foreach (var cached in blanks.Values) cached.Dispose();
        icons.Clear();
        blanks.Clear();
    }
}

internal static class CardShape
{
    public static GraphicsPath Rounded(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        if (bounds.Width <= 1 || bounds.Height <= 1)
        {
            path.AddRectangle(bounds);
            return path;
        }
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width - 1, bounds.Height - 1));
        var rect = new Rectangle(bounds.X, bounds.Y, Math.Max(1, bounds.Width - 1), Math.Max(1, bounds.Height - 1));
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

/// <summary>主菜单之外的子菜单没有自己的类型，用这张表按实例挂住圆角状态。</summary>
internal static class TrayPopups
{
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ToolStripDropDown, PopupCorners> bound = new();

    public static void Bind(ToolStripDropDown popup)
    {
        if (bound.TryGetValue(popup, out _)) return;
        var corners = new PopupCorners(popup);
        bound.Add(popup, corners);
        popup.HandleCreated += (_, _) => corners.Apply();
        popup.SizeChanged += (_, _) => corners.Apply();
        corners.Apply();
    }
}

/// <summary>
/// 把弹出窗体收成圆角卡片：Windows 11 交给 DWM（抗锯齿，阴影由系统跟随窗口区域），
/// 更早版本或 DWM 调用失败时退回圆角 Region。
/// </summary>
internal sealed class PopupCorners(ToolStripDropDown popup) : IDisposable
{
    private const int CornerPreference = 33;
    private const int RoundPreference = 2;
    private const int ClassDropShadow = 0x00020000;
    private Region? region;
    private bool dwmRounded;

    public static CreateParams DecorateParams(CreateParams parameters)
    {
        parameters.ClassStyle |= ClassDropShadow;
        return parameters;
    }

    public void Apply()
    {
        if (!popup.IsHandleCreated) return;
        if (!dwmRounded && Environment.OSVersion.Version.Build >= 22000)
        {
            var preference = RoundPreference;
            dwmRounded = DwmSetWindowAttribute(popup.Handle, CornerPreference, ref preference, sizeof(int)) == 0;
        }
        if (dwmRounded) return;
        var radius = (int)Math.Round(8 * popup.DeviceDpi / 96d);
        var next = new Region(CardShape.Rounded(new Rectangle(0, 0, popup.ClientSize.Width, popup.ClientSize.Height), radius));
        var previous = region;
        popup.Region = next;
        region = next;
        previous?.Dispose();
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public void Dispose()
    {
        region?.Dispose();
        region = null;
    }
}
