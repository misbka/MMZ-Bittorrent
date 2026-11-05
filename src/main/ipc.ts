/**
 * IPC surface: every `ipcMain.handle` registration for the app.
 *
 * Rules enforced here:
 *   - only channels declared in the shared contract are registered;
 *   - every payload is parsed by its zod schema before it reaches the core;
 *   - paths handed back to the OS must live inside a known download root.
 */
import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { AppCore } from './core'
import { isInsideAnyRoot } from './reveal-guard'
import { PAYLOAD_SCHEMAS, type IpcChannel } from '@shared/ipc'
import { defaultDownloadDir } from './paths'
import type { Settings } from '@shared/settings'

function assertChannel(channel: string): asserts channel is IpcChannel {
  if (!(channel in PAYLOAD_SCHEMAS) && !NO_PAYLOAD.has(channel as IpcChannel)) {
    throw new Error(`unknown channel: ${channel}`)
  }
}

const NO_PAYLOAD = new Set<IpcChannel>([
  'app:info',
  'app:quit',
  'settings:get',
  'settings:reset',
  'settings:export',
  'settings:import',
  'dialog:chooseDirectory',
  'dialog:openTorrents',
  'history:get',
  'history:clear',
  'categories:list',
  'engine:status',
  'session:stats',
  'log:get'
])

/** Roots a "reveal/open" path may point into. */
function allowedRoots(core: AppCore): string[] {
  const settings = core.getSettings()
  const roots = [
    settings.downloads.savePath,
    settings.downloads.tempPath,
    settings.downloads.moveCompletedPath,
    defaultDownloadDir(),
    app.getPath('downloads'),
    // A torrent can be added to any folder picked in the add dialog, which is
    // not necessarily the configured default — its own destination is a root.
    ...core.torrentSavePaths()
  ].filter((value): value is string => Boolean(value && value.trim()))
  return roots.map((value) => path.resolve(value))
}

function assertRevealable(core: AppCore, target: string): void {
  if (!isInsideAnyRoot(target, allowedRoots(core))) {
    throw new Error('path is outside the allowed download folders')
  }
}

export function registerIpc(core: AppCore): void {
  const handle = <T>(channel: IpcChannel, fn: (payload: unknown) => T | Promise<T>): void => {
    assertChannel(channel)
    ipcMain.handle(`mmz:${channel}`, async (_event, payload) => {
      const schema = PAYLOAD_SCHEMAS[channel]
      const value = schema ? schema.parse(payload) : payload
      try {
        return await fn(value)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message)
      }
    })
  }

  // -- app --------------------------------------------------------------
  handle('app:info', () => core.getInfo(String(process.env['MMZ_PYTHON'] ?? '')))
  handle('app:quit', () => {
    app.quit()
    return true
  })
  handle('app:openPath', (payload) => {
    const target = payload as string
    assertRevealable(core, target)
    // `shell.openPath` executes the default handler for the file type, so only
    // folders are allowed here — the app never launches downloaded files.
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error('openPath only accepts folders')
    }
    return shell.openPath(target)
  })
  handle('app:revealPath', (payload) => {
    const target = payload as string
    assertRevealable(core, target)
    shell.showItemInFolder(target)
    return true
  })

  // -- settings ---------------------------------------------------------
  handle('settings:get', () => core.getSettings())
  handle('settings:update', (payload) => core.updateSettings(payload))
  handle('settings:reset', () => core.resetSettings())
  handle('settings:export', (payload) => {
    const { filePath } = payload as { filePath: string }
    core.exportSettings(filePath)
    return filePath
  })
  handle('settings:import', (payload) => {
    const { filePath } = payload as { filePath: string }
    return core.importSettings(filePath)
  })

  // -- dialogs ----------------------------------------------------------
  handle('dialog:chooseDirectory', async (payload) => {
    const opts = (payload ?? {}) as { title?: string; defaultPath?: string }
    const result = await dialog.showOpenDialog({
      title: opts.title ?? 'Select folder',
      defaultPath: opts.defaultPath || core.getSettings().downloads.savePath || defaultDownloadDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('dialog:openTorrents', async (payload) => {
    const opts = (payload ?? {}) as { defaultPath?: string }
    const result = await dialog.showOpenDialog({
      title: 'Add torrents',
      defaultPath: opts.defaultPath || core.getSettings().downloads.savePath || defaultDownloadDir(),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'BitTorrent files', extensions: ['torrent'] }]
    })
    if (result.canceled) return []
    const files: { name: string; data: string }[] = []
    const skipped: { source: string; reason: string }[] = []
    for (const filePath of result.filePaths) {
      try {
        const stat = fs.statSync(filePath)
        if (stat.size > 32 * 1024 * 1024) {
          skipped.push({ source: filePath, reason: 'torrent too large' })
          continue
        }
        files.push({ name: path.basename(filePath), data: fs.readFileSync(filePath).toString('base64') })
      } catch (error) {
        skipped.push({ source: filePath, reason: String(error) })
      }
    }
    return { files, skipped }
  })

  // -- torrents ---------------------------------------------------------
  handle('torrents:add', (payload) => core.addTorrents(payload as never))
  handle('torrents:command', async (payload) => {
    const { action, hashes } = payload as { action: never; hashes: string[] }
    await core.command(action, hashes)
    return true
  })
  handle('torrents:remove', async (payload) => {
    const { hashes, deleteFiles } = payload as { hashes: string[]; deleteFiles: boolean }
    await core.remove(hashes, deleteFiles)
    return true
  })
  handle('torrents:files', (payload) => core.files((payload as { hash: string }).hash))
  handle('torrents:peers', (payload) => core.peers((payload as { hash: string }).hash))
  handle('torrents:trackers', (payload) => core.trackers((payload as { hash: string }).hash))
  handle('torrents:pieces', (payload) => core.pieces((payload as { hash: string }).hash))
  handle('torrents:priorities', (payload) => {
    const { hash, priorities } = payload as { hash: string; priorities: number[] }
    return core.setPriorities(hash, priorities)
  })
  handle('torrents:options', (payload) => core.setOptions(payload as never))
  handle('torrents:setTrackers', (payload) => {
    const { hash, trackers } = payload as { hash: string; trackers: string[] }
    return core.setTrackers(hash, trackers)
  })
  handle('torrents:meta', (payload) => core.setMeta(payload as never))

  // -- queries ----------------------------------------------------------
  handle('session:stats', () => core.getStats())
  handle('log:get', (payload) => {
    const { since, limit, hash } = (payload ?? {}) as {
      since?: number
      limit?: number
      hash?: string
    }
    return core.getLog(since ?? 0, limit ?? 500, hash)
  })
  handle('history:get', () => core.getHistory())
  handle('history:clear', () => {
    core.clearHistory()
    return true
  })
  handle('categories:list', () => core.categories())
  handle('engine:status', () => core.engineStatus)

  // Fallback guard: refuse anything registered outside this file.
  const existing = ipcMain.eventNames().map(String)
  for (const name of existing) {
    if (!name.startsWith('mmz:')) continue
    const channel = name.slice(4) as IpcChannel
    if (!(NO_PAYLOAD.has(channel) || channel in PAYLOAD_SCHEMAS)) {
      throw new Error(`unvalidated channel registered: ${name}`)
    }
  }
}

/** Renderer-facing error shape (electron wraps thrown errors). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export type { BrowserWindow, Settings }
