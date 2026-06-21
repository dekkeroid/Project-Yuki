#pragma warning disable CS0067, CS0414
using System;
using UnityEngine;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Yuki.UnityFrontend.Desktop
{
    public sealed class YukiSystemTrayController : MonoBehaviour
    {
        [SerializeField] private DesktopOverlayController overlayController;
        [SerializeField] private string tooltip = "Yuki Desktop Assistant";

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct NOTIFYICONDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public int uID;
            public int uFlags;
            public int uCallbackMessage;
            public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string szTip;
            public int dwState;
            public int dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string szInfo;
            public int uVersionOrTimeout;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string szInfoTitle;
            public int dwInfoFlags;
            public Guid guidItem;
            public IntPtr hBalloonIcon;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Auto)]
        private static extern bool Shell_NotifyIcon(int dwMessage, ref NOTIFYICONDATA lpData);

        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr LoadIcon(IntPtr hInstance, IntPtr lpIconName);

        private const int NIM_ADD = 0x00000000;
        private const int NIM_MODIFY = 0x00000001;
        private const int NIM_DELETE = 0x00000002;

        private const int NIF_MESSAGE = 0x00000001;
        private const int NIF_ICON = 0x00000002;
        private const int NIF_TIP = 0x00000004;

        private const int IDI_APPLICATION = 32512;

        private NOTIFYICONDATA nid;
        private bool hasTrayIcon = false;
#endif

        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            InitializeTrayIcon();
#endif
        }

        private void OnDestroy()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            RemoveTrayIcon();
#endif
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private void InitializeTrayIcon()
        {
            IntPtr hwnd = GetActiveWindow();
            IntPtr hIcon = LoadIcon(IntPtr.Zero, (IntPtr)IDI_APPLICATION);

            nid = new NOTIFYICONDATA
            {
                cbSize = Marshal.SizeOf(typeof(NOTIFYICONDATA)),
                hWnd = hwnd,
                uID = 1,
                uFlags = NIF_ICON | NIF_TIP,
                hIcon = hIcon,
                szTip = tooltip
            };

            hasTrayIcon = Shell_NotifyIcon(NIM_ADD, ref nid);
            if (!hasTrayIcon)
            {
                Debug.LogError("[SystemTray] Failed to register tray icon.");
            }
        }

        private void RemoveTrayIcon()
        {
            if (hasTrayIcon)
            {
                Shell_NotifyIcon(NIM_DELETE, ref nid);
                hasTrayIcon = false;
            }
        }
#endif
    }
}
