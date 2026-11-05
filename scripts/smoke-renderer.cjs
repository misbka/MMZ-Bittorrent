/**
 * Smoke check for the built renderer + preload, without needing the full app.
 *
 * Loads `out/renderer/index.html` in a sandboxed BrowserWindow with the real
 * preload (same webPreferences as src/main/index.ts) and reports:
 *   - preload load errors (e.g. a dependency that must be bundled but is not)
 *   - renderer console errors
 *   - whether React actually mounted (`rootChildren`) and `window.mmz` exists
 *
 * IPC handler errors ("No handler registered for 'mmz:...'") are EXPECTED here:
 * this script deliberately does not register the main-process handlers.
 *
 * Usage:  node scripts/smoke-renderer.cjs   (requires `npm run build` first)
 * Pass criteria: one line `[summary]` with `"mmz":"object"` and
 * `"rootChildren":1` (or more), and no `[preload-error]`.
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
let failures = 0

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) {
      failures += 1
      console.log(`[console:error] ${message} (${source}:${line})`)
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    failures += 1
    console.log(`[did-fail-load] ${code} ${desc}`)
  })
  win.webContents.on('preload-error', (_e, pathName, error) => {
    failures += 1
    console.log(`[preload-error] ${pathName}: ${error.message}`)
  })

  win
    .loadFile(path.join(root, 'out/renderer/index.html'))
    .catch((error) => {
      failures += 1
      console.log('[load] rejected', error.message)
    })

  setTimeout(async () => {
    const summary = await win.webContents.executeJavaScript(
      `JSON.stringify({
        rootChildren: document.getElementById('root')?.childElementCount ?? -1,
        rootText: (document.getElementById('root')?.innerText || '').slice(0, 80),
        mmz: typeof window.mmz,
        mmzKeys: window.mmz ? Object.keys(window.mmz) : null,
        platform: window.mmz ? window.mmz.platform : null
      })`
    )
    console.log('[summary]', summary)

    const parsed = JSON.parse(summary)
    if (parsed.mmz !== 'object') failures += 1
    if (!(parsed.rootChildren > 0)) failures += 1

    console.log(failures === 0 ? '[smoke] PASS' : `[smoke] FAIL (${failures})`)
    app.exit(failures === 0 ? 0 : 1)
  }, 6000)
})
