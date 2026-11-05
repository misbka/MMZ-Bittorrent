/**
 * Application core: owns SQLite, the engine child process, settings and the
 * push of events to every open window.  IPC handlers (ipc.ts) are thin
 * wrappers around this class, and nothing else in the main process talks to
 * the engine directly.
 */
import { EventEmitter } from 'node:events'
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Database } from './db'
import { EngineClient } from './engine'
import {
  engineDataDir,
  defaultDownloadDir,
  type ResolvedPython
} from './paths'
import { notifyError, notifyFinished } from './notifications'
import { activeRuleFor } from './schedule'
import {
  defaultSettings,
  mergeSettings,
  toEngineSettings,
  type ScheduleRule,
  type Settings
} from '@shared/settings'
import type {
  AddTorrentResult,
  AppInfo,
  EngineEventName,
  EngineHello,
  EngineStatus,
  FilesPayload,
  GlobalStats,
  HistoryEntry,
  LogEntry,
  MainToRendererEvent,
  PeerInfo,
  PiecesPayload,
  SessionStats,
  SpeedSample,
  TorrentCommand,
  TorrentMeta,
  TorrentMetaPatch,
  TorrentSummary,
  TrackerInfo,
  TickPayload
} from '@shared/types'
import type { AddTorrentPayload } from '@shared/ipc'

const TICK_FORWARD_MS = 1000
const HISTORY_LIMIT = 500

const LOG_LEVEL_RANK: Record<LogEntry['level'], number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3
}

interface EngineAddResult {
  added: { hash: string; name: string; duplicate: boolean }[]
  skipped: { source: string; reason: string }[]
  savePath: string
}

export class AppCore extends EventEmitter {
  readonly db: Database
  readonly dataDir: string
  settings: Settings
  engine: EngineClient | null = null
  engineStatus: EngineStatus = { state: 'starting' }

  private windows = new Set<BrowserWindow>()
  private meta = new Map<string, TorrentMeta>()
  private lastTick: TickPayload | null = null
  private samples: SpeedSample[] = []
  private startedAt = 0
  private forwardedAt = 0
  private appliedLimits = { down: -1, up: -1 }
  private engineSettingsFile: string

  constructor(dataDir: string) {
    super()
    this.dataDir = dataDir
    fs.mkdirSync(dataDir, { recursive: true })
    this.db = new Database(path.join(dataDir, 'mmz.sqlite'))
    this.settings = this.db.loadSettings()
    this.engineSettingsFile = path.join(engineDataDir(), 'settings.json')
    for (const row of this.db.listTorrents()) this.meta.set(row.hash, row)
  }

  // ---------------------------------------------------------------- windows

  addWindow(win: BrowserWindow): void {
    this.windows.add(win)
    win.on('closed', () => this.windows.delete(win))
  }

  broadcast(event: MainToRendererEvent): void {
    for (const win of this.windows) {
      if (win.isDestroyed()) continue
      win.webContents.send(EVENT_FORWARD, event)
    }
  }

  // --------------------------------------------------------------- lifecycle

  async start(python: ResolvedPython): Promise<void> {
    if (!this.settings.downloads.savePath) {
      this.settings = mergeSettings(this.settings, {
        downloads: { savePath: defaultDownloadDir() }
      })
      this.db.saveSettings(this.settings)
    }

    const engineSettings = toEngineSettings(this.settings)
    fs.mkdirSync(engineDataDir(), { recursive: true })
    fs.writeFileSync(
      this.engineSettingsFile,
      JSON.stringify(engineSettings, null, 2),
      'utf8'
    )

    const client = new EngineClient()
    this.engine = client

    client.on('status', (status: EngineStatus) => {
      this.engineStatus = status
      this.broadcast({ type: 'engineStatus', status })
    })
    client.on('protocolError', (message: string) => {
      this.logLocal('error', 'protocol', message)
    })
    client.on('tick', (payload: TickPayload) => this.onTick(payload))
    client.on('event', ({ name, data }: { name: EngineEventName; data: unknown }) =>
      this.onEngineEvent(name, data)
    )

    this.startedAt = Date.now()
    await client.start({
      python,
      dataDir: engineDataDir(),
      settingsFile: this.engineSettingsFile
    })
    this.appliedLimits = { down: -1, up: -1 }
    this.applySchedule()
  }

  async stop(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.stop()
      } catch {
        /* engine already gone */
      }
      this.engine = null
    }
    this.db.close()
  }

  // ------------------------------------------------------------------ info

  getInfo(pythonConfigured: string): AppInfo {
    return {
      name: 'MMZ Torrent',
      version: process.env['npm_package_version'] ?? '0.1.0',
      platform: process.platform,
      arch: process.arch,
      dataDir: this.dataDir,
      engineDataDir: engineDataDir(),
      locales: ['pt-BR', 'es', 'en'],
      python: {
        configured: pythonConfigured,
        resolved: this.engine?.pythonSpec ?? null
      },
      engine: {
        state: this.engineStatus.state,
        hello: this.engineStatus.state === 'ready' ? this.engineStatus.hello : null,
        diagnostics: this.engine?.diagnostics ?? []
      }
    }
  }

  getEngineHello(): EngineHello | null {
    return this.engine?.hello ?? null
  }

  // --------------------------------------------------------------- settings

  getSettings(): Settings {
    return this.settings
  }

  async updateSettings(patch: unknown): Promise<Settings> {
    const merged = mergeSettings(this.settings, patch)
    this.settings = merged
    this.db.saveSettings(merged)
    await this.pushEngineSettings()
    this.applySchedule()
    this.broadcast({ type: 'settings', settings: merged })
    return merged
  }

  async resetSettings(): Promise<Settings> {
    const fresh = mergeSettings(defaultSettings, {
      downloads: { savePath: defaultDownloadDir() }
    })
    this.settings = fresh
    this.db.saveSettings(fresh)
    await this.pushEngineSettings()
    this.applySchedule()
    this.broadcast({ type: 'settings', settings: fresh })
    return fresh
  }

  exportSettings(filePath: string): void {
    const payload = { app: 'mmz-torrent', version: 1, settings: this.settings }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  importSettings(filePath: string): Settings {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { settings?: unknown }
    if (!raw || typeof raw.settings !== 'object' || raw.settings === null) {
      throw new Error('invalid settings file')
    }
    const merged = mergeSettings(defaultSettings, raw.settings)
    this.settings = merged
    this.db.saveSettings(merged)
    void this.pushEngineSettings()
    this.applySchedule()
    this.broadcast({ type: 'settings', settings: merged })
    return merged
  }

  private async pushEngineSettings(): Promise<void> {
    if (!this.engine) return
    try {
      await this.engine.request('configure', { settings: toEngineSettings(this.settings) })
    } catch (error) {
      this.logLocal('error', 'config', `could not apply settings: ${String(error)}`)
    }
  }

  /** Speed schedule: recompute the effective global limits and apply them. */
  applySchedule(): void {
    if (!this.engine) return
    const base = toEngineSettings(this.settings)
    let down = Number(base['downloadRateLimit'] ?? 0)
    let up = Number(base['uploadRateLimit'] ?? 0)

    if (this.settings.speed.scheduleEnabled) {
      const rule = activeRuleFor(this.settings.speed.scheduleRules, new Date())
      if (rule) {
        if (rule.downloadLimit > 0) down = rule.downloadLimit * 1024
        if (rule.uploadLimit > 0) up = rule.uploadLimit * 1024
      }
    }

    if (down === this.appliedLimits.down && up === this.appliedLimits.up) return
    this.appliedLimits = { down, up }
    void this.engine
      .request('configure', { settings: { downloadRateLimit: down, uploadRateLimit: up } })
      .catch((error) => this.logLocal('warning', 'schedule', String(error)))
  }

  // --------------------------------------------------------------- torrents

  async addTorrents(payload: AddTorrentPayload): Promise<AddTorrentResult> {
    if (!this.engine) throw new Error('engine is not running')

    const savePath = payload.savePath?.trim() || this.settings.downloads.savePath
    const params: Record<string, unknown> = {
      urls: payload.urls ?? [],
      torrentFiles: payload.files ?? [],
      savePath,
      paused: payload.paused ?? !this.settings.downloads.autoStart,
      sequential: payload.sequential ?? this.settings.bittorrent.sequential
    }
    if (payload.filePriorities?.length) params['filePriorities'] = payload.filePriorities

    const result = await this.engine.request<EngineAddResult>('addTorrent', params)

    for (const item of result.added) {
      if (item.duplicate) continue
      const meta: TorrentMeta = {
        hash: item.hash,
        name: item.name,
        category: payload.category ?? '',
        tags: payload.tags ?? [],
        note: '',
        addedAt: Date.now(),
        completedAt: 0,
        savePath: result.savePath,
        size: 0,
        order: this.meta.size
      }
      this.meta.set(item.hash, meta)
      this.db.insertTorrent(meta)
      this.pushHistory({
        hash: item.hash,
        name: item.name,
        action: 'added',
        detail: result.savePath,
        size: 0,
        at: Date.now()
      })
    }

    this.broadcast({
      type: 'torrentAdded',
      data: { hash: result.added[0]?.hash ?? '', name: result.added[0]?.name ?? '', source: 'add' }
    })
    return result
  }

  async command(action: TorrentCommand, hashes: string[]): Promise<void> {
    if (!this.engine) throw new Error('engine is not running')
    const method = action === 'recheck' || action === 'reannounce' ? action : action
    await this.engine.request(method, { hashes })
    if (action === 'recheck') {
      this.pushHistory({
        hash: hashes[0],
        name: this.meta.get(hashes[0])?.name ?? hashes[0],
        action: 'checked',
        detail: `${hashes.length} torrent(s)`,
        size: 0,
        at: Date.now()
      })
    }
  }

  async remove(hashes: string[], deleteFiles: boolean): Promise<void> {
    if (!this.engine) throw new Error('engine is not running')
    await this.engine.request('remove', { hashes, deleteFiles })
    for (const hash of hashes) {
      const meta = this.meta.get(hash)
      this.meta.delete(hash)
      this.db.removeTorrent(hash)
      this.pushHistory({
        hash,
        name: meta?.name ?? hash,
        action: 'removed',
        detail: deleteFiles ? 'files deleted' : '',
        size: meta?.size ?? 0,
        at: Date.now()
      })
    }
    this.broadcast({ type: 'torrentsRemoved', data: { hashes } })
  }

  async files(hash: string): Promise<FilesPayload> {
    if (!this.engine) throw new Error('engine is not running')
    return this.engine.request<FilesPayload>('getFiles', { hash })
  }

  async peers(hash: string): Promise<PeerInfo[]> {
    if (!this.engine) throw new Error('engine is not running')
    const res = await this.engine.request<{ peers: PeerInfo[] }>('getPeers', { hash })
    return res.peers
  }

  async trackers(hash: string): Promise<TrackerInfo[]> {
    if (!this.engine) throw new Error('engine is not running')
    const res = await this.engine.request<{ trackers: TrackerInfo[] }>('getTrackers', { hash })
    return res.trackers
  }

  async pieces(hash: string): Promise<PiecesPayload> {
    if (!this.engine) throw new Error('engine is not running')
    return this.engine.request<PiecesPayload>('getPieces', { hash })
  }

  async setPriorities(hash: string, priorities: number[]): Promise<FilesPayload> {
    if (!this.engine) throw new Error('engine is not running')
    return this.engine.request<FilesPayload>('setFilePriorities', { hash, priorities })
  }

  async setTrackers(hash: string, trackers: string[]): Promise<TrackerInfo[]> {
    if (!this.engine) throw new Error('engine is not running')
    const res = await this.engine.request<{ trackers: TrackerInfo[] }>('setTrackers', {
      hash,
      trackers
    })
    return res.trackers
  }

  async setOptions(options: {
    hash: string
    downloadLimit?: number
    uploadLimit?: number
    maxConnections?: number
    sequential?: boolean
    superSeeding?: boolean
    savePath?: string
  }): Promise<void> {
    if (!this.engine) throw new Error('engine is not running')
    const { hash, ...rest } = options
    await this.engine.request('setTorrentOptions', { hash, ...rest })
  }

  setMeta(patch: { hash: string } & TorrentMetaPatch): TorrentMeta {
    const current = this.meta.get(patch.hash)
    if (!current) throw new Error('unknown torrent')
    const next: TorrentMeta = {
      ...current,
      category: patch.category ?? current.category,
      tags: patch.tags ?? current.tags,
      note: patch.note ?? current.note
    }
    this.meta.set(next.hash, next)
    this.db.updateTorrent(next.hash, {
      category: next.category,
      tags: next.tags,
      note: next.note
    })
    this.broadcast({
      type: 'metaChanged',
      data: { hash: next.hash, category: next.category, tags: next.tags, note: next.note }
    })
    return next
  }

  categories(): string[] {
    return this.db.categories()
  }

  /**
   * Destination folder of every known torrent.  The reveal/open sandbox treats
   * them as roots: torrents can be added to a folder chosen in the add dialog
   * that differs from the configured download directory.
   */
  torrentSavePaths(): string[] {
    const out = new Set<string>()
    for (const meta of this.meta.values()) {
      const savePath = meta.savePath?.trim()
      if (savePath) out.add(savePath)
    }
    return [...out]
  }

  /** Hashes currently tracked by the engine (from the last tick). */
  hashes(): string[] {
    return this.lastTick ? this.lastTick.torrents.map((t) => t.hash) : []
  }

  // ------------------------------------------------------------------ query

  getStats(): SessionStats {
    const global = this.lastTick?.global
    return {
      startedAt: this.startedAt,
      downloadTotal: global?.downloadTotal ?? 0,
      uploadTotal: global?.uploadTotal ?? 0,
      downloadRate: global?.downloadRate ?? 0,
      uploadRate: global?.uploadRate ?? 0,
      samples: [...this.samples]
    }
  }

  async getLog(since = 0, limit = 500, hash?: string): Promise<LogEntry[]> {
    if (!this.engine) return []
    const res = await this.engine.request<{ entries: LogEntry[] }>('getLog', {
      since,
      limit,
      ...(hash ? { hash } : {})
    })
    const minRank = LOG_LEVEL_RANK[this.settings.advanced.logLevel]
    return res.entries.filter((e) => LOG_LEVEL_RANK[e.level] >= minRank)
  }

  getHistory(): HistoryEntry[] {
    return this.db.listHistory(HISTORY_LIMIT)
  }

  clearHistory(): void {
    this.db.clearHistory()
    this.broadcast({ type: 'history', entries: [] })
  }

  // --------------------------------------------------------------- internal

  private onTick(payload: TickPayload): void {
    // enrich with UI metadata owned by SQLite
    for (const torrent of payload.torrents) {
      const meta = this.meta.get(torrent.hash)
      if (meta) {
        torrent.category = meta.category
        torrent.tags = meta.tags
        torrent.note = meta.note
        torrent.order = meta.order
      }
    }
    this.lastTick = payload

    const now = Date.now()
    this.samples.push({
      ts: now,
      down: payload.global.downloadRate,
      up: payload.global.uploadRate
    })
    const cutoff = now - this.settings.advanced.speedHistorySeconds * 1000
    while (this.samples.length > 0 && this.samples[0].ts < cutoff) this.samples.shift()

    this.applySchedule()

    if (now - this.forwardedAt >= TICK_FORWARD_MS) {
      this.forwardedAt = now
      this.broadcast({ type: 'tick', payload })
    }
  }

  private onEngineEvent(name: EngineEventName, rawData: unknown): void {
    const data = rawData as Record<string, unknown>
    switch (name) {
      case 'log': {
        const entry = rawData as LogEntry
        const minRank = LOG_LEVEL_RANK[this.settings.advanced.logLevel]
        if (LOG_LEVEL_RANK[entry.level] < minRank) return
        if (entry.level === 'error' && this.settings.general.notifications) {
          notifyError(entry.message)
        }
        this.broadcast({ type: 'log', entry })
        return
      }
      case 'torrentAdded':
        this.broadcast({
          type: 'torrentAdded',
          data: {
            hash: String(data['hash'] ?? ''),
            name: String(data['name'] ?? ''),
            source: String(data['source'] ?? '')
          }
        })
        return
      case 'torrentFinished': {
        const hash = String(data['hash'] ?? '')
        const name = String(data['name'] ?? hash)
        const meta = this.meta.get(hash)
        if (meta && !meta.completedAt) {
          const completedAt = Date.now()
          this.meta.set(hash, { ...meta, completedAt })
          this.db.updateTorrent(hash, { completedAt })
        }
        this.pushHistory({ hash, name, action: 'finished', detail: '', size: meta?.size ?? 0, at: Date.now() })
        if (this.settings.general.notifications) notifyFinished(name)
        this.broadcast({ type: 'torrentFinished', data: { hash, name } })
        return
      }
      case 'torrentError': {
        const hash = String(data['hash'] ?? '')
        const message = String(data['message'] ?? '')
        this.pushHistory({
          hash,
          name: this.meta.get(hash)?.name ?? hash,
          action: 'error',
          detail: message,
          size: 0,
          at: Date.now()
        })
        if (this.settings.general.notifications) notifyError(message)
        this.broadcast({ type: 'torrentError', data: { hash, message } })
        return
      }
      case 'metadataReceived':
        this.broadcast({
          type: 'metadataReceived',
          data: {
            hash: String(data['hash'] ?? ''),
            name: String(data['name'] ?? ''),
            fileCount: typeof data['fileCount'] === 'number' ? data['fileCount'] : undefined,
            totalSize: typeof data['totalSize'] === 'number' ? data['totalSize'] : undefined
          }
        })
        return
      case 'trackerStatus':
        this.broadcast({
          type: 'trackerStatus',
          data: {
            hash: String(data['hash'] ?? ''),
            url: String(data['url'] ?? ''),
            working: Boolean(data['working']),
            message: String(data['message'] ?? '')
          }
        })
        return
      case 'listenStatus':
        this.broadcast({
          type: 'listenStatus',
          data: { ok: Boolean(data['ok']), message: String(data['message'] ?? '') }
        })
        return
      case 'recheckFinished':
        this.broadcast({ type: 'recheckFinished', data: { hash: String(data['hash'] ?? '') } })
        return
      case 'storageMoved':
        this.broadcast({
          type: 'storageMoved',
          data: { hash: String(data['hash'] ?? ''), path: String(data['path'] ?? '') }
        })
        return
      case 'storageMoveFailed':
        this.broadcast({
          type: 'storageMoveFailed',
          data: { hash: String(data['hash'] ?? ''), message: String(data['message'] ?? '') }
        })
        return
      default:
        return
    }
  }

  private pushHistory(entry: Omit<HistoryEntry, 'id'>): void {
    this.db.addHistory(entry)
    this.broadcast({ type: 'history', entries: this.db.listHistory(HISTORY_LIMIT) })
  }

  private logLocal(level: LogEntry['level'], source: string, message: string): void {
    this.broadcast({
      type: 'log',
      entry: { seq: 0, ts: Date.now() / 1000, level, source, message, torrent: null }
    })
  }
}

/** Channel name the preload bridge listens on (kept next to its producer). */
export const EVENT_FORWARD = 'mmz:event'

export type { GlobalStats, ScheduleRule, TorrentSummary }
