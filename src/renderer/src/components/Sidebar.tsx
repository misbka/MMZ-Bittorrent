/** Left navigation: status filters + user categories. */
import {
  AlertTriangle,
  CheckCircle2,
  Folder,
  LayoutList,
  PauseCircle,
  Play,
  Sprout
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore, matchesFilter, type SidebarFilter } from '../store'
import { useT } from '../i18n'

const BASE_FILTERS: { id: Exclude<SidebarFilter, 'category'>; labelKey: string; icon: React.JSX.Element }[] = [
  { id: 'all', labelKey: 'sidebar.all', icon: <LayoutList className="size-4" /> },
  { id: 'downloading', labelKey: 'sidebar.downloading', icon: <Play className="size-4" /> },
  { id: 'seeding', labelKey: 'sidebar.seeding', icon: <Sprout className="size-4" /> },
  { id: 'finished', labelKey: 'sidebar.finished', icon: <CheckCircle2 className="size-4" /> },
  { id: 'paused', labelKey: 'sidebar.paused', icon: <PauseCircle className="size-4" /> },
  { id: 'error', labelKey: 'sidebar.errors', icon: <AlertTriangle className="size-4" /> }
]

export default function Sidebar(): React.JSX.Element {
  const t = useT()
  const torrents = useAppStore((s) => s.torrents)
  const categories = useAppStore((s) => s.categories)
  const filter = useAppStore((s) => s.filter)
  const filterValue = useAppStore((s) => s.filterValue)
  const setFilter = useAppStore((s) => s.setFilter)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const [newCategory, setNewCategory] = useState('')

  // keep the category list fresh after torrents are added/removed
  useEffect(() => {
    const timer = setInterval(() => {
      void invoke<string[]>('categories:list')
        .then((list) => {
          const current = useAppStore.getState().categories
          if (list.join(' ') !== current.join(' ')) useAppStore.setState({ categories: list })
        })
        .catch(() => undefined)
    }, 5000)
    return () => clearInterval(timer)
  }, [invoke])

  const countFor = (id: SidebarFilter): number =>
    id === 'category'
      ? torrents.filter((torrent) => torrent.category === filterValue).length
      : torrents.filter((torrent) => matchesFilter(torrent, id, '')).length

  const assignCategory = async (): Promise<void> => {
    const name = newCategory.trim()
    if (!name) return
    const hash = useAppStore.getState().selected[0]
    if (!hash) {
      toast('info', t('sidebar.selectTorrentForCategory'))
      return
    }
    try {
      await invoke('torrents:meta', { hash, category: name })
      setNewCategory('')
      useAppStore.setState({ categories: [...new Set([...categories, name])] })
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    }
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 p-3">
      <nav className="flex flex-col gap-0.5">
        {BASE_FILTERS.map((entry) => {
          const active = filter === entry.id
          const count = countFor(entry.id)
          return (
            <button
              key={entry.id}
              data-testid={`filter-${entry.id}`}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                active ? 'bg-accent text-white shadow-sm' : 'text-ink-dim hover:bg-surface-2 hover:text-ink'
              }`}
              onClick={() => setFilter(entry.id)}
            >
              {entry.icon}
              <span className="flex-1 truncate">{t(entry.labelKey)}</span>
              <span className={`text-[11px] ${active ? 'text-white/80' : 'text-ink-faint'}`}>{count}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-4 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t('sidebar.categories')}
        </span>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {categories.length === 0 && (
          <span className="px-3 py-1 text-[12px] text-ink-faint">{t('sidebar.noCategories')}</span>
        )}
        {categories.map((category) => {
          const active = filter === 'category' && filterValue === category
          const count = torrents.filter((torrent) => torrent.category === category).length
          return (
            <button
              key={category}
              data-testid={`filter-category-${category}`}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition ${
                active ? 'bg-accent-soft text-accent' : 'text-ink-dim hover:bg-surface-2 hover:text-ink'
              }`}
              onClick={() => setFilter('category', category)}
            >
              <Folder className="size-4" />
              <span className="flex-1 truncate">{category}</span>
              <span className="text-[11px] text-ink-faint">{count}</span>
            </button>
          )
        })}
      </nav>

      <form
        className="mt-2 flex gap-1 px-2"
        onSubmit={(event) => {
          event.preventDefault()
          void assignCategory()
        }}
        title={t('sidebar.assignCategory')}
      >
        <input
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value)}
          placeholder={t('sidebar.newCategory')}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md border border-border bg-surface-2 px-2 text-[12px] text-ink-dim transition hover:bg-surface-3"
        >
          +
        </button>
      </form>
    </aside>
  )
}
