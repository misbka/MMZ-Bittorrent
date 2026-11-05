/** "Add torrent" dialog: URLs (magnet/http) and/or raw .torrent files. */
import { useEffect, useRef, useState } from 'react'
import { FileUp, Link2, X } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { ConfirmDialog } from './ConfirmDialog'

export default function AddTorrentDialog(): React.JSX.Element | null {
  const t = useT()
  const open = useAppStore((s) => s.addDialogOpen)
  const pending = useAppStore((s) => s.pendingAdd)
  const close = useAppStore((s) => s.closeAddDialog)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const categories = useAppStore((s) => s.categories)

  const [urls, setUrls] = useState('')
  const [files, setFiles] = useState<{ name: string; data: string }[]>([])
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [paused, setPaused] = useState(false)
  const [savePath, setSavePath] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    const initialUrls = (pending?.urls ?? []).filter((value) => value.trim())
    setUrls(initialUrls.join('\n'))
    setFiles(pending?.files ?? [])
    setCategory('')
    setTags('')
    setPaused(false)
    setSavePath('')
    setBusy(false)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open, pending])

  if (!open) return null

  const chooseFiles = async (): Promise<void> => {
    const result = await invoke<{ files: { name: string; data: string }[] }>('dialog:openTorrents')
    if (result.files.length > 0) setFiles((current) => [...current, ...result.files])
  }

  const chooseDirectory = async (): Promise<void> => {
    const path = await invoke<string | null>('dialog:chooseDirectory', { title: t('add.savePath') })
    if (path) setSavePath(path)
  }

  const submit = async (): Promise<void> => {
    const urlList = urls
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    if (urlList.length === 0 && files.length === 0) {
      toast('error', t('add.nothing'))
      return
    }

    const payload: Record<string, unknown> = {}
    if (urlList.length > 0) payload['urls'] = urlList
    if (files.length > 0) payload['files'] = files
    if (category.trim()) payload['category'] = category.trim()
    const tagList = tags
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (tagList.length > 0) payload['tags'] = tagList
    payload['paused'] = paused
    if (savePath.trim()) payload['savePath'] = savePath.trim()

    setBusy(true)
    try {
      const result = await invoke<{
        added: { hash: string; name: string; duplicate: boolean }[]
        skipped: { source: string; reason: string }[]
      }>('torrents:add', payload)

      const addedCount = result.added.filter((item) => !item.duplicate).length
      if (addedCount > 0) toast('success', t('add.added', { count: addedCount }))
      if (result.skipped.length > 0) {
        const detail = result.skipped.map((item) => `${item.source}: ${item.reason}`).join('\n')
        const { confirmed } = await ConfirmDialog.confirm({
          title: t('add.skippedTitle'),
          message: detail,
          confirmLabel: t('action.close')
        })
        void confirmed
      }
      close()
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="add-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="animate-mmz-in flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">{t('add.title')}</h2>
          <button
            className="rounded-md p-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
            onClick={close}
            aria-label={t('action.cancel')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-dim">
              <Link2 className="size-3.5" />
              {t('add.urls')}
            </label>
            <textarea
              ref={textareaRef}
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder={'magnet:?xt=urn:btih:…\nhttps://example.com/file.torrent'}
              rows={4}
              className={`${inputClass} resize-none font-mono text-[12px]`}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-ink-faint">{t('add.urlsHint')}</p>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink-dim">{t('add.files')}</label>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-[13px] text-ink-dim transition hover:border-accent hover:text-ink"
              onClick={() => void chooseFiles()}
              data-testid="add-pick-files"
            >
              <FileUp className="size-4" />
              {t('add.pickFiles')}
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="flex-1 truncate text-ink">{file.name}</span>
                    <button
                      className="text-ink-faint transition hover:text-danger"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      aria-label={t('action.remove')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-dim">{t('add.category')}</label>
              <input
                list="mmz-categories"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={t('add.categoryPlaceholder')}
                className={inputClass}
              />
              <datalist id="mmz-categories">
                {categories.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-ink-dim">{t('add.tags')}</label>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t('add.tagsPlaceholder')}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink-dim">{t('add.savePath')}</label>
            <div className="flex gap-2">
              <input
                value={savePath}
                onChange={(event) => setSavePath(event.target.value)}
                placeholder={t('add.savePathDefault')}
                className={inputClass}
              />
              <button
                className="shrink-0 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-ink-dim transition hover:bg-surface-3"
                onClick={() => void chooseDirectory()}
              >
                …
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={paused}
              onChange={(event) => setPaused(event.target.checked)}
              className="size-4 accent-accent"
            />
            {t('add.startPaused')}
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-[13px] text-ink transition hover:bg-surface-3"
            onClick={close}
          >
            {t('action.cancel')}
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="add-submit"
          >
            {busy ? t('add.working') : t('add.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
