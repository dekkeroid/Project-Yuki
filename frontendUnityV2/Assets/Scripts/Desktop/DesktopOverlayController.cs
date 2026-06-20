using UnityEngine;
using System;

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

        private bool isCurrentlyInteractive = true;

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

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
#endif

        public bool TransparentWindowRequested => transparentWindowRequested;
        public bool ClickThroughWhenIdle => clickThroughWhenIdle;

        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (transparentWindowRequested)
            {
                IntPtr hwnd = GetActiveWindow();

                SetWindowLong(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);

                int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
                SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_LAYERED);

                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

                var margins = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
                DwmExtendFrameIntoClientArea(hwnd, ref margins);
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
    }
}
