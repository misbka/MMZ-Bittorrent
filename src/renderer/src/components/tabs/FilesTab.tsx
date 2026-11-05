/** "Files" tab: per-file progress, size and priority editing. */
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { formatBytes, formatPercent } from '../../utils/format'
import type { EngineFile } from '@shared/types'

const PRIORITY_LABELS = ['skip', 'low', 'low', 'low', 'normal', 'high', 'high', 'high']

export default function FilesTab({ hash }: { hash: string }): React.JSX.Element {
  const t = useT()
  const files = useAppStore((s) => s.files)
  const loading = useAppStore((s) => s.detailLoading)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (hash) void useAppStore.getState().refreshDetail(hash)
  }, [hash])

  const setPriority = async (file: EngineFile, priority: number): Promise<void> => {
    setPending(true)
    try {
      const priorities = files.map((entry) => (entry.index === file.index ? priority : entry.priority))
      await invoke('torrents:priorities', { hash, priorities })
      await useAppStore.getState().refreshDetail(hash)
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    } finally {
      setPending(false)
    }
  }

  const selectFiles = async (indexes: number[], download: boolean): Promise<void> => {
    setPending(true)
    try {
      const priorities = files.map((entry) =>
        indexes.includes(entry.index) ? (download ? 4 : 0) : entry.priority
      )
      await invoke('torrents:priorities', { hash, priorities })
      await useAppStore.getState().refreshDetail(hash)
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    } finally {
      setPending(false)
    }
  }

  if (loading && files.length === 0) {
    return <div className="p-4 text-[13px] text-ink-faint">{t('detail.loading')}</div>
  }
  if (files.length === 0) {
    return <div className="p-4 text-[13px] text-ink-faint">{t('files.noMetadata')}</div>
  }

  const allIndexes = files.filter((file) => !file.pad).map((file) => file.index)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <button
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-ink-dim transition hover:bg-surface-3 disabled:opacity-50"
          disabled={pending}
          onClick={() => void selectFiles(allIndexes, true)}
        >
          {t('files.downloadAll')}
        </button>
        <button
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-ink-dim transition hover:bg-surface-3 disabled:opacity-50"
          disabled={pending}
          onClick={() => void selectFiles([], false)}
        >
          {t('files.downloadNone')}
        </button>
        <span className="ml-auto text-[11px] text-ink-faint">
          {t('files.count', { count: files.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">{t('files.name')}</th>
              <th className="w-24 px-3 py-1.5 text-right font-semibold">{t('files.size')}</th>
              <th className="w-24 px-3 py-1.5 text-right font-semibold">{t('files.done')}</th>
              <th className="w-40 px-3 py-1.5 text-left font-semibold">{t('files.progress')}</th>
              <th className="w-28 px-3 py-1.5 text-left font-semibold">{t('files.priority')}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.index} className="border-b border-border/60 hover:bg-surface-2">
                <td className="max-w-[420px] truncate px-3 py-1.5 text-ink" title={file.path}>
                  {file.path}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
                  {formatBytes(file.size)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-dim">
                  {formatBytes(file.downloaded)}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full ${file.progress >= 1 ? 'bg-ok' : 'bg-accent'}`}
                        style={{ width: `${Math.round(file.progress * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums text-[11px] text-ink-faint">
                      {formatPercent(file.progress)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={file.priority}
                    disabled={pending || file.pad}
                    onChange={(event) => void setPriority(file, Number(event.target.value))}
                    className="w-full rounded-md border border-border bg-surface-1 px-1.5 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
                    aria-label={t('files.priority')}
                  >
                    {[0, 1, 4, 7].map((priority) => (
                      <option key={priority} value={priority}>
                        {t(`files.prio.${PRIORITY_LABELS[priority]}`)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
