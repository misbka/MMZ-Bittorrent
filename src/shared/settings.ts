/**
 * Application settings: schema (zod), defaults and the mapping to engine
 * settings.  Shared so the renderer can validate what it edits and the main
 * process can translate it for the BitTorrent engine.
 */
import { z } from 'zod'
import type { Language, ThemeMode } from './types'

export const PROXY_TYPES = ['none', 'http', 'socks5', 'socks4', 'http_with_auth'] as const

export const COLUMN_IDS = [
  'name',
  'status',
  'progress',
  'size',
  'down',
  'up',
  'seeds',
  'peers',
  'eta',
  'category',
  'ratio',
  'added'
] as const

export type ColumnId = (typeof COLUMN_IDS)[number]

/** True for a real clock value like "09:05" / "23:59" (rejects "25:00"). */
function isValidClock(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59
}

const clock = () =>
  z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .refine(isValidClock, { message: 'must be a HH:MM time between 00:00 and 23:59' })

export const scheduleRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  /** 0 = Sunday ... 6 = Saturday */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  from: clock(),
  to: clock(),
  /** KB/s, 0 = unlimited */
  downloadLimit: z.number().int().min(0),
  uploadLimit: z.number().int().min(0)
})

export const settingsSchema = z.object({
  general: z.object({
    language: z.enum(['pt-BR', 'es', 'en']),
    theme: z.enum(['light', 'dark', 'system']),
    startWithSystem: z.boolean(),
    minimizeToTray: z.boolean(),
    closeToTray: z.boolean(),
    confirmRemove: z.boolean(),
    notifications: z.boolean()
  }),
  downloads: z.object({
    savePath: z.string(),
    tempPath: z.string(),
    maxConcurrentDownloads: z.number().int().min(1).max(100),
    maxConcurrentUploads: z.number().int().min(1).max(100),
    maxConcurrentTorrents: z.number().int().min(1).max(200),
    autoStart: z.boolean(),
    autoVerify: z.boolean(),
    createSubfolders: z.boolean(),
    moveCompleted: z.boolean(),
    moveCompletedPath: z.string()
  }),
  connection: z.object({
    listenPort: z.number().int().min(1).max(65535),
    upnp: z.boolean(),
    natpmp: z.boolean(),
    ipv4: z.boolean(),
    ipv6: z.boolean(),
    maxConnections: z.number().int().min(10).max(10000),
    maxConnectionsPerTorrent: z.number().int().min(2).max(1000),
    proxy: z.object({
      type: z.enum(PROXY_TYPES),
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      username: z.string(),
      password: z.string()
    })
  }),
  speed: z.object({
    /** KB/s, 0 = unlimited */
    downloadLimit: z.number().int().min(0),
    uploadLimit: z.number().int().min(0),
    torrentDownloadLimit: z.number().int().min(0),
    torrentUploadLimit: z.number().int().min(0),
    scheduleEnabled: z.boolean(),
    scheduleRules: z.array(scheduleRuleSchema)
  }),
  bittorrent: z.object({
    dht: z.boolean(),
    pex: z.boolean(),
    lsd: z.boolean(),
    encryption: z.enum(['enabled', 'forced', 'disabled']),
    sequential: z.boolean(),
    anonymousMode: z.boolean(),
    announceToAllTrackers: z.boolean(),
    defaultTrackers: z.array(z.string())
  }),
  interface: z.object({
    density: z.enum(['comfortable', 'compact']),
    scale: z.number().min(0.8).max(2),
    showStatusbar: z.boolean(),
    showSpeedGraph: z.boolean(),
    showSidebar: z.boolean(),
    columns: z.record(z.enum(COLUMN_IDS), z.boolean())
  }),
  advanced: z.object({
    enginePython: z.string(),
    resumeOnStart: z.boolean(),
    recheckOnStart: z.boolean(),
    logLevel: z.enum(['debug', 'info', 'warning', 'error']),
    keepHistory: z.boolean(),
    speedHistorySeconds: z.number().int().min(60).max(86400),
    sessionStatsEnabled: z.boolean()
  })
})

export type Settings = z.infer<typeof settingsSchema>
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>

const ALL_COLUMNS: Record<ColumnId, boolean> = {
  name: true,
  status: true,
  progress: true,
  size: true,
  down: true,
  up: true,
  seeds: true,
  peers: true,
  eta: true,
  category: true,
  ratio: true,
  added: false
}

export const defaultSettings: Settings = {
  general: {
    language: 'pt-BR',
    theme: 'system',
    startWithSystem: false,
    minimizeToTray: true,
    closeToTray: true,
    confirmRemove: true,
    notifications: true
  },
  downloads: {
    savePath: '',
    tempPath: '',
    maxConcurrentDownloads: 5,
    maxConcurrentUploads: 5,
    maxConcurrentTorrents: 10,
    autoStart: true,
    autoVerify: true,
    createSubfolders: true,
    moveCompleted: false,
    moveCompletedPath: ''
  },
  connection: {
    listenPort: 6881,
    upnp: true,
    natpmp: true,
    ipv4: true,
    ipv6: true,
    maxConnections: 500,
    maxConnectionsPerTorrent: 100,
    proxy: { type: 'none', host: '', port: 8080, username: '', password: '' }
  },
  speed: {
    downloadLimit: 0,
    uploadLimit: 0,
    torrentDownloadLimit: 0,
    torrentUploadLimit: 0,
    scheduleEnabled: false,
    scheduleRules: []
  },
  bittorrent: {
    dht: true,
    pex: true,
    lsd: true,
    encryption: 'enabled',
    sequential: false,
    anonymousMode: false,
    announceToAllTrackers: false,
    defaultTrackers: []
  },
  interface: {
    density: 'comfortable',
    scale: 1,
    showStatusbar: true,
    showSpeedGraph: true,
    showSidebar: true,
    columns: { ...ALL_COLUMNS }
  },
  advanced: {
    enginePython: '',
    resumeOnStart: true,
    recheckOnStart: false,
    logLevel: 'info',
    keepHistory: true,
    speedHistorySeconds: 600,
    sessionStatsEnabled: true
  }
}

/** Deep-merge a partial patch onto a full settings object, validating both. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const p = (patch ?? {}) as Record<string, Record<string, unknown> | undefined>
  const section = (name: keyof Settings): Record<string, unknown> => ({
    ...(base[name] as unknown as Record<string, unknown>),
    ...(p[name as string] ?? {})
  })
  const connection = section('connection')
  connection.proxy = {
    ...(base.connection.proxy as unknown as Record<string, unknown>),
    ...((p['connection']?.['proxy'] as Record<string, unknown> | undefined) ?? {})
  }
  const merged = {
    general: section('general'),
    downloads: section('downloads'),
    connection,
    speed: section('speed'),
    bittorrent: section('bittorrent'),
    interface: section('interface'),
    advanced: section('advanced')
  }
  const parsed = settingsSchema.safeParse(merged)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`${first.path.join('.')}: ${first.message}`)
  }
  return parsed.data
}

/** Translate app settings into the engine's own settings vocabulary. */
export function toEngineSettings(settings: Settings): Record<string, unknown> {
  const kb = (value: number): number => value * 1024
  const downloadDirectory = settings.downloads.savePath
  return {
    listenPort: settings.connection.listenPort,
    upnp: settings.connection.upnp,
    natpmp: settings.connection.natpmp,
    ipv6: settings.connection.ipv6,
    maxConnections: settings.connection.maxConnections,
    maxConnectionsPerTorrent: settings.connection.maxConnectionsPerTorrent,
    proxy: {
      type: settings.connection.proxy.type,
      host: settings.connection.proxy.host,
      port: settings.connection.proxy.port,
      username: settings.connection.proxy.username,
      password: settings.connection.proxy.password
    },
    downloadRateLimit: kb(settings.speed.downloadLimit),
    uploadRateLimit: kb(settings.speed.uploadLimit),
    torrentDownloadRateLimit: kb(settings.speed.torrentDownloadLimit),
    torrentUploadRateLimit: kb(settings.speed.torrentUploadLimit),
    maxActiveDownloads: settings.downloads.maxConcurrentDownloads,
    maxActiveSeeds: settings.downloads.maxConcurrentUploads,
    maxActiveTorrents: settings.downloads.maxConcurrentTorrents,
    dht: settings.bittorrent.dht,
    pex: settings.bittorrent.pex,
    lsd: settings.bittorrent.lsd,
    encryption: settings.bittorrent.encryption,
    anonymousMode: settings.bittorrent.anonymousMode,
    announceToAllTrackers: settings.bittorrent.announceToAllTrackers,
    downloadDirectory,
    temporaryDirectory: settings.downloads.tempPath,
    startAddedTorrents: settings.downloads.autoStart,
    resumeOnStart: settings.advanced.resumeOnStart,
    recheckOnStart: settings.advanced.recheckOnStart,
    sequentialDownload: settings.bittorrent.sequential,
    userAgent: 'MMZ Torrent/0.1.0'
  }
}

export function isLanguage(value: unknown): value is Language {
  return value === 'pt-BR' || value === 'es' || value === 'en'
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}
