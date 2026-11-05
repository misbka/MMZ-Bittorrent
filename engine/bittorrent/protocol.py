"""stdio transport: newline-delimited JSON (NDJSON) framed messages.

Host -> engine:  {"id": 1, "method": "addTorrent", "params": {...}}
Engine -> host:  {"id": 1, "ok": true, "result": {...}}
                 {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
Engine -> host:  {"event": "tick", "data": {...}}          (unsolicited)

The transport is intentionally stdin/stdout only: no sockets, no temp files,
so nothing else on the machine can talk to the engine without already having
control of the child process.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any, Callable, Dict, Optional

PROTOCOL_VERSION = 1


class Host:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._closed = False

    # -- writing ----------------------------------------------------------
    def send(self, payload: Dict[str, Any]) -> None:
        try:
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            data = json.dumps({"event": "log", "data": {
                "level": "error", "source": "protocol",
                "message": "unserializable payload dropped"}})
        with self._lock:
            if self._closed:
                return
            try:
                sys.stdout.buffer.write(data.encode("utf-8") + b"\n")
                sys.stdout.buffer.flush()
            except (BrokenPipeError, ValueError, OSError):
                self._closed = True

    def send_event(self, name: str, data: Any) -> None:
        self.send({"event": name, "data": data})

    def send_result(self, msg_id: Any, result: Any) -> None:
        self.send({"id": msg_id, "ok": True, "result": result})

    def send_error(self, msg_id: Any, code: str, message: str) -> None:
        self.send({"id": msg_id, "ok": False, "error": {"code": code, "message": message}})

    def close(self) -> None:
        with self._lock:
            self._closed = True

    # -- reading ----------------------------------------------------------
    def read_loop(self, on_message: Callable[[Dict[str, Any]], None],
                  on_eof: Callable[[], None]) -> None:
        """Blocking loop; meant to run on the reader thread."""
        stream = getattr(sys.stdin, "buffer", sys.stdin)
        try:
            for raw in stream:
                if isinstance(raw, bytes):
                    line = raw.decode("utf-8", "replace").strip()
                else:
                    line = str(raw).strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    self.send_event("log", {
                        "level": "warning", "source": "protocol",
                        "message": "discarded malformed JSON frame"})
                    continue
                if not isinstance(message, dict):
                    self.send_event("log", {
                        "level": "warning", "source": "protocol",
                        "message": "discarded non-object frame"})
                    continue
                try:
                    on_message(message)
                except Exception as exc:  # reader must never die
                    self.send_event("log", {
                        "level": "error", "source": "protocol",
                        "message": f"frame handler failed: {exc}"})
        except Exception:
            pass
        finally:
            on_eof()
