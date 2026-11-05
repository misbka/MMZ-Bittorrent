"""Structured, bounded log bus for the engine.

Logs are kept in a ring buffer (so memory stays bounded no matter how long the
engine runs) and are mirrored to the host through the ``log`` event so the UI
can stream them live.  Every entry carries a stable shape:

    {"seq": int, "ts": float, "level": str, "source": str,
     "message": str, "torrent": str|null}
"""

from __future__ import annotations

from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional

LEVELS = ("debug", "info", "warning", "error")


class LogBus:
    def __init__(self, emit: Callable[[str, Dict[str, Any]], None], maxlen: int = 2000):
        self._emit = emit
        self._buffer: Deque[Dict[str, Any]] = deque(maxlen=maxlen)
        self._seq = 0

    def log(self, level: str, message: str, source: str = "engine",
            torrent: Optional[str] = None) -> Dict[str, Any]:
        if level not in LEVELS:
            level = "info"
        self._seq += 1
        entry = {
            "seq": self._seq,
            "ts": __import__("time").time(),
            "level": level,
            "source": source,
            "message": message,
            "torrent": torrent,
        }
        self._buffer.append(entry)
        try:
            self._emit("log", entry)
        except Exception:
            pass  # logging must never break the engine
        return entry

    def since(self, seq: int = 0, limit: int = 500) -> List[Dict[str, Any]]:
        items = [e for e in self._buffer if e["seq"] > seq]
        if limit and len(items) > limit:
            items = items[-limit:]
        return items

    def tail(self, limit: int = 500) -> List[Dict[str, Any]]:
        return list(self._buffer)[-limit:]
