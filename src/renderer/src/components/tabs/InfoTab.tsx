/** "Info" tab: hash, tracker, transfer totals and per-torrent limits. */
import { useState } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { formatBytes, formatDateTime, formatRate, shortHash } from '../../utils/format'

export default function InfoTab({ hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const torrent = useAppStore((s) => s.torrents.find((row) => row.hash === hash))
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const [downLimit, setDownLimit] = useState('')
  const [upLimit, setUpLimit] = useState('')

  if (!torrent) return <div className="p-4 text-[13px] text-ink-faint">{t('detail.missing')}</div>

  const applyLimits = async (): Promise<void> => {
    try {
      const options: Record<string, unknown> = { hash }
      if (downLimit !== '') options['downloadLimit'] = Math.max(0, Number(downLimit) * 1024)
      if (upLimit !== '') options['uploadLimit'] = Math.max(0, Number(upLimit) * 1024)
      if (Object.keys(options).length === 1) return
      await invoke('torrents:options', options)
      setDownLimit('')
      setUpLimit('')
      toast('success', t('info.limitsSaved'))
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    }
  }

  const rows: { label: string; value: string }[] = [
    { label: t('info.hash'), value: shortHash(hash) },
    { label: t('info.magnet'), value: `magnet:?xt=urn:btih:${hash}` },
    { label: t('info.tracker'), value: torrent.currentTracker || '—' },
    { label: t('info.savePath'), value: torrent.savePath || '—' },
    { label: t('info.totalDownload'), value: formatBytes(torrent.downloadedAllTime) },
    { label: t('info.totalUpload'), value: formatBytes(torrent.uploadedAllTime) },
    { label: t('info.downRate'), value: formatRate(torrent.downloadRate) },
    { label: t('info.upRate'), value: formatRate(torrent.uploadRate) },
    { label: t('info.downLimit'), value: torrent.downloadLimit > 0 ? formatRate(torrent.downloadLimit) : '∞' },
    { label: t('info.upLimit'), value: torrent.uploadLimit > 0 ? formatRate(torrent.uploadLimit) : '∞' },
    { label: t('info.addedOn'), value: formatDateTime(torrent.addedAt) },
    { label: t('info.completedOn'), value: torrent.completedAt ? formatDateTime(torrent.completedAt) : '—' },
    { label: t('info.pieceCount'), value: String(torrent.pieceCount) },
    { label: t('info.queuePosition'), value: String(torrent.queuePosition) },
    { label: t('info.state'), value: torrent.state },
    { label: t('info.error'), value: torrent.error || '—' }
  ]

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 p-4 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-3 text-[13px]">
          <span className="shrink-0 text-ink-faint">{row.label}</span>
          <span className="truncate tabular-nums text-ink" title={row.value}>
            {row.value}
          </span>
        </div>
      ))}

      <div className="col-span-full mt-2 flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="flex flex-col gap-1 text-[12px] text-ink-dim">
          {t('info.setDownLimit')}
          <input
            value={downLimit}
            onChange={(event) => setDownLimit(event.target.value)}
            placeholder={torrent.downloadLimit > 0 ? String(Math.round(torrent.downloadLimit / 1024)) : '0'}
            className="w-32 rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-dim">
          {t('info.setUpLimit')}
          <input
            value={upLimit}
            onChange={(event) => setUpLimit(event.target.value)}
            placeholder={torrent.uploadLimit > 0 ? String(Math.round(torrent.uploadLimit / 1024)) : '0'}
            className="w-32 rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90"
          onClick={() => void applyLimits()}
        >
          {t('action.save')}
        </button>
        <span className="text-[11px] text-ink-faint">{t('info.limitHint')}</span>
      </div>

      <div className="col-span-full mt-1 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-ink-dim">
          {t('info.category')}
          <input
            defaultValue={torrent.category}
            onBlur={(event) => {
              const value = event.target.value.trim()
              if (value === torrent.category) return
              void invoke('torrents:meta', { hash, category: value }).catch((error: unknown) =>
                toast('error', String(error))
              )
            }}
            className="w-44 rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-dim">
          {t('info.tags')}
          <input
            defaultValue={(torrent.tags ?? []).join(', ')}
            onBlur={(event) => {
              const value = event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
              void invoke('torrents:meta', { hash, tags: value }).catch((error: unknown) =>
                toast('error', String(error))
              )
            }}
            className="w-64 rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-[12px] text-ink-dim">
          {t('info.note')}
          <input
            defaultValue={torrent.note ?? ''}
            onBlur={(event) => {
              const value = event.target.value
              if (value === (torrent.note ?? '')) return
              void invoke('torrents:meta', { hash, note: value }).catch((error: unknown) =>
                toast('error', String(error))
              )
            }}
            className="rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
      </div>
    </div>
  )
}
