/** Non-blocking banner shown when the BitTorrent engine cannot start. */
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'

export default function EngineBanner(): React.JSX.Element | null {
  const t = useT()
  const status = useAppStore((s) => s.engineStatus)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)

  if (status.state !== 'error') return null

  return (
    <div
      className="flex items-start gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2.5 text-[13px] text-ink"
      role="alert"
      data-testid="engine-banner"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-danger">{t('engine.unavailable')}</span>
        <span className="ml-2 text-ink-dim">{status.message}</span>
        <div className="mt-1 text-[12px] text-ink-faint">{t('engine.help')}</div>
      </div>
      <button
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] transition hover:bg-surface-2"
        onClick={() => {
          void invoke('app:info')
            .then(() => window.location.reload())
            .catch((error: unknown) => toast('error', String(error)))
        }}
      >
        <RefreshCw className="size-3.5" />
        {t('engine.retry')}
      </button>
    </div>
  )
}
