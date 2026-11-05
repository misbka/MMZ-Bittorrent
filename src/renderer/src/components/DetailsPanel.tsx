/** Bottom detail panel with the 7 tabs required by the spec. */
import { useEffect } from 'react'
import { useAppStore, type DetailTab } from '../store'
import { useT } from '../i18n'
import GeneralTab from './tabs/GeneralTab'
import FilesTab from './tabs/FilesTab'
import InfoTab from './tabs/InfoTab'
import PeersTab from './tabs/PeersTab'
import TrackersTab from './tabs/TrackersTab'
import PiecesTab from './tabs/PiecesTab'
import LogTab from './tabs/LogTab'

const TABS: { id: DetailTab; key: string }[] = [
  { id: 'general', key: 'tab.general' },
  { id: 'files', key: 'tab.files' },
  { id: 'info', key: 'tab.info' },
  { id: 'peers', key: 'tab.peers' },
  { id: 'trackers', key: 'tab.trackers' },
  { id: 'pieces', key: 'tab.pieces' },
  { id: 'log', key: 'tab.log' }
]

export default function DetailsPanel(): React.JSX.Element {
  const t = useT()
  const selected = useAppStore((s) => s.selected)
  const tab = useAppStore((s) => s.detailTab)
  const setTab = useAppStore((s) => s.setDetailTab)
  const refreshDetail = useAppStore((s) => s.refreshDetail)
  const settings = useAppStore((s) => s.settings)
  const hash = selected[0] ?? ''

  // refresh the active tab's data whenever the selection or tab changes,
  // then keep it live while the tab stays open
  useEffect(() => {
    if (!hash && tab !== 'log') return
    void refreshDetail(hash)
    if (tab === 'log') return
    const timer = setInterval(() => void refreshDetail(hash), 2000)
    return () => clearInterval(timer)
  }, [hash, tab, refreshDetail])

  const height = settings?.interface.density === 'compact' ? 'h-56' : 'h-72'

  return (
    <section className={`flex ${height} shrink-0 flex-col border-t border-border bg-surface-1`}>
      <div className="flex items-center gap-1 border-b border-border px-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            data-testid={`tab-${entry.id}`}
            className={`relative px-3 py-2 text-[13px] transition ${
              tab === entry.id ? 'font-medium text-accent' : 'text-ink-dim hover:text-ink'
            }`}
            onClick={() => setTab(entry.id)}
          >
            {t(entry.key)}
            {tab === entry.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
        {hash && (
          <span className="ml-auto max-w-[45%] truncate pr-2 text-[11px] text-ink-faint">
            {useAppStore.getState().torrents.find((row) => row.hash === hash)?.name}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto" data-testid="detail-content">
        {tab !== 'log' && !hash ? (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
            {t('detail.selectTorrent')}
          </div>
        ) : tab === 'general' ? (
          <GeneralTab hash={hash} />
        ) : tab === 'files' ? (
          <FilesTab hash={hash} />
        ) : tab === 'info' ? (
          <InfoTab hash={hash} />
        ) : tab === 'peers' ? (
          <PeersTab hash={hash} />
        ) : tab === 'trackers' ? (
          <TrackersTab hash={hash} />
        ) : tab === 'pieces' ? (
          <PiecesTab hash={hash} />
        ) : (
          <LogTab />
        )}
      </div>
    </section>
  )
}
