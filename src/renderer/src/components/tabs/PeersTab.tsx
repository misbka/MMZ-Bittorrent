/** "Peers" tab: live peer list for the selected torrent. */
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { formatBytes, formatPercent, formatRate } from '../../utils/format'

export default function PeersTab({ hash: _hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const peers = useAppStore((s) => s.peers)
  const loading = useAppStore((s) => s.detailLoading)

  if (loading && peers.length === 0) {
    return <div className="p-4 text-[13px] text-ink-faint">{t('detail.loading')}</div>
  }
  if (peers.length === 0) {
    return <div className="p-4 text-[13px] text-ink-faint">{t('peers.none')}</div>
  }

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-ink-faint">
        <tr>
          <th className="px-3 py-1.5 text-left font-semibold">{t('peers.ip')}</th>
          <th className="px-3 py-1.5 text-left font-semibold">{t('peers.client')}</th>
          <th className="px-3 py-1.5 text-right font-semibold">{t('peers.progress')}</th>
          <th className="px-3 py-1.5 text-right font-semibold">{t('peers.down')}</th>
          <th className="px-3 py-1.5 text-right font-semibold">{t('peers.up')}</th>
          <th className="px-3 py-1.5 text-right font-semibold">{t('peers.downloaded')}</th>
          <th className="px-3 py-1.5 text-right font-semibold">{t('peers.uploaded')}</th>
          <th className="px-3 py-1.5 text-left font-semibold">{t('peers.flags')}</th>
        </tr>
      </thead>
      <tbody>
        {peers.map((peer) => (
          <tr key={`${peer.ip}-${peer.client}`} className="border-b border-border/60 hover:bg-surface-2">
            <td className="px-3 py-1.5 text-ink">{peer.ip}</td>
            <td className="px-3 py-1.5 text-ink-dim">{peer.client || '—'}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
              {formatPercent(peer.progress)}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-accent">
              {formatRate(peer.downSpeed)}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-ok">{formatRate(peer.upSpeed)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
              {formatBytes(peer.downloaded)}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
              {formatBytes(peer.uploaded)}
            </td>
            <td className="px-3 py-1.5 text-[11px] text-ink-faint">
              {peer.seed ? t('peers.seed') : t('peers.leecher')}
              {peer.connecting ? ` · ${t('peers.connecting')}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
