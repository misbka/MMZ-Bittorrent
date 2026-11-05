# Engine protocol (v1)

The BitTorrent engine is a **separate Python process** that owns one libtorrent
session. It never touches the UI directly: the Electron main process
(`src/main/engine.ts`) spawns it, speaks NDJSON over stdin/stdout, and forwards
sanitised events to the renderer over the `mmz:event` push channel.

Source of truth:

| Side            | File                                  |
| --------------- | ------------------------------------- |
| Framing, I/O    | `engine/bittorrent/protocol.py`       |
| Commands        | `engine/bittorrent/engine.py` (`cmd_*`) |
| Host client     | `src/main/engine.ts`                  |
| Event payloads  | `src/shared/types.ts`                 |
| Renderer IPC    | `src/shared/ipc.ts` (zod schemas)     |

## Transport

- **stdin / stdout only** — no sockets, no temp files, so nothing else on the
  machine can talk to the engine without already controlling the child process.
- One JSON object per line (UTF-8, `\n` terminated), `ensure_ascii=False`.
- stdout carries **only** protocol frames; human-readable diagnostics go to
  stderr.

Three frame shapes:

```jsonc
// host -> engine
{"id": 1, "method": "addTorrent", "params": { ... }}

// engine -> host (success / failure)
{"id": 1, "ok": true,  "result": { ... }}
{"id": 1, "ok": false, "error": {"code": "invalid_params", "message": "..."}}

// engine -> host (unsolicited event)
{"event": "tick", "data": { ... }}
```

`id` is echoed verbatim (it may be a number or a string). Responses and events
may interleave freely; the host matches responses by `id`.

Malformed frames are dropped with a `log` event instead of killing the reader
thread — the reader must never die.

## Handshake

The host always calls `hello` first (30 s timeout) and refuses to use an engine
whose `protocolVersion` it does not understand:

```jsonc
// result
{"protocolVersion": 1, "engineVersion": "0.1.0",
 "libtorrentVersion": "2.1.1", "python": "3.10.12"}
```

`PROTOCOL_VERSION = 1`. Breaking changes to any frame shape bump it.

## Commands

| Method                | Params (all optional unless noted)                          | Result |
| --------------------- | ------------------------------------------------------------ | ------ |
| `hello`               | —                                                            | handshake (above) |
| `configure`           | `settings` (required object, validated by `config.py`)       | `{settings}` merged view |
| `addTorrent`          | `torrentFiles[]` (base64), `urls[]` (magnet/http), `savePath` (required), `category`, `paused`, `sequential`, `filePriorities` | `{added[], skipped[]}` |
| `remove`              | `hashes[]`, `deleteFiles`                                    | `{removed[]}` |
| `pause` / `stop` / `resume` | `hashes[]`                                            | `{hashes[]}` |
| `recheck`             | `hashes[]`                                                   | `{hashes[]}` |
| `reannounce`          | `hashes[]`                                                   | `{hashes[]}` |
| `setFilePriorities`   | `hash`, `priorities[]` (0=skip, 1=low, 2=normal, 4=high)      | `{hash, files[]}` |
| `setTrackers`         | `hash`, `trackers[]` (`udp:`/`http:`/`https:` only)          | `{hash, trackers[]}` |
| `setTorrentOptions`   | `hash`, `downloadLimit`, `uploadLimit`, `maxConnections`, `sequential`, `superSeeding`, `savePath` | `{hash}` |
| `getFiles`            | `hash`                                                       | `{hash, files[]}` |
| `getPeers`            | `hash`                                                       | `{hash, peers[]}` |
| `getTrackers`         | `hash`                                                       | `{hash, trackers[]}` |
| `getPieces`           | `hash`                                                       | `{hash, bitfield, pieces[], ...}` |
| `getSessionStats`     | —                                                            | session totals |
| `getLog`              | `limit`, `since`                                             | `{entries[]}` |
| `shutdown`            | —                                                            | acknowledges, then exits |

`hash` is always the lowercase 40-char hex v1 info-hash (v2/hybrid torrents are
addressed by their v1 component).

## Events

| Event              | Data                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `tick`             | per-torrent snapshot list + session stats (drives the whole UI)  |
| `log`              | `{level, source, message, time, hash?}`                          |
| `torrentAdded`     | `{hash, name, source}`                                           |
| `torrentFinished`  | `{hash, name}`                                                   |
| `torrentError`     | `{hash, message}`                                                |
| `metadataReceived` | magnet metadata payload (BEP 9)                                  |
| `trackerStatus`    | `{hash, url, status, message}`                                   |
| `listenStatus`     | `{ok, message}`                                                  |
| `recheckFinished`  | `{hash}`                                                         |
| `storageMoved`     | `{hash, path}`                                                   |
| `storageMoveFailed`| `{hash, message}`                                                |

Timestamps in payloads are **milliseconds since the Unix epoch** (`addedAt`,
`completedAt`) — matching `Date.now()` on the host side. The only exception is
`log.ts`, which stays in seconds (the renderer converts it with `* 1000`); keep
any new timestamp field in milliseconds.

## Error codes

`add_failed`, `bad_save_path`, `fetch_failed`, `invalid_magnet`,
`invalid_params`, `invalid_settings`, `invalid_torrent`, `invalid_tracker`,
`invalid_url`, `no_metadata`, `no_save_path`, `not_found`, `session_init`,
`settings_apply`, `too_large`, `tracker_update`, `unknown_method`,
`unsafe_path`.

Codes are stable identifiers — match on `code`, never on `message`.

## Safety rules enforced by the engine

- `.torrent` and magnet inputs are parsed and validated **before** any disk
  write; invalid input is reported in `skipped[]`, not thrown.
- Every path coming out of a torrent is passed through
  `engine/bittorrent/safety.py`: `..` segments, absolute paths, drive-letter
  prefixes, UNC paths, reserved device names and symlink escapes raise
  `unsafe_path` and are refused.
- Tracker URLs must use `udp:` / `http:` / `https:` and be ≤ 1024 chars.
- `configure` rejects unknown keys (typos cannot silently change behaviour).

## Adding a command

1. Implement `cmd_<name>(self, params) -> dict` in `engine/bittorrent/engine.py`
   (raise `EngineError("<code>", message)` for failures).
2. Add a functional test in `engine/tests/test_engine.py`.
3. If the host should call it, add a typed wrapper in `src/main/core.ts` and,
   if the renderer can trigger it, a channel + zod schema in
   `src/shared/ipc.ts` and a handler in `src/main/ipc.ts`.
4. Document it in the table above.
