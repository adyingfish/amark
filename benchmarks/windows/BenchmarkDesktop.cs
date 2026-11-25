using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// A native desktop lets both real app windows stay open without occupying the
// user's interactive desktop. No switch to this desktop or input injection.
public sealed class BenchmarkDesktop : IDisposable {
    readonly string name = "AMarkBenchmark-" + Guid.NewGuid().ToString("N");
    IntPtr desktop;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public int size;
        public string reserved, desktop, title;
        public int x, y, width, height, columns, rows, fill, flags;
        public short show, reservedBytes;
        public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }

    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateDesktopW(string desktop, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr attributes);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inheritHandles, uint flags, IntPtr env, string cwd, ref StartupInfo start, out ProcessInfo info);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    public BenchmarkDesktop() {
        const uint desktopRights = 0x01ff; // Window station's standard desktop-specific rights.
        desktop = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, desktopRights, IntPtr.Zero);
        if (desktop == IntPtr.Zero) throw new Win32Exception();
    }
    public Process Start(string exe, string arguments, string cwd) {
        var start = new StartupInfo { size=Marshal.SizeOf<StartupInfo>(), desktop=name };
        var line = new StringBuilder("\"" + exe + "\" " + arguments);
        ProcessInfo info;
        if (!CreateProcessW(exe, line, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref start, out info))
            throw new Win32Exception();
        try { return Process.GetProcessById(info.pid); }
        finally { CloseHandle(info.thread); CloseHandle(info.process); }
    }
    public void Dispose() {
        if (desktop != IntPtr.Zero) { CloseDesktop(desktop); desktop=IntPtr.Zero; }
    }
}
