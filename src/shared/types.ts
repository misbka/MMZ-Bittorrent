/**
 * Wire types shared between the Electron main process, the preload bridge and
 * the renderer.  The engine payloads mirror `engine/bittorrent/serialize.py`;
 * anything marked "enriched" is attached by the main process from SQLite.
 */
import type { Settings } from './settings'

export type Language = 'pt-BR' | 'es' | 'en'
export type ThemeMode = 'light' | 'dark' | 'system'
export type EncryptionMode = 'enabled' | 'forced' | 'disabled'

/** Coarse torrent state used by the sidebar filters and status column. */
export type UiState =
  | 'downloading'
  | 'stalled'
  | 'seeding'
  | 'finished'
  | 'paused'
  | 'queued'
  | 'checking'
  | 'allocating'
  | 'metadata'
  | 'moving'
  | 'error'

export interface TorrentSummary {
  hash: string
  name: string
  state: string
  uiState: UiState
  progress: number
  totalSize: number
  totalWanted: number
  downloaded: number
  downloadedWanted: number
  downloadedAllTime: number
  uploadedAllTime: number
  downloadRate: number
  uploadRate: number
  /** seconds, -1 when unknown, 0 when complete */
  eta: number
  numSeeds: number
  numPeers: number
  knownSeeds: number
  knownPeers: number
  numComplete: number
  numIncomplete: number
  availability: number
  savePath: string
  addedAt: number
  completedAt: number
  error: string
  paused: boolean
  autoManaged: boolean
  sequential: boolean
  hasMetadata: boolean
  queuePosition: number
  pieceCount: number
  completed: boolean
  currentTracker: string
  downloadLimit: number
  uploadLimit: number
  connections: number
  finalPath?: string
  // --- enriched by the main process (SQLite) ---
  category?: string
  tags?: string[]
  note?: string
  order?: number
}

export interface GlobalStats {
  downloadRate: number
  uploadRate: number
  downloadTotal: number
  uploadTotal: number
  connections: number
  maxConnections: number
  dhtNodes: number
  downloadLimit: number
  uploadLimit: number
  torrents: number
}

export interface TickPayload {
  ts: number
  global: GlobalStats
  torrents: TorrentSummary[]
}

export interface EngineFile {
  index: number
  name: string
  path: string
  size: number
  downloaded: number
  progress: number
  /** 0 ignore, 1 low, 4 normal, 7 high */
  priority: number
  pad: boolean
}

export interface FilesPayload {
  hash: string
  hasMetadata: boolean
  files: EngineFile[]
  pieceLength?: number
  totalSize?: number
}

export interface PeerInfo {
  ip: string
  client: string
  progress: number
  downSpeed: number
  upSpeed: number
  downloaded: number
  uploaded: number
  flags: number
  numPieces: number
  connecting: boolean
  seed: boolean
}

export interface TrackerInfo {
  url: string
  tier: number
  fails: number
  working: boolean
  message: string
  error: string
  nextAnnounceIn: number
  scrapeComplete: number
  scrapeIncomplete: number
  scrapeDownloaded: number
  verified: boolean
}

export interface PiecesPayload {
  hash: string
  hasMetadata: boolean
  pieceCount: number
  piecesHave?: number
  pieceLength?: number
  totalSize?: number
  /** base64 bitmap, MSB-first */
  bitmap?: string
  availability?: number[]
}

export interface LogEntry {
  seq: number
  ts: number
  level: 'debug' | 'info' | 'warning' | 'error'
  source: string
  message: string
  torrent: string | null
}

export interface AddTorrentRequest {
  /** magnet:/http(s) links */
  urls?: string[]
  /** raw .torrent bytes, base64 encoded */
  files?: { name: string; data: string }[]
  category?: string
  tags?: string[]
  paused?: boolean
  sequential?: boolean
  savePath?: string
  filePriorities?: number[]
}

export interface AddTorrentResult {
  added: { hash: string; name: string; duplicate: boolean }[]
  skipped: { source: string; reason: string }[]
  savePath: string
}

export type TorrentCommand =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'recheck'
  | 'reannounce'

export interface EngineHello {
  protocolVersion: number
  engineVersion: string
  libtorrentVersion: string
  python: string
}

export type EngineEventName =
  | 'log'
  | 'torrentAdded'
  | 'torrentFinished'
  | 'torrentError'
  | 'metadataReceived'
  | 'trackerStatus'
  | 'listenStatus'
  | 'recheckFinished'
  | 'storageMoved'
  | 'storageMoveFailed'

export interface EngineEvent<T = unknown> {
  name: EngineEventName
  data: T
}

export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; hello: EngineHello; pythonPath: string }
  | { state: 'error'; message: string }

/** Persisted per-torrent metadata owned by the UI (not the engine). */
export interface TorrentMeta {
  hash: string
  name: string
  category: string
  tags: string[]
  note: string
  addedAt: number
  completedAt: number
  savePath: string
  size: number
  order: number
}

export interface HistoryEntry {
  id: number
  hash: string
  name: string
  action: 'added' | 'finished' | 'removed' | 'error' | 'checked'
  detail: string
  size: number
  at: number
}

export interface SessionStats {
  startedAt: number
  downloadTotal: number
  uploadTotal: number
  downloadRate: number
  uploadRate: number
  /** recent samples for the speed graph, oldest first */
  samples: { ts: number; down: number; up: number }[]
}

export interface SpeedSample {
  ts: number
  down: number
  up: number
}

/** Application metadata surfaced by `app:info`. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  dataDir: string
  engineDataDir: string
  locales: Language[]
  python: { configured: string; resolved: string | null }
  engine: { state: EngineStatus['state']; hello: EngineHello | null; diagnostics: string[] }
}

/** Per-torrent UI metadata edits (category / tags / note). */
export interface TorrentMetaPatch {
  category?: string
  tags?: string[]
  note?: string
}

/** Everything the main process pushes to the renderer, on one channel. */
export type MainToRendererEvent =
  | { type: 'tick'; payload: TickPayload }
  | { type: 'engineStatus'; status: EngineStatus }
  | { type: 'log'; entry: LogEntry }
  | { type: 'torrentAdded'; data: { hash: string; name: string; source: string } }
  | { type: 'torrentFinished'; data: { hash: string; name: string } }
  | { type: 'torrentError'; data: { hash: string; message: string } }
  | { type: 'metadataReceived'; data: { hash: string; name: string; fileCount?: number; totalSize?: number } }
  | { type: 'trackerStatus'; data: { hash: string; url: string; working: boolean; message: string } }
  | { type: 'listenStatus'; data: { ok: boolean; message: string } }
  | { type: 'recheckFinished'; data: { hash: string } }
  | { type: 'storageMoved'; data: { hash: string; path: string } }
  | { type: 'storageMoveFailed'; data: { hash: string; message: string } }
  | { type: 'settings'; settings: Settings }
  | { type: 'metaChanged'; data: { hash: string; category: string; tags: string[]; note: string } }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'torrentsRemoved'; data: { hashes: string[] } }
