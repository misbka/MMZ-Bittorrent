"""Engine configuration: defaults, validation and libtorrent settings mapping.

Every setting accepted by the engine is declared here exactly once.  Unknown
keys coming from the UI are rejected instead of silently ignored so a typo can
never produce a "setting did nothing" bug.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ENCRYPTION_MODES = ("enabled", "forced", "disabled")

PROXY_TYPES = ("none", "http", "socks5", "socks4", "http_with_auth")

DEFAULTS: Dict[str, Any] = {
    # --- connection -------------------------------------------------------
    "listenPort": 6881,
    "listenInterfaces": "",          # empty -> 0.0.0.0:<listenPort> (+ ipv6 if available)
    "upnp": True,
    "natpmp": True,
    "ipv6": True,
    "maxConnections": 500,
    "maxConnectionsPerTorrent": 100,
    "maxUploadsPerTorrent": 12,
    "proxy": {
        "type": "none",
        "host": "",
        "port": 8080,
        "username": "",
        "password": "",
    },
    # --- bandwidth --------------------------------------------------------
    "downloadRateLimit": 0,          # bytes/second, 0 = unlimited
    "uploadRateLimit": 0,            # bytes/second, 0 = unlimited
    "torrentDownloadRateLimit": 0,   # per torrent, 0 = unlimited
    "torrentUploadRateLimit": 0,     # per torrent, 0 = unlimited
    "maxActiveDownloads": 5,
    "maxActiveSeeds": 5,
    "maxActiveTorrents": 10,
    # --- protocol ---------------------------------------------------------
    "dht": True,
    "pex": True,
    "lsd": True,
    "encryption": "enabled",         # enabled | forced | disabled
    "anonymousMode": False,
    "announceToAllTrackers": False,
    "upnpLeaseDuration": 3600,
    # --- behaviour --------------------------------------------------------
    "downloadDirectory": "",         # resolved by the host before start
    "temporaryDirectory": "",        # when set, incomplete torrents live here
    "startAddedTorrents": True,
    "resumeOnStart": True,
    "recheckOnStart": False,
    "sequentialDownload": False,
    "queueManagement": True,
    "userAgent": "MMZ Torrent/0.1.0",
    "pieceSelection": "normal",      # normal | strict (sequential-ish picker)
}

_REQUIRED_TYPES: Dict[str, Tuple[type, ...]] = {
    "listenPort": (int,),
    "listenInterfaces": (str,),
    "upnp": (bool,),
    "natpmp": (bool,),
    "ipv6": (bool,),
    "maxConnections": (int,),
    "maxConnectionsPerTorrent": (int,),
    "maxUploadsPerTorrent": (int,),
    "proxy": (dict,),
    "downloadRateLimit": (int,),
    "uploadRateLimit": (int,),
    "torrentDownloadRateLimit": (int,),
    "torrentUploadRateLimit": (int,),
    "maxActiveDownloads": (int,),
    "maxActiveSeeds": (int,),
    "maxActiveTorrents": (int,),
    "dht": (bool,),
    "pex": (bool,),
    "lsd": (bool,),
    "encryption": (str,),
    "anonymousMode": (bool,),
    "announceToAllTrackers": (bool,),
    "upnpLeaseDuration": (int,),
    "downloadDirectory": (str,),
    "temporaryDirectory": (str,),
    "startAddedTorrents": (bool,),
    "resumeOnStart": (bool,),
    "recheckOnStart": (bool,),
    "sequentialDownload": (bool,),
    "queueManagement": (bool,),
    "userAgent": (str,),
    "pieceSelection": (str,),
}

_PROXY_KEYS = ("type", "host", "port", "username", "password")


class ConfigError(ValueError):
    """Raised when a settings payload from the host is invalid."""


def merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Validate *patch* against DEFAULTS and return a full settings dict."""
    unknown = [k for k in patch if k not in DEFAULTS]
    if unknown:
        raise ConfigError("unknown settings: " + ", ".join(sorted(unknown)))

    merged = dict(base)
    for key, value in patch.items():
        expected = _REQUIRED_TYPES[key]
        if key == "proxy":
            if not isinstance(value, dict):
                raise ConfigError("proxy must be an object")
            bad = [k for k in value if k not in _PROXY_KEYS]
            if bad:
                raise ConfigError("unknown proxy settings: " + ", ".join(sorted(bad)))
            current = dict(merged.get("proxy", DEFAULTS["proxy"]))
            for pk, pv in value.items():
                if pk == "type" and pv not in PROXY_TYPES:
                    raise ConfigError(f"invalid proxy type: {pv}")
                if pk == "port" and not isinstance(pv, int):
                    raise ConfigError("proxy.port must be an integer")
                current[pk] = pv
            merged["proxy"] = current
            continue
        if not isinstance(value, expected):
            raise ConfigError(f"{key} must be of type {expected[0].__name__}")
        if key == "encryption" and value not in ENCRYPTION_MODES:
            raise ConfigError(f"invalid encryption mode: {value}")
        if key == "pieceSelection" and value not in ("normal", "strict"):
            raise ConfigError(f"invalid pieceSelection: {value}")
        if isinstance(value, int) and not isinstance(value, bool):
            if value < 0:
                raise ConfigError(f"{key} must be >= 0")
        merged[key] = value

    if merged["listenPort"] and not (0 < merged["listenPort"] < 65536):
        raise ConfigError("listenPort must be in 1..65535")
    return merged


def _encryption_policies(mode: str) -> Tuple[int, int]:
    """Map UI encryption mode to libtorrent in/out policy ints."""
    if mode == "disabled":
        return 0, 0
    if mode == "forced":
        return 2, 2
    return 1, 1


def to_libtorrent(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the MMZ settings payload into libtorrent settings_pack keys.

    The returned dict only contains keys known to libtorrent; it is meant to be
    passed to ``session.apply_settings``.
    """
    port = int(settings["listenPort"]) or 6881
    interfaces: List[str] = []
    configured = (settings.get("listenInterfaces") or "").strip()
    if configured:
        interfaces = [part.strip() for part in configured.split(",") if part.strip()]
    else:
        interfaces.append(f"0.0.0.0:{port}")
        if settings.get("ipv6", True):
            interfaces.append(f"[::]:{port}")

    in_pol, out_pol = _encryption_policies(settings["encryption"])
    proxy = settings["proxy"]

    out: Dict[str, Any] = {
        "listen_interfaces": ",".join(interfaces),
        "enable_upnp": bool(settings["upnp"]),
        "enable_natpmp": bool(settings["natpmp"]),
        "enable_dht": bool(settings["dht"]),
        "enable_lsd": bool(settings["lsd"]),
        # NOTE: PEX has no session-wide switch in libtorrent; it is toggled per
        # torrent through torrent_flags.disable_pex (see Engine._prepare_flags).
        "enable_incoming_tcp": True,
        "enable_outgoing_tcp": True,
        "enable_incoming_utp": True,
        "enable_outgoing_utp": True,
        "connections_limit": int(settings["maxConnections"]),
        "download_rate_limit": int(settings["downloadRateLimit"]),
        "upload_rate_limit": int(settings["uploadRateLimit"]),
        "active_downloads": int(settings["maxActiveDownloads"]),
        "active_seeds": int(settings["maxActiveSeeds"]),
        "active_limit": int(settings["maxActiveTorrents"]),
        "in_enc_policy": in_pol,
        "out_enc_policy": out_pol,
        "anonymous_mode": bool(settings["anonymousMode"]),
        "announce_to_all_trackers": bool(settings["announceToAllTrackers"]),
        "user_agent": settings["userAgent"],
        "handshake_client_version": settings["userAgent"],
        "upnp_lease_duration": int(settings["upnpLeaseDuration"]),
        "alert_mask": _alert_mask(),
        "max_queued_disk_bytes": 16 * 1024 * 1024,
        "cache_size": 0 if True else 0,  # libtorrent 2.x uses disk cache auto-tuning
    }
    out.pop("cache_size", None)

    if proxy.get("type", "none") != "none" and proxy.get("host"):
        proxy_map = {"http": 1, "socks5": 2, "socks4": 3, "http_with_auth": 4}
        out["proxy_type"] = proxy_map[proxy["type"]]
        out["proxy_hostname"] = proxy["host"]
        out["proxy_port"] = int(proxy.get("port") or 8080)
        if proxy.get("username"):
            out["proxy_username"] = proxy["username"]
        if proxy.get("password"):
            out["proxy_password"] = proxy["password"]
        out["proxy_peer_connections"] = True
        out["proxy_tracker_connections"] = True
    else:
        out["proxy_type"] = 0

    return out


def _alert_mask() -> int:
    import libtorrent as lt  # local import keeps unit tests importable w/o lt

    mask = (
        lt.alert_category.error
        | lt.alert_category.status
        | lt.alert_category.storage
        | lt.alert_category.tracker
        | lt.alert_category.connect
        | lt.alert_category.port_mapping
        | lt.alert_category.performance_warning
        | lt.alert_category.dht
        | lt.alert_category.session_log
        | lt.alert_category.torrent_log
    )
    return int(mask)


def validate(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if payload is None:
        return dict(DEFAULTS)
    if not isinstance(payload, dict):
        raise ConfigError("settings payload must be an object")
    return merge(dict(DEFAULTS), payload)
