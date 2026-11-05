/** "Logs" tab: streaming engine log with level filter and clear. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'

const LEVEL_CLASS: Record<string, string> = {
  debug: 'text-ink-faint',
  info: 'text-ink-dim',
  warning: 'text-warn',
  error: 'text-danger'
}

export default function LogTab(): React.JSX.Element {
  const t = useT()
  const logs = useAppStore((s) => s.logs)
  const clearLogs = useAppStore((s) => s.clearLogs)
  const [level, setLevel] = useState<'debug' | 'info' | 'warning' | 'error'>('info')
  const [follow, setFollow] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  const rank = { debug: 0, info: 1, warning: 2, error: 3 }
  const visible = useMemo(
    () => logs.filter((entry) => rank[entry.level] >= rank[level]),
    [logs, level]
  )

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: 'end' })
  }, [visible.length, follow])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value as typeof level)}
          className="rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
          aria-label={t('log.level')}
        >
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-dim">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} className="size-3.5 accent-accent" />
          {t('log.follow')}
        </label>
        <span className="ml-auto text-[11px] text-ink-faint">{t('log.count', { count: visible.length })}</span>
        <button
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-ink-dim transition hover:bg-surface-3"
          onClick={clearLogs}
        >
          {t('log.clear')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-[12px] leading-relaxed" data-testid="log-list">
        {visible.length === 0 && <div className="text-ink-faint">{t('log.empty')}</div>}
        {visible.map((entry, index) => (
          <div key={`${entry.seq}-${index}`} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="shrink-0 tabular-nums text-ink-faint">
              {new Date(entry.ts * 1000).toLocaleTimeString()}
            </span>
            <span className={`shrink-0 uppercase ${LEVEL_CLASS[entry.level] ?? ''}`}>
              {entry.level.padEnd(7)}
            </span>
            <span className="shrink-0 text-accent">[{entry.source}]</span>
            <span className="text-ink-dim">{entry.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
