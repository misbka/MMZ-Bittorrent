"""The MMZ Torrent engine: a real libtorrent session behind a JSON-RPC API.

Threading model
---------------
* One **reader thread** parses NDJSON frames from stdin and pushes commands
  onto a queue.
* The **worker loop** (main thread) executes commands, drives libtorrent
  alerts and emits ``tick`` events at a steady rate.  All engine state is
  touched only by this thread, so no internal locking is required.
* A small **thread pool** runs network-bound jobs (fetching .torrent files
  over HTTP) and replies asynchronously through the ``Deferred`` helper.

Everything libtorrent-related lives here; the Electron process only speaks the
documented protocol (see ``protocol.py``).
"""

from __future__ import annotations

import base64
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import libtorrent as lt

from . import config as config_mod
from . import serialize as ser
from .logs import LogBus
from .persistence import Store
from .safety import UnsafePathError, normalize_dir, validate_file_storage

PROTOCOL_VERSION = 1
ENGINE_VERSION = "0.1.0"
MAX_TORRENT_BYTES = 32 * 1024 * 1024      # .torrent metadata size cap
MAX_FETCH_BYTES = 32 * 1024 * 1024        # HTTP download cap
HTTP_TIMEOUT = 30.0

# file priority vocabulary used on the wire (UI -> engine)
PRIORITY_MIN, PRIORITY_MAX = 0, 7
PRIORITY_DEFAULT = 4

_REMOVE_FLAGS = getattr(getattr(lt, "options_t", None), "delete_files", 0)

# Alert types that carry nothing we surface: ignored explicitly so the
# catch-all debug line does not flood the log stream.
_NOISY_ALERTS = tuple(
    alert_type for alert_type in (
        getattr(lt, name, None)
        for name in (
            "state_changed_alert", "torrent_added_alert", "add_torrent_alert",
            "torrent_removed_alert", "torrent_deleted_alert", "file_prio_alert",
            "file_rename_alert", "file_renamed_alert", "file_rename_failed_alert",
            "cache_flushed_alert", "incoming_connection_alert",
            "block_downloaded_alert", "block_finished_alert", "piece_finished_alert",
            "request_dropped_alert", "read_piece_alert", "incoming_request_alert",
            "tracker_announce_alert", "tracker_error_alert", "tracker_reply_alert",
            "tracker_warning_alert", "listen_succeeded_alert", "listen_failed_alert",
            "torrent_error_alert", "file_error_alert", "metadata_received_alert",
            "torrent_finished_alert", "save_resume_data_alert",
            "save_resume_data_failed_alert", "state_update_alert",
            "session_stats_alert", "torrent_checked_alert", "storage_moved_alert",
            "storage_moved_failed_alert", "performance_alert", "dht_stats_alert",
            "torrent_log_alert", "peer_log_alert", "log_alert", "portmap_log_alert",
        )
    )
    if alert_type is not None
)


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Deferred:
    """Promise used for commands answered by a background job."""

    def __init__(self) -> None:
        self._callbacks: List[Callable[[Any], None]] = []
        self._errors: List[Callable[[str, str], None]] = []
        self._settled = False

    def then(self, on_ok: Callable[[Any], None]) -> "Deferred":
        self._callbacks.append(on_ok)
        return self

    def catch(self, on_err: Callable[[str, str], None]) -> "Deferred":
        self._errors.append(on_err)
        return self

    def resolve(self, value: Any) -> None:
        if self._settled:
            return
        self._settled = True
        for cb in self._callbacks:
            try:
                cb(value)
            except Exception:
                pass

    def reject(self, code: str, message: str) -> None:
        if self._settled:
            return
        self._settled = True
        for cb in self._errors:
            try:
                cb(code, message)
            except Exception:
                pass


def _hash_from_params(params: Any) -> str:
    """add_torrent_params -> canonical key (v1 hash when available)."""
    try:
        ih = params.info_hashes
        v1 = str(ih.v1)
        if v1 and v1 != "0" * 40:
            return v1
        return str(ih.v2)
    except Exception:
        return ""


def _handle_hash(handle: Any) -> str:
    try:
        ih = handle.info_hashes()
        v1 = str(ih.v1)
        if v1 and v1 != "0" * 40:
            return v1
        return str(ih.v2)
    except Exception:
        return ""


def _is_magnet(url: str) -> bool:
    return url.lower().startswith("magnet:?")


def _is_http(url: str) -> bool:
    return url.lower().startswith(("http://", "https://"))


class Engine:
    TICK_INTERVAL = 0.5
    SAVE_CHECK_INTERVAL = 10.0
    STALE_REFRESH_SECONDS = 3.0

    def __init__(self, settings: Dict[str, Any], store: Store,
                 emit: Callable[[str, Any], None]):
        self.settings = settings
        self.store = store
        self._emit = emit
        self.log = LogBus(emit)
        self.session: Optional[Any] = None
        self.torrents: Dict[str, Dict[str, Any]] = {}
        self._pending_status: Dict[str, Any] = {}
        self._counters: Dict[str, Any] = {}
        self._rates: Dict[str, Any] = {"downloadRate": 0, "uploadRate": 0, "torrentCount": 0}
        self._pending_saves: set = set()
        self._next_save_check = 0.0
        self._pending_saves_inflight: set = set()
        self._commands: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._running = False
        self._shutdown_cb: Optional[Callable[[], None]] = None
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mmz-job")

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def set_shutdown_callback(self, cb: Callable[[], None]) -> None:
        self._shutdown_cb = cb

    def start(self) -> None:
        cfg = config_mod.to_libtorrent(self.settings)
        try:
            self.session = lt.session(cfg)
        except Exception as exc:
            raise EngineError("session_init", f"failed to create libtorrent session: {exc}")
        self._running = True
        self.log.log("info", f"libtorrent {lt.version} session created (engine {ENGINE_VERSION})",
                     source="session")
        self._restore()

    def _restore(self) -> None:
        hashes = self.store.list_resume_hashes()
        restored = 0
        for info_hash in hashes:
            try:
                if self._restore_one(info_hash):
                    restored += 1
            except Exception as exc:
                self.log.log("warning", f"could not restore {info_hash}: {exc}", source="restore")
        if hashes:
            self.log.log("info", f"restored {restored}/{len(hashes)} torrents from disk",
                         source="restore")

    def _restore_one(self, info_hash: str) -> bool:
        resume = self.store.load_resume(info_hash)
        torrent_bytes = self.store.load_torrent(info_hash)
        if resume is None and torrent_bytes is None:
            return False

        params: Any = None
        if resume is not None:
            try:
                params = lt.read_resume_data(resume)
            except Exception as exc:
                self.log.log("warning", f"invalid resume data for {info_hash}: {exc}",
                             source="restore")
        if params is None:
            params = lt.add_torrent_params()

        if torrent_bytes is not None:
            try:
                params.ti = lt.torrent_info(torrent_bytes)
            except Exception as exc:
                self.log.log("warning", f"invalid torrent file for {info_hash}: {exc}",
                             source="restore")
                if params.ti is None:
                    return False

        if params.ti is None:
            self.log.log("warning", f"skipping {info_hash}: no metadata available",
                         source="restore")
            return False

        save_path = params.save_path or self.settings.get("downloadDirectory") or os.path.expanduser("~")
        try:
            save_path = normalize_dir(save_path, create=True)
        except ValueError:
            save_path = normalize_dir(self.settings.get("downloadDirectory") or os.path.expanduser("~"),
                                      create=True)
        storage = params.ti.files()
        paths = [storage.file_path(i) for i in range(storage.num_files())]
        offenders = validate_file_storage(save_path, paths)
        if offenders:
            self.log.log("error",
                         f"refusing to restore {info_hash}: unsafe path {offenders[0][1]!r}",
                         source="restore")
            return False
        params.save_path = save_path

        was_paused = bool(params.flags & lt.torrent_flags.paused) if params.flags is not None else False
        if not self.settings.get("resumeOnStart", True):
            was_paused = True
        params.flags = params.flags | lt.torrent_flags.paused
        if was_paused or not self.settings.get("queueManagement", True):
            params.flags = params.flags & ~lt.torrent_flags.auto_managed
        else:
            params.flags = (params.flags | lt.torrent_flags.auto_managed) & ~lt.torrent_flags.paused
            was_paused = False

        try:
            handle = self.session.add_torrent(params)
        except Exception as exc:
            self.log.log("warning", f"could not add {info_hash}: {exc}", source="restore")
            return False

        meta = self.store.load_meta(info_hash) or {}
        entry = self._register(handle, time.time())
        entry["final_dir"] = meta.get("finalDir")
        entry["temp_dir"] = bool(meta.get("temp")) and bool(entry["final_dir"])
        if self.settings.get("recheckOnStart"):
            handle.force_recheck()
        self.log.log("info", f"restored {entry.get('name') or info_hash}", source="restore")
        return True

    def _register(self, handle: Any, added_at: float) -> Dict[str, Any]:
        key = _handle_hash(handle)
        entry: Dict[str, Any] = {
            "handle": handle,
            "added_at": added_at,
            "last_status": None,
            "last_refresh": 0.0,
            "error": "",
            "temp_dir": False,
            "final_dir": None,
            "limits": {"download": None, "upload": None, "maxConnections": None},
        }
        self.torrents[key] = entry
        return entry

    def submit(self, message: Dict[str, Any]) -> None:
        """Queue a parsed command for the worker loop."""
        self._commands.put(message)

    def stop(self) -> None:
        self._running = False

    def shutdown(self, timeout: float = 6.0) -> None:
        """Persist resume data and tear the session down."""
        if self.session is None:
            return
        self.log.log("info", "shutting down, saving resume data", source="session")
        deadline = time.time() + timeout
        try:
            for entry in list(self.torrents.values()):
                try:
                    entry["handle"].save_resume_data(lt.save_resume_flags_t.save_info_dict)
                except Exception:
                    pass
            while time.time() < deadline:
                alerts = self.session.pop_alerts()
                wrote = False
                for alert in alerts:
                    if isinstance(alert, lt.save_resume_data_alert):
                        self._persist_resume(alert)
                        wrote = True
                if wrote and not self._pending_saves_inflight:
                    # keep draining briefly to catch stragglers
                    if time.time() + 0.2 > deadline:
                        break
                time.sleep(0.05)
        except Exception as exc:
            self.log.log("warning", f"shutdown save failed: {exc}", source="session")
        try:
            del self.session
        except Exception:
            pass
        self.session = None
        self._pool.shutdown(wait=False)
        self.log.log("info", "engine stopped", source="session")

    # ------------------------------------------------------------------
    # command dispatch (worker thread)
    # ------------------------------------------------------------------
    def execute(self, method: str, params: Optional[Dict[str, Any]]) -> Any:
        handler = getattr(self, f"cmd_{method}", None)
        if handler is None:
            raise EngineError("unknown_method", f"unknown method: {method}")
        return handler(params or {})

    # -- protocol --------------------------------------------------------
    def cmd_hello(self, _params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "engineVersion": ENGINE_VERSION,
            "libtorrentVersion": lt.version,
            "python": __import__("platform").python_version(),
        }

    def cmd_configure(self, params: Dict[str, Any]) -> Dict[str, Any]:
        patch = params.get("settings")
        if not isinstance(patch, dict):
            raise EngineError("invalid_params", "settings object is required")
        try:
            merged = config_mod.merge(self.settings, patch)
        except config_mod.ConfigError as exc:
            raise EngineError("invalid_settings", str(exc))
        cfg = config_mod.to_libtorrent(merged)
        try:
            self.session.apply_settings(cfg)
        except Exception as exc:
            raise EngineError("settings_apply", str(exc))
        self.settings = merged
        self._propagate_limits()
        self.log.log("info", "settings applied", source="config")
        return {"settings": merged}

    def _propagate_limits(self) -> None:
        per_down = int(self.settings.get("torrentDownloadRateLimit", 0))
        per_up = int(self.settings.get("torrentUploadRateLimit", 0))
        per_conn = int(self.settings.get("maxConnectionsPerTorrent", 0))
        pex = bool(self.settings.get("pex", True))
        dht = bool(self.settings.get("dht", True))
        lsd = bool(self.settings.get("lsd", True))
        for entry in self.torrents.values():
            handle = entry["handle"]
            limits = entry["limits"]
            try:
                handle.set_download_limit(limits["download"] if limits["download"] is not None else per_down)
                handle.set_upload_limit(limits["upload"] if limits["upload"] is not None else per_up)
                handle.set_max_connections(limits["maxConnections"]
                                           if limits["maxConnections"] is not None
                                           else per_conn)
                self._apply_feature_flags(handle, pex, dht, lsd)
            except Exception:
                pass

    @staticmethod
    def _apply_feature_flags(handle: Any, pex: bool, dht: bool, lsd: bool) -> None:
        for enabled, flag in ((pex, lt.torrent_flags.disable_pex),
                              (dht, lt.torrent_flags.disable_dht),
                              (lsd, lt.torrent_flags.disable_lsd)):
            if enabled:
                handle.unset_flags(flag)
            else:
                handle.set_flags(flag)

    # -- torrent lifecycle ----------------------------------------------
    def cmd_addTorrent(self, params: Dict[str, Any]) -> Any:
        urls = params.get("urls") or []
        torrent_files = params.get("torrentFiles") or []
        if not isinstance(urls, list) or not isinstance(torrent_files, list):
            raise EngineError("invalid_params", "urls and torrentFiles must be arrays")
        if not urls and not torrent_files:
            raise EngineError("invalid_params", "nothing to add")

        needs_network = any(_is_http(u) for u in urls if isinstance(u, str))
        if not needs_network:
            return self._add_blocking(params)

        deferred = Deferred()

        def job() -> None:
            try:
                deferred.resolve(self._add_blocking(params))
            except EngineError as exc:
                deferred.reject(exc.code, exc.message)
            except Exception as exc:
                deferred.reject("internal", str(exc))

        self._pool.submit(job)
        return deferred

    def _add_blocking(self, params: Dict[str, Any]) -> Dict[str, Any]:
        save_path = params.get("savePath") or self.settings.get("downloadDirectory")
        if not save_path:
            raise EngineError("no_save_path", "no download directory configured")
        try:
            save_path = normalize_dir(save_path, create=True)
        except ValueError as exc:
            raise EngineError("bad_save_path", str(exc))

        added: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []

        for item in params.get("torrentFiles") or []:
            if not isinstance(item, dict) or not item.get("data"):
                skipped.append({"source": "<file>", "reason": "empty torrent payload"})
                continue
            try:
                data = base64.b64decode(item["data"], validate=True)
            except Exception:
                skipped.append({"source": item.get("name", "<file>"),
                                "reason": "invalid base64 payload"})
                continue
            if len(data) > MAX_TORRENT_BYTES:
                skipped.append({"source": item.get("name", "<file>"), "reason": "torrent too large"})
                continue
            try:
                added.append(self._add_torrent_bytes(data, save_path, params))
            except EngineError as exc:
                skipped.append({"source": item.get("name", "<file>"), "reason": exc.message})

        for url in params.get("urls") or []:
            if not isinstance(url, str) or not url.strip():
                skipped.append({"source": str(url), "reason": "invalid url"})
                continue
            url = url.strip()
            try:
                if _is_magnet(url):
                    added.append(self._add_magnet(url, save_path, params))
                elif _is_http(url):
                    data = self._fetch_torrent_file(url)
                    added.append(self._add_torrent_bytes(data, save_path, params,
                                                         source=url))
                else:
                    skipped.append({"source": url, "reason": "unsupported scheme (use magnet:, http:// or https://)"})
            except EngineError as exc:
                skipped.append({"source": url, "reason": exc.message})
            except Exception as exc:
                skipped.append({"source": url, "reason": str(exc)})

        return {"added": added, "skipped": skipped, "savePath": save_path}

    def _prepare_flags(self, params: Dict[str, Any], paused: Optional[bool] = None) -> Any:
        flags = lt.torrent_flags.default_flags
        if paused is None:
            paused = bool(params.get("paused", not self.settings.get("startAddedTorrents", True)))
        queue_mgmt = bool(self.settings.get("queueManagement", True))
        if paused or not queue_mgmt:
            flags = (flags | lt.torrent_flags.paused) & ~lt.torrent_flags.auto_managed
        else:
            flags = (flags | lt.torrent_flags.auto_managed) & ~lt.torrent_flags.paused
        if params.get("sequential", self.settings.get("sequentialDownload", False)):
            flags |= lt.torrent_flags.sequential_download
        if not self.settings.get("pex", True):
            flags |= lt.torrent_flags.disable_pex
        if not self.settings.get("dht", True):
            flags |= lt.torrent_flags.disable_dht
        if not self.settings.get("lsd", True):
            flags |= lt.torrent_flags.disable_lsd
        return flags

    def _finish_add(self, handle: Any, save_path: str, final_dir: str,
                    params: Dict[str, Any], source: str) -> Dict[str, Any]:
        key = _handle_hash(handle)
        entry = self._register(handle, time.time())

        temp_dir = self.settings.get("temporaryDirectory") or ""
        use_temp = bool(temp_dir) and temp_dir != final_dir
        if use_temp:
            try:
                temp_path = normalize_dir(temp_dir, create=True)
                handle.move_storage(temp_path)
                entry["temp_dir"] = True
                entry["final_dir"] = final_dir
                self.store.save_meta(key, {"temp": True, "finalDir": final_dir})
            except Exception as exc:  # noqa: BLE001 - logged, non-fatal
                self.log.log("warning", f"temporary dir unavailable: {exc}", source="storage")

        limits = entry["limits"]
        try:
            handle.set_download_limit(limits["download"] if limits["download"] is not None
                                      else int(self.settings.get("torrentDownloadRateLimit", 0)))
            handle.set_upload_limit(limits["upload"] if limits["upload"] is not None
                                    else int(self.settings.get("torrentUploadRateLimit", 0)))
            handle.set_max_connections(limits["maxConnections"]
                                       if limits["maxConnections"] is not None
                                       else int(self.settings.get("maxConnectionsPerTorrent", 0)))
        except Exception:
            pass

        priorities = params.get("filePriorities")
        if isinstance(priorities, list) and priorities:
            try:
                self._apply_file_priorities(handle, priorities)
            except EngineError as exc:
                self.log.log("warning", f"file priorities not applied: {exc.message}",
                             source="torrent")

        status = handle.status()
        name = status.name or key
        self.log.log("info", f"added {name} (from {source})", source="torrent", torrent=key)
        self._emit("torrentAdded", {"hash": key, "name": name, "source": source})
        return {"hash": key, "name": name, "duplicate": False}

    def _add_torrent_bytes(self, data: bytes, save_path: str, params: Dict[str, Any],
                           source: str = "file") -> Dict[str, Any]:
        try:
            ti = lt.torrent_info(data)
        except Exception as exc:
            raise EngineError("invalid_torrent", f"invalid .torrent file: {exc}")

        storage = ti.files()
        paths = [storage.file_path(i) for i in range(storage.num_files())]
        offenders = validate_file_storage(save_path, paths)
        if offenders:
            raise EngineError("unsafe_path",
                              f"torrent contains an unsafe path: {offenders[0][1]!r}")

        existing = self._find_existing(ti)
        if existing is not None:
            key = _handle_hash(existing)
            return {"hash": key, "name": existing.status().name or key, "duplicate": True}

        atp = lt.add_torrent_params()
        atp.ti = ti
        atp.save_path = save_path
        atp.flags = self._prepare_flags(params)
        try:
            handle = self.session.add_torrent(atp)
        except Exception as exc:
            raise EngineError("add_failed", str(exc))

        key = _handle_hash(handle)
        if key in self.torrents:
            # libtorrent handed back the torrent we already track
            return {"hash": key, "name": handle.status().name or key, "duplicate": True}
        try:
            self.store.save_torrent(key, data)
        except OSError as exc:
            self.log.log("warning", f"could not persist torrent file: {exc}", source="storage")
        return self._finish_add(handle, save_path, save_path, params, source)

    def _add_magnet(self, url: str, save_path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if "urn:btih:" not in url and "urn:btmh:" not in url:
            raise EngineError("invalid_magnet", "magnet link has no info hash")
        try:
            atp = lt.parse_magnet_uri(url)
        except Exception as exc:
            raise EngineError("invalid_magnet", f"invalid magnet link: {exc}")

        existing = self._find_existing(atp)
        if existing is not None:
            key = _handle_hash(existing)
            return {"hash": key, "name": existing.status().name or key, "duplicate": True}

        atp.save_path = save_path
        atp.flags = self._prepare_flags(params)
        try:
            handle = self.session.add_torrent(atp)
        except Exception as exc:
            raise EngineError("add_failed", str(exc))
        key = _handle_hash(handle)
        if key in self.torrents:
            return {"hash": key, "name": handle.status().name or key, "duplicate": True}
        return self._finish_add(handle, save_path, save_path, params, "magnet")

    def _find_existing(self, params_or_ti: Any) -> Optional[Any]:
        try:
            if not hasattr(params_or_ti, "info_hashes"):
                return None
            ih = params_or_ti.info_hashes
            v1 = str(ih.v1)
            if v1 and v1 != "0" * 40:
                handle = self.session.find_torrent(lt.sha1_hash(v1))
            else:
                handle = self.session.find_torrent(lt.sha256_hash(str(ih.v2)))
            return handle if handle.is_valid() else None
        except Exception:
            return None

    def _fetch_torrent_file(self, url: str) -> bytes:
        if not _is_http(url):
            raise EngineError("invalid_url", "only http:// and https:// URLs are allowed")
        request = urllib.request.Request(url, headers={
            "User-Agent": self.settings.get("userAgent", "MMZ Torrent/0.1.0"),
            "Accept": "application/x-bittorrent, application/octet-stream, */*",
        })
        context = ssl.create_default_context()
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT, context=context) as response:
                final = response.geturl()
                if not _is_http(final):
                    raise EngineError("invalid_url", "redirected to a non-HTTP scheme")
                chunks: List[bytes] = []
                total = 0
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_FETCH_BYTES:
                        raise EngineError("too_large", "torrent file exceeds 32 MB")
                    chunks.append(chunk)
                data = b"".join(chunks)
        except EngineError:
            raise
        except urllib.error.HTTPError as exc:
            raise EngineError("fetch_failed", f"HTTP {exc.code} while fetching torrent")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise EngineError("fetch_failed", f"could not fetch torrent: {exc}")
        if not data:
            raise EngineError("fetch_failed", "empty response")
        return data

    # -- per torrent actions --------------------------------------------
    def _entry(self, info_hash: str) -> Dict[str, Any]:
        entry = self.torrents.get(info_hash.lower())
        if entry is None:
            raise EngineError("not_found", f"torrent not found: {info_hash}")
        return entry

    def _hashes(self, params: Dict[str, Any]) -> List[str]:
        raw = params.get("hashes")
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, list) or not raw:
            raise EngineError("invalid_params", "hashes array is required")
        return [str(h).lower() for h in raw]

    def cmd_remove(self, params: Dict[str, Any]) -> Dict[str, Any]:
        delete_files = bool(params.get("deleteFiles", False))
        removed: List[str] = []
        for key in self._hashes(params):
            entry = self.torrents.pop(key, None)
            if entry is None:
                continue
            try:
                option = _REMOVE_FLAGS if delete_files else 0
                self.session.remove_torrent(entry["handle"], option)
            except Exception as exc:
                self.log.log("warning", f"remove failed: {exc}", source="torrent", torrent=key)
            self.store.forget(key)
            removed.append(key)
            self.log.log("info", "torrent removed" + (" with files" if delete_files else ""),
                         source="torrent", torrent=key)
        return {"removed": removed, "deleteFiles": delete_files}

    def cmd_pause(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self._set_paused(params, True)

    def cmd_stop(self, params: Dict[str, Any]) -> Dict[str, Any]:
        # "stop" == pause; kept as its own method so the protocol (and future
        # work) can diverge (e.g. stop_when_ready) without breaking callers.
        return self._set_paused(params, True)

    def cmd_resume(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self._set_paused(params, False)

    def _set_paused(self, params: Dict[str, Any], paused: bool) -> Dict[str, Any]:
        changed: List[str] = []
        for key in self._hashes(params):
            entry = self._entry(key)
            handle = entry["handle"]
            try:
                if paused:
                    handle.unset_flags(lt.torrent_flags.auto_managed)
                    handle.pause()
                else:
                    handle.resume()
                    if self.settings.get("queueManagement", True):
                        handle.set_flags(lt.torrent_flags.auto_managed)
                entry["error"] = ""
                changed.append(key)
            except Exception as exc:
                self.log.log("warning", f"pause/resume failed: {exc}", source="torrent",
                             torrent=key)
            self._schedule_save(key)
        return {"changed": changed, "paused": paused}

    def cmd_recheck(self, params: Dict[str, Any]) -> Dict[str, Any]:
        changed = []
        for key in self._hashes(params):
            entry = self._entry(key)
            try:
                entry["handle"].force_recheck()
                changed.append(key)
                self.log.log("info", "recheck started", source="torrent", torrent=key)
            except Exception as exc:
                self.log.log("warning", f"recheck failed: {exc}", source="torrent", torrent=key)
        return {"changed": changed}

    def cmd_reannounce(self, params: Dict[str, Any]) -> Dict[str, Any]:
        changed = []
        for key in self._hashes(params):
            entry = self._entry(key)
            try:
                entry["handle"].force_reannounce()
                changed.append(key)
            except Exception as exc:
                self.log.log("warning", f"reannounce failed: {exc}", source="torrent",
                             torrent=key)
        return {"changed": changed}

    def cmd_setFilePriorities(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        entry = self._entry(key)
        handle = entry["handle"]
        status = handle.status()
        if not status.has_metadata:
            raise EngineError("no_metadata", "torrent metadata not available yet")

        if "priorities" in params:
            priorities = params["priorities"]
            if not isinstance(priorities, list):
                raise EngineError("invalid_params", "priorities must be an array")
            self._apply_file_priorities(handle, priorities)
        elif "index" in params and "priority" in params:
            index = int(params["index"])
            priority = int(params["priority"])
            if priority < PRIORITY_MIN or priority > PRIORITY_MAX:
                raise EngineError("invalid_params", "priority must be 0..7")
            current = list(handle.get_file_priorities())
            if index < 0 or index >= len(current):
                raise EngineError("invalid_params", "file index out of range")
            current[index] = priority
            handle.prioritize_files(current)
        else:
            raise EngineError("invalid_params", "priorities or index+priority required")

        self._schedule_save(key)
        return {"hash": key, "files": ser.files_payload(handle)["files"]}

    def _apply_file_priorities(self, handle: Any, priorities: List[Any]) -> None:
        current = list(handle.get_file_priorities())
        if len(priorities) != len(current):
            raise EngineError("invalid_params",
                              f"expected {len(current)} priorities, got {len(priorities)}")
        cleaned: List[int] = []
        for value in priorities:
            prio = int(value)
            if prio < PRIORITY_MIN or prio > PRIORITY_MAX:
                raise EngineError("invalid_params", "priority must be 0..7")
            cleaned.append(prio)
        handle.prioritize_files(cleaned)

    def cmd_setTorrentOptions(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        entry = self._entry(key)
        handle = entry["handle"]
        limits = entry["limits"]

        if "downloadLimit" in params:
            value = int(params["downloadLimit"])
            limits["download"] = None if value == 0 else value
            handle.set_download_limit(value)
        if "uploadLimit" in params:
            value = int(params["uploadLimit"])
            limits["upload"] = None if value == 0 else value
            handle.set_upload_limit(value)
        if "maxConnections" in params:
            value = int(params["maxConnections"])
            limits["maxConnections"] = None if value == 0 else value
            handle.set_max_connections(value)
        if "sequential" in params:
            if params["sequential"]:
                handle.set_flags(lt.torrent_flags.sequential_download)
            else:
                handle.unset_flags(lt.torrent_flags.sequential_download)
        if "superSeeding" in params:
            if params["superSeeding"]:
                handle.set_flags(lt.torrent_flags.super_seeding)
            else:
                handle.unset_flags(lt.torrent_flags.super_seeding)
        if params.get("savePath"):
            try:
                target = normalize_dir(str(params["savePath"]), create=True)
            except ValueError as exc:
                raise EngineError("bad_save_path", str(exc))
            storage = handle.torrent_file().files() if handle.status().has_metadata else None
            if storage is not None:
                paths = [storage.file_path(i) for i in range(storage.num_files())]
                offenders = validate_file_storage(target, paths)
                if offenders:
                    raise EngineError("unsafe_path",
                                      f"unsafe path after move: {offenders[0][1]!r}")
            handle.move_storage(target)
            if entry["temp_dir"]:
                entry["temp_dir"] = False
                entry["final_dir"] = None
                self.store.save_meta(key, {"temp": False, "finalDir": ""})

        self._schedule_save(key)
        status = handle.status()
        return {"hash": key, "torrent": ser.torrent_summary(status, entry["added_at"])}

    # -- on demand detail -------------------------------------------------
    def cmd_setTrackers(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Replace the announce list of a torrent (validated schemes only)."""
        key = str(params.get("hash", "")).lower()
        entry = self._entry(key)
        raw = params.get("trackers")
        if not isinstance(raw, list):
            raise EngineError("invalid_params", "trackers must be an array")
        urls: List[str] = []
        for item in raw:
            if not isinstance(item, str):
                continue
            url = item.strip()
            if not url:
                continue
            if not url.startswith(("udp:", "http:", "https:")):
                raise EngineError("invalid_tracker", f"unsupported tracker scheme: {url}")
            if len(url) > 1024:
                raise EngineError("invalid_tracker", "tracker url too long")
            urls.append(url)
        handle = entry["handle"]
        try:
            handle.replace_trackers([lt.announce_entry(url) for url in urls])
        except Exception as exc:
            raise EngineError("tracker_update", str(exc))
        self._schedule_save(key)
        self.log.log("info", f"trackers updated ({len(urls)})", source="tracker", torrent=key)
        return {"hash": key, "trackers": ser.trackers_payload(handle)}

    def cmd_getFiles(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        return ser.files_payload(self._entry(key)["handle"])

    def cmd_getPeers(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        return {"hash": key, "peers": ser.peers_payload(self._entry(key)["handle"])}

    def cmd_getTrackers(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        return {"hash": key, "trackers": ser.trackers_payload(self._entry(key)["handle"])}

    def cmd_getPieces(self, params: Dict[str, Any]) -> Dict[str, Any]:
        key = str(params.get("hash", "")).lower()
        return ser.pieces_payload(self._entry(key)["handle"])

    def cmd_getSessionStats(self, _params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "global": ser.global_summary(self._counters, self._rates, self.settings),
            "counters": {k: v for k, v in self._counters.items()
                         if k.startswith(("net.", "ses.", "dht."))},
        }

    def cmd_getLog(self, params: Dict[str, Any]) -> Dict[str, Any]:
        since = int(params.get("since", 0))
        limit = min(int(params.get("limit", 500)), 2000)
        info_hash = params.get("hash")
        entries = self.log.since(since, limit)
        if info_hash:
            entries = [e for e in entries if e.get("torrent") == str(info_hash).lower()]
        return {"entries": entries}

    def cmd_shutdown(self, _params: Dict[str, Any]) -> Dict[str, Any]:
        """Ask the engine to persist everything and exit cleanly."""
        self._running = False
        return {"ok": True}

    # ------------------------------------------------------------------
    # worker loop: commands + alerts + tick (single thread)
    # ------------------------------------------------------------------
    def run(self) -> None:
        """Main worker loop; runs until stop() is called."""
        next_tick = 0.0
        while self._running:
            did_work = False
            try:
                while True:
                    message = self._commands.get_nowait()
                    did_work = True
                    self._dispatch(message)
            except queue.Empty:
                pass
            except Exception as exc:  # pragma: no cover - defensive
                self.log.log("error", f"worker error: {exc}", source="worker")

            now = time.time()
            if now >= next_tick:
                next_tick = now + self.TICK_INTERVAL
                try:
                    self.tick()
                except Exception as exc:  # pragma: no cover - defensive
                    self.log.log("error", f"tick failed: {exc}", source="worker")

            if not did_work:
                time.sleep(0.05)

    def _dispatch(self, message: Dict[str, Any]) -> None:
        msg_id = message.get("id")
        method = message.get("method")
        params = message.get("params")
        if not isinstance(method, str):
            if msg_id is not None:
                self._emit("_response", {"id": msg_id, "ok": False,
                                         "error": {"code": "invalid_request",
                                                   "message": "method must be a string"}})
            return
        try:
            result = self.execute(method, params)
        except EngineError as exc:
            if msg_id is not None:
                self._emit("_response", {"id": msg_id, "ok": False,
                                         "error": {"code": exc.code, "message": exc.message}})
            self.log.log("debug", f"{method} failed: {exc.message}", source="rpc")
            return
        except Exception as exc:
            if msg_id is not None:
                self._emit("_response", {"id": msg_id, "ok": False,
                                         "error": {"code": "internal", "message": str(exc)}})
            self.log.log("error", f"{method} crashed: {exc}", source="rpc")
            return

        if isinstance(result, Deferred):
            if msg_id is None:
                return

            def ok(value: Any, _id: Any = msg_id) -> None:
                self._emit("_response", {"id": _id, "ok": True, "result": value})

            def err(code: str, message: str, _id: Any = msg_id) -> None:
                self._emit("_response", {"id": _id, "ok": False,
                                         "error": {"code": code, "message": message}})

            result.then(ok).catch(err)
            return

        if msg_id is not None:
            self._emit("_response", {"id": msg_id, "ok": True, "result": result})

    def tick(self) -> None:
        if self.session is None:
            return
        now = time.time()
        self.session.post_torrent_updates()
        self.session.post_session_stats()
        for alert in self.session.pop_alerts():
            self._handle_alert(alert)

        if now >= self._next_save_check:
            self._next_save_check = now + self.SAVE_CHECK_INTERVAL
            for key, entry in self.torrents.items():
                try:
                    if entry["handle"].need_save_resume_data():
                        self._schedule_save(key)
                except Exception:
                    pass

        self._process_saves()
        self._emit_tick()

    # -- alerts ----------------------------------------------------------
    def _handle_alert(self, alert: Any) -> None:
        try:
            if isinstance(alert, lt.state_update_alert):
                for status in alert.status:
                    self._pending_status[ser.primary_hash(status)] = status
                return
            if isinstance(alert, lt.session_stats_alert):
                self._counters = dict(alert.values)
                return
            if isinstance(alert, lt.metadata_received_alert):
                self._on_metadata(alert.handle)
                return
            if isinstance(alert, lt.torrent_finished_alert):
                self._on_finished(alert.handle)
                return
            if isinstance(alert, lt.save_resume_data_alert):
                self._persist_resume(alert)
                return
            if isinstance(alert, lt.save_resume_data_failed_alert):
                self._save_failed(alert)
                return
            if isinstance(alert, (lt.torrent_error_alert, lt.file_error_alert)):
                message = str(getattr(alert, "error", "") or alert.message())
                key = _handle_hash(alert.handle)
                self.log.log("error", message, source="torrent", torrent=key)
                entry = self.torrents.get(key)
                if entry is not None:
                    entry["error"] = message
                self._emit("torrentError", {"hash": key, "message": message})
                return
            if isinstance(alert, lt.tracker_error_alert):
                key = _handle_hash(alert.handle)
                message = alert.message()
                self.log.log("warning", f"tracker error: {message}", source="tracker",
                             torrent=key)
                self._emit("trackerStatus", {"hash": key, "url": alert.url,
                                             "working": False, "message": message})
                return
            if isinstance(alert, lt.tracker_warning_alert):
                key = _handle_hash(alert.handle)
                self.log.log("warning", alert.message(), source="tracker", torrent=key)
                return
            if isinstance(alert, lt.tracker_reply_alert):
                key = _handle_hash(alert.handle)
                self._emit("trackerStatus", {"hash": key, "url": alert.url,
                                             "working": True, "message": ""})
                return
            if isinstance(alert, lt.listen_failed_alert):
                message = alert.message()
                self.log.log("error", f"listen failed: {message}", source="network")
                self._emit("listenStatus", {"ok": False, "message": message})
                return
            if isinstance(alert, lt.listen_succeeded_alert):
                self.log.log("info", f"listening on {alert.address}:{alert.port}",
                             source="network")
                return
            if isinstance(alert, lt.torrent_checked_alert):
                key = _handle_hash(alert.handle)
                self.log.log("info", "recheck finished", source="torrent", torrent=key)
                self._schedule_save(key)
                self._emit("recheckFinished", {"hash": key})
                return
            if isinstance(alert, lt.storage_moved_alert):
                key = _handle_hash(alert.handle)
                self.log.log("info", f"storage moved to {alert.path}", source="storage",
                             torrent=key)
                self._emit("storageMoved", {"hash": key, "path": alert.path})
                self._schedule_save(key)
                return
            if isinstance(alert, lt.storage_moved_failed_alert):
                key = _handle_hash(alert.handle)
                message = alert.message()
                self.log.log("error", f"storage move failed: {message}", source="storage",
                             torrent=key)
                self._emit("storageMoveFailed", {"hash": key, "message": message})
                return
            if isinstance(alert, lt.performance_alert):
                self.log.log("warning", alert.message(), source="performance")
                return
            if isinstance(alert, lt.dht_stats_alert):
                return
            if isinstance(alert, lt.torrent_log_alert):
                self.log.log("debug", alert.message(), source="torrent",
                             torrent=_handle_hash(alert.handle))
                return
            if isinstance(alert, lt.peer_log_alert):
                self.log.log("debug", alert.message(), source="peer")
                return
            if isinstance(alert, (lt.log_alert, lt.portmap_log_alert)):
                self.log.log("debug", alert.message(), source="libtorrent")
                return
            if isinstance(alert, _NOISY_ALERTS):
                return
            self.log.log("debug", f"unhandled alert: {alert.what()}", source="alerts")
        except Exception as exc:  # alert handling must never kill the loop
            self.log.log("debug", f"alert handling error: {exc}", source="alerts")

    def _on_metadata(self, handle: Any) -> None:
        key = _handle_hash(handle)
        entry = self.torrents.get(key)
        if entry is None:
            return
        # Persist the generated .torrent so magnets survive a restart.
        # libtorrent 2.x removed file hashing from create_torrent, so we rebuild
        # the .torrent from the raw info-section instead (validated below).
        try:
            ti = handle.torrent_file()
            info_dict = lt.bdecode(ti.info_section())
            payload: Dict[bytes, Any] = {b"info": info_dict}
            trackers: Dict[int, List[bytes]] = {}
            for entry in handle.trackers():
                if entry.url:
                    trackers.setdefault(int(entry.tier), []).append(entry.url.encode("utf-8"))
            if trackers:
                first = next(iter(sorted(trackers.items())))
                payload[b"announce"] = first[1][0]
                payload[b"announce-list"] = [[u] for _, urls in sorted(trackers.items())
                                             for u in urls]
            torrent_bytes = lt.bencode(payload)
            lt.torrent_info(torrent_bytes)  # validation pass
            self.store.save_torrent(key, torrent_bytes)
        except Exception as exc:
            self.log.log("warning", f"could not persist metadata: {exc}", source="storage",
                         torrent=key)

        # Late path validation (magnets carry no paths until metadata arrives).
        try:
            status = handle.status()
            save_path = status.save_path
            storage = handle.torrent_file().files()
            paths = [storage.file_path(i) for i in range(storage.num_files())]
            offenders = validate_file_storage(save_path, paths)
            if offenders:
                handle.unset_flags(lt.torrent_flags.auto_managed)
                handle.pause()
                entry["error"] = f"unsafe path in torrent: {offenders[0][1]!r}"
                self.log.log("error", entry["error"], source="security", torrent=key)
                self._emit("torrentError", {"hash": key, "message": entry["error"]})
                return
        except UnsafePathError as exc:
            entry["error"] = str(exc)
            self._emit("torrentError", {"hash": key, "message": str(exc)})

        self._schedule_save(key)
        meta = ser.metadata_summary(handle)
        self.log.log("info", f"metadata received for {meta.get('name') or key}",
                     source="torrent", torrent=key)
        self._emit("metadataReceived", meta)

    def _on_finished(self, handle: Any) -> None:
        key = _handle_hash(handle)
        entry = self.torrents.get(key)
        name = handle.status().name or key
        self.log.log("info", f"download finished: {name}", source="torrent", torrent=key)
        if entry is not None and entry.get("temp_dir") and entry.get("final_dir"):
            try:
                handle.move_storage(entry["final_dir"])
                entry["temp_dir"] = False
                self.store.save_meta(key, {"temp": False, "finalDir": entry["final_dir"]})
                self.log.log("info", f"moved to {entry['final_dir']}", source="storage",
                             torrent=key)
            except Exception as exc:
                self.log.log("error", f"move on completion failed: {exc}", source="storage",
                             torrent=key)
        self._schedule_save(key)
        self._emit("torrentFinished", {"hash": key, "name": name})

    # -- resume persistence ---------------------------------------------
    def _schedule_save(self, info_hash: str) -> None:
        if info_hash in self.torrents:
            self._pending_saves.add(info_hash)

    def _process_saves(self) -> None:
        for key in list(self._pending_saves):
            entry = self.torrents.get(key)
            if entry is None:
                self._pending_saves.discard(key)
                continue
            try:
                if not entry["handle"].need_save_resume_data():
                    self._pending_saves.discard(key)
                    continue
                entry["handle"].save_resume_data(lt.save_resume_flags_t.save_info_dict)
                self._pending_saves.discard(key)
                self._pending_saves_inflight.add(key)
            except Exception:
                # torrent may be checking; retry on the next pass
                self._pending_saves.discard(key)

    def _persist_resume(self, alert: Any) -> None:
        try:
            params = alert.params
            buf = lt.write_resume_data_buf(params)
            key = _hash_from_params(params)
            if not key:
                key = _handle_hash(alert.handle)
            if key:
                self.store.save_resume(key, bytes(buf))
            self._pending_saves_inflight.discard(key)
        except Exception as exc:
            self.log.log("warning", f"could not write resume data: {exc}", source="storage")

    def _save_failed(self, alert: Any) -> None:
        try:
            key = _handle_hash(alert.handle)
        except Exception:
            key = ""
        self._pending_saves_inflight.discard(key)
        self.log.log("debug", f"resume data not needed: {alert.message()}",
                     source="storage", torrent=key or None)

    # -- tick emission ---------------------------------------------------
    def _emit_tick(self) -> None:
        statuses = self._pending_status
        self._pending_status = {}

        summaries: List[Dict[str, Any]] = []
        download_total = 0
        upload_total = 0
        now = time.time()

        for key, entry in self.torrents.items():
            status = statuses.get(key)
            if status is None:
                status = entry.get("last_status")
                stale = (status is None or
                         now - entry.get("last_refresh", 0) >= self.STALE_REFRESH_SECONDS)
                if status is None or (status.download_payload_rate > 0 or
                                      status.upload_payload_rate > 0 or stale):
                    try:
                        status = entry["handle"].status()
                    except Exception:
                        continue
            entry["last_status"] = status
            entry["last_refresh"] = now

            download_total += int(status.download_payload_rate)
            upload_total += int(status.upload_payload_rate)

            extra: Dict[str, Any] = {}
            if entry.get("error"):
                extra["error"] = entry["error"]
            if entry.get("temp_dir") and entry.get("final_dir"):
                extra["finalPath"] = entry["final_dir"]
            summaries.append(ser.torrent_summary(status, entry["added_at"], extra))

        self._rates = {
            "downloadRate": download_total,
            "uploadRate": upload_total,
            "torrentCount": len(summaries),
        }
        payload = {
            "ts": now,
            "global": ser.global_summary(self._counters, self._rates, self.settings),
            "torrents": summaries,
        }
        self._emit("tick", payload)
