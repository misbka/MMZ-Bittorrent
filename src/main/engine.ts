/**
 * Child-process client for the BitTorrent engine.
 *
 * Speaks the NDJSON protocol defined in engine/bittorrent/protocol.py over
 * stdio: every request carries an id, every push message carries an event
 * name.  Nothing else in the app talks to libtorrent directly.
 */
import { EventEmitter } from 'events'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { EngineHello, EngineStatus } from '@shared/types'
import type { ResolvedPython } from './paths'
import { engineScript } from './paths'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  method: string
}

export interface EngineStartOptions {
  python: ResolvedPython
  dataDir: string
  settingsFile: string
}

export class EngineError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'EngineError'
  }
}

export class EngineClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private pending = new Map<number, Pending>()
  private nextId = 1
  private stderrTail: string[] = []
  private stopping = false

  status: EngineStatus = { state: 'starting' }
  hello: EngineHello | null = null
  pythonSpec = ''

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed
  }

  get diagnostics(): string[] {
    return [...this.stderrTail]
  }

  async start(options: EngineStartOptions): Promise<void> {
    this.stopping = false
    this.pythonSpec = options.python.spec
    const args = [
      ...options.python.args,
      engineScript(),
      '--data-dir',
      options.dataDir,
      '--settings',
      options.settingsFile
    ]
    const child = spawn(options.python.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    })
    this.child = child
    this.buffer = ''
    this.stderrTail = []

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.stderrTail.push(line)
        if (this.stderrTail.length > 100) this.stderrTail.shift()
      }
    })
    child.on('error', (error) => {
      this.setStatus({ state: 'error', message: error.message })
      this.failAllPending(error)
    })
    child.on('exit', (code, signal) => {
      this.child = null
      if (this.stopping) return
      const detail =
        this.stderrTail.slice(-5).join('\n') ||
        `code=${code ?? 'null'} signal=${signal ?? 'none'}`
      this.setStatus({ state: 'error', message: `engine exited: ${detail}` })
      this.failAllPending(new EngineError('engine_exited', detail))
    })

    const hello = (await this.request<EngineHello>('hello', {}, 30000)) as EngineHello
    this.hello = hello
    this.setStatus({ state: 'ready', hello, pythonPath: options.python.spec })
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.onFrame(line)
      index = this.buffer.indexOf('\n')
    }
    // guard against a pathological stream without newlines
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = ''
  }

  private onFrame(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.emit('protocolError', `malformed frame: ${line.slice(0, 120)}`)
      return
    }

    if (typeof message['id'] === 'number') {
      const id = message['id'] as number
      const entry = this.pending.get(id)
      if (!entry) return
      this.pending.delete(id)
      clearTimeout(entry.timer)
      if (message['ok'] === true) {
        entry.resolve(message['result'])
      } else {
        const error = (message['error'] ?? {}) as { code?: string; message?: string }
        entry.reject(
          new EngineError(error.code ?? 'engine_error', error.message ?? 'unknown error')
        )
      }
      return
    }

    if (typeof message['event'] === 'string') {
      const name = message['event'] as string
      const data = message['data']
      if (name === 'tick') {
        this.emit('tick', data)
      } else {
        this.emit('event', { name, data })
      }
    }
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30000
  ): Promise<T> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      return Promise.reject(new EngineError('not_running', 'engine is not running'))
    }
    const id = this.nextId++
    const frame = JSON.stringify({ id, method, params })
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new EngineError('timeout', `${method} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method
      })
      try {
        child.stdin.write(frame + '\n')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new EngineError('write_failed', String(error)))
      }
    })
  }

  /** Fire-and-forget command used for teardown paths. */
  notify(method: string, params: Record<string, unknown> = {}): void {
    const child = this.child
    if (!child || child.exitCode !== null) return
    try {
      child.stdin.write(JSON.stringify({ id: this.nextId++, method, params }) + '\n')
    } catch {
      /* engine is going away */
    }
  }

  async stop(timeoutMs = 8000): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    try {
      this.notify('shutdown')
    } catch {
      /* ignore */
    }
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    if (!exited) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    this.child = null
    this.failAllPending(new EngineError('stopping', 'engine stopped'))
    this.setStatus({ state: 'starting' })
  }

  private setStatus(status: EngineStatus): void {
    this.status = status
    this.emit('status', status)
  }

  private failAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}

/** Persist engine settings to the JSON file the engine reads at startup. */
export function writeEngineSettings(dataDir: string, settings: Record<string, unknown>): string {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, 'settings.json')
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return file
}
