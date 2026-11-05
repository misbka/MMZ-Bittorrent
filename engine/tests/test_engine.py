"""Functional tests for the MMZ Torrent engine (real libtorrent transfers).

These tests deliberately exercise *real* BitTorrent traffic: a local seeder
session shares a generated payload over loopback and the engine under test
downloads it, verifies priorities, metadata exchange (BEP 9/10), persistence
across restarts and the stdio protocol end-to-end.

Run with:  python engine/run-tests.py   (or `npm run engine:test`)
"""

from __future__ import annotations

import base64
import functools
import hashlib
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)

ENGINE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.dirname(ENGINE_DIR)
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

import libtorrent as lt  # noqa: E402

from bittorrent import config as config_mod  # noqa: E402
from bittorrent.engine import Deferred, Engine, EngineError  # noqa: E402
from bittorrent.persistence import Store  # noqa: E402
from bittorrent.safety import (  # noqa: E402
    UnsafePathError, is_safe_member, normalize_dir, safe_join, validate_file_storage,
)

PIECE = 16 * 1024


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def make_torrent_bytes(files, piece_size=PIECE, announce="http://127.0.0.1:9/announce",
                       name=b"payload") -> bytes:
    """Build a valid v1 .torrent from an ordered list of (path, data).

    ``files`` is a list of tuples: single-element paths create a single-file
    torrent when there is exactly one entry and ``name`` matches, otherwise a
    multi-file torrent rooted at ``name``.
    """
    paths = [p for p, _ in files]
    payloads = [d for _, d in files]
    stream = b"".join(payloads)
    pieces = b"".join(hashlib.sha1(stream[i:i + piece_size]).digest()
                       for i in range(0, len(stream), piece_size))
    info = {b"name": name, b"piece length": piece_size, b"pieces": pieces}
    if len(files) == 1 and len(paths[0].split("/")) == 1:
        info[b"name"] = paths[0].encode()
        info[b"length"] = len(payloads[0])
    else:
        info[b"files"] = [
            {b"path": [seg.encode() for seg in path.split("/")], b"length": len(data)}
            for path, data in files
        ]
    return lt.bencode({b"announce": announce.encode(), b"info": info})


class Seeder:
    """A local libtorrent session that seeds generated payload on loopback."""

    def __init__(self, torrent_bytes: bytes, source_dir: str, port: int | None = None):
        self.port = port or free_port()
        self.source_dir = source_dir
        self.session = lt.session({
            "listen_interfaces": f"127.0.0.1:{self.port}",
            "enable_dht": False, "enable_lsd": False,
            "enable_upnp": False, "enable_natpmp": False,
            "alert_mask": 0xffffffff,
        })
        ti = lt.torrent_info(torrent_bytes)
        params = lt.add_torrent_params()
        params.ti = ti
        params.save_path = source_dir
        # default add flags start paused; make the seeder serve immediately so
        # tests never connect during the paused window
        params.flags = ((params.flags | lt.torrent_flags.seed_mode
                         | lt.torrent_flags.auto_managed)
                        & ~lt.torrent_flags.paused)
        self.handle = self.session.add_torrent(params)
        self.info_hash = str(ti.info_hashes().v1)
        # give the listen socket and auto-manager a moment to come up
        deadline = time.time() + 10.0
        while time.time() < deadline:
            self.session.post_torrent_updates()
            self.session.pop_alerts()
            if not self.handle.status().paused:
                break
            time.sleep(0.1)

    def pump(self) -> None:
        self.session.post_torrent_updates()
        self.session.pop_alerts()

    def close(self) -> None:
        session = getattr(self, "session", None)
        if session is None:
            return
        try:
            session.remove_torrent(self.handle)
        except Exception:
            pass
        self.session = None


class EventLog:
    def __init__(self) -> None:
        self.events: list = []
        self._lock = threading.Lock()

    def __call__(self, name, data) -> None:
        with self._lock:
            self.events.append((name, data))

    def of(self, name: str) -> list:
        with self._lock:
            return [d for n, d in self.events if n == name]

    def clear(self) -> None:
        with self._lock:
            self.events.clear()


def pump(engine: Engine, seconds: float = 5.0, until=None) -> bool:
    """Drive engine ticks until the condition holds (or time runs out)."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        engine.tick()
        if until is not None and until():
            return True
        time.sleep(0.05)
    return bool(until()) if until else True


class EngineTestCase(unittest.TestCase):
    """Shared temp workspace + engine factory."""

    def setUp(self) -> None:
        self.work = tempfile.mkdtemp(prefix="mmz-engine-")
        self.src = os.path.join(self.work, "src")
        self.dl = os.path.join(self.work, "dl")
        self.store_dir = os.path.join(self.work, "store")
        os.makedirs(self.src, exist_ok=True)
        os.makedirs(self.dl, exist_ok=True)
        self.engines: list = []
        self.seeders: list = []

    def tearDown(self) -> None:
        for engine in self.engines:
            try:
                engine.stop()
                engine.shutdown(timeout=3.0)
            except Exception:
                pass
        for seeder in self.seeders:
            try:
                seeder.close()
            except Exception:
                pass
        shutil.rmtree(self.work, ignore_errors=True)

    # -- factories -------------------------------------------------------
    def base_settings(self, **overrides) -> dict:
        settings = {
            "downloadDirectory": self.dl,
            "listenInterfaces": f"127.0.0.1:{free_port()}",
            "upnp": False, "natpmp": False, "ipv6": False,
            "dht": False, "lsd": False, "pex": False,
            "startAddedTorrents": True,
            "maxActiveDownloads": 8, "maxActiveSeeds": 8, "maxActiveTorrents": 16,
        }
        settings.update(overrides)
        return config_mod.validate(settings)

    def make_engine(self, store_dir: str | None = None, **overrides):
        store = Store(store_dir or self.store_dir)
        events = EventLog()
        engine = Engine(self.base_settings(**overrides), store, emit=events)
        engine.start()
        self.engines.append(engine)
        return engine, events

    def make_seeder(self, torrent_bytes: bytes) -> Seeder:
        seeder = Seeder(torrent_bytes, self.src)
        self.seeders.append(seeder)
        return seeder

    def write_payload(self, files) -> None:
        for path, data in files:
            full = os.path.join(self.src, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "wb") as fh:
                fh.write(data)

    @staticmethod
    def add(engine: Engine, torrent_bytes: bytes | None = None, urls=None,
            **params) -> dict:
        payload = dict(params)
        if torrent_bytes is not None:
            payload["torrentFiles"] = [{
                "name": "test.torrent",
                "data": base64.b64encode(torrent_bytes).decode("ascii"),
            }]
        if urls:
            payload["urls"] = urls
        result = engine.execute("addTorrent", payload)
        assert not isinstance(result, EngineError)
        if isinstance(result, Deferred):
            # HTTP downloads answer asynchronously
            box: dict = {}
            done = threading.Event()
            result.then(lambda value: (box.setdefault("ok", value), done.set()))
            result.catch(lambda code, message: (box.setdefault("err", (code, message)),
                                                done.set()))
            self_ok = done.wait(30)
            assert self_ok, "async addTorrent never settled"
            assert "err" not in box, box["err"]
            return box["ok"]
        return result


# ---------------------------------------------------------------------------
# protocol / configuration
# ---------------------------------------------------------------------------
class ProtocolTests(EngineTestCase):
    def test_hello(self):
        engine, _ = self.make_engine()
        hello = engine.execute("hello", {})
        self.assertEqual(hello["protocolVersion"], 1)
        self.assertIn("libtorrentVersion", hello)
        self.assertTrue(hello["engineVersion"])

    def test_unknown_method_rejected(self):
        engine, _ = self.make_engine()
        with self.assertRaises(EngineError):
            engine.execute("definitelyNotAMethod", {})

    def test_configure_rejects_unknown_keys(self):
        engine, _ = self.make_engine()
        with self.assertRaises(EngineError):
            engine.execute("configure", {"settings": {"bogusKey": 1}})
        with self.assertRaises(EngineError):
            engine.execute("configure", {"settings": {"encryption": "rot13"}})
        with self.assertRaises(EngineError):
            engine.execute("configure", {"settings": {"listenPort": 700000}})

    def test_configure_applies_bandwidth_limits(self):
        engine, _ = self.make_engine()
        result = engine.execute("configure", {
            "settings": {"downloadRateLimit": 1024 * 128, "uploadRateLimit": 1024 * 32},
        })
        self.assertEqual(result["settings"]["downloadRateLimit"], 1024 * 128)
        applied = engine.session.get_settings()
        self.assertEqual(applied["download_rate_limit"], 1024 * 128)
        self.assertEqual(applied["upload_rate_limit"], 1024 * 32)

    def test_log_buffer(self):
        engine, _ = self.make_engine()
        engine.log.log("info", "hello log", source="test")
        result = engine.execute("getLog", {"limit": 10})
        self.assertTrue(any(e["message"] == "hello log" for e in result["entries"]))


# ---------------------------------------------------------------------------
# adding torrents (validation, magnet, HTTP)
# ---------------------------------------------------------------------------
class AddTests(EngineTestCase):
    def test_add_invalid_torrent_is_skipped(self):
        engine, _ = self.make_engine()
        result = self.add(engine, torrent_bytes=b"definitely not bencode")
        self.assertEqual(result["added"], [])
        self.assertEqual(len(result["skipped"]), 1)
        self.assertIn("invalid", result["skipped"][0]["reason"])

    def test_add_invalid_magnet_is_skipped(self):
        engine, _ = self.make_engine()
        result = self.add(engine, urls=["magnet:?dn=nope"])
        self.assertEqual(result["added"], [])
        self.assertEqual(len(result["skipped"]), 1)

    def test_add_unsupported_scheme_is_skipped(self):
        engine, _ = self.make_engine()
        result = self.add(engine, urls=["file:///etc/passwd"])
        self.assertEqual(result["added"], [])
        self.assertIn("unsupported scheme", result["skipped"][0]["reason"])

    def test_add_requires_save_path(self):
        engine, _ = self.make_engine(downloadDirectory="")
        with self.assertRaises(EngineError) as ctx:
            self.add(engine, urls=["magnet:?xt=urn:btih:" + "a" * 40])
        self.assertEqual(ctx.exception.code, "no_save_path")

    def test_add_duplicate_reports_duplicate(self):
        payload = os.urandom(40 * 1024)
        files = [("dup.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"dup.bin")
        engine, _ = self.make_engine()
        first = self.add(engine, torrent)
        second = self.add(engine, torrent)
        self.assertEqual(len(first["added"]), 1)
        self.assertTrue(second["added"][0]["duplicate"])

    def test_add_via_http_url(self):
        payload = os.urandom(64 * 1024)
        files = [("http.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"http.bin")
        torrent_path = os.path.join(self.src, "served.torrent")
        with open(torrent_path, "wb") as fh:
            fh.write(torrent)

        port = free_port()

        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):  # noqa: D102 - silence test server
                pass

        handler = functools.partial(QuietHandler, directory=self.src)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            engine, _ = self.make_engine()
            result = self.add(engine, urls=[f"http://127.0.0.1:{port}/served.torrent"])
            self.assertEqual(len(result["added"]), 1, result)
            self.assertEqual(engine.torrents[result["added"][0]["hash"]]["handle"].status().name,
                             "http.bin")
        finally:
            server.shutdown()
            server.server_close()

    def test_add_magnet_without_hash_skipped(self):
        engine, _ = self.make_engine()
        result = self.add(engine, urls=["magnet:?dn=only-name"])
        self.assertEqual(result["added"], [])


# ---------------------------------------------------------------------------
# tracker list management (setTrackers)
# ---------------------------------------------------------------------------
class TrackerTests(EngineTestCase):
    def _add_torrent(self, engine: Engine) -> str:
        payload = os.urandom(32 * 1024)
        files = [("trackers.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"trackers.bin")
        result = self.add(engine, torrent)
        self.assertEqual(len(result["added"]), 1)
        return result["added"][0]["hash"]

    def test_set_trackers_replaces_announce_list(self):
        engine, _ = self.make_engine()
        key = self._add_torrent(engine)

        replaced = engine.execute("setTrackers", {
            "hash": key,
            "trackers": ["udp://tracker.example.invalid:80/announce",
                         "https://tracker.example.invalid/announce"],
        })
        self.assertNotIsInstance(replaced, EngineError)
        urls = sorted(t["url"] for t in replaced["trackers"])
        self.assertEqual(urls, sorted(["udp://tracker.example.invalid:80/announce",
                                       "https://tracker.example.invalid/announce"]))

        # the change is visible through getTrackers as well
        read_back = engine.execute("getTrackers", {"hash": key})
        self.assertEqual(sorted(t["url"] for t in read_back["trackers"]), urls)

        # clearing works too (empty list = no trackers)
        cleared = engine.execute("setTrackers", {"hash": key, "trackers": []})
        self.assertEqual(cleared["trackers"], [])

    def test_timestamps_are_milliseconds(self):
        """libtorrent reports seconds; the protocol must expose milliseconds."""
        engine, _ = self.make_engine()
        key = self._add_torrent(engine)

        result = engine.execute("setTorrentOptions", {"hash": key, "sequential": False})
        torrent = result["torrent"]
        # ms since epoch: anything near 1.7e12 is 2026, ~1.7e9 would be 1970
        self.assertGreater(torrent["addedAt"], 1_700_000_000_000)
        self.assertLess(torrent["addedAt"], 4_000_000_000_000)
        # not finished yet -> 0, never a bogus 1970 date
        self.assertEqual(torrent["completedAt"], 0)

    def test_set_trackers_rejects_unsafe_schemes(self):
        engine, _ = self.make_engine()
        key = self._add_torrent(engine)

        for bad in ["ftp://tracker.example.invalid/announce",
                    "javascript:alert(1)",
                    "file:///etc/passwd"]:
            with self.assertRaises(EngineError) as ctx:
                engine.execute("setTrackers", {"hash": key, "trackers": [bad]})
            self.assertEqual(ctx.exception.code, "invalid_tracker")

        with self.assertRaises(EngineError):
            engine.execute("setTrackers", {"hash": key, "trackers": "not-a-list"})
        with self.assertRaises(EngineError):
            engine.execute("setTrackers", {"hash": "f" * 40,
                                           "trackers": ["udp://x/announce"]})


# ---------------------------------------------------------------------------
# real transfers over loopback
# ---------------------------------------------------------------------------
class TransferTests(EngineTestCase):
    def _seeded_transfer(self, engine, seeder, timeout=45.0) -> None:
        key = seeder.info_hash
        entry = engine.torrents.get(key)
        self.assertIsNotNone(entry, "torrent was not registered")
        entry["handle"].connect_peer(("127.0.0.1", seeder.port))

        def finished():
            seeder.pump()
            status = entry["handle"].status()
            return bool(status.is_finished or status.progress >= 1.0)

        if not pump(engine, timeout, finished):
            st = entry["handle"].status()
            self.fail("transfer did not finish: state=%s progress=%.3f peers=%d seeds=%d "
                      "rate=%d err=%r" % (st.state, st.progress, st.num_peers, st.num_seeds,
                                          st.download_payload_rate, st.error))

    def test_full_download_with_file_priorities(self):
        # sizes are piece-aligned so no piece is shared between the two files
        data_a = os.urandom(128 * 1024)
        data_b = os.urandom(96 * 1024)
        files = [("root/alpha.bin", data_a), ("root/beta.bin", data_b)]
        self.write_payload(files)
        # info.files paths are relative to the torrent name ("root")
        torrent = make_torrent_bytes([("alpha.bin", data_a), ("beta.bin", data_b)],
                                     name=b"root")
        seeder = self.make_seeder(torrent)
        engine, events = self.make_engine()

        # beta is skipped (priority 0) on the first pass
        result = self.add(engine, torrent, filePriorities=[4, 0])
        self.assertEqual(len(result["added"]), 1)

        self._seeded_transfer(engine, seeder)

        hash_ = seeder.info_hash
        detail = engine.execute("getFiles", {"hash": hash_})
        by_name = {f["path"].replace("\\", "/"): f for f in detail["files"]}
        alpha = by_name["root/alpha.bin"]
        beta = by_name["root/beta.bin"]
        self.assertEqual(alpha["priority"], 4)
        self.assertEqual(beta["priority"], 0)
        self.assertGreaterEqual(alpha["progress"], 0.999)
        self.assertEqual(beta["downloaded"], 0,
                         "an ignored file must not receive data")

        downloaded = os.path.join(self.dl, "root", "alpha.bin")
        with open(downloaded, "rb") as fh:
            self.assertEqual(hashlib.sha256(fh.read()).digest(),
                             hashlib.sha256(data_a).digest())

        # re-enable beta and watch it fill in
        engine.execute("setFilePriorities", {"hash": hash_, "priorities": [4, 4]})
        deadline_ok = pump(engine, 45.0, lambda: (
            engine.execute("getFiles", {"hash": hash_})["files"][1]["progress"] >= 0.999))
        self.assertTrue(deadline_ok, "beta did not download after re-enabling")

        finished_events = events.of("torrentFinished")
        self.assertTrue(any(e["hash"] == hash_ for e in finished_events),
                        "torrentFinished event missing")

        # completion timestamp must be milliseconds (libtorrent reports seconds)
        def completed_ms() -> int:
            res = engine.execute("setTorrentOptions", {"hash": hash_, "sequential": False})
            return int(res["torrent"]["completedAt"])

        self.assertTrue(pump(engine, 10.0, lambda: completed_ms() > 0),
                        "completedAt never became available after finishing")
        self.assertGreater(completed_ms(), 1_700_000_000_000,
                           "completedAt looks like seconds, not milliseconds")

        # status summary sanity
        summary = engine.execute("getSessionStats", {})
        self.assertIn("downloadTotal", summary["global"])

    def test_pause_resume_stop(self):
        payload = os.urandom(200 * 1024)
        files = [("pause.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"pause.bin")
        seeder = self.make_seeder(torrent)
        engine, _ = self.make_engine()
        result = self.add(engine, torrent)
        key = result["added"][0]["hash"]
        entry = engine.torrents[key]
        entry["handle"].connect_peer(("127.0.0.1", seeder.port))

        # let it start downloading
        pump(engine, 3.0, lambda: (seeder.pump(),
                                   entry["handle"].status().download_payload_rate > 0)[1])

        engine.execute("pause", {"hashes": [key]})
        self.assertTrue(pump(engine, 5.0, lambda: entry["handle"].status().paused))
        # the reported payload rate is an EWMA that decays over ~10s; the real
        # invariant is that no further bytes arrive while paused
        before = entry["handle"].status().total_done
        pump(engine, 2.0)
        after = entry["handle"].status().total_done
        self.assertEqual(before, after, "bytes kept arriving while paused")
        status = entry["handle"].status()
        self.assertTrue(status.paused)

        engine.execute("resume", {"hashes": [key]})
        self.assertTrue(pump(engine, 8.0, lambda: not entry["handle"].status().paused))

        engine.execute("stop", {"hashes": [key]})
        self.assertTrue(pump(engine, 5.0, lambda: entry["handle"].status().paused))

    def test_magnet_metadata_exchange(self):
        payload = os.urandom(80 * 1024)
        files = [("mag.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"mag.bin")
        seeder = self.make_seeder(torrent)
        engine, events = self.make_engine()

        result = self.add(engine, urls=[f"magnet:?xt=urn:btih:{seeder.info_hash}&dn=mag.bin"])
        self.assertEqual(len(result["added"]), 1, result)
        key = result["added"][0]["hash"]
        entry = engine.torrents[key]
        self.assertFalse(entry["handle"].status().has_metadata)

        entry["handle"].connect_peer(("127.0.0.1", seeder.port))
        got_meta = pump(engine, 30.0, lambda: entry["handle"].status().has_metadata)
        self.assertTrue(got_meta, "metadata never arrived")
        self.assertTrue(any(e.get("hash") == key for e in events.of("metadataReceived")))

        detail = engine.execute("getFiles", {"hash": key})
        self.assertEqual(len(detail["files"]), 1)
        self.assertEqual(detail["files"][0]["name"], "mag.bin")

        # and the metadata torrent file is persisted for restores
        self.assertIsNotNone(engine.store.load_torrent(key))

        # finish the download to prove magnet transfers really work
        self.assertTrue(pump(engine, 45.0, lambda: entry["handle"].status().progress >= 1.0))
        with open(os.path.join(self.dl, "mag.bin"), "rb") as fh:
            self.assertEqual(hashlib.sha256(fh.read()).digest(),
                             hashlib.sha256(payload).digest())

    def test_recheck_detects_missing_file(self):
        payload = os.urandom(64 * 1024)
        files = [("check.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"check.bin")
        seeder = self.make_seeder(torrent)
        engine, _ = self.make_engine()
        result = self.add(engine, torrent)
        key = result["added"][0]["hash"]
        entry = engine.torrents[key]
        entry["handle"].connect_peer(("127.0.0.1", seeder.port))

        # download fully first (seed exists)
        if not pump(engine, 45.0, lambda: entry["handle"].status().is_finished
                    or entry["handle"].status().progress >= 1.0):
            st = entry["handle"].status()
            self.fail("initial download did not finish: state=%s progress=%.3f peers=%d "
                      "rate=%d err=%r" % (st.state, st.progress, st.num_peers,
                                          st.download_payload_rate, st.error))

        # stop the seeder so the recheck result cannot be masked by re-downloading
        seeder.close()

        # delete the payload and force a recheck: progress must drop
        os.remove(os.path.join(self.dl, "check.bin"))
        engine.execute("recheck", {"hashes": [key]})

        def finished_checking():
            status = entry["handle"].status()
            state = str(status.state).split(".")[-1]
            return status.progress < 1.0 and state not in (
                "checking_files", "checking_resume_data", "allocating")

        self.assertTrue(pump(engine, 30.0, finished_checking),
                        "recheck did not run")

    def test_pieces_and_peers_endpoints(self):
        payload = os.urandom(64 * 1024)
        files = [("pieces.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"pieces.bin")
        seeder = self.make_seeder(torrent)
        engine, _ = self.make_engine()
        result = self.add(engine, torrent)
        key = result["added"][0]["hash"]
        entry = engine.torrents[key]
        entry["handle"].connect_peer(("127.0.0.1", seeder.port))
        pump(engine, 8.0)

        peers = engine.execute("getPeers", {"hash": key})
        self.assertIsInstance(peers["peers"], list)

        pieces = engine.execute("getPieces", {"hash": key})
        self.assertTrue(pieces["hasMetadata"])
        self.assertGreater(pieces["pieceCount"], 0)
        bitmap = base64.b64decode(pieces["bitmap"])
        self.assertEqual(len(bitmap), (pieces["pieceCount"] + 7) // 8)
        self.assertEqual(pieces["piecesHave"], sum(bin(b).count("1") for b in bitmap))

        trackers = engine.execute("getTrackers", {"hash": key})
        self.assertTrue(any(t["url"].startswith("http://") for t in trackers["trackers"]))


# ---------------------------------------------------------------------------
# safety
# ---------------------------------------------------------------------------
class SafetyTests(unittest.TestCase):
    def test_safe_member(self):
        root = os.path.abspath(os.path.join(tempfile.gettempdir(), "mmz-root"))
        self.assertTrue(is_safe_member(root, os.path.join("sub", "file.bin")))
        self.assertFalse(is_safe_member(root, "../../etc/passwd"))
        self.assertFalse(is_safe_member(root, "/etc/passwd"))
        self.assertFalse(is_safe_member(root, "sub/../../escape.bin"))
        if os.name == "nt":
            self.assertFalse(is_safe_member(root, "C:\\Windows\\evil.dll"))
            self.assertFalse(is_safe_member(root, "..\\..\\evil.bin"))

    def test_validate_storage_reports_offenders(self):
        root = os.path.abspath(os.path.join(tempfile.gettempdir(), "mmz-root2"))
        offenders = validate_file_storage(root, ["ok/one.bin", "../two.bin"])
        self.assertEqual(len(offenders), 1)
        self.assertEqual(offenders[0][1], "../two.bin")

    def test_normalize_dir_creates(self):
        target = os.path.join(tempfile.gettempdir(), "mmz-created-dir")
        if os.path.isdir(target):
            shutil.rmtree(target)
        try:
            result = normalize_dir(target, create=True)
            self.assertTrue(os.path.isdir(result))
            with self.assertRaises(ValueError):
                normalize_dir(os.path.join(target, "missing", "child"))
        finally:
            shutil.rmtree(target, ignore_errors=True)

    def test_crafted_traversal_torrent_stays_inside_download_dir(self):
        """libtorrent sanitizes hostile paths; the result must stay rooted."""
        payload = os.urandom(40 * 1024)
        pieces = b"".join(hashlib.sha1(payload[i:i + PIECE]).digest()
                          for i in range(0, len(payload), PIECE))
        info = {
            b"name": b"evil",
            b"piece length": PIECE,
            b"pieces": pieces,
            b"files": [{b"path": [b"..", b"escaped.txt"], b"length": len(payload)}],
        }
        torrent = lt.bencode({b"info": info})
        work = tempfile.mkdtemp(prefix="mmz-evil-")
        try:
            dl = os.path.join(work, "dl")
            os.makedirs(dl)
            ti = lt.torrent_info(torrent)
            storage = ti.files()
            paths = [storage.file_path(i) for i in range(storage.num_files())]
            offenders = validate_file_storage(dl, paths)
            self.assertEqual(offenders, [], "engine would reject a torrent libtorrent already sanitized")
            for member in paths:
                self.assertTrue(is_safe_member(dl, member), member)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_unsafe_path_error_raised(self):
        root = os.path.abspath(os.path.join(tempfile.gettempdir(), "mmz-safe-root"))
        with self.assertRaises(UnsafePathError):
            safe_join(root, os.path.join("..", "escape.bin"))
        with self.assertRaises(UnsafePathError):
            safe_join(root, os.path.join("sub", "..", "..", "escape.bin"))
        self.assertEqual(safe_join(root, os.path.join("sub", "ok.bin")),
                         os.path.normpath(os.path.join(root, "sub", "ok.bin")))


# ---------------------------------------------------------------------------
# persistence / restart
# ---------------------------------------------------------------------------
class PersistenceTests(EngineTestCase):
    def _add_and_save(self, engine, torrent, paused=False):
        result = self.add(engine, torrent)
        key = result["added"][0]["hash"]
        if paused:
            engine.execute("pause", {"hashes": [key]})
        engine._schedule_save(key)
        saved = pump(engine, 8.0, lambda: engine.store.load_resume(key) is not None)
        if not saved:
            # belt & braces: force the write path directly
            entry = engine.torrents.get(key)
            if entry is not None:
                entry["handle"].save_resume_data(lt.save_resume_flags_t.save_info_dict)
                saved = pump(engine, 8.0, lambda: engine.store.load_resume(key) is not None)
        self.assertTrue(saved, "resume data was never written")
        return key

    def test_restore_after_restart(self):
        payload = os.urandom(64 * 1024)
        files = [("restore.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"restore.bin")

        engine1, _ = self.make_engine()
        key = self._add_and_save(engine1, torrent)
        engine1.stop()
        engine1.shutdown(timeout=4.0)

        engine2, _ = self.make_engine(store_dir=self.store_dir,
                                      listenInterfaces=f"127.0.0.1:{free_port()}")
        self.assertIn(key, engine2.torrents, "torrent was not restored")
        self.assertIsNotNone(engine2.store.load_torrent(key))

    def test_paused_state_survives_restart(self):
        payload = os.urandom(32 * 1024)
        files = [("keep-paused.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"keep-paused.bin")

        engine1, _ = self.make_engine()
        key = self._add_and_save(engine1, torrent, paused=True)
        engine1.stop()
        engine1.shutdown(timeout=4.0)

        engine2, _ = self.make_engine(store_dir=self.store_dir,
                                      listenInterfaces=f"127.0.0.1:{free_port()}")
        self.assertIn(key, engine2.torrents)
        entry = engine2.torrents[key]
        status = entry["handle"].status()
        self.assertTrue(status.paused, "paused torrent auto-resumed on restore")

    def test_remove_deletes_persistence_files(self):
        payload = os.urandom(32 * 1024)
        files = [("gone.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"gone.bin")
        engine, _ = self.make_engine()
        key = self._add_and_save(engine, torrent)
        self.assertIsNotNone(engine.store.load_resume(key))

        engine.execute("remove", {"hashes": [key]})
        self.assertNotIn(key, engine.torrents)
        self.assertIsNone(engine.store.load_resume(key))
        self.assertIsNone(engine.store.load_torrent(key))

    def test_remove_with_delete_files(self):
        payload = os.urandom(64 * 1024)
        files = [("delete-me.bin", payload)]
        self.write_payload(files)
        torrent = make_torrent_bytes(files, name=b"delete-me.bin")
        seeder = self.make_seeder(torrent)
        engine, _ = self.make_engine()
        result = self.add(engine, torrent)
        key = result["added"][0]["hash"]
        entry = engine.torrents[key]
        entry["handle"].connect_peer(("127.0.0.1", seeder.port))
        self.assertTrue(pump(engine, 45.0, lambda: entry["handle"].status().progress >= 1.0))

        target = os.path.join(self.dl, "delete-me.bin")
        self.assertTrue(os.path.isfile(target))

        engine.execute("remove", {"hashes": [key], "deleteFiles": True})
        deleted = pump(engine, 15.0, lambda: not os.path.exists(target))
        self.assertTrue(deleted, "file was not deleted after remove(deleteFiles=True)")


# ---------------------------------------------------------------------------
# end-to-end stdio protocol with a real child process
# ---------------------------------------------------------------------------
class EngineProcess:
    """Speaks NDJSON with a real ``engine/run.py`` child process."""

    def __init__(self, data_dir: str, settings: dict):
        settings_path = os.path.join(data_dir, "settings.json")
        with open(settings_path, "w", encoding="utf-8") as fh:
            json.dump(settings, fh)
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(ENGINE_DIR, "run.py"),
             "--data-dir", data_dir, "--settings", settings_path],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=REPO_ROOT, bufsize=0,
        )
        self.stderr_lines: list = []
        threading.Thread(target=self._read_stderr, daemon=True).start()
        self._next_id = 0
        self._responses: dict = {}
        self._events: list = []
        self._cond = threading.Condition()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read_stderr(self) -> None:
        for raw in self.proc.stderr:
            self.stderr_lines.append(raw.decode("utf-8", "replace").rstrip())

    def _read(self) -> None:
        for raw in self.proc.stdout:
            try:
                message = json.loads(raw.decode("utf-8"))
            except ValueError:
                continue
            with self._cond:
                if "id" in message:
                    self._responses[message["id"]] = message
                elif "event" in message:
                    self._events.append(message)
                self._cond.notify_all()

    def request(self, method: str, params: dict | None = None, timeout: float = 15.0):
        with self._cond:
            self._next_id += 1
            msg_id = self._next_id
        frame = json.dumps({"id": msg_id, "method": method, "params": params or {}}) + "\n"
        self.proc.stdin.write(frame.encode("utf-8"))
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        with self._cond:
            while msg_id not in self._responses:
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise TimeoutError(f"no response for {method}")
                self._cond.wait(remaining)
            return self._responses[msg_id]

    def events(self, name: str) -> list:
        with self._cond:
            return [m["data"] for m in self._events if m["event"] == name]

    def close(self, timeout: float = 10.0) -> int:
        try:
            self.request("shutdown", {}, timeout=5.0)
        except Exception:
            pass
        try:
            self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5.0)
        return self.proc.returncode


class SubprocessTests(unittest.TestCase):
    def test_engine_process_hello_add_shutdown(self):
        work = tempfile.mkdtemp(prefix="mmz-proc-")
        try:
            settings = {
                "downloadDirectory": os.path.join(work, "dl"),
                "listenInterfaces": f"127.0.0.1:{free_port()}",
                "upnp": False, "natpmp": False, "dht": False, "lsd": False,
                "pex": False, "ipv6": False,
            }
            os.makedirs(settings["downloadDirectory"], exist_ok=True)
            proc = EngineProcess(work, settings)
            try:
                hello = proc.request("hello")
                self.assertTrue(hello["ok"], hello)
                self.assertEqual(hello["result"]["protocolVersion"], 1)

                # a magnet without seeder: just prove add flows through stdio
                fake_hash = hashlib.sha1(b"mmz-test-torrent").hexdigest()
                added = proc.request("addTorrent", {
                    "urls": [f"magnet:?xt=urn:btih:{fake_hash}&dn=proc-test"],
                })
                self.assertTrue(added["ok"], added)
                self.assertEqual(len(added["result"]["added"]), 1)

                stats = proc.request("getSessionStats")
                self.assertTrue(stats["ok"], stats)
                self.assertIn("global", stats["result"])

                bad = proc.request("nopeNotAMethod")
                self.assertFalse(bad["ok"], bad)

                # wait for at least one tick event
                deadline = time.time() + 10.0
                while time.time() < deadline and not proc.events("tick"):
                    time.sleep(0.1)
                self.assertTrue(proc.events("tick"), "no tick events received")
            finally:
                code = proc.close()
                self.assertEqual(code, 0,
                                 "engine exited with an error:\n" +
                                 "\n".join(proc.stderr_lines[-20:]))
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
