/**
 * Path helpers and BitTorrent engine runtime discovery.
 *
 * The engine is a Python process (libtorrent bindings).  At runtime we look
 * for a usable interpreter in this order:
 *
 *   1. bundled runtime (packaged app: resources/engine/runtime)
 *   2. user configured path (settings.advanced.enginePython, e.g. "py -3.10")
 *   3. MMZ_PYTHON environment variable
 *   4. probing the common interpreters for an importable ``libtorrent``
 */
import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface PythonCandidate {
  command: string
  args: string[]
}

/** Repository / resources root that contains engine/run.py */
export function engineDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'engine')
  }
  return path.join(app.getAppPath(), 'engine')
}

export function engineScript(): string {
  return path.join(engineDir(), 'run.py')
}

export function engineDataDir(): string {
  return path.join(app.getPath('userData'), 'engine')
}

export function parsePythonSpec(spec: string): PythonCandidate | null {
  const parts = spec.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  return { command: parts[0], args: parts.slice(1) }
}

function bundledRuntime(): PythonCandidate | null {
  const base = path.join(engineDir(), 'runtime')
  const win = path.join(base, 'python.exe')
  const unix = path.join(base, 'bin', 'python3')
  if (process.platform === 'win32' && fs.existsSync(win)) {
    return { command: win, args: [] }
  }
  if (process.platform !== 'win32' && fs.existsSync(unix)) {
    return { command: unix, args: [] }
  }
  return null
}

function probe(candidate: PythonCandidate, timeout = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        candidate.command,
        [...candidate.args, '-c', 'import libtorrent'],
        { timeout, windowsHide: true },
        (error) => resolve(!error)
      )
      child.on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

export function defaultCandidates(configured: string): PythonCandidate[] {
  const list: PythonCandidate[] = []
  const configuredSpec = parsePythonSpec(configured)
  if (configuredSpec) list.push(configuredSpec)

  const envSpec = parsePythonSpec(process.env['MMZ_PYTHON'] ?? '')
  if (envSpec) list.push(envSpec)

  list.push({ command: 'python3', args: [] })
  list.push({ command: 'python', args: [] })
  for (const version of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
    list.push({ command: 'py', args: [`-${version}`] })
  }

  const seen = new Set<string>()
  return list.filter((candidate) => {
    const key = `${candidate.command} ${candidate.args.join(' ')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface ResolvedPython extends PythonCandidate {
  spec: string
}

/**
 * Resolve a Python interpreter that can import libtorrent.
 * Returns null when none is available (the UI then shows setup guidance).
 */
export async function resolvePython(configured: string): Promise<ResolvedPython | null> {
  const bundled = bundledRuntime()
  if (bundled && (await probe(bundled))) {
    return { ...bundled, spec: stringifyPython(bundled) }
  }
  for (const candidate of defaultCandidates(configured)) {
    if (await probe(candidate)) {
      return { ...candidate, spec: stringifyPython(candidate) }
    }
  }
  return null
}

export function stringifyPython(candidate: PythonCandidate): string {
  return [candidate.command, ...candidate.args].join(' ')
}

export function defaultDownloadDir(): string {
  const downloads = app.getPath('downloads')
  return path.join(downloads, 'MMZ Torrent')
}
