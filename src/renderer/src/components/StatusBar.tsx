/** Status bar: live global speeds, DHT/peers and the speed graph toggle. */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { formatBytes, formatDuration, formatRate } from '../utils/format'
import type { SessionStats } from '@shared/types'

export default function StatusBar(): React.JSX.Element {
  const t = useT()
  const global = useAppStore((s) => s.global)
  const engineStatus = useAppStore((s) => s.engineStatus)
  const settings = useAppStore((s) => s.settings)
  const showGraph = settings?.interface.showSpeedGraph ?? true

  const startedAt = useAppStore((s) => s.session?.startedAt ?? 0)
  const upSince = startedAt > 0 ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-surface-2 px-4 text-[11px] text-ink-dim">
      <span className="flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${
            engineStatus.state === 'ready' ? 'bg-ok' : engineStatus.state === 'error' ? 'bg-danger' : 'bg-warn'
          }`}
        />
        {engineStatus.state === 'ready'
          ? t('status.engineReady')
          : engineStatus.state === 'error'
            ? t('status.engineError')
            : t('status.engineStarting')}
      </span>

      <span className="flex items-center gap-1">
        <span className="text-ink-faint">{t('status.dht')}</span>
        <span className="tabular-nums">{global.dhtNodes}</span>
      </span>

      <span className="flex items-center gap-1">
        <span className="text-ink-faint">{t('status.peers')}</span>
        <span className="tabular-nums">
          {global.connections}/{global.maxConnections}
        </span>
      </span>

      <span className="flex items-center gap-1">
        <span className="text-ink-faint">{t('status.torrents')}</span>
        <span className="tabular-nums">{global.torrents}</span>
      </span>

      {showGraph && <SpeedGraph />}

      <span className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="text-ink-faint">↓</span>
          <span className="tabular-nums text-accent">{formatRate(global.downloadRate)}</span>
          <span className="text-ink-faint">
            {global.downloadLimit > 0 ? `(${formatRate(global.downloadLimit)})` : ''}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-ink-faint">↑</span>
          <span className="tabular-nums text-ok">{formatRate(global.uploadRate)}</span>
          <span className="text-ink-faint">
            {global.uploadLimit > 0 ? `(${formatRate(global.uploadLimit)})` : ''}
          </span>
        </span>
        <span className="text-ink-faint">
          {t('status.total')} ↓ {formatBytes(global.downloadTotal)} · ↑ {formatBytes(global.uploadTotal)}
        </span>
        <span className="text-ink-faint">{formatDuration(upSince)}</span>
      </span>
    </footer>
  )
}

/** Rolling60-second speed graph drawn on a canvas. */
function SpeedGraph(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    const draw = (): void => {
      const session: SessionStats | null = useAppStore.getState().session
      const samples = session?.samples ?? []
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)

      if (samples.length > 1) {
        const max = Math.max(
          1,
          ...samples.map((sample) => Math.max(sample.down, sample.up))
        )
        const step = width / Math.max(1, samples.length - 1)

        const line = (key: 'down' | 'up', color: string): void => {
          context.beginPath()
          samples.forEach((sample, index) => {
            const x = index * step
            const y = height - (sample[key] / max) * (height - 2) - 1
            if (index === 0) context.moveTo(x, y)
            else context.lineTo(x, y)
          })
          context.strokeStyle = color
          context.lineWidth = 1.2
          context.stroke()
        }

        line('down', 'var(--mmz-accent)')
        line('up', 'var(--mmz-ok)')
      }

      frame = window.setTimeout(draw, 1000)
    }

    draw()
    return () => window.clearTimeout(frame)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={18}
      className="rounded border border-border bg-surface-1"
      title="speed graph"
    />
  )
}
