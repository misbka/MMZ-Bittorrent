import { Notification, app } from 'electron'

function show(title: string, body: string): void {
  if (!app.isReady() || !Notification.isSupported()) return
  try {
    const n = new Notification({ title, body })
    n.show()
  } catch {
    /* notifications are best effort */
  }
}

/** Notification fired when a download completes. */
export function notifyFinished(name: string): void {
  show('MMZ Torrent', `Download finished: ${name}`)
}

/** Notification fired when the engine or a torrent reports an error. */
export function notifyError(message: string): void {
  show('MMZ Torrent — error', message)
}
