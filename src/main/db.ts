/**
 * SQLite persistence (settings, per-torrent UI metadata, history, counters)
 * using the built-in `node:sqlite` module — no native addons to rebuild.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import type { HistoryEntry, TorrentMeta } from '@shared/types'
import { defaultSettings, mergeSettings, type Settings } from '@shared/settings'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS torrents (
  hash        TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL DEFAULT '',
  addedAt     INTEGER NOT NULL DEFAULT 0,
  completedAt INTEGER NOT NULL DEFAULT 0,
  savePath    TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  orderIdx    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS history (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  hash   TEXT NOT NULL,
  name   TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  size   INTEGER NOT NULL DEFAULT 0,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_at ON history (at DESC);
`

export interface TorrentPatch {
  name?: string
  category?: string
  tags?: string[]
  note?: string
  addedAt?: number
  completedAt?: number
  savePath?: string
  size?: number
  order?: number
}

export class Database {
  private db: DatabaseSync

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }

  // -- kv ---------------------------------------------------------------
  getKV(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setKV(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  // -- settings ---------------------------------------------------------
  loadSettings(): Settings {
    const raw = this.getKV('settings')
    if (!raw) return defaultSettings
    try {
      return mergeSettings(defaultSettings, JSON.parse(raw))
    } catch {
      // schema changed or corrupted: keep what still validates
      return defaultSettings
    }
  }

  saveSettings(settings: Settings): void {
    this.setKV('settings', JSON.stringify(settings))
  }

  // -- torrent metadata -------------------------------------------------
  listTorrents(): TorrentMeta[] {
    const rows = this.db
      .prepare('SELECT * FROM torrents ORDER BY orderIdx ASC, addedAt DESC')
      .all() as Record<string, unknown>[]
    return rows.map((row) => this.rowToMeta(row))
  }

  getTorrent(hash: string): TorrentMeta | null {
    const row = this.db.prepare('SELECT * FROM torrents WHERE hash = ?').get(hash) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToMeta(row) : null
  }

  /** Insert only when the hash is unknown (keeps user edits on re-add). */
  insertTorrent(meta: TorrentMeta): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO torrents
         (hash, name, category, tags, note, addedAt, completedAt, savePath, size, orderIdx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meta.hash,
        meta.name,
        meta.category,
        JSON.stringify(meta.tags ?? []),
        meta.note ?? '',
        Math.round(meta.addedAt),
        Math.round(meta.completedAt),
        meta.savePath ?? '',
        Math.round(meta.size ?? 0),
        Math.round(meta.order ?? 0)
      )
  }

  updateTorrent(hash: string, patch: TorrentPatch): void {
    const columns: Record<string, string> = {
      name: 'name',
      category: 'category',
      tags: 'tags',
      note: 'note',
      addedAt: 'addedAt',
      completedAt: 'completedAt',
      savePath: 'savePath',
      size: 'size',
      order: 'orderIdx'
    }
    const sets: string[] = []
    const params: unknown[] = []
    for (const [key, column] of Object.entries(columns)) {
      const value = (patch as Record<string, unknown>)[key]
      if (value === undefined) continue
      sets.push(`${column} = ?`)
      params.push(key === 'tags' ? JSON.stringify(value) :
        typeof value === 'number' ? Math.round(value) : value)
    }
    if (sets.length === 0) return
    params.push(hash)
    this.db.prepare(`UPDATE torrents SET ${sets.join(', ')} WHERE hash = ?`).run(
      ...(params as never[])
    )
  }

  removeTorrent(hash: string): void {
    this.db.prepare('DELETE FROM torrents WHERE hash = ?').run(hash)
  }

  categories(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT category FROM torrents WHERE category != \'\' ORDER BY category')
      .all() as { category: string }[]
    return rows.map((row) => row.category)
  }

  // -- history ----------------------------------------------------------
  addHistory(entry: Omit<HistoryEntry, 'id'>): void {
    this.db
      .prepare(
        'INSERT INTO history (hash, name, action, detail, size, at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        entry.hash,
        entry.name,
        entry.action,
        entry.detail ?? '',
        Math.round(entry.size ?? 0),
        Math.round(entry.at)
      )
  }

  listHistory(limit = 500): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM history ORDER BY at DESC, id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[]
    return rows.map((row) => ({
      id: Number(row['id']),
      hash: String(row['hash']),
      name: String(row['name']),
      action: row['action'] as HistoryEntry['action'],
      detail: String(row['detail'] ?? ''),
      size: Number(row['size'] ?? 0),
      at: Number(row['at'] ?? 0)
    }))
  }

  clearHistory(): void {
    this.db.exec('DELETE FROM history')
  }

  private rowToMeta(row: Record<string, unknown>): TorrentMeta {
    let tags: string[] = []
    try {
      const parsed = JSON.parse(String(row['tags'] ?? '[]'))
      if (Array.isArray(parsed)) tags = parsed.map(String)
    } catch {
      tags = []
    }
    return {
      hash: String(row['hash']),
      name: String(row['name'] ?? ''),
      category: String(row['category'] ?? ''),
      tags,
      note: String(row['note'] ?? ''),
      addedAt: Number(row['addedAt'] ?? 0),
      completedAt: Number(row['completedAt'] ?? 0),
      savePath: String(row['savePath'] ?? ''),
      size: Number(row['size'] ?? 0),
      order: Number(row['orderIdx'] ?? 0)
    }
  }
}
