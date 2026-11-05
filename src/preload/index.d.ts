import type { MmzBridge } from '@shared/ipc'

declare global {
  interface Window {
    mmz: MmzBridge & {
      /** Absolute path for a dragged/selected File (Electron webUtils). */
      pathForFile(file: File): string
    }
  }
}

export {}
