#pragma warning disable CS0067, CS0414
using UnityEngine;
using System;
using System.Collections;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Yuki.UnityFrontend.Desktop
{
    public sealed class DesktopOverlayController : MonoBehaviour
    {
        [SerializeField] private bool transparentWindowRequested = true;
        [SerializeField] private bool clickThroughWhenIdle = true;
        [SerializeField] private LayerMask interactiveLayers = ~0;
        [SerializeField] private bool enableFullscreenDetection = true;
        [SerializeField] private float fullscreenPollInterval = 2f;
        [SerializeField] private bool enableGlobalHotkey = true;
        [SerializeField] private int hotkeyId = 9001;
        [SerializeField] private bool hotkeyStartsListening = true;

        private bool isCurrentlyInteractive = true;
        private bool isFullscreen;
        private bool isWindowVisible = true;
        private IntPtr savedHwnd;

        public bool IsFullscreen => isFullscreen;
        public bool IsWindowVisible => isWindowVisible;

        public event Action OnHotkeyTriggered;
        public event Action<bool> OnFullscreenChanged;
        public event Action<bool> OnVisibilityChanged;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

        [DllImport("Dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS
        {
            public int cxLeftWidth;
            public int cxRightWidth;
            public int cyTopHeight;
            public int cyBottomHeight;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        private const int GWL_EXSTYLE = -20;
        private const int GWL_STYLE = -16;

        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_TRANSPARENT = 0x00000020;

        private const int WS_POPUP = unchecked((int)0x80000000);
        private const int WS_VISIBLE = 0x10000000;

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;

        private const uint MOD_ALT = 0x0001;
        private const uint VK_S = 0x53;

        private const int SW_HIDE = 0;
        private const int SW_SHOWNA = 8;
        private const int SW_SHOW = 5;

        private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        private static WndProcDelegate wndProcDelegate;
        private static IntPtr originalWndProc;
        private const int WM_HOTKEY = 0x0312;

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;

        private const int DEFAULT_WINDOW_WIDTH = 320;
        private const int DEFAULT_WINDOW_HEIGHT = 605;
        private const int WINDOW_WIDTH_EXTRA = 120;
#endif

        public bool TransparentWindowRequested => transparentWindowRequested;
        public bool ClickThroughWhenIdle => clickThroughWhenIdle;

        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            savedHwnd = GetActiveWindow();

            if (transparentWindowRequested)
            {
                SetWindowLong(savedHwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);

                int exStyle = GetWindowLong(savedHwnd, GWL_EXSTYLE);
                SetWindowLong(savedHwnd, GWL_EXSTYLE, exStyle | WS_EX_LAYERED);

                SetWindowPos(savedHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

                var margins = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
                DwmExtendFrameIntoClientArea(savedHwnd, ref margins);
            }

            if (enableGlobalHotkey)
            {
                RegisterGlobalHotkey();
            }

            if (enableFullscreenDetection)
            {
                StartCoroutine(FullscreenPollLoop());
            }
#endif
        }

        private void OnDestroy()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (enableGlobalHotkey)
            {
                UnregisterGlobalHotkey();
            }
#endif
        }

        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (transparentWindowRequested)
            {
                bool isOverUI = false;
                if (UnityEngine.EventSystems.EventSystem.current != null)
                {
                    isOverUI = UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject();
                }

                bool isOverCollider = false;
                if (Camera.main != null)
                {
                    Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
                    if (Physics.Raycast(ray, out RaycastHit _, 100f, interactiveLayers))
                    {
                        isOverCollider = true;
                    }
                }

                bool needsInteraction = isOverUI || isOverCollider;
                SetInteractive(needsInteraction);
            }

            ProcessWndProcMessages();
#endif
        }

        public void SetInteractive(bool interactive)
        {
            if (isCurrentlyInteractive == interactive) return;
            isCurrentlyInteractive = interactive;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            IntPtr hwnd = GetActiveWindow();
            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            if (interactive)
            {
                SetWindowLong(hwnd, GWL_EXSTYLE, exStyle & ~WS_EX_TRANSPARENT);
            }
            else
            {
                if (clickThroughWhenIdle)
                {
                    SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_TRANSPARENT);
                }
            }
#else
            Debug.Log($"[DesktopOverlay] Interactivity changed: {interactive}");
#endif
        }

        public void ShowWindow()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            ShowWindow(savedHwnd, SW_SHOW);
            SetForegroundWindow(savedHwnd);
#endif
            isWindowVisible = true;
            OnVisibilityChanged?.Invoke(true);
        }

        public void HideWindow()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            ShowWindow(savedHwnd, SW_HIDE);
#endif
            isWindowVisible = false;
            OnVisibilityChanged?.Invoke(false);
        }

        public void ToggleVisibility()
        {
            if (isWindowVisible) HideWindow();
            else ShowWindow();
        }

        public void SetAlwaysOnTop(bool enabled)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            IntPtr insertAfter = enabled ? HWND_TOPMOST : IntPtr.Zero;
            SetWindowPos(savedHwnd, insertAfter, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
#endif
        }

        public void DragWindow()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (savedHwnd != IntPtr.Zero)
            {
                ReleaseCapture();
                SendMessage(savedHwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            }
#endif
        }

        public void ResizeWindow(float scale)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (savedHwnd == IntPtr.Zero) return;

            int newWidth = Mathf.RoundToInt(DEFAULT_WINDOW_WIDTH * scale) + WINDOW_WIDTH_EXTRA;
            int newHeight = Mathf.RoundToInt(DEFAULT_WINDOW_HEIGHT * scale);

            if (GetWindowRect(savedHwnd, out RECT rect))
            {
                int currentWidth = rect.Right - rect.Left;
                int currentHeight = rect.Bottom - rect.Top;

                int anchorX = rect.Left + currentWidth / 2;
                int anchorY = rect.Top + currentHeight;

                int newX = anchorX - newWidth / 2;
                int newY = anchorY - newHeight;

                SetWindowPos(savedHwnd, HWND_TOPMOST, newX, newY, newWidth, newHeight, SWP_NOACTIVATE);
            }
#else
            Debug.Log($"[DesktopOverlay] Window resized to scale: {scale}");
#endif
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private void RegisterGlobalHotkey()
        {
            wndProcDelegate = new WndProcDelegate(WndProc);
            originalWndProc = SetWindowLong(savedHwnd, -4, Marshal.GetFunctionPointerForDelegate(wndProcDelegate));
            RegisterHotKey(savedHwnd, hotkeyId, MOD_ALT, VK_S);
        }

        private void UnregisterGlobalHotkey()
        {
            UnregisterHotKey(savedHwnd, hotkeyId);
            if (originalWndProc != IntPtr.Zero)
            {
                SetWindowLong(savedHwnd, -4, originalWndProc);
                originalWndProc = IntPtr.Zero;
            }
        }

        private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == WM_HOTKEY)
            {
                int id = wParam.ToInt32();
                if (id == 9001)
                {
                    Instance?.OnHotkeyTriggered?.Invoke();
                }
            }

            if (originalWndProc != IntPtr.Zero)
            {
                return CallWindowProc(originalWndProc, hWnd, msg, wParam, lParam);
            }
            return DefWindowProc(hWnd, msg, wParam, lParam);
        }

        [DllImport("user32.dll")]
        private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

        private static DesktopOverlayController Instance;

        private void Awake()
        {
            Instance = this;
        }

        private IEnumerator FullscreenPollLoop()
        {
            while (true)
            {
                yield return new WaitForSeconds(fullscreenPollInterval);
                CheckFullscreen();
            }
        }

        private void CheckFullscreen()
        {
            bool wasFullscreen = isFullscreen;
            isFullscreen = DetectFullscreen();

            if (isFullscreen != wasFullscreen)
            {
                OnFullscreenChanged?.Invoke(isFullscreen);

                if (isFullscreen && isWindowVisible)
                {
                    HideWindow();
                }
                else if (!isFullscreen && !isWindowVisible)
                {
                    ShowWindow();
                }
            }
        }

        private bool DetectFullscreen()
        {
            IntPtr foregroundWnd = GetForegroundWindow();
            if (foregroundWnd == IntPtr.Zero || foregroundWnd == savedHwnd) return false;

            StringBuilder sb = new StringBuilder(256);
            GetWindowText(foregroundWnd, sb, 256);
            string title = sb.ToString();

            if (string.IsNullOrEmpty(title)) return false;

            if (GetWindowRect(foregroundWnd, out RECT rect))
            {
                int screenWidth = GetSystemMetrics(0);
                int screenHeight = GetSystemMetrics(1);

                int winWidth = rect.Right - rect.Left;
                int winHeight = rect.Bottom - rect.Top;

                bool coversScreen = winWidth >= screenWidth && winHeight >= screenHeight;
                bool atOrigin = rect.Left <= 0 && rect.Top <= 0;

                return coversScreen && atOrigin;
            }

            return false;
        }

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        private void ProcessWndProcMessages()
        {
        }
#else
        private void ProcessWndProcMessages() { }
#endif
    }
}
