"""Fernet-based encryption for AI provider API keys at rest (spec S4).

Key file: `~/.timetrace/secret.key` (mode 0600), generated on first use, colocated with
`settings.db_file` (same convention `core/timer.py` uses for `active_timer.json`, so it honours
`TIMETRACE_DB_FILE` overrides in tests). This defends against a stolen DB or an unencrypted backup
under `~/.timetrace/backups/` -- it does **not** defend against anything that can already read the
user's home directory. That limit must be surfaced in the `/settings/ai` UI, not just here.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet

from timetrace.config import settings

SECRET_KEY_FILENAME = "secret.key"


def _key_path() -> Path:
    return settings.db_file.parent / SECRET_KEY_FILENAME


def _generate_key(path: Path) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        os.write(fd, key)
    finally:
        os.close(fd)
    os.chmod(path, 0o600)
    return key


def load_or_create_key() -> bytes:
    """Returns the Fernet key at `~/.timetrace/secret.key`, generating it (mode 0600) the first
    time it's needed. Re-asserts 0600 on every load in case the file was recreated with looser
    permissions by some other tool (e.g. an editor save)."""
    path = _key_path()
    if path.exists():
        os.chmod(path, 0o600)
        return path.read_bytes().strip()
    return _generate_key(path)


def _fernet() -> Fernet:
    return Fernet(load_or_create_key())


def encrypt_secret(plaintext: str) -> str:
    """Encrypts `plaintext` (an API key) for storage in `aiproviderconfig.api_key_encrypted`."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypts a value produced by `encrypt_secret`.

    Raises `cryptography.fernet.InvalidToken` on a tampered or foreign-key ciphertext (e.g. the
    key file was rotated/lost). Callers should surface that as a corrupt provider config that
    needs the key re-entered, never swallow it silently.
    """
    return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")


def key_last4(plaintext: str) -> str:
    """Last 4 characters of a plaintext API key, for the `api_key_last4` display field. Responses
    must only ever expose `api_key_set: bool` + this -- never the decrypted key itself."""
    return plaintext[-4:] if len(plaintext) >= 4 else plaintext
