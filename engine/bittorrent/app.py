"""Engine entry point: wires stdio transport, settings and the Engine core."""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
from typing import Any, Dict, Optional

from . import config as config_mod
from .engine import Engine, EngineError
from .persistence import Store
from .protocol import Host


def _load_settings(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("settings file must contain a JSON object")
    return data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mmz-engine",
                                     description="MMZ Torrent BitTorrent engine (libtorrent)")
    parser.add_argument("--data-dir", required=True,
                        help="directory for resume data, torrents and metadata")
    parser.add_argument("--settings", default=None,
                        help="path to a JSON file with engine settings")
    parser.add_argument("--version", action="store_true",
                        help="print versions and exit")
    return parser


def main(argv: Optional[list] = None) -> int:
    args = build_parser().parse_args(argv)

    if args.version:
        import libtorrent as lt
        from . import ENGINE_VERSION
        print(json.dumps({"engine": ENGINE_VERSION, "libtorrent": lt.version}))
        return 0

    try:
        raw_settings = _load_settings(args.settings)
        settings = config_mod.validate(raw_settings)
    except (OSError, ValueError, config_mod.ConfigError) as exc:
        print(f"mmz-engine: invalid settings: {exc}", file=sys.stderr)
        return 2

    data_dir = os.path.abspath(args.data_dir)
    try:
        os.makedirs(data_dir, exist_ok=True)
    except OSError as exc:
        print(f"mmz-engine: cannot use data dir {data_dir}: {exc}", file=sys.stderr)
        return 2

    store = Store(os.path.join(data_dir, "store"))
    host = Host()

    def emit(name: str, data: Any) -> None:
        if name == "_response":
            host.send(data)
        else:
            host.send_event(name, data)

    engine = Engine(settings, store, emit)

    try:
        engine.start()
    except EngineError as exc:
        print(f"mmz-engine: {exc.message}", file=sys.stderr)
        return 3

    def on_shutdown_signal(_signum: Any, _frame: Any) -> None:
        engine.stop()

    for sig_name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, on_shutdown_signal)
            except (ValueError, OSError):
                pass

    reader = threading.Thread(target=host.read_loop,
                              args=(engine.submit, engine.stop),
                              name="mmz-reader", daemon=True)
    reader.start()

    try:
        engine.run()
    finally:
        engine.shutdown()
        host.close()
        # The reader thread is parked on a blocking stdin read.  If the parent
        # closed our stdin it will have exited on EOF; otherwise a finalizing
        # interpreter would abort on the daemon thread's buffered read, so we
        # exit the hard way (stdout is flushed after every frame).
        reader.join(timeout=1.0)
        if reader.is_alive():
            os._exit(0)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
