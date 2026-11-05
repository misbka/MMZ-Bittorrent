/**
 * System tray: icon, context menu and the show/hide + pause/resume/quit
 * actions required by the spec.
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppCore } from './core'

let tray: Tray | null = null

function iconPath(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icons', 'tray.png'),
    path.join(app.getAppPath(), 'resources', 'icons', 'tray.png'),
    path.join(app.getAppPath(), 'out', 'renderer', 'icon.png')
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return ''
}

export interface TrayCallbacks {
  toggleWindow: () => void
  isVisible: () => boolean
  quit: () => void
}

export function createTray(core: AppCore, callbacks: TrayCallbacks): Tray | null {
  if (tray) return tray

  const file = iconPath()
  let image = nativeImage.createEmpty()
  if (file) image = nativeImage.createFromPath(file)
  if (process.platform === 'linux') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('MMZ Torrent')

  const rebuild = (): void => {
    if (!tray) return
    const menu = Menu.buildFromTemplate([
      {
        label: callbacks.isVisible() ? 'Hide window' : 'Show window',
        click: () => callbacks.toggleWindow()
      },
      { type: 'separator' },
      {
        label: 'Pause all',
        click: () => {
          const hashes = core.hashes()
          if (hashes.length) void core.command('pause', hashes)
        }
      },
      {
        label: 'Resume all',
        click: () => {
          const hashes = core.hashes()
          if (hashes.length) void core.command('resume', hashes)
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => callbacks.quit() }
    ])
    tray.setContextMenu(menu)
  }

  tray.on('double-click', () => callbacks.toggleWindow())
  rebuild()

  // keep the labels in sync with the window state
  const timer = setInterval(() => {
    if (!tray) {
      clearInterval(timer)
      return
    }
    rebuild()
  }, 4000)

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
