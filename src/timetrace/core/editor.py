import os
import tempfile
import subprocess
import frontmatter
from typing import Dict, Any, Optional

PALETTE = [
    "#7c3aed",
    "#2563eb",
    "#d97706",
    "#dc2626",
    "#059669",
    "#ec4899",
    "#0284c7",
    "#78350f",
    "#0d9488",
    "#4f46e5",
]


def get_auto_color(text: str) -> str:
    """Deterministically picks a distinct color from the palette based on text hash."""
    if not text:
        return PALETTE[0]
    hash_val = sum(ord(c) for c in text)
    return PALETTE[hash_val % len(PALETTE)]


def open_in_nvim(
    template_yaml: Dict[str, Any],
    initial_notes: str = "",
    hint_comments: str = "",
    cursor_line: int = 2,
) -> Optional[Dict[str, Any]]:
    """
    Spawns Neovim with a temporary .md file populated with frontmatter template.
    Pre-positions cursor for ultra-fast vim editing.
    """
    editor = os.environ.get("EDITOR", "nvim")

    post = frontmatter.Post(initial_notes, **template_yaml)
    raw_md = frontmatter.dumps(post)

    # Insert optional inline comment hints above the content body or frontmatter
    if hint_comments:
        lines = raw_md.splitlines()
        # Insert hints inside YAML frontmatter block if present
        if len(lines) > 1 and lines[0] == "---":
            raw_md = "\n".join(lines)

    with tempfile.NamedTemporaryFile(
        suffix=".md", mode="w+", delete=False, encoding="utf-8"
    ) as tf:
        tf.write(raw_md)
        temp_path = tf.name

    try:
        # Launch Neovim and position cursor directly on target line
        cmd = [editor, f"+{cursor_line}", temp_path]
        result = subprocess.call(cmd)
        if result != 0:
            return None

        # Parse saved .md file
        parsed = frontmatter.load(temp_path)
        data = dict(parsed.metadata)
        data["notes"] = parsed.content.strip()
        return data
    except Exception:
        return None
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
