/** Top action bar: add / start / pause / remove / search / settings. */
import {
  Magnet,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2
} from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { useRef, useState } from 'react'

interface Props {
  onRemove: () => void
}

export default function Toolbar({ onRemove }: Props): React.JSX.Element {
  const t = useT()
  const selected = useAppStore((s) => s.selected)
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const openAddDialog = useAppStore((s) => s.openAddDialog)
  const openSettingsDialog = useAppStore((s) => s.openSettingsDialog)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const runCommand = async (action: 'pause' | 'resume' | 'recheck' | 'reannounce'): Promise<void> => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    try {
      await invoke('torrents:command', { action, hashes: selected })
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const pickFiles = async (): Promise<void> => {
    const result = await invoke<{ files: { name: string; data: string }[]; skipped: unknown[] }>(
      'dialog:openTorrents'
    )
    if (result.files.length > 0) openAddDialog({ urls: [], files: result.files })
  }

  const disabled = selected.length === 0

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <button
        data-testid="add-torrent"
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
        onClick={() => openAddDialog()}
        title={t('toolbar.addTorrent')}
      >
        <Plus className="size-4" />
        {t('toolbar.add')}
      </button>

      <button
        data-testid="add-magnet"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink transition hover:bg-surface-2"
        onClick={() => openAddDialog({ urls: [''], files: [] })}
        title={t('toolbar.addMagnet')}
      >
        <Magnet className="size-4" />
        {t('toolbar.magnet')}
      </button>

      <button
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink transition hover:bg-surface-2 disabled:opacity-40"
        disabled={disabled || busy}
        onClick={() => void runCommand('resume')}
        title={t('toolbar.start')}
        data-testid="action-start"
      >
        <Play className="size-4" />
        {t('toolbar.start')}
      </button>

      <button
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink transition hover:bg-surface-2 disabled:opacity-40"
        disabled={disabled || busy}
        onClick={() => void runCommand('pause')}
        title={t('toolbar.pause')}
        data-testid="action-pause"
      >
        <Pause className="size-4" />
        {t('toolbar.pause')}
      </button>

      <button
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink transition hover:bg-surface-2 disabled:opacity-40"
        disabled={disabled || busy}
        onClick={() => void runCommand('recheck')}
        title={t('toolbar.recheck')}
      >
        <RefreshCw className="size-4" />
        {t('toolbar.recheck')}
      </button>

      <button
        data-testid="action-remove"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink transition hover:bg-surface-2 hover:text-danger disabled:opacity-40"
        disabled={disabled}
        onClick={onRemove}
        title={t('toolbar.remove')}
      >
        <Trash2 className="size-4" />
        {t('toolbar.remove')}
      </button>

      <div className="relative ml-auto min-w-0 flex-1 max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          data-testid="search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('toolbar.search')}
          className="w-full rounded-lg border border-border bg-surface-1 py-2 pl-8 pr-3 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
        />
      </div>

      <button
        className="rounded-lg border border-border bg-surface-1 p-2 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        onClick={() => void pickFiles()}
        title={t('toolbar.openFile')}
      >
        <Plus className="size-4" />
      </button>

      <button
        data-testid="open-settings"
        className="rounded-lg border border-border bg-surface-1 p-2 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        onClick={openSettingsDialog}
        title={t('toolbar.settings')}
      >
        <Settings className="size-4" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".torrent"
        multiple
        className="hidden"
        onChange={() => fileInputRef.current?.form?.reset()}
      />
    </div>
  )
}
