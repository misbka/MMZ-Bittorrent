"""On-disk persistence for the engine.

Layout (inside the host-provided data directory):

    store/
      resume/<infohash>.resume    libtorrent fast-resume blob (bencoded)
      torrents/<infohash>.torrent original torrent file (or generated one)

Keeping the original .torrent file next to the resume data means magnets that
have received their metadata can be restored fully offline on next launch.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Dict, List, Optional

_HASH_RE = re.compile(r"^[0-9a-f]{40}$|^[0-9a-f]{64}$")


class Store:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.resume_dir = os.path.join(self.root, "resume")
        self.torrents_dir = os.path.join(self.root, "torrents")
        os.makedirs(self.resume_dir, exist_ok=True)
        os.makedirs(self.torrents_dir, exist_ok=True)

    # -- helpers ----------------------------------------------------------
    @staticmethod
    def _check_hash(info_hash: str) -> str:
        h = (info_hash or "").strip().lower()
        if not _HASH_RE.match(h):
            raise ValueError(f"invalid info hash: {info_hash!r}")
        return h

    def _resume_path(self, info_hash: str) -> str:
        return os.path.join(self.resume_dir, self._check_hash(info_hash) + ".resume")

    def _torrent_path(self, info_hash: str) -> str:
        return os.path.join(self.torrents_dir, self._check_hash(info_hash) + ".torrent")

    # -- resume data ------------------------------------------------------
    def save_resume(self, info_hash: str, data: bytes) -> None:
        path = self._resume_path(info_hash)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)

    def load_resume(self, info_hash: str) -> Optional[bytes]:
        path = self._resume_path(info_hash)
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except OSError:
            return None

    # -- torrent files ----------------------------------------------------
    def save_torrent(self, info_hash: str, data: bytes) -> None:
        path = self._torrent_path(info_hash)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)

    def load_torrent(self, info_hash: str) -> Optional[bytes]:
        path = self._torrent_path(info_hash)
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except OSError:
            return None

    # -- sidecar metadata (final dir, temp flag, ...) ---------------------
    def save_meta(self, info_hash: str, meta: Dict[str, Any]) -> None:
        path = os.path.join(self.torrents_dir, self._check_hash(info_hash) + ".meta.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(meta, fh)
        os.replace(tmp, path)

    def load_meta(self, info_hash: str) -> Optional[Dict[str, Any]]:
        path = os.path.join(self.torrents_dir, self._check_hash(info_hash) + ".meta.json")
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    # -- listing / cleanup ------------------------------------------------
    def list_resume_hashes(self) -> List[str]:
        out: List[str] = []
        try:
            names = os.listdir(self.resume_dir)
        except OSError:
            return out
        for name in names:
            if name.endswith(".resume"):
                h = name[: -len(".resume")].lower()
                if _HASH_RE.match(h):
                    out.append(h)
        return sorted(out)

    def forget(self, info_hash: str) -> None:
        h = self._check_hash(info_hash)
        for path in (self._resume_path(h), self._torrent_path(h),
                     os.path.join(self.torrents_dir, h + ".meta.json")):
            try:
                os.remove(path)
            except OSError:
                pass

    def clear(self) -> None:
        for directory in (self.resume_dir, self.torrents_dir):
            shutil.rmtree(directory, ignore_errors=True)
            os.makedirs(directory, exist_ok=True)
