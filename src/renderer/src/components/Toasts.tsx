/** Toast notifications (finish / error / feedback). */
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useAppStore } from '../store'

export default function Toasts(): React.JSX.Element {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)

  if (toasts.length === 0) return <></>

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-mmz-in pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] shadow-lg ${
            toast.kind === 'error'
              ? 'border-danger/40 bg-surface-1 text-danger'
              : toast.kind === 'success'
                ? 'border-ok/40 bg-surface-1 text-ink'
                : 'border-border bg-surface-1 text-ink'
          }`}
          role="status"
        >
          {toast.kind === 'error' ? (
            <XCircle className="mt-0.5 size-4 shrink-0" />
          ) : toast.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          )}
          <span className="flex-1 break-words">{toast.message}</span>
          <button
            className="rounded p-0.5 text-ink-faint transition hover:text-ink"
            onClick={() => dismiss(toast.id)}
            aria-label="close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
