/** Empty state shown when the list has no rows (first-run guidance). */
import { FilePlus2, Magnet } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'

export default function EmptyState({ noTorrents }: { noTorrents: boolean }): React.JSX.Element {
  const t = useT()
  const openAddDialog = useAppStore((s) => s.openAddDialog)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {noTorrents ? <FilePlus2 className="size-8" /> : <SearchIcon />}
      </div>
      <div>
        <h2 className="text-base font-semibold text-ink">
          {noTorrents ? t('empty.title') : t('empty.noMatch')}
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-dim">
          {noTorrents ? t('empty.body') : t('empty.noMatchBody')}
        </p>
      </div>
      {noTorrents && (
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
            onClick={() => openAddDialog()}
          >
            <FilePlus2 className="size-4" />
            {t('toolbar.add')}
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-4 py-2 text-[13px] text-ink transition hover:bg-surface-2"
            onClick={() => openAddDialog({ urls: [''], files: [] })}
          >
            <Magnet className="size-4" />
            {t('toolbar.addMagnet')}
          </button>
        </div>
      )}
      <p className="mt-2 text-[12px] text-ink-faint">{t('empty.hint')}</p>
    </div>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}
