import ctypes
import subprocess
import sys


def get_idle_seconds() -> float | None:
    """
    Cross-platform non-blocking system idle time detector.
    Returns seconds since observed input, or None when activity cannot be observed.
    Failure/unsupported platforms are not evidence of returned activity.
    """
    # 1. Windows Platform
    if sys.platform.startswith("win"):
        try:

            class LASTINPUTINFO(ctypes.Structure):
                _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

            last_input = LASTINPUTINFO()
            last_input.cbSize = ctypes.sizeof(LASTINPUTINFO)
            if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(last_input)):
                millis = ctypes.windll.kernel32.GetTickCount() - last_input.dwTime
                return max(0.0, millis / 1000.0)
        except Exception:
            return None

    # 2. macOS Platform
    elif sys.platform == "darwin":
        try:
            cmd = ["ioreg", "-c", "IOHIDSystem"]
            output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
            for line in output.splitlines():
                if "HIDIdleTime" in line:
                    nanos = int(line.split("=")[-1].strip())
                    return max(0.0, nanos / 1_000_000_000.0)
        except Exception:
            return None

    # 3. Linux / Unix Platform (X11 / Wayland)
    elif sys.platform.startswith("linux"):
        # Try xprintidle first (X11)
        try:
            output = subprocess.check_output(["xprintidle"], text=True, stderr=subprocess.DEVNULL)
            return max(0.0, int(output.strip()) / 1000.0)
        except Exception:
            pass

        # Try xssstate
        try:
            output = subprocess.check_output(["xssstate", "-i"], text=True, stderr=subprocess.DEVNULL)
            return max(0.0, int(output.strip()) / 1000.0)
        except Exception:
            pass

    return None
