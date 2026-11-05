/**
 * Electron main entry point: window lifecycle, tray, engine boot and IPC.
 */
import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { AppCore } from './core'
import { registerIpc } from './ipc'
import { destroyTray, createTray } from './tray'
import { engineDataDir, resolvePython } from './paths'
import type { Settings } from '@shared/settings'

let core: AppCore | null = null
let mainWindow: BrowserWindow | null = null
let quitting = false

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.js')
}

async function createWindow(): Promise<void> {
  const settings = core?.getSettings()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f7fa',
    title: 'MMZ Torrent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  core?.addWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (event) => {
    if (quitting) return
    const s: Settings | undefined = core?.getSettings()
    if (s?.general.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Devtools on F12 is handled by the renderer; keep the menu minimal.
  if (settings?.general.startWithSystem) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath })
  } else {
    app.setLoginItemSettings({ openAtLogin: false })
  }
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

async function boot(): Promise<void> {
  const dataDir = path.join(app.getPath('userData'), 'data')
  core = new AppCore(dataDir)
  registerIpc(core)

  const settings = core.getSettings()
  const python = await resolvePython(settings.advanced.enginePython)
  if (!python) {
    // The renderer shows setup guidance when engine.state === 'error'.
    core.engineStatus = {
      state: 'error',
      message:
        'No Python interpreter with libtorrent was found. Install libtorrent ' +
        '(pip install libtorrent) or set the interpreter path in Settings > Advanced.'
    }
  } else {
    try {
      await core.start(python)
    } catch (error) {
      core.engineStatus = { state: 'error', message: String(error) }
    }
  }

  await createWindow()

  createTray(core, {
    toggleWindow,
    isVisible: () => mainWindow?.isVisible() ?? false,
    quit: () => app.quit()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  Menu.setApplicationMenu(null)

  void app.whenReady().then(async () => {
    await boot()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
      else mainWindow?.show()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('quit', () => {
    destroyTray()
    const shutdown = core?.stop()
    core = null
    void shutdown
  })
}

export { engineDataDir }
