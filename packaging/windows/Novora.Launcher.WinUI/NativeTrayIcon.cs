using System.Runtime.InteropServices;
using Windows.Graphics;

namespace Novora.Launcher.WinUI;

internal enum TrayIconCommand { OpenMenu, OpenStatus, OpenApplication }

/// <summary>
/// Hosts the Explorer notification icon in the resident WinUI process. Keeping
/// the shell callback here avoids launching a second tray executable and lets
/// every tray request reuse the already initialized WinUI runtime.
/// </summary>
internal sealed class NativeTrayIcon : IDisposable
{
    private const uint WmApp = 0x8000;
    private const uint WmTrayCallback = WmApp + 42;
    private const int WmLButtonUp = 0x0202;
    private const int WmLButtonDoubleClick = 0x0203;
    private const int WmRButtonUp = 0x0205;
    private const uint NimAdd = 0;
    private const uint NimDelete = 2;
    private const uint NifMessage = 1;
    private const uint NifIcon = 2;
    private const uint NifTip = 4;
    private const uint ImageIcon = 1;
    private const uint LoadFromFile = 0x0010;
    private const uint LoadDefaultSize = 0x0040;
    private const uint CsDoubleClicks = 0x0008;
    private const int SwHide = 0;
    private static readonly string WindowClassName = $"NovoraTrayMessageWindow.{Environment.ProcessId}";
    private static readonly WindowProc WindowProcedure = WndProc;
    private static NativeTrayIcon? current;
    private static uint taskbarCreatedMessage;

    private readonly Action<TrayIconCommand, PointInt32> onCommand;
    private readonly IntPtr iconHandle;
    private readonly bool ownsIcon;
    private IntPtr windowHandle;
    private bool disposed;

    public NativeTrayIcon(string iconPath, Action<TrayIconCommand, PointInt32> onCommand)
    {
        this.onCommand = onCommand;
        current = this;
        taskbarCreatedMessage = RegisterWindowMessage("TaskbarCreated");
        RegisterMessageWindowClass();
        var instance = GetModuleHandle(null);
        windowHandle = CreateWindowEx(0, WindowClassName, "Novora Tray Host", 0,
            0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        if (windowHandle == IntPtr.Zero) throw new InvalidOperationException("无法创建 Novora 托盘消息窗口。");

        iconHandle = LoadImage(IntPtr.Zero, iconPath, ImageIcon, 0, 0, LoadFromFile | LoadDefaultSize);
        ownsIcon = iconHandle != IntPtr.Zero;
        AddIcon();
    }

    private static void RegisterMessageWindowClass()
    {
        var instance = GetModuleHandle(null);
        var windowClass = new WindowClass
        {
            Size = (uint)Marshal.SizeOf<WindowClass>(),
            Style = CsDoubleClicks,
            WindowProcedure = WindowProcedure,
            Instance = instance,
            ClassName = WindowClassName
        };
        if (RegisterClassEx(ref windowClass) == 0 && Marshal.GetLastWin32Error() != 1410)
            throw new InvalidOperationException("无法注册 Novora 托盘消息窗口。");
    }

    private void AddIcon()
    {
        if (windowHandle == IntPtr.Zero) return;
        var data = new NotifyIconData
        {
            Size = (uint)Marshal.SizeOf<NotifyIconData>(),
            Window = windowHandle,
            Id = 1,
            Flags = NifMessage | NifIcon | NifTip,
            CallbackMessage = WmTrayCallback,
            Icon = iconHandle,
            Tip = "Novora 学校服务端"
        };
        if (!Shell_NotifyIcon(NimAdd, ref data))
            throw new InvalidOperationException("Windows 未能创建 Novora 托盘图标。");
    }

    private void OnShellMessage(int message)
    {
        var command = message switch
        {
            WmRButtonUp => TrayIconCommand.OpenMenu,
            WmLButtonDoubleClick => TrayIconCommand.OpenApplication,
            WmLButtonUp => TrayIconCommand.OpenStatus,
            _ => (TrayIconCommand?)null
        };
        if (command is null) return;
        GetCursorPos(out var cursor);
        onCommand(command.Value, new PointInt32(cursor.X, cursor.Y));
    }

    private static IntPtr WndProc(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WmTrayCallback)
        {
            current?.OnShellMessage(lParam.ToInt32());
            return IntPtr.Zero;
        }
        if (taskbarCreatedMessage != 0 && message == taskbarCreatedMessage)
        {
            current?.AddIcon();
            return IntPtr.Zero;
        }
        return DefWindowProc(hWnd, message, wParam, lParam);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (windowHandle != IntPtr.Zero)
        {
            var data = new NotifyIconData
            {
                Size = (uint)Marshal.SizeOf<NotifyIconData>(),
                Window = windowHandle,
                Id = 1
            };
            Shell_NotifyIcon(NimDelete, ref data);
            ShowWindow(windowHandle, SwHide);
            DestroyWindow(windowHandle);
            windowHandle = IntPtr.Zero;
        }
        if (ownsIcon && iconHandle != IntPtr.Zero) DestroyIcon(iconHandle);
        if (ReferenceEquals(current, this)) current = null;
        GC.KeepAlive(WindowProcedure);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public uint Size;
        public uint Style;
        public WindowProc WindowProcedure;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public string? MenuName;
        public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint Size;
        public IntPtr Window;
        public uint Id;
        public uint Flags;
        public uint CallbackMessage;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr WindowProc(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WindowClass windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr LoadIcon(IntPtr instance, IntPtr iconName);
    [DllImport("user32.dll")]
    private static extern IntPtr DestroyIcon(IntPtr icon);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);
}
