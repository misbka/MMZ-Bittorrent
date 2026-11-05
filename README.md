<p align="center">
  <img src="resources/icons/icon.svg" alt="MMZ Torrent logo" width="128" height="128" />
</p>

<h1 align="center">MMZ Torrent</h1>

<p align="center">
  A modern, fast and honest BitTorrent client for Windows and Linux.<br/>
  Built on Electron, React and a real <strong>libtorrent</strong> engine.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#screenshot">Screenshot</a> ·
  <a href="#requirements">Requirements</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#building--packaging">Building</a> ·
  <a href="#known-limitations">Limitations</a> ·
  <a href="#license">License</a>
</p>

---

## About

MMZ Torrent is a desktop BitTorrent client inspired by the classic µTorrent
workflow (list + filters + details panel), rebuilt with a modern stack and a
clean separation between UI and protocol engine.

The UI never fakes data: everything shown in the table, details tabs, graphs
and status bar is produced by a **real libtorrent 2.1 session** running in a
separate Python process, talking to Electron over a validated NDJSON
JSON-RPC channel (protocol `v1`).

### Screenshot

> _Placeholder — screenshots will be added once the UI settles._

| Main list (dark)                                   | Details panel                                   |
| -------------------------------------------------- | ----------------------------------------------- |
| _placeholder: torrent list, toolbar, status bar_   | _placeholder: files / peers / trackers / pieces_ |

## Features

**Torrent management**
- Add by `.torrent` file, magnet link or HTTP/HTTPS URL (multiple at once)
- Start / pause / resume / stop, remove, remove + delete files
- Recheck (force verification), reannounce to trackers
- Per-file selection and priorities (skip / low / normal / high)
- Per-torrent and global speed limits, queue position control
- Drag & drop `.torrent` files onto the window

**Protocol**
- BitTorrent v1, v2 and hybrid torrents
- DHT, PEX, LSD, UDP/HTTP/HTTPS trackers
- Magnet URIs with BEP 9 metadata exchange and BEP 10 extension protocol
- Protocol encryption (when supported), UPnP / NAT-PMP, IPv4 + IPv6
- Sequential downloading per torrent

**Interface**
- Modern React UI with light, dark and system themes
- i18n: **pt-BR (default fallback)**, Spanish and English — menus, settings,
  dialogs, notifications and tooltips
- Left sidebar filters (all / downloading / seeding / completed / paused /
  errors), search, sortable columns, custom column set, table density
- Details panel with 7 tabs: General, Files, Information, Peers, Trackers,
  Pieces (visual piece map) and Log
- Real-time status bar with session totals and a live speed graph
- Toast notifications, system tray with context menu, keyboard shortcuts

**Settings center** — General, Downloads, Connection, Speed (weekly schedule
with time windows), BitTorrent, Interface (theme / language / scale / columns)
and Advanced (logs, data directory, export & import, restore defaults).

**Security**
- `.torrent` and magnet validation before anything touches disk
- Path-traversal protection: crafted entries such as `../`, absolute paths and
  device names are rejected by the engine (see `engine/bittorrent/safety.py`)
- Renderer is sandboxed (`contextIsolation`, no Node in the page), IPC
  restricted to an explicit channel allow-list and every payload validated
  with zod on both sides
- Files are never executed automatically; "open containing folder" is
  sandboxed to the configured download/data directories

## Technology

| Layer       | Choice                                                             |
| ----------- | ------------------------------------------------------------------ |
| Shell       | Electron 37, electron-vite, contextIsolation + preload allow-list  |
| UI          | React 19, TypeScript, Tailwind CSS v4, Zustand, Lucide icons       |
| Validation  | zod (shared schemas for settings, IPC payloads)                    |
| Storage     | SQLite via Node's built-in `node:sqlite`, JSON settings backup     |
| Engine      | Python 3.10 + **libtorrent 2.1.1** (separate process)              |
| Protocol    | NDJSON JSON-RPC over stdio, protocol version `1`                   |
| Tests       | Vitest (main/preload/shared units) + `unittest` engine suite       |
| Packaging   | electron-builder (NSIS + portable, AppImage / deb / rpm)           |

## Requirements

- **Node.js** ≥ 20 (22 recommended) and npm
- **Python 3.10+** with the `libtorrent` bindings
  ```bash
  pip install libtorrent      # 2.1.x recommended
  ```
- Windows 10/11 x64, or Ubuntu/Debian/Fedora-based Linux x64
- On Debian/Ubuntu the packaged `.deb` depends on `python3` and
  `python3-libtorrent`

The engine is discovered at runtime in this order:

1. bundled runtime inside `resources/engine/runtime` (optional, not shipped yet)
2. the interpreter configured in **Settings → Advanced** (e.g. `py -3.10`)
3. the `MMZ_PYTHON` environment variable
4. probing `python3`, `python`, `py -3.13 … py -3.9` for an importable
   `libtorrent`

If none is found the UI shows setup guidance instead of failing silently.

## Getting started

```bash
git clone https://github.com/mmz-torrent/mmz-torrent.git
cd mmz-torrent
npm install
npm run icons          # generates resources/icons + renderer favicon
```

Development (hot reload for the renderer, Electron restart on main changes):

```bash
npm run dev
```

Other useful scripts:

| Script                  | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run typecheck`     | Type-checks `tsconfig.node.json` and `tsconfig.web.json` |
| `npm test`              | Runs the Vitest suite                                 |
| `npm run engine:test`   | Runs the Python engine tests (real loopback transfers) |
| `npm run build`         | Compiles main/preload/renderer to `out/`              |
| `npm run start`         | Preview the built app                                 |
| `npm run icons`         | Regenerates the icon set                              |
| `npm run dist:win`      | Windows: NSIS installer + portable `.exe`             |
| `npm run dist:linux`    | Linux: AppImage, `.deb`, `.rpm`                       |

## Building & packaging

```bash
npm run dist:win      # release/MMZ Torrent-<version>-win-x64.exe (+ portable)
npm run dist:linux    # release/MMZ Torrent-<version>-linux-x64.{AppImage,deb,rpm}
```

Configuration lives in [`electron-builder.yml`](electron-builder.yml). The
Python engine is copied to `<app>/resources/engine` (outside the asar), so the
packaged app spawns it exactly like the dev build.

### CI / releases

- `.github/workflows/ci.yml` — typecheck, unit tests, engine tests on Windows
  and Ubuntu, plus a bundle build
- `.github/workflows/release.yml` — builds installers for both platforms and
  publishes a GitHub release when a `v*` tag is pushed

## Project structure

```
mmz-torrent/
├── src/
│   ├── main/           # Electron main: AppCore, IPC, tray, schedule, notifications
│   ├── preload/        # contextBridge API + channel allow-list
│   ├── renderer/       # React app (components, dialogs, tabs, store, i18n)
│   └── shared/         # types + zod schemas shared by both sides
├── engine/             # Python/libtorrent engine (stdio JSON-RPC)
│   ├── bittorrent/     # session, storage, safety, persistence, protocol
│   └── tests/          # functional tests with a real local seeder
├── tests/              # Vitest suites
├── resources/icons/    # generated icon set
├── scripts/            # tooling (icon generation, codemods)
├── docs/               # engine protocol reference for contributors
├── .github/workflows/  # CI + release pipelines
└── electron-builder.yml
```

See [`docs/engine-protocol.md`](docs/engine-protocol.md) for the NDJSON RPC
contract between Electron and the Python engine.

## Testing

```bash
npm test                  # 74 unit tests: settings, IPC schemas, schedule, format,
                          # i18n, path-reveal sandbox
npm run engine:test       # 30 functional tests: real transfers, magnets, priorities,
                          # pause/resume/stop, recheck, persistence, safety, stdio RPC
node scripts/smoke-renderer.cjs   # loads the built renderer with the real preload
                          # in a sandboxed window (catches preload/CSP/React breakage)
```

The engine suite creates a local seeder on loopback and downloads it for real
— no mocked protocol behaviour.

## Known limitations

Documented honestly rather than hidden:

- **Bundled Python runtime is not shipped.** Installers require a Python 3.10+
  interpreter with `libtorrent` on the machine (or set one in
  Settings → Advanced). `engine/runtime` is the hook for a future embedded
  runtime.
- **BitTorrent v2 / hybrid support** is enabled through libtorrent, but the
  suite currently exercises v1 payloads only.
- **Sequential download** is exposed per torrent; piece prioritisation for
  "download in order" is driven by libtorrent's sequential flag, not a custom
  picker.
- **Categories/tags** are stored and filterable; bulk editing from the context
  menu is not implemented yet.
- **Portable mode** stores its data next to the executable's data directory
  only when configured; default installs use `%APPDATA%`/`~/.config`.
- The **interface scale** setting supports 90/100/110/125/150 %.
- Torrent creation (`.torrent` authoring) and RSS are out of scope for the MVP.

## Contributing

1. Fork and create a feature branch (`git checkout -b feature/my-change`)
2. Run `npm run typecheck && npm test && npm run engine:test`
3. Keep changes focused; update `src/renderer/src/locales/*.json` for any new
   user-facing string (all three languages)
4. Open a pull request with a clear description

## License

Released under the [MIT License](LICENSE).

## Credits

- [libtorrent](https://libtorrent.org/) — the BitTorrent engine
- [Electron](https://www.electronjs.org/), [React](https://react.dev/),
  [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/)
- Interface inspired by the workflow of classic desktop torrent clients;
  **no proprietary logos, artwork or code were copied.**

## Legal notice

MMZ Torrent is a generic file-sharing tool. It does not include trackers,
indexes or torrent sources. You are responsible for complying with the laws of
your jurisdiction and for the files you choose to share.
