#!/usr/bin/env python3
"""Standalone launcher for the MMZ Torrent engine.

Works both from the repository (``python engine/run.py``) and from a bundled
runtime (``python resources/engine/src/run.py``) because it resolves its own
directory instead of relying on the current working directory.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bittorrent.app import main  # noqa: E402  (path set up above)

if __name__ == "__main__":
    raise SystemExit(main())
