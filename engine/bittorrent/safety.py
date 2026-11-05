"""Filesystem safety helpers (path traversal protection, §9 of the spec).

A malicious .torrent can contain entries such as ``../../etc/passwd`` or
``C:\\Windows\\system32\\evil.dll``.  libtorrent will happily write them, so the
engine refuses any torrent whose files could escape the chosen download
directory — both at add time and again when metadata arrives late (magnets).
"""

from __future__ import annotations

import os
from typing import Iterable, List, Tuple


class UnsafePathError(ValueError):
    """Raised when a torrent contains files that escape the target directory."""


def normalize_dir(path: str, create: bool = False) -> str:
    """Return an absolute, normalized directory path, optionally creating it."""
    if not path or not isinstance(path, str):
        raise ValueError("directory path is required")
    expanded = os.path.abspath(os.path.expandvars(os.path.expanduser(path)))
    if create:
        os.makedirs(expanded, exist_ok=True)
    if not os.path.isdir(expanded):
        raise ValueError(f"directory does not exist: {expanded}")
    return expanded


def is_safe_member(save_path: str, member: str) -> bool:
    """True when ``member`` resolves inside ``save_path``."""
    if not member:
        return False
    # Reject absolute paths and drive letters outright.
    if os.path.isabs(member) or os.path.splitdrive(member)[0]:
        return False
    combined = os.path.normpath(os.path.join(save_path, member))
    root = os.path.normpath(save_path)
    try:
        return os.path.commonpath([root, combined]) == root
    except ValueError:  # different drives on Windows
        return False


def validate_file_storage(save_path: str, file_paths: Iterable[str]) -> List[Tuple[int, str]]:
    """Validate every file path of a torrent.

    Returns the list of offending ``(index, path)`` pairs (empty when safe).
    """
    offenders: List[Tuple[int, str]] = []
    for index, member in enumerate(file_paths):
        if not is_safe_member(save_path, member):
            offenders.append((index, member))
    return offenders


def safe_join(save_path: str, member: str) -> str:
    """Join and verify, raising UnsafePathError when the result escapes."""
    if not is_safe_member(save_path, member):
        raise UnsafePathError(f"path traversal rejected: {member!r}")
    return os.path.normpath(os.path.join(save_path, member))
