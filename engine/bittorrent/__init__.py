"""MMZ Torrent BitTorrent engine.

This package wraps libtorrent-rasterbar (via its official Python bindings)
behind a small, versioned JSON-RPC protocol executed over stdio.  The engine
runs as a separate OS process from the Electron UI so a crash in the network
layer can never take the interface down (and vice-versa).
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
