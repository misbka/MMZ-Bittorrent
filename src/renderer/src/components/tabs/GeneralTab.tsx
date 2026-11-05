/** "General" tab: headline numbers for the selected torrent. */
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRate,
  formatRatio
} from '../../utils/format'

export default function GeneralTab({ hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const torrent = useAppStore((s) => s.torrents.find((row) => row.hash === hash))

  if (!torrent) return <div className="p-4 text-[13px] text-ink-faint">{t('detail.missing')}</div>

  const elapsed = torrent.addedAt ? (Date.now() - torrent.addedAt) / 1000 : 0
  const remaining =
    torrent.downloadRate > 0
      ? Math.max(0, (torrent.totalWanted - torrent.downloadedWanted) / torrent.downloadRate)
      : -1

  const items: { label: string; value: string }[] = [
    { label: t('detail.downloaded'), value: formatBytes(torrent.downloadedWanted) },
    { label: t('detail.uploaded'), value: formatBytes(torrent.uploadedAllTime) },
    { label: t('detail.remaining'), value: formatBytes(Math.max(0, torrent.totalWanted - torrent.downloadedWanted)) },
    { label: t('detail.totalSize'), value: formatBytes(torrent.totalSize) },
    { label: t('detail.downloadRate'), value: formatRate(torrent.downloadRate) },
    { label: t('detail.uploadRate'), value: formatRate(torrent.uploadRate) },
    { label: t('detail.shareRatio'), value: formatRatio(torrent.downloaded, torrent.uploadedAllTime) },
    { label: t('detail.availability'), value: torrent.availability.toFixed(2) },
    { label: t('detail.eta'), value: torrent.eta >= 0 ? formatDuration(torrent.eta) : '∞' },
    { label: t('detail.timeRemaining'), value: remaining >= 0 ? formatDuration(remaining) : '∞' },
    { label: t('detail.seeds'), value: `${torrent.numSeeds} / ${torrent.knownSeeds}` },
    { label: t('detail.peers'), value: `${torrent.numPeers} / ${torrent.knownPeers}` },
    { label: t('detail.connections'), value: String(torrent.connections) },
    { label: t('detail.addedOn'), value: formatDateTime(torrent.addedAt) },
    { label: t('detail.completedOn'), value: torrent.completedAt ? formatDateTime(torrent.completedAt) : '—' },
    { label: t('detail.timeElapsed'), value: formatDuration(elapsed) },
    { label: t('detail.savePath'), value: torrent.savePath || '—' },
    { label: t('detail.category'), value: torrent.category || '—' },
    { label: t('detail.tags'), value: torrent.tags?.length ? torrent.tags.join(', ') : '—' },
    { label: t('detail.note'), value: torrent.note || '—' }
  ]

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 p-4 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline justify-between gap-3 text-[13px]">
          <span className="shrink-0 text-ink-faint">{item.label}</span>
          <span className="truncate tabular-nums text-ink" title={item.value}>
            {item.value}
          </span>
        </div>
      ))}
      <div className="col-span-full mt-1">
        <div className="flex items-center justify-between text-[12px] text-ink-dim">
          <span>{formatPercent(torrent.progress)}</span>
          <span>{t('detail.pieceCount', { count: torrent.pieceCount })}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full transition-all duration-500 ${torrent.progress >= 1 ? 'bg-ok' : 'bg-accent'}`}
            style={{ width: `${Math.round(torrent.progress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
