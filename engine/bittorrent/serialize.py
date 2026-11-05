"""Serialization helpers: libtorrent objects -> JSON-safe dicts for the host."""

from __future__ import annotations

import base64
import time
from typing import Any, Dict, List, Optional

import libtorrent as lt

# libtorrent state name -> UI state vocabulary (kept stable for the renderer)
_UI_STATES = {
    "checking_files": "checking",
    "checking_resume_data": "checking",
    "allocating": "allocating",
    "downloading_metadata": "metadata",
    "downloading": "downloading",
    "finished": "finished",
    "seeding": "seeding",
}


def state_name(state: Any) -> str:
    """libtorrent state enum -> stable string name."""
    return str(state).split(".")[-1]


def ui_state(status: Any) -> str:
    """Map a torrent_status to the compact state used by the UI."""
    err = getattr(status, "error", "") or ""
    if err:
        return "error"
    if getattr(status, "moving_storage", False):
        return "moving"
    name = state_name(status.state)
    base = _UI_STATES.get(name, name)
    if getattr(status, "paused", False):
        if getattr(status, "auto_managed", False):
            return "queued"
        return "paused"
    if base == "downloading" and status.download_payload_rate <= 0:
        return "stalled"
    return base


def primary_hash(status: Any) -> str:
    """Prefer the v1 (SHA1) hash for display; fall back to v2 (SHA256)."""
    ih = status.info_hashes
    v1 = str(ih.v1)
    v2 = str(ih.v2)
    if v1 and v1 != "0" * 40:
        return v1
    return v2


def _eta(seconds: float) -> int:
    if seconds < 0 or seconds != seconds or seconds == float("inf"):
        return -1
    return int(seconds)


def compute_eta(status: Any) -> int:
    remaining = status.total_wanted - status.total_wanted_done
    rate = status.download_payload_rate
    if remaining <= 0:
        return 0
    if rate <= 0:
        return -1
    return _eta(remaining / rate)


def torrent_summary(status: Any, added_at: float, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Compact per-torrent payload pushed on every tick."""
    err = getattr(status, "error", "") or ""
    completed = status.total > 0 and status.total_done >= status.total and status.progress >= 1.0
    summary: Dict[str, Any] = {
        "hash": primary_hash(status),
        "name": status.name or "",
        "state": state_name(status.state),
        "uiState": ui_state(status),
        "progress": round(float(status.progress), 4),
        "totalSize": int(status.total),
        "totalWanted": int(status.total_wanted),
        "downloaded": int(status.total_done),
        "downloadedAllTime": int(status.all_time_download),
        "uploadedAllTime": int(status.all_time_upload),
        "downloadRate": int(status.download_payload_rate),
        "uploadRate": int(status.upload_payload_rate),
        "eta": compute_eta(status),
        "numSeeds": int(status.num_seeds),
        "numPeers": int(status.num_peers),
        "knownSeeds": int(status.list_seeds),
        "knownPeers": int(status.list_peers),
        "numComplete": int(status.num_complete),
        "numIncomplete": int(status.num_incomplete),
        "availability": round(float(status.distributed_copies), 2),
        "savePath": status.save_path or "",
        # libtorrent reports unix timestamps in *seconds*; the whole host side
        # (DB, renderer, Date.now) works with milliseconds, so convert here and
        # keep the protocol unit consistent: ms since epoch.
        "addedAt": int(float(status.added_time or added_at or 0) * 1000),
        "completedAt": int(float(status.completed_time or 0) * 1000),
        "error": err,
        "paused": bool(status.paused),
        "autoManaged": bool(status.auto_managed),
        "sequential": bool(status.sequential_download),
        "hasMetadata": bool(status.has_metadata),
        "queuePosition": int(status.queue_position),
        "pieceCount": int(status.num_pieces),
        "completed": bool(completed),
        "currentTracker": status.current_tracker or "",
        "downloadLimit": int(status.download_limit),
        "uploadLimit": int(status.upload_limit),
        "connections": int(status.num_connections),
        "downloadedWanted": int(status.total_wanted_done),
    }
    if extra:
        summary.update(extra)
    return summary


def global_summary(counters: Dict[str, Any], rates: Dict[str, int],
                   settings: Dict[str, Any]) -> Dict[str, Any]:
    """Session-wide numbers for the status bar / graphs."""
    def _c(*keys: str, default: int = 0) -> int:
        for key in keys:
            if key in counters:
                try:
                    return int(counters[key])
                except (TypeError, ValueError):
                    continue
        return default

    return {
        "downloadRate": int(rates.get("downloadRate", 0)),
        "uploadRate": int(rates.get("uploadRate", 0)),
        "downloadTotal": _c("net.recv_payload_bytes"),
        "uploadTotal": _c("net.sent_payload_bytes"),
        "connections": _c("ses.num_connections", "ses.num_peers"),
        "maxConnections": int(settings.get("maxConnections", 0)),
        "dhtNodes": _c("dht.dht_nodes"),
        "downloadLimit": int(settings.get("downloadRateLimit", 0)),
        "uploadLimit": int(settings.get("uploadRateLimit", 0)),
        "torrents": int(rates.get("torrentCount", 0)),
    }


def files_payload(handle: Any) -> Dict[str, Any]:
    """Per-file detail (on demand): size, progress, priority, availability."""
    status = handle.status()
    if not status.has_metadata:
        return {"hash": primary_hash(status), "files": [], "hasMetadata": False}

    ti = handle.torrent_file()
    storage = ti.files()
    try:
        progress = list(handle.file_progress())
    except Exception:
        progress = []
    try:
        priorities = list(handle.get_file_priorities())
    except Exception:
        priorities = []

    files: List[Dict[str, Any]] = []
    for index in range(storage.num_files()):
        size = int(storage.file_size(index))
        done = int(progress[index]) if index < len(progress) else 0
        prio = int(priorities[index]) if index < len(priorities) else 4
        files.append({
            "index": index,
            "name": storage.file_name(index),
            "path": storage.file_path(index),
            "size": size,
            "downloaded": done,
            "progress": round(done / size, 4) if size > 0 else 1.0,
            "priority": prio,
            "pad": bool(storage.file_flags(index) & lt.file_storage.flag_pad_file),
        })
    return {
        "hash": primary_hash(status),
        "hasMetadata": True,
        "files": files,
        "pieceLength": int(storage.piece_length()),
        "totalSize": int(storage.total_size()),
    }


def peers_payload(handle: Any) -> List[Dict[str, Any]]:
    peers: List[Dict[str, Any]] = []
    for peer in handle.get_peer_info():
        client = peer.client
        if isinstance(client, (bytes, bytearray)):
            client = bytes(client).decode("utf-8", "replace")
        peers.append({
            "ip": str(peer.ip),
            "client": client or "",
            "progress": round(float(peer.progress), 4),
            "downSpeed": int(getattr(peer, "payload_down_speed", 0)),
            "upSpeed": int(getattr(peer, "payload_up_speed", 0)),
            "downloaded": int(getattr(peer, "total_download", 0)),
            "uploaded": int(getattr(peer, "total_upload", 0)),
            "flags": int(peer.flags),
            "numPieces": int(getattr(peer, "num_pieces", 0)),
            "connecting": bool(getattr(peer, "connecting", False)),
            "seed": bool(int(peer.flags) & int(getattr(lt.peer_info, "seed", 0) or 0)),
        })
    peers.sort(key=lambda p: p["downSpeed"], reverse=True)
    return peers


def trackers_payload(handle: Any) -> List[Dict[str, Any]]:
    """Announce entries for the Trackers tab.

    The Python bindings hand back plain dicts (not announce_entry objects), so
    everything goes through ``_field`` which supports both shapes.
    """
    now = time.time()

    def _field(entry: Any, key: str, default: Any = None) -> Any:
        if isinstance(entry, dict):
            return entry.get(key, default)
        return getattr(entry, key, default)

    trackers: List[Dict[str, Any]] = []
    for entry in handle.trackers():
        last_error = _field(entry, "last_error") or {}
        error_value = 0
        if isinstance(last_error, dict):
            error_value = int(last_error.get("value") or 0)
        elif last_error is not None:
            try:
                error_value = int(getattr(last_error, "value", 0) or 0)
            except Exception:
                error_value = 0

        next_announce = _field(entry, "next_announce", 0) or 0
        try:
            next_announce = float(next_announce)
        except (TypeError, ValueError):
            next_announce = 0.0
        # bindings expose a unix timestamp; tolerate a relative value too
        next_in = int(next_announce - now) if next_announce > 1_000_000_000 \
            else int(next_announce)
        if next_in < 0:
            next_in = 0

        message = _field(entry, "message", "") or ""
        if not message and error_value:
            message = f"error #{error_value}"

        trackers.append({
            "url": _field(entry, "url", ""),
            "tier": int(_field(entry, "tier", 0) or 0),
            "fails": int(_field(entry, "fails", 0) or 0),
            "working": error_value == 0,
            "message": message,
            "error": message if error_value else "",
            "nextAnnounceIn": next_in,
            "scrapeComplete": int(_field(entry, "scrape_complete", -1) or -1),
            "scrapeIncomplete": int(_field(entry, "scrape_incomplete", -1) or -1),
            "scrapeDownloaded": int(_field(entry, "scrape_downloaded", -1) or -1),
            "verified": bool(_field(entry, "verified", False)),
        })
    trackers.sort(key=lambda t: (t["tier"], t["url"]))
    return trackers


def pieces_payload(handle: Any) -> Dict[str, Any]:
    """Bitmap of verified pieces + per-piece peer availability."""
    status = handle.status()
    if not status.has_metadata:
        return {"hash": primary_hash(status), "hasMetadata": False, "pieceCount": 0}

    bits = list(status.pieces)
    bitmap = bytearray((len(bits) + 7) // 8)
    have = 0
    for index, value in enumerate(bits):
        if value:
            bitmap[index >> 3] |= 0x80 >> (index & 7)
            have += 1

    availability: List[int] = []
    try:
        availability = [int(v) for v in handle.piece_availability()]
    except Exception:
        availability = []

    piece_length = 0
    total_size = 0
    try:
        ti = handle.torrent_file()
        piece_length = int(ti.piece_length())
        total_size = int(ti.total_size())
    except Exception:
        pass

    return {
        "hash": primary_hash(status),
        "hasMetadata": True,
        "pieceCount": len(bits),
        "piecesHave": have,
        "pieceLength": piece_length,
        "totalSize": total_size,
        "bitmap": base64.b64encode(bytes(bitmap)).decode("ascii"),
        "availability": availability,
    }


def metadata_summary(handle: Any) -> Dict[str, Any]:
    status = handle.status()
    out: Dict[str, Any] = {"hash": primary_hash(status), "name": status.name or ""}
    if status.has_metadata:
        storage = handle.torrent_file().files()
        out["fileCount"] = int(storage.num_files())
        out["totalSize"] = int(storage.total_size())
    return out
