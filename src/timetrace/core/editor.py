import os
import tempfile
import subprocess
from typing import Optional

PALETTE = [
    "#7c3aed",
    "#2563eb",
    "#059669",
    "#d97706",
    "#dc2626",
    "#ec4899",
    "#0284c7",
    "#0d9488",
    "#4f46e5",
    "#9333ea",
    "#16a34a",
    "#ea580c",
    "#e11d48",
    "#c026d3",
    "#0891b2",
    "#b45309",
]


def get_auto_color(text: str) -> str:
    """Deterministically picks a distinct color from the extended palette based on polynomial string hashing."""
    if not text:
        return PALETTE[0]
    hash_val = 0
    for char in text:
        hash_val = (hash_val * 31 + ord(char)) & 0x7FFFFFFF
    return PALETTE[hash_val % len(PALETTE)]


def open_in_nvim(initial_text: str = "") -> Optional[str]:
    """
    Spawns Neovim with a temporary clean .md file.
    Returns the raw saved string from Neovim.
    """
    editor = os.environ.get("EDITOR", "nvim")

    with tempfile.NamedTemporaryFile(
        suffix=".md", mode="w+", delete=False, encoding="utf-8"
    ) as tf:
        if initial_text:
            tf.write(initial_text)
        temp_path = tf.name

    try:
        result = subprocess.call([editor, temp_path])
        if result != 0:
            return None

        with open(temp_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return None
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
