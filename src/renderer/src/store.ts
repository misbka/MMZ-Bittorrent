/**
 * Renderer store: one Zustand slice holding everything the UI renders.
 *
 * Data arrives from two places only:
 *   - push: `window.mmz.onEvent(...)` (ticks, logs, engine status, ...)
 *   - pull: `window.mmz.invoke(...)` (files/peers/trackers on demand)
 */
import { create } from 'zustand'
import type {
  AppInfo,
  EngineFile,
  EngineStatus,
  GlobalStats,
  HistoryEntry,
  LogEntry,
  MainToRendererEvent,
  PeerInfo,
  PiecesPayload,
  SessionStats,
  TorrentMetaPatch,
  TorrentSummary,
  TrackerInfo
} from '@shared/types'
import type { Settings } from '@shared/settings'
import type { AddTorrentPayload, IpcChannel } from '@shared/ipc'

export type SidebarFilter =
  | 'all'
  | 'downloading'
  | 'seeding'
  | 'finished'
  | 'paused'
  | 'error'
  | 'category'

export type DetailTab = 'general' | 'files' | 'info' | 'peers' | 'trackers' | 'pieces' | 'log'

export interface SortState {
  column: string
  direction: 'asc' | 'desc'
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface PendingAdd {
  urls: string[]
  files: { name: string; data: string }[]
}

const EMPTY_GLOBAL: GlobalStats = {
  downloadRate: 0,
  uploadRate: 0,
  downloadTotal: 0,
  uploadTotal: 0,
  connections: 0,
  maxConnections: 0,
  dhtNodes: 0,
  downloadLimit: 0,
  uploadLimit: 0,
  torrents: 0
}

interface AppState {
  ready: boolean
  info: AppInfo | null
  settings: Settings | null
  engineStatus: EngineStatus
  torrents: TorrentSummary[]
  global: GlobalStats
  session: SessionStats | null
  categories: string[]
  selected: string[]
  filter: SidebarFilter
  filterValue: string
  search: string
  sort: SortState
  detailTab: DetailTab
  logs: LogEntry[]
  history: HistoryEntry[]
  toasts: Toast[]
  addDialogOpen: boolean
  settingsDialogOpen: boolean
  pendingAdd: PendingAdd | null
  detailLoading: boolean
  files: EngineFile[]
  peers: PeerInfo[]
  trackers: TrackerInfo[]
  pieces: PiecesPayload | null

  // actions
  init: () => () => void
  invoke: <T>(channel: IpcChannel, payload?: unknown) => Promise<T>
  setSettings: (settings: Settings) => void
  setFilter: (filter: SidebarFilter, value?: string) => void
  setSearch: (search: string) => void
  setSort: (sort: SortState) => void
  select: (hashes: string[], mode?: 'replace' | 'toggle' | 'add') => void
  setDetailTab: (tab: DetailTab) => void
  openAddDialog: (pending?: PendingAdd | null) => void
  closeAddDialog: () => void
  openSettingsDialog: () => void
  closeSettingsDialog: () => void
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
  refreshDetail: (hash: string) => Promise<void>
  clearLogs: () => void
}

let toastSeq = 1

function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  return window.mmz.invoke<T>(channel, payload)
}

export const useAppStore = create<AppState>((set, get) => {
  const handleEvent = (event: MainToRendererEvent): void => {
    switch (event.type) {
      case 'tick': {
        const torrents = event.payload.torrents
        const previous = get().selected
        const known = new Set(torrents.map((t) => t.hash))
        set({
          torrents,
          global: event.payload.global,
          // drop selections for torrents that disappeared
          selected: previous.filter((hash) => known.has(hash))
        })
        return
      }
      case 'engineStatus':
        set({ engineStatus: event.status })
        return
      case 'settings':
        set({ settings: event.settings })
        return
      case 'log':
        set((state) => ({ logs: [...state.logs, event.entry].slice(-1000) }))
        return
      case 'history':
        set({ history: event.entries })
        return
      case 'metaChanged':
        set((state) => ({
          torrents: state.torrents.map((t) =>
            t.hash === event.data.hash
              ? {
                  ...t,
                  category: event.data.category,
                  tags: event.data.tags,
                  note: event.data.note
                }
              : t
          )
        }))
        return
      case 'torrentsRemoved':
        set((state) => ({
          torrents: state.torrents.filter((t) => !event.data.hashes.includes(t.hash)),
          selected: state.selected.filter((hash) => !event.data.hashes.includes(hash))
        }))
        return
      case 'torrentFinished':
        get().toast('success', event.data.name)
        return
      case 'torrentError':
        get().toast('error', event.data.message)
        return
      case 'torrentAdded':
        return
      case 'metadataReceived':
      case 'trackerStatus':
      case 'listenStatus':
      case 'recheckFinished':
      case 'storageMoved':
      case 'storageMoveFailed':
        // surfaced through the tick stream / logs; no local state needed
        return
      default:
        return
    }
  }

  return {
    ready: false,
    info: null,
    settings: null,
    engineStatus: { state: 'starting' },
    torrents: [],
    global: EMPTY_GLOBAL,
    session: null,
    categories: [],
    selected: [],
    filter: 'all',
    filterValue: '',
    search: '',
    sort: { column: 'name', direction: 'asc' },
    detailTab: 'general',
    logs: [],
    history: [],
    toasts: [],
    addDialogOpen: false,
    settingsDialogOpen: false,
    pendingAdd: null,
    detailLoading: false,
    files: [],
    peers: [],
    trackers: [],
    pieces: null,

    invoke,

    init: () => {
      const unsubscribe = window.mmz.onEvent(handleEvent)

      void Promise.all([
        invoke<AppInfo>('app:info'),
        invoke<Settings>('settings:get'),
        invoke<EngineStatus>('engine:status'),
        invoke<HistoryEntry[]>('history:get'),
        invoke<LogEntry[]>('log:get', { since: 0, limit: 500 }),
        invoke<string[]>('categories:list')
      ])
        .then(([info, settings, status, history, logs, categories]) => {
          set({
            info,
            settings,
            engineStatus: status,
            history,
            logs,
            categories,
            ready: true
          })
        })
        .catch((error: unknown) => {
          set({ ready: true })
          get().toast('error', String(error))
        })

      return unsubscribe
    },

    setSettings: (settings) => set({ settings }),

    setFilter: (filter, value = '') => set({ filter, filterValue: value }),

    setSearch: (search) => set({ search }),

    setSort: (sort) => set({ sort }),

    select: (hashes, mode = 'replace') => {
      if (mode === 'replace') {
        set({ selected: hashes })
        return
      }
      set((state) => {
        const next = new Set(state.selected)
        for (const hash of hashes) {
          if (mode === 'toggle' && next.has(hash)) next.delete(hash)
          else next.add(hash)
        }
        return { selected: [...next] }
      })
    },

    setDetailTab: (tab) => set({ detailTab: tab }),

    openAddDialog: (pending = null) => set({ addDialogOpen: true, pendingAdd: pending }),
    closeAddDialog: () => set({ addDialogOpen: false, pendingAdd: null }),
    openSettingsDialog: () => set({ settingsDialogOpen: true }),
    closeSettingsDialog: () => set({ settingsDialogOpen: false }),

    toast: (kind, message) => {
      const id = toastSeq++
      set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-5) }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000)
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

    refreshDetail: async (hash) => {
      if (!hash) return
      set({ detailLoading: true })
      try {
        const tab = get().detailTab
        if (tab === 'files') {
          const files = await invoke<EngineFile[]>('torrents:files', { hash }).then((payload) =>
            Array.isArray(payload) ? payload : (payload as { files: EngineFile[] }).files
          )
          set({ files })
        } else if (tab === 'peers') {
          set({ peers: await invoke<PeerInfo[]>('torrents:peers', { hash }) })
        } else if (tab === 'trackers') {
          set({ trackers: await invoke<TrackerInfo[]>('torrents:trackers', { hash }) })
        } else if (tab === 'pieces') {
          set({ pieces: await invoke<PiecesPayload>('torrents:pieces', { hash }) })
        }
      } catch (error) {
        get().toast('error', String(error instanceof Error ? error.message : error))
      } finally {
        set({ detailLoading: false })
      }
    },

    clearLogs: () => set({ logs: [] })
  }
})

// ---------------------------------------------------------------------------
// helpers exported to components
// ---------------------------------------------------------------------------

export function matchesFilter(torrent: TorrentSummary, filter: SidebarFilter, value: string): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'downloading':
      return torrent.uiState === 'downloading' || torrent.uiState === 'stalled' || torrent.uiState === 'metadata'
    case 'seeding':
      return torrent.uiState === 'seeding'
    case 'finished':
      return Boolean(torrent.completed) || torrent.progress >= 1
    case 'paused':
      return torrent.uiState === 'paused' || torrent.uiState === 'queued'
    case 'error':
      return torrent.uiState === 'error' || Boolean(torrent.error)
    case 'category':
      return torrent.category === value
    default:
      return true
  }
}

export function visibleTorrents(state: AppState): TorrentSummary[] {
  const needle = state.search.trim().toLowerCase()
  const rows = state.torrents.filter((torrent) => {
    if (!matchesFilter(torrent, state.filter, state.filterValue)) return false
    if (!needle) return true
    return (
      torrent.name.toLowerCase().includes(needle) ||
      (torrent.category ?? '').toLowerCase().includes(needle) ||
      (torrent.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
    )
  })

  const { column, direction } = state.sort
  const factor = direction === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    const left = sortValue(a, column)
    const right = sortValue(b, column)
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
    return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor
  })
  return rows
}

function sortValue(torrent: TorrentSummary, column: string): string | number {
  switch (column) {
    case 'progress':
      return torrent.progress
    case 'size':
      return torrent.totalSize
    case 'down':
      return torrent.downloadRate
    case 'up':
      return torrent.uploadRate
    case 'seeds':
      return torrent.numSeeds
    case 'peers':
      return torrent.numPeers
    case 'eta':
      return torrent.eta < 0 ? Number.MAX_SAFE_INTEGER : torrent.eta
    case 'ratio':
      return torrent.downloaded > 0 ? torrent.uploadedAllTime / torrent.downloaded : 0
    case 'added':
      return torrent.addedAt
    case 'status':
      return torrent.uiState
    case 'category':
      return torrent.category ?? ''
    default:
      return torrent.name
  }
}

export type { TorrentMetaPatch, AddTorrentPayload, SessionStats }
