/** Sortable torrent table with selection, context menu and progress bars. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Magnet,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Zap
} from 'lucide-react'
import { useAppStore, type SortState } from '../store'
import { useT } from '../i18n'
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRateSigned,
  formatRatio,
  formatRelativeTime
} from '../utils/format'
import { COLUMN_IDS, type ColumnId } from '@shared/settings'
import type { TorrentSummary, UiState } from '@shared/types'
import { ConfirmDialog } from './dialogs/ConfirmDialog'

interface Props {
  rows: TorrentSummary[]
}

const STATUS_COLOR: Record<UiState, string> = {
  downloading: 'text-accent',
  stalled: 'text-warn',
  seeding: 'text-ok',
  finished: 'text-ok',
  paused: 'text-ink-faint',
  queued: 'text-ink-faint',
  checking: 'text-warn',
  allocating: 'text-warn',
  metadata: 'text-accent',
  moving: 'text-accent',
  error: 'text-danger'
}

const STATUS_KEY: Record<UiState, string> = {
  downloading: 'status.downloading',
  stalled: 'status.stalled',
  seeding: 'status.seeding',
  finished: 'status.finished',
  paused: 'status.paused',
  queued: 'status.queued',
  checking: 'status.checking',
  allocating: 'status.allocating',
  metadata: 'status.metadata',
  moving: 'status.moving',
  error: 'status.error'
}

export default function TorrentTable({ rows }: Props): React.JSX.Element {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const selected = useAppStore((s) => s.selected)
  const select = useAppStore((s) => s.select)
  const sort = useAppStore((s) => s.sort)
  const setSort = useAppStore((s) => s.setSort)
  const columns = settings?.interface.columns ?? ({} as Record<ColumnId, boolean>)
  const density = settings?.interface.density ?? 'comfortable'

  const visibleColumns = useMemo(
    () => COLUMN_IDS.filter((id) => columns[id] !== false),
    [columns]
  )

  const [menu, setMenu] = useState<{ x: number; y: number; hash: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const toggleSort = (column: string): void => {
    const next: SortState =
      sort.column === column
        ? { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
    setSort(next)
  }

  const onRowClick = (hash: string, event: React.MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) select([hash], 'toggle')
    else if (event.shiftKey && selected.length > 0) {
      const anchor = rows.findIndex((row) => row.hash === selected[selected.length - 1])
      const current = rows.findIndex((row) => row.hash === hash)
      if (anchor >= 0 && current >= 0) {
        const [from, to] = anchor < current ? [anchor, current] : [current, anchor]
        select(rows.slice(from, to + 1).map((row) => row.hash))
      }
    } else select([hash])
  }

  const cellPadding = density === 'compact' ? 'py-1' : 'py-2'

  return (
    <div ref={bodyRef} className="h-full overflow-auto" data-testid="torrent-table">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column}
                className={`whitespace-nowrap px-3 text-left font-semibold ${
                  column === 'name' ? 'min-w-[260px]' : ''
                } ${column === 'progress' ? 'w-[170px]' : ''}`}
              >
                <button
                  className="flex items-center gap-1 py-2 transition hover:text-ink"
                  onClick={() => toggleSort(column)}
                >
                  {t(`column.${column}`)}
                  {sort.column === column &&
                    (sort.direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </button>
              </th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((torrent) => {
            const isSelected = selected.includes(torrent.hash)
            return (
              <tr
                key={torrent.hash}
                data-testid={`torrent-row-${torrent.hash}`}
                className={`cursor-default border-b border-border/60 transition ${
                  isSelected ? 'bg-accent-soft' : 'hover:bg-surface-2'
                }`}
                onClick={(event) => onRowClick(torrent.hash, event)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (!isSelected) select([torrent.hash])
                  setMenu({ x: event.clientX, y: event.clientY, hash: torrent.hash })
                }}
              >
                {visibleColumns.map((column) => (
                  <td key={column} className={`px-3 ${cellPadding} align-middle`}>
                    {renderCell(column, torrent, t)}
                  </td>
                ))}
                <td className="px-1">
                  <ChevronRight className="size-3.5 text-ink-faint" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {menu && <ContextMenu x={menu.x} y={menu.y} hash={menu.hash} onClose={() => setMenu(null)} />}
    </div>
  )
}

function renderCell(
  column: ColumnId,
  torrent: TorrentSummary,
  t: (key: string, vars?: Record<string, string | number>) => string
): React.JSX.Element {
  switch (column) {
    case 'name':
      return (
        <div className="flex min-w-0 items-center gap-2">
          <span className={`truncate font-medium text-ink`} title={torrent.name}>
            {torrent.name || torrent.hash}
          </span>
          {torrent.error && <span className="shrink-0 text-danger" title={torrent.error}>!</span>}
        </div>
      )
    case 'status':
      return (
        <span className={`flex items-center gap-1.5 whitespace-nowrap ${STATUS_COLOR[torrent.uiState]}`}>
          <StatusDot state={torrent.uiState} />
          {t(STATUS_KEY[torrent.uiState])}
        </span>
      )
    case 'progress':
      return (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                torrent.progress >= 1 ? 'bg-ok' : torrent.uiState === 'error' ? 'bg-danger' : 'bg-accent'
              }`}
              style={{ width: `${Math.round(torrent.progress * 100)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right tabular-nums text-ink-dim">
            {formatPercent(torrent.progress)}
          </span>
        </div>
      )
    case 'size':
      return <span className="tabular-nums text-ink-dim">{formatBytes(torrent.totalSize)}</span>
    case 'down':
      return (
        <span className="tabular-nums text-accent">{formatRateSigned(torrent.downloadRate, 'down')}</span>
      )
    case 'up':
      return <span className="tabular-nums text-ok">{formatRateSigned(torrent.uploadRate, 'up')}</span>
    case 'seeds':
      return (
        <span className="tabular-nums text-ink-dim">
          {torrent.numSeeds}/{torrent.knownSeeds}
        </span>
      )
    case 'peers':
      return (
        <span className="tabular-nums text-ink-dim">
          {torrent.numPeers}/{torrent.knownPeers}
        </span>
      )
    case 'eta':
      return <span className="tabular-nums text-ink-dim">{formatEta(torrent.eta)}</span>
    case 'category':
      return (
        <span className="truncate text-ink-dim" title={torrent.category}>
          {torrent.category || '—'}
        </span>
      )
    case 'ratio':
      return (
        <span className="tabular-nums text-ink-dim">
          {formatRatio(torrent.downloaded, torrent.uploadedAllTime)}
        </span>
      )
    case 'added':
      return (
        <span className="whitespace-nowrap text-ink-faint">{formatRelativeTime(torrent.addedAt)}</span>
      )
    default:
      return <span />
  }
}

function StatusDot({ state }: { state: UiState }): React.JSX.Element {
  const color =
    state === 'error'
      ? 'bg-danger'
      : state === 'paused' || state === 'queued'
        ? 'bg-ink-faint'
        : state === 'stalled' || state === 'checking'
          ? 'bg-warn'
          : 'bg-current'
  return <span className={`inline-block size-1.5 rounded-full ${color}`} />
}

function ContextMenu({
  x,
  y,
  hash,
  onClose
}: {
  x: number
  y: number
  hash: string
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const torrent = useAppStore((s) => s.torrents.find((row) => row.hash === hash))
  const select = useAppStore((s) => s.select)

  const run = async (action: 'pause' | 'resume' | 'recheck' | 'reannounce'): Promise<void> => {
    try {
      await invoke('torrents:command', { action, hashes: [hash] })
    } catch (error) {
      toast('error', String(error))
    } finally {
      onClose()
    }
  }

  const remove = async (): Promise<void> => {
    const { confirmed, extra } = await ConfirmDialog.confirm({
      title: t('dialog.removeTitle'),
      message: t('dialog.removeMessage', { count: 1 }),
      confirmLabel: t('action.remove'),
      danger: true,
      extra: 'deleteFiles',
      extraLabel: t('dialog.deleteFiles')
    })
    if (!confirmed) {
      onClose()
      return
    }
    try {
      await invoke('torrents:remove', { hashes: [hash], deleteFiles: extra })
      select([])
    } catch (error) {
      toast('error', String(error))
    } finally {
      onClose()
    }
  }

  const openFolder = async (): Promise<void> => {
    if (!torrent) return
    try {
      await invoke('app:revealPath', `${torrent.savePath}`)
    } catch (error) {
      toast('error', String(error))
    } finally {
      onClose()
    }
  }

  const left = Math.min(x, window.innerWidth - 210)
  const top = Math.min(y, window.innerHeight - 300)

  const item =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink transition hover:bg-surface-2'

  return (
    <div
      className="fixed z-40 w-48 rounded-lg border border-border bg-surface-1 py-1 shadow-xl"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <button className={item} onClick={() => void run(torrent?.paused ? 'resume' : 'pause')}>
        {torrent?.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        {torrent?.paused ? t('action.start') : t('action.pause')}
      </button>
      <button className={item} onClick={() => void run('recheck')}>
        <RefreshCw className="size-3.5" />
        {t('action.recheck')}
      </button>
      <button className={item} onClick={() => void run('reannounce')}>
        <Zap className="size-3.5" />
        {t('action.reannounce')}
      </button>
      <div className="my-1 border-t border-border" />
      <button className={item} onClick={() => void openFolder()}>
        <FolderOpen className="size-3.5" />
        {t('action.openFolder')}
      </button>
      <button
        className={item}
        onClick={() => {
          void navigator.clipboard?.writeText(hash)
          onClose()
        }}
      >
        <Magnet className="size-3.5" />
        {t('action.copyHash')}
      </button>
      <div className="my-1 border-t border-border" />
      <button className={`${item} text-danger`} onClick={() => void remove()}>
        <Trash2 className="size-3.5" />
        {t('action.remove')}
      </button>
      <button
        className={`${item} text-danger`}
        onClick={() => {
          void (async () => {
            const { confirmed } = await ConfirmDialog.confirm({
              title: t('dialog.removeTitle'),
              message: t('dialog.removeFilesMessage'),
              confirmLabel: t('action.remove'),
              danger: true
            })
            if (confirmed) {
              try {
                await invoke('torrents:remove', { hashes: [hash], deleteFiles: true })
              } catch (error) {
                toast('error', String(error))
              }
            }
            onClose()
          })()
        }}
      >
        <CheckCircle2 className="size-3.5" />
        {t('action.removeWithFiles')}
      </button>
    </div>
  )
}
