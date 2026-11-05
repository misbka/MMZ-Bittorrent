/** "Pieces" tab: verified-piece bitmap plus per-piece availability. */
import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { formatBytes } from '../../utils/format'

const CELL = 8
const CELL_GAP = 1
const ROW_HEIGHT = CELL + CELL_GAP

export default function PiecesTab({ hash: _hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const pieces = useAppStore((s) => s.pieces)
  const loading = useAppStore((s) => s.detailLoading)

  const bits = useMemo(() => {
    if (!pieces?.bitmap) return null
    const binary = atob(pieces.bitmap)
    const out: boolean[] = []
    for (let i = 0; i < pieces.pieceCount; i += 1) {
      const byte = binary.charCodeAt(i >> 3)
      out.push((byte & (0x80 >> (i & 7))) !== 0)
    }
    return out
  }, [pieces])

  if (loading && !pieces) return <div className="p-4 text-[13px] text-ink-faint">{t('detail.loading')}</div>
  if (!pieces || !pieces.hasMetadata) {
    return <div className="p-4 text-[13px] text-ink-faint">{t('pieces.noMetadata')}</div>
  }

  const have = pieces.piecesHave ?? 0
  const total = pieces.pieceCount
  const containerWidth = 900
  const perRow = Math.max(1, Math.floor(containerWidth / (CELL + CELL_GAP)))
  const rows = Math.ceil(total / perRow)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-3 py-1.5 text-[12px] text-ink-dim">
        <span>
          {t('pieces.have', { have, total })}
        </span>
        <span>
          {t('pieces.percent', { percent: total > 0 ? ((have / total) * 100).toFixed(1) : '0.0' })}
        </span>
        <span>{t('pieces.pieceLength', { size: formatBytes(pieces.pieceLength ?? 0) })}</span>
        <span>{t('pieces.totalSize', { size: formatBytes(pieces.totalSize ?? 0) })}</span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-faint">
          <span className="size-2.5 rounded-sm bg-accent" /> {t('pieces.haveLegend')}
          <span className="size-2.5 rounded-sm bg-surface-3" /> {t('pieces.missingLegend')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <svg
          width={perRow * (CELL + CELL_GAP)}
          height={rows * ROW_HEIGHT}
          role="img"
          aria-label={t('pieces.ariaLabel')}
          data-testid="pieces-grid"
        >
          {bits?.map((present, index) => {
            const x = (index % perRow) * (CELL + CELL_GAP)
            const y = Math.floor(index / perRow) * ROW_HEIGHT
            const availability = pieces.availability?.[index] ?? 0
            return (
              <rect
                key={index}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={1.5}
                fill={present ? 'var(--mmz-accent)' : 'var(--mmz-surface-3)'}
                opacity={!present && availability > 0 ? 0.55 : 1}
              >
                <title>
                  {t('pieces.cellTitle', {
                    index: index + 1,
                    state: present ? t('pieces.have') : t('pieces.missing'),
                    availability
                  })}
                </title>
              </rect>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
