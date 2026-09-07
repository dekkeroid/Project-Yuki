"""
Utility module for capturing screenshots with automatic exclusion of Yuki's floating 3D avatar window.
Ensures clean, unpolluted screen vision without obscuring desktop content or wasting vision tokens.
"""

from contextlib import contextmanager
import ctypes
import time
from typing import Optional
from PIL import Image, ImageGrab

# Candidate window titles for Yuki's main floating 3D avatar window
_AVATAR_TITLES = (
    "Yuki AI - Agentic 3D Desktop Companion",
    "Yuki AI - Main",
    "Yuki AI",
)

# Win32 Constants
_SW_HIDE = 0
_SW_SHOWNA = 8  # Show window without activating or stealing keyboard/mouse focus


def _ensure_desktop_access():
    """Ensure the calling thread is attached to the interactive window station and desktop with physical DPI awareness."""
    try:
        user32 = ctypes.windll.user32
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass
        winsta0 = user32.OpenWindowStationW("WinSta0", False, 0x00020000 | 0x037F)
        if winsta0:
            user32.SetProcessWindowStation(winsta0)
            h_desk = user32.OpenDesktopW("default", 0, False, 0x00020000 | 0x01FF)
            if h_desk:
                user32.SetThreadDesktop(h_desk)
    except Exception:
        pass


def find_yuki_avatar_window() -> Optional[int]:
    """
    Finds the Win32 window handle (HWND) for Yuki's 3D avatar window.
    Returns the HWND integer if found and visible, else None.
    """
    try:
        user32 = ctypes.windll.user32
        _ensure_desktop_access()

        # 1. Fast direct title lookup across known candidates
        for title in _AVATAR_TITLES:
            hwnd = user32.FindWindowW(None, title)
            if hwnd and user32.IsWindow(hwnd) and user32.IsWindowVisible(hwnd):
                return hwnd

        # 2. Enumeration fallback with smart filtering (ignores Settings, Chat, Canvas windows)
        found = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)

        def _enum_cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    t = buff.value.lower()
                    if ("agentic 3d desktop companion" in t) or ("yuki ai - main" in t) or (t.strip() == "yuki ai"):
                        found.append(hwnd)
                        return False  # Stop enumeration
            return True

        cb = WNDENUMPROC(_enum_cb)
        user32.EnumWindows(cb, 0)
        return found[0] if found else None
    except Exception:
        return None


def get_foreground_window_info() -> dict:
    """
    Returns a dict with information about the currently active / focused foreground window:
    {"hwnd": int, "title": str, "bbox": (left, top, right, bottom) or None}
    """
    info = {"hwnd": 0, "title": "", "bbox": None}
    try:
        user32 = ctypes.windll.user32
        _ensure_desktop_access()
        hwnd = user32.GetForegroundWindow()
        if not hwnd or not user32.IsWindow(hwnd):
            return info
        info["hwnd"] = hwnd
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            info["title"] = buff.value.strip()

        from ctypes import wintypes
        rect = wintypes.RECT()
        if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            if rect.right > rect.left and rect.bottom > rect.top:
                info["bbox"] = (rect.left, rect.top, rect.right, rect.bottom)
    except Exception:
        pass
    return info


def get_active_monitor_bbox() -> Optional[tuple]:
    """
    Returns the bounding box (left, top, right, bottom) of the monitor that contains
    the active foreground window, or cursor location if no window is focused.
    Returns None if detection fails.
    """
    try:
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        _ensure_desktop_access()

        # MONITOR_DEFAULTTONEAREST = 2
        hwnd = user32.GetForegroundWindow()
        h_monitor = 0
        if hwnd and user32.IsWindow(hwnd) and user32.IsWindowVisible(hwnd):
            h_monitor = user32.MonitorFromWindow(hwnd, 2)

        if not h_monitor:
            pt = wintypes.POINT()
            if user32.GetCursorPos(ctypes.byref(pt)):
                h_monitor = user32.MonitorFromPoint(pt, 2)

        if not h_monitor:
            return None

        class MONITORINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD),
            ]

        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(h_monitor, ctypes.byref(mi)):
            r = mi.rcMonitor
            return (r.left, r.top, r.right, r.bottom)
    except Exception:
        pass
    return None


@contextmanager
def temporary_avatar_hidden():
    """
    Pass-through context manager. Previously hid Yuki's window, which caused visual flickering.
    Now preserved as a zero-overhead pass-through so Yuki remains smoothly rendered without flicker,
    while vision prompts instruct the model to ignore the floating avatar.
    """
    yield


def grab_screen_clean(bbox: Optional[tuple] = None, all_screens: bool = False, use_active_monitor: bool = True) -> Image.Image:
    """
    Captures the desktop screen cleanly and instantly without hiding windows or causing flicker.
    Multi-monitor aware: targets the monitor containing the active window or cursor when bbox is omitted.
    Falls back to normal grab or PyAutoGUI if ImageGrab fails.
    """
    with temporary_avatar_hidden():
        target_bbox = bbox
        if not target_bbox and not all_screens and use_active_monitor:
            target_bbox = get_active_monitor_bbox()

        try:
            if all_screens and not target_bbox:
                return ImageGrab.grab(all_screens=True)
            elif target_bbox:
                # With Windows multi-monitor, passing all_screens=True with bbox allows capturing secondary displays
                try:
                    return ImageGrab.grab(bbox=target_bbox, all_screens=True)
                except Exception:
                    return ImageGrab.grab(bbox=target_bbox)
            else:
                return ImageGrab.grab()
        except Exception:
            try:
                return ImageGrab.grab(bbox=target_bbox)
            except Exception:
                import pyautogui
                return pyautogui.screenshot(region=target_bbox) if target_bbox else pyautogui.screenshot()
