/**
 * Promise-based confirm dialog.
 *
 * Components call `ConfirmDialog.confirm({...})` and render
 * `<ConfirmDialog.Renderer />` once near the app root.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useT } from '../../i18n'
import { X } from 'lucide-react'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** optional extra checkbox value returned as the second tuple element */
  extra?: string
  extraLabel?: string
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: { confirmed: boolean; extra: boolean }) => void
}

let pending: PendingConfirm | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PendingConfirm | null {
  return pending
}

export const ConfirmDialog = {
  confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; extra: boolean }> {
    return new Promise((resolve) => {
      pending = { options, resolve }
      emit()
    })
  },

  Renderer(): React.JSX.Element | null {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    if (!state) return null
    return <ConfirmView key={state.options.title + state.options.message} state={state} />
  }
}

function ConfirmView({ state }: { state: PendingConfirm }): React.JSX.Element {
  const t = useT()
  const { options } = state
  const [checked, setChecked] = useState(false)

  const close = (confirmed: boolean): void => {
    state.resolve({ confirmed, extra: checked })
    pending = null
    emit()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(false)
      if (event.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="confirm-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(false)
      }}
    >
      <div className="animate-mmz-in w-full max-w-md rounded-xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">{options.title}</h2>
          <button
            className="rounded-md p-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
            onClick={() => close(false)}
            aria-label={t('action.cancel')}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-dim">{options.message}</p>
          {options.extra && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                className="size-4 accent-accent"
              />
              {options.extraLabel ?? t('dialog.deleteFiles')}
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            className="rounded-lg border border-border bg-surface-2 px-3.5 py-1.5 text-[13px] text-ink transition hover:bg-surface-3"
            onClick={() => close(false)}
          >
            {options.cancelLabel ?? t('action.cancel')}
          </button>
          <button
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white transition ${
              options.danger ? 'bg-danger hover:opacity-90' : 'bg-accent hover:opacity-90'
            }`}
            onClick={() => close(true)}
            data-testid="confirm-accept"
          >
            {options.confirmLabel ?? t('action.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
