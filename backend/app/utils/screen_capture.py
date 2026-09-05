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
    """Ensure the calling thread is attached to the interactive window station and desktop."""
    try:
        user32 = ctypes.windll.user32
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


@contextmanager
def temporary_avatar_hidden():
    """
    Context manager that temporarily hides Yuki's floating 3D avatar window for a clean capture snapshot.
    Restores the window immediately via SW_SHOWNA (Show No-Activate) so it does NOT steal keyboard or mouse focus.
    """
    hwnd = find_yuki_avatar_window()
    hidden = False
    if hwnd:
        try:
            user32 = ctypes.windll.user32
            user32.ShowWindow(hwnd, _SW_HIDE)
            hidden = True
            # Brief pause (15ms) to allow Windows DWM to clear the window from the desktop compositor
            time.sleep(0.015)
        except Exception:
            hidden = False

    try:
        yield
    finally:
        if hwnd and hidden:
            try:
                user32 = ctypes.windll.user32
                user32.ShowWindow(hwnd, _SW_SHOWNA)
            except Exception:
                pass


def grab_screen_clean(bbox: Optional[tuple] = None, all_screens: bool = False) -> Image.Image:
    """
    Captures the desktop screen cleanly with Yuki's 3D avatar temporarily hidden for ~20ms.
    Falls back to normal grab or PyAutoGUI if ImageGrab fails.
    """
    with temporary_avatar_hidden():
        try:
            if all_screens and not bbox:
                return ImageGrab.grab(all_screens=True)
            elif bbox:
                return ImageGrab.grab(bbox=bbox)
            else:
                return ImageGrab.grab()
        except Exception:
            try:
                return ImageGrab.grab(bbox=bbox)
            except Exception:
                import pyautogui
                return pyautogui.screenshot(region=bbox) if bbox else pyautogui.screenshot()
