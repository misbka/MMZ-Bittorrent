/**
 * Preload bridge: the only thing the renderer can reach.
 *
 * Exposes `window.mmz` with an allow-listed `invoke` and an event
 * subscription.  `contextIsolation` stays on and the renderer has no Node
 * access, so a compromised renderer can only ask for validated operations.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { EVENT_CHANNEL, IPC_CHANNELS, type IpcChannel, type MmzBridge, type RendererEventCallback } from '@shared/ipc'
import type { MainToRendererEvent } from '@shared/types'

const channels = new Set<string>(IPC_CHANNELS)

const bridge: MmzBridge = {
  invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
    if (!channels.has(channel)) {
      return Promise.reject(new Error(`channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(`mmz:${channel}`, payload) as Promise<T>
  },

  onEvent(callback: RendererEventCallback): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: MainToRendererEvent): void => {
      callback(message)
    }
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener)
  },

  platform: process.platform
}

/** Absolute path of a dropped/selected File (used for .torrent drag & drop). */
Object.defineProperty(bridge, 'pathForFile', {
  value: (file: File): string => webUtils.getPathForFile(file),
  enumerable: false
})

contextBridge.exposeInMainWorld('mmz', bridge)
