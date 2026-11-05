import { useEffect, useMemo } from 'react'
import { I18nProvider, useT } from './i18n'
import { useAppStore, visibleTorrents } from './store'
import { useTheme } from './hooks/useTheme'
import { useUiScale } from './hooks/useUiScale'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import TorrentTable from './components/TorrentTable'
import DetailsPanel from './components/DetailsPanel'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'
import EngineBanner from './components/EngineBanner'
import AddTorrentDialog from './components/dialogs/AddTorrentDialog'
import SettingsDialog from './components/dialogs/SettingsDialog'
import { ConfirmDialog } from './components/dialogs/ConfirmDialog'
import EmptyState from './components/EmptyState'
import type { MainToRendererEvent, SessionStats, TorrentSummary } from '@shared/types'

export default function App(): React.JSX.Element {
  const init = useAppStore((s) => s.init)
  const settings = useAppStore((s) => s.settings)
  const ready = useAppStore((s) => s.ready)
  const language = settings?.general.language ?? 'pt-BR'

  useEffect(() => init(), [init])

  // session stats feed the status bar graph and uptime counter
  useEffect(() => {
    const timer = setInterval(() => {
      void window.mmz
        .invoke<SessionStats>('session:stats')
        .then((session) => useAppStore.setState({ session }))
        .catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  useTheme(settings?.general.theme)
  useUiScale(settings?.interface.scale)

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0 text-ink-dim">
        <div className="flex items-center gap-3">
          <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span data-testid="boot-loading">Loading…</span>
        </div>
      </div>
    )
  }

  return (
    <I18nProvider
      language={language}
      onLanguageChange={(next) => {
        const current = useAppStore.getState().settings
        if (!current || current.general.language === next) return
        void useAppStore.getState().invoke('settings:update', { general: { language: next } })
      }}
    >
      <Shell />
    </I18nProvider>
  )
}

function Shell(): React.JSX.Element {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const torrents = useAppStore((s) => s.torrents)
  const selected = useAppStore((s) => s.selected)
  const search = useAppStore((s) => s.search)
  const filter = useAppStore((s) => s.filter)
  const filterValue = useAppStore((s) => s.filterValue)
  const sort = useAppStore((s) => s.sort)
  const invoke = useAppStore((s) => s.invoke)
  const select = useAppStore((s) => s.select)
  const openAddDialog = useAppStore((s) => s.openAddDialog)

  const rows = useMemo(
    () => visibleTorrents(useAppStore.getState()),
    // recompute on every state change that affects the table
    [torrents, search, filter, filterValue, sort]
  )

  // --- keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const state = useAppStore.getState()
      const hashes = state.selected

      if (event.key === 'Delete' && hashes.length > 0) {
        event.preventDefault()
        void removeSelection(hashes)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        select(state.torrents.map((torrent) => torrent.hash))
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openAddDialog()
      } else if (event.key === ' ' && hashes.length > 0) {
        event.preventDefault()
        const paused = hashes.every((hash) => state.torrents.find((torrent) => torrent.hash === hash)?.paused)
        void invoke('torrents:command', { action: paused ? 'resume' : 'pause', hashes })
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [invoke, select, openAddDialog])

  // --- drag & drop of .torrent files ---------------------------------------
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return
      const torrents: { name: string; data: string }[] = []
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.torrent')) continue
        event.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result ?? '')
          const base64 = result.slice(result.indexOf(',') + 1)
          torrents.push({ name: file.name, data: base64 })
          if (torrents.length === files.length) {
            useAppStore.getState().openAddDialog({ urls: [], files: torrents })
          }
        }
        reader.readAsDataURL(file)
      }
      if (torrents.length === 0 && files.length > 0) event.preventDefault()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const removeSelection = async (hashes: string[]): Promise<void> => {
    const state = useAppStore.getState()
    if (state.settings?.general.confirmRemove) {
      const ok = await ConfirmDialog.confirm({
        title: t('dialog.removeTitle'),
        message: t('dialog.removeMessage', { count: hashes.length }),
        confirmLabel: t('action.remove'),
        danger: true,
        extra: 'deleteFiles'
      })
      if (!ok) return
    }
    try {
      await state.invoke('torrents:remove', { hashes, deleteFiles: false })
      state.select([])
    } catch (error) {
      state.toast('error', String(error instanceof Error ? error.message : error))
    }
  }

  const showEmpty = rows.length === 0
  const noTorrents = torrents.length === 0

  return (
    <div className="flex h-full flex-col bg-surface-0 text-ink">
      <EngineBanner />
      <div className="flex min-h-0 flex-1">
        {settings?.interface.showSidebar !== false && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar onRemove={() => void removeSelection(selected)} />
          <div className="min-h-0 flex-1 overflow-hidden rounded-tl-lg border-t border-l border-border bg-surface-1">
            {showEmpty ? (
              <EmptyState noTorrents={noTorrents} />
            ) : (
              <TorrentTable rows={rows} />
            )}
          </div>
          <DetailsPanel />
        </main>
      </div>
      {settings?.interface.showStatusbar !== false && <StatusBar />}
      <Toasts />
      <AddTorrentDialog />
      <SettingsDialog />
      <ConfirmDialog.Renderer />
    </div>
  )
}

/** Re-exported so tests can drive the same event typing. */
export type { MainToRendererEvent, SessionStats, TorrentSummary }
