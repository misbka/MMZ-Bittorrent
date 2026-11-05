/** "Trackers" tab: announce list with live status. */
import { useState } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { Zap } from 'lucide-react'

export default function TrackersTab({ hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const trackers = useAppStore((s) => s.trackers)
  const loading = useAppStore((s) => s.detailLoading)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')

  const reannounce = async (): Promise<void> => {
    try {
      await invoke('torrents:command', { action: 'reannounce', hashes: [hash] })
      toast('success', t('trackers.reannounced'))
    } catch (error) {
      toast('error', String(error))
    }
  }

  const replaceTrackers = async (next: string[]): Promise<void> => {
    try {
      await invoke('torrents:setTrackers', { hash, trackers: next })
      await useAppStore.getState().refreshDetail(hash)
      toast('success', t('trackers.updated'))
    } catch (error) {
      toast('error', String(error))
    }
  }

  const addTracker = async (): Promise<void> => {
    const value = url.trim()
    if (!value) return
    await replaceTrackers([...trackers.map((tracker) => tracker.url), value])
    setUrl('')
    setAdding(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <button
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-ink-dim transition hover:bg-surface-3"
          onClick={() => void reannounce()}
        >
          <Zap className="size-3.5" />
          {t('trackers.reannounce')}
        </button>
        <button
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-ink-dim transition hover:bg-surface-3"
          onClick={() => setAdding((value) => !value)}
        >
          {adding ? t('action.cancel') : t('trackers.add')}
        </button>
        {adding && (
          <>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://tracker.example/announce"
              className="min-w-56 flex-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addTracker()
              }}
            />
            <button
              className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white"
              onClick={() => void addTracker()}
            >
              {t('action.save')}
            </button>
          </>
        )}
        <span className="ml-auto text-[11px] text-ink-faint">{t('trackers.count', { count: trackers.length })}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && trackers.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-faint">{t('detail.loading')}</div>
        ) : trackers.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-faint">{t('trackers.none')}</div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">{t('trackers.url')}</th>
                <th className="w-16 px-3 py-1.5 text-left font-semibold">{t('trackers.status')}</th>
                <th className="w-24 px-3 py-1.5 text-right font-semibold">{t('trackers.next')}</th>
                <th className="w-24 px-3 py-1.5 text-right font-semibold">{t('trackers.seeds')}</th>
                <th className="w-24 px-3 py-1.5 text-right font-semibold">{t('trackers.leeches')}</th>
                <th className="w-32 px-3 py-1.5 text-left font-semibold">{t('trackers.message')}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {trackers.map((tracker) => (
                <tr key={tracker.url} className="border-b border-border/60 hover:bg-surface-2">
                  <td className="max-w-[420px] truncate px-3 py-1.5 text-ink" title={tracker.url}>
                    {tracker.url}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[12px] ${
                        tracker.working ? 'text-ok' : 'text-danger'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${tracker.working ? 'bg-ok' : 'bg-danger'}`}
                      />
                      {tracker.working ? t('trackers.working') : t('trackers.error')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
                    {tracker.nextAnnounceIn > 0 ? `${tracker.nextAnnounceIn}s` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
                    {tracker.scrapeComplete >= 0 ? tracker.scrapeComplete : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
                    {tracker.scrapeIncomplete >= 0 ? tracker.scrapeIncomplete : '—'}
                  </td>
                  <td className="truncate px-3 py-1.5 text-[12px] text-ink-faint" title={tracker.message}>
                    {tracker.message || '—'}
                  </td>
                  <td className="px-1">
                    <button
                      className="rounded p-1 text-ink-faint transition hover:bg-surface-3 hover:text-danger"
                      title={t('trackers.remove')}
                      onClick={() =>
                        void replaceTrackers(
                          trackers.map((entry) => entry.url).filter((entry) => entry !== tracker.url)
                        )
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
