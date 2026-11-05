/**
 * Settings centre: 7 categories backed by the zod-validated settings schema.
 * Every control writes through `settings:update`, which the main process
 * validates before persisting and forwarding to the engine.
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT, LANGUAGES } from '../../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import type { Settings } from '@shared/settings'

type SectionId = 'general' | 'downloads' | 'connection' | 'speed' | 'bittorrent' | 'interface' | 'advanced'

const SECTIONS: { id: SectionId; key: string }[] = [
  { id: 'general', key: 'settings.general' },
  { id: 'downloads', key: 'settings.downloads' },
  { id: 'connection', key: 'settings.connection' },
  { id: 'speed', key: 'settings.speed' },
  { id: 'bittorrent', key: 'settings.bittorrent' },
  { id: 'interface', key: 'settings.interface' },
  { id: 'advanced', key: 'settings.advanced' }
]

/** Deep-merge helper for settings patches. */
function patch<K extends keyof Settings>(section: K, values: Partial<Settings[K]>): Record<string, unknown> {
  return { [section]: values }
}

export default function SettingsDialog(): React.JSX.Element | null {
  const t = useT()
  const open = useAppStore((s) => s.settingsDialogOpen)
  const close = useAppStore((s) => s.closeSettingsDialog)
  const settings = useAppStore((s) => s.settings)
  const invoke = useAppStore((s) => s.invoke)
  const toast = useAppStore((s) => s.toast)
  const [section, setSection] = useState<SectionId>('general')
  const [draft, setDraft] = useState<Settings | null>(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  if (!open || !draft) return null

  const save = async (next: Settings): Promise<void> => {
    try {
      const saved = await invoke<Settings>('settings:update', next)
      useAppStore.getState().setSettings(saved)
      setDraft(saved)
      toast('success', t('settings.saved'))
    } catch (error) {
      toast('error', String(error instanceof Error ? error.message : error))
    }
  }

  const update = (values: Record<string, unknown>): void => {
    const merged: Settings = {
      ...draft,
      ...values,
      ...Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { ...(draft as unknown as Record<string, Record<string, unknown>>)[key], ...(value as object) }
        ])
      )
    } as Settings
    setDraft(merged)
    void save(merged)
  }

  const chooseDirectory = async (field: 'savePath' | 'tempPath' | 'moveCompletedPath'): Promise<void> => {
    const path = await invoke<string | null>('dialog:chooseDirectory', { defaultPath: draft.downloads[field] })
    if (path) update(patch('downloads', { [field]: path }))
  }

  const exportSettings = async (): Promise<void> => {
    const path = await invoke<string | null>('dialog:chooseDirectory', { title: t('settings.exportTitle') })
    if (!path) return
    const file = `${path.replace(/[\\/]+$/, '')}/mmz-settings.json`
    try {
      await invoke('settings:export', { filePath: file })
      toast('success', t('settings.exported', { path: file }))
    } catch (error) {
      toast('error', String(error))
    }
  }

  const importSettings = async (): Promise<void> => {
    const path = await invoke<string | null>('dialog:chooseDirectory', { title: t('settings.importTitle') })
    if (!path) return
    const file = `${path.replace(/[\\/]+$/, '')}/mmz-settings.json`
    try {
      const imported = await invoke<Settings>('settings:import', { filePath: file })
      useAppStore.getState().setSettings(imported)
      setDraft(imported)
      toast('success', t('settings.imported'))
    } catch (error) {
      toast('error', String(error))
    }
  }

  const reset = async (): Promise<void> => {
    const { confirmed } = await ConfirmDialog.confirm({
      title: t('settings.resetTitle'),
      message: t('settings.resetMessage'),
      confirmLabel: t('action.confirm'),
      danger: true
    })
    if (!confirmed) return
    try {
      const fresh = await invoke<Settings>('settings:reset')
      useAppStore.getState().setSettings(fresh)
      setDraft(fresh)
      toast('success', t('settings.resetDone'))
    } catch (error) {
      toast('error', String(error))
    }
  }

  const row = 'flex items-center justify-between gap-4 py-2 text-[13px]'
  const label = 'text-ink-dim'
  const toggle = (checked: boolean, onChange: (value: boolean) => void): React.JSX.Element => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="size-4 accent-accent"
    />
  )
  const textInput =
    'w-56 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent'
  const numberInput = `${textInput} tabular-nums`
  const selectInput = `${textInput}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="settings-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="animate-mmz-in flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl">
        <nav className="w-52 shrink-0 border-r border-border bg-surface-2 p-2">
          <h2 className="px-2 pb-2 pt-1 text-sm font-semibold">{t('settings.title')}</h2>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              data-testid={`settings-${entry.id}`}
              className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition ${
                section === entry.id ? 'bg-accent text-white' : 'text-ink-dim hover:bg-surface-3 hover:text-ink'
              }`}
              onClick={() => setSection(entry.id)}
            >
              {t(entry.key)}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 className="text-sm font-semibold">{t(`settings.${section}`)}</h3>
            <button
              className="rounded-md p-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
              onClick={close}
              aria-label={t('action.close')}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {section === 'general' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.language')}</span>
                  <select
                    value={draft.general.language}
                    onChange={(event) =>
                      update(patch('general', { language: event.target.value as Settings['general']['language'] }))
                    }
                    className={selectInput}
                    data-testid="settings-language"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.theme')}</span>
                  <select
                    value={draft.general.theme}
                    onChange={(event) =>
                      update(patch('general', { theme: event.target.value as Settings['general']['theme'] }))
                    }
                    className={selectInput}
                    data-testid="settings-theme"
                  >
                    <option value="system">{t('theme.system')}</option>
                    <option value="light">{t('theme.light')}</option>
                    <option value="dark">{t('theme.dark')}</option>
                  </select>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.startWithSystem')}</span>
                  {toggle(draft.general.startWithSystem, (value) =>
                    update(patch('general', { startWithSystem: value }))
                  )}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.minimizeToTray')}</span>
                  {toggle(draft.general.minimizeToTray, (value) =>
                    update(patch('general', { minimizeToTray: value }))
                  )}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.closeToTray')}</span>
                  {toggle(draft.general.closeToTray, (value) => update(patch('general', { closeToTray: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.confirmRemove')}</span>
                  {toggle(draft.general.confirmRemove, (value) => update(patch('general', { confirmRemove: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.notifications')}</span>
                  {toggle(draft.general.notifications, (value) => update(patch('general', { notifications: value })))}
                </div>
              </div>
            )}

            {section === 'downloads' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.savePath')}</span>
                  <div className="flex gap-2">
                    <input
                      value={draft.downloads.savePath}
                      onChange={(event) => update(patch('downloads', { savePath: event.target.value }))}
                      className={textInput}
                    />
                    <button
                      className="rounded-md border border-border bg-surface-2 px-2 text-[12px]"
                      onClick={() => void chooseDirectory('savePath')}
                    >
                      …
                    </button>
                  </div>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.tempPath')}</span>
                  <div className="flex gap-2">
                    <input
                      value={draft.downloads.tempPath}
                      onChange={(event) => update(patch('downloads', { tempPath: event.target.value }))}
                      className={textInput}
                      placeholder={t('settings.tempPathHint')}
                    />
                    <button
                      className="rounded-md border border-border bg-surface-2 px-2 text-[12px]"
                      onClick={() => void chooseDirectory('tempPath')}
                    >
                      …
                    </button>
                  </div>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.maxDownloads')}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.downloads.maxConcurrentDownloads}
                    onChange={(event) =>
                      update(patch('downloads', { maxConcurrentDownloads: Number(event.target.value) }))
                    }
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.maxUploads')}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.downloads.maxConcurrentUploads}
                    onChange={(event) =>
                      update(patch('downloads', { maxConcurrentUploads: Number(event.target.value) }))
                    }
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.maxTorrents')}</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={draft.downloads.maxConcurrentTorrents}
                    onChange={(event) =>
                      update(patch('downloads', { maxConcurrentTorrents: Number(event.target.value) }))
                    }
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.autoStart')}</span>
                  {toggle(draft.downloads.autoStart, (value) => update(patch('downloads', { autoStart: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.autoVerify')}</span>
                  {toggle(draft.downloads.autoVerify, (value) => update(patch('downloads', { autoVerify: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.createSubfolders')}</span>
                  {toggle(draft.downloads.createSubfolders, (value) =>
                    update(patch('downloads', { createSubfolders: value }))
                  )}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.moveCompleted')}</span>
                  <div className="flex items-center gap-2">
                    {toggle(draft.downloads.moveCompleted, (value) =>
                      update(patch('downloads', { moveCompleted: value }))
                    )}
                    <input
                      value={draft.downloads.moveCompletedPath}
                      onChange={(event) => update(patch('downloads', { moveCompletedPath: event.target.value }))}
                      className={textInput}
                      placeholder={t('settings.moveCompletedPath')}
                      disabled={!draft.downloads.moveCompleted}
                    />
                    <button
                      className="rounded-md border border-border bg-surface-2 px-2 text-[12px]"
                      onClick={() => void chooseDirectory('moveCompletedPath')}
                    >
                      …
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'connection' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.listenPort')}</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.connection.listenPort}
                    onChange={(event) => update(patch('connection', { listenPort: Number(event.target.value) }))}
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>UPnP</span>
                  {toggle(draft.connection.upnp, (value) => update(patch('connection', { upnp: value })))}
                </div>
                <div className={row}>
                  <span className={label}>NAT-PMP</span>
                  {toggle(draft.connection.natpmp, (value) => update(patch('connection', { natpmp: value })))}
                </div>
                <div className={row}>
                  <span className={label}>IPv4</span>
                  {toggle(draft.connection.ipv4, (value) => update(patch('connection', { ipv4: value })))}
                </div>
                <div className={row}>
                  <span className={label}>IPv6</span>
                  {toggle(draft.connection.ipv6, (value) => update(patch('connection', { ipv6: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.maxConnections')}</span>
                  <input
                    type="number"
                    min={10}
                    max={10000}
                    value={draft.connection.maxConnections}
                    onChange={(event) => update(patch('connection', { maxConnections: Number(event.target.value) }))}
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.maxConnectionsPerTorrent')}</span>
                  <input
                    type="number"
                    min={2}
                    max={1000}
                    value={draft.connection.maxConnectionsPerTorrent}
                    onChange={(event) =>
                      update(patch('connection', { maxConnectionsPerTorrent: Number(event.target.value) }))
                    }
                    className={numberInput}
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.proxyType')}</span>
                  <select
                    value={draft.connection.proxy.type}
                    onChange={(event) =>
                      update(patch('connection', { proxy: { ...draft.connection.proxy, type: event.target.value as Settings['connection']['proxy']['type'] } }))
                    }
                    className={selectInput}
                  >
                    <option value="none">{t('proxy.none')}</option>
                    <option value="http">HTTP</option>
                    <option value="socks5">SOCKS5</option>
                    <option value="socks4">SOCKS4</option>
                    <option value="http_with_auth">HTTP + auth</option>
                  </select>
                </div>
                {draft.connection.proxy.type !== 'none' && (
                  <>
                    <div className={row}>
                      <span className={label}>{t('settings.proxyHost')}</span>
                      <input
                        value={draft.connection.proxy.host}
                        onChange={(event) =>
                          update(patch('connection', { proxy: { ...draft.connection.proxy, host: event.target.value } }))
                        }
                        className={textInput}
                      />
                    </div>
                    <div className={row}>
                      <span className={label}>{t('settings.proxyPort')}</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={draft.connection.proxy.port}
                        onChange={(event) =>
                          update(patch('connection', { proxy: { ...draft.connection.proxy, port: Number(event.target.value) } }))
                        }
                        className={numberInput}
                      />
                    </div>
                    <div className={row}>
                      <span className={label}>{t('settings.proxyUser')}</span>
                      <input
                        value={draft.connection.proxy.username}
                        onChange={(event) =>
                          update(patch('connection', { proxy: { ...draft.connection.proxy, username: event.target.value } }))
                        }
                        className={textInput}
                      />
                    </div>
                    <div className={row}>
                      <span className={label}>{t('settings.proxyPassword')}</span>
                      <input
                        type="password"
                        value={draft.connection.proxy.password}
                        onChange={(event) =>
                          update(patch('connection', { proxy: { ...draft.connection.proxy, password: event.target.value } }))
                        }
                        className={textInput}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {section === 'speed' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.globalDown')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={draft.speed.downloadLimit}
                      onChange={(event) => update(patch('speed', { downloadLimit: Number(event.target.value) }))}
                      className={numberInput}
                    />
                    <span className="text-[12px] text-ink-faint">KB/s</span>
                  </div>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.globalUp')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={draft.speed.uploadLimit}
                      onChange={(event) => update(patch('speed', { uploadLimit: Number(event.target.value) }))}
                      className={numberInput}
                    />
                    <span className="text-[12px] text-ink-faint">KB/s</span>
                  </div>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.torrentDown')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={draft.speed.torrentDownloadLimit}
                      onChange={(event) =>
                        update(patch('speed', { torrentDownloadLimit: Number(event.target.value) }))
                      }
                      className={numberInput}
                    />
                    <span className="text-[12px] text-ink-faint">KB/s</span>
                  </div>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.torrentUp')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={draft.speed.torrentUploadLimit}
                      onChange={(event) => update(patch('speed', { torrentUploadLimit: Number(event.target.value) }))}
                      className={numberInput}
                    />
                    <span className="text-[12px] text-ink-faint">KB/s</span>
                  </div>
                </div>
                <ScheduleEditor
                  enabled={draft.speed.scheduleEnabled}
                  rules={draft.speed.scheduleRules}
                  onChange={(scheduleEnabled, scheduleRules) =>
                    update(patch('speed', { scheduleEnabled, scheduleRules }))
                  }
                />
              </div>
            )}

            {section === 'bittorrent' && (
              <div>
                <div className={row}>
                  <span className={label}>DHT</span>
                  {toggle(draft.bittorrent.dht, (value) => update(patch('bittorrent', { dht: value })))}
                </div>
                <div className={row}>
                  <span className={label}>PEX</span>
                  {toggle(draft.bittorrent.pex, (value) => update(patch('bittorrent', { pex: value })))}
                </div>
                <div className={row}>
                  <span className={label}>LSD</span>
                  {toggle(draft.bittorrent.lsd, (value) => update(patch('bittorrent', { lsd: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.encryption')}</span>
                  <select
                    value={draft.bittorrent.encryption}
                    onChange={(event) =>
                      update(patch('bittorrent', { encryption: event.target.value as Settings['bittorrent']['encryption'] }))
                    }
                    className={selectInput}
                  >
                    <option value="enabled">{t('enc.enabled')}</option>
                    <option value="forced">{t('enc.forced')}</option>
                    <option value="disabled">{t('enc.disabled')}</option>
                  </select>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.sequential')}</span>
                  {toggle(draft.bittorrent.sequential, (value) => update(patch('bittorrent', { sequential: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.anonymous')}</span>
                  {toggle(draft.bittorrent.anonymousMode, (value) =>
                    update(patch('bittorrent', { anonymousMode: value }))
                  )}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.announceAll')}</span>
                  {toggle(draft.bittorrent.announceToAllTrackers, (value) =>
                    update(patch('bittorrent', { announceToAllTrackers: value }))
                  )}
                </div>
                <div className="py-2">
                  <span className={`${label} mb-1.5 block`}>{t('settings.defaultTrackers')}</span>
                  <textarea
                    value={draft.bittorrent.defaultTrackers.join('\n')}
                    onChange={(event) =>
                      update(
                        patch('bittorrent', {
                          defaultTrackers: event.target.value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean)
                        })
                      )
                    }
                    rows={5}
                    placeholder={'udp://tracker.example:1337/announce\nhttps://tracker.example/announce'}
                    className="w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-[11px] text-ink-faint">{t('settings.defaultTrackersHint')}</p>
                </div>
              </div>
            )}

            {section === 'interface' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.density')}</span>
                  <select
                    value={draft.interface.density}
                    onChange={(event) =>
                      update(patch('interface', { density: event.target.value as Settings['interface']['density'] }))
                    }
                    className={selectInput}
                  >
                    <option value="comfortable">{t('density.comfortable')}</option>
                    <option value="compact">{t('density.compact')}</option>
                  </select>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.scale')}</span>
                  <input
                    type="range"
                    min={0.8}
                    max={1.6}
                    step={0.1}
                    value={draft.interface.scale}
                    onChange={(event) => update(patch('interface', { scale: Number(event.target.value) }))}
                    className="w-56 accent-accent"
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.showStatusbar')}</span>
                  {toggle(draft.interface.showStatusbar, (value) => update(patch('interface', { showStatusbar: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.showSpeedGraph')}</span>
                  {toggle(draft.interface.showSpeedGraph, (value) =>
                    update(patch('interface', { showSpeedGraph: value }))
                  )}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.showSidebar')}</span>
                  {toggle(draft.interface.showSidebar, (value) => update(patch('interface', { showSidebar: value })))}
                </div>
                <div className="py-2">
                  <span className={`${label} mb-2 block`}>{t('settings.columns')}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.keys(draft.interface.columns) as (keyof Settings['interface']['columns'])[]).map(
                      (column) => (
                        <label
                          key={column}
                          className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-ink"
                        >
                          <input
                            type="checkbox"
                            checked={draft.interface.columns[column]}
                            onChange={(event) =>
                              update(
                                patch('interface', {
                                  columns: { ...draft.interface.columns, [column]: event.target.checked }
                                })
                              )
                            }
                            className="size-3.5 accent-accent"
                          />
                          {t(`column.${column}`)}
                        </label>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {section === 'advanced' && (
              <div>
                <div className={row}>
                  <span className={label}>{t('settings.enginePython')}</span>
                  <input
                    value={draft.advanced.enginePython}
                    onChange={(event) => update(patch('advanced', { enginePython: event.target.value }))}
                    placeholder="py -3.10"
                    className={textInput}
                    data-testid="settings-engine-python"
                  />
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.resumeOnStart')}</span>
                  {toggle(draft.advanced.resumeOnStart, (value) => update(patch('advanced', { resumeOnStart: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.recheckOnStart')}</span>
                  {toggle(draft.advanced.recheckOnStart, (value) => update(patch('advanced', { recheckOnStart: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.logLevel')}</span>
                  <select
                    value={draft.advanced.logLevel}
                    onChange={(event) =>
                      update(patch('advanced', { logLevel: event.target.value as Settings['advanced']['logLevel'] }))
                    }
                    className={selectInput}
                  >
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                  </select>
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.keepHistory')}</span>
                  {toggle(draft.advanced.keepHistory, (value) => update(patch('advanced', { keepHistory: value })))}
                </div>
                <div className={row}>
                  <span className={label}>{t('settings.speedHistory')}</span>
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    value={draft.advanced.speedHistorySeconds}
                    onChange={(event) =>
                      update(patch('advanced', { speedHistorySeconds: Number(event.target.value) }))
                    }
                    className={numberInput}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <button
                    className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink transition hover:bg-surface-3"
                    onClick={() => void exportSettings()}
                  >
                    {t('settings.export')}
                  </button>
                  <button
                    className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink transition hover:bg-surface-3"
                    onClick={() => void importSettings()}
                  >
                    {t('settings.import')}
                  </button>
                  <button
                    className="rounded-lg border border-danger/40 bg-surface-2 px-3 py-1.5 text-[13px] text-danger transition hover:bg-danger/10"
                    onClick={() => void reset()}
                    data-testid="settings-reset"
                  >
                    {t('settings.reset')}
                  </button>
                  <span className="ml-auto self-center text-[11px] text-ink-faint">
                    {t('settings.dataDirHint')}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
            <button
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
              onClick={close}
            >
              {t('action.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Weekly speed schedule editor (rules with days + time window + limits). */
function ScheduleEditor({
  enabled,
  rules,
  onChange
}: {
  enabled: boolean
  rules: Settings['speed']['scheduleRules']
  onChange: (enabled: boolean, rules: Settings['speed']['scheduleRules']) => void
}): React.JSX.Element {
  const t = useT()
  const days = [0, 1, 2, 3, 4, 5, 6]
  const dayLabels = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => t(`day.${day}`))

  const updateRule = (index: number, values: Partial<(typeof rules)[number]>): void => {
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...values } : rule))
    onChange(enabled, next)
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="flex cursor-pointer items-center justify-between gap-4 py-2 text-[13px]">
        <span className="text-ink-dim">{t('settings.scheduleEnabled')}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked, rules)}
          className="size-4 accent-accent"
          data-testid="schedule-enabled"
        />
      </label>

      {enabled && (
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
              <div className="flex gap-1">
                {days.map((day) => (
                  <button
                    key={day}
                    className={`rounded px-1.5 py-1 text-[11px] transition ${
                      rule.days.includes(day)
                        ? 'bg-accent text-white'
                        : 'bg-surface-1 text-ink-faint hover:text-ink'
                    }`}
                    title={dayLabels[day]}
                    onClick={() => {
                      const next = rule.days.includes(day)
                        ? rule.days.filter((value) => value !== day)
                        : [...rule.days, day].sort()
                      if (next.length > 0) updateRule(index, { days: next })
                    }}
                  >
                    {dayLabels[day].slice(0, 3)}
                  </button>
                ))}
              </div>
              <input
                type="time"
                value={rule.from}
                onChange={(event) => updateRule(index, { from: event.target.value })}
                className="rounded-md border border-border bg-surface-1 px-1.5 py-1 text-[12px] text-ink outline-none"
              />
              <span className="text-ink-faint">→</span>
              <input
                type="time"
                value={rule.to}
                onChange={(event) => updateRule(index, { to: event.target.value })}
                className="rounded-md border border-border bg-surface-1 px-1.5 py-1 text-[12px] text-ink outline-none"
              />
              <label className="flex items-center gap-1 text-[11px] text-ink-dim">
                ↓
                <input
                  type="number"
                  min={0}
                  value={rule.downloadLimit}
                  onChange={(event) => updateRule(index, { downloadLimit: Number(event.target.value) })}
                  className="w-20 rounded-md border border-border bg-surface-1 px-1.5 py-1 text-[12px] tabular-nums text-ink outline-none"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-ink-dim">
                ↑
                <input
                  type="number"
                  min={0}
                  value={rule.uploadLimit}
                  onChange={(event) => updateRule(index, { uploadLimit: Number(event.target.value) })}
                  className="w-20 rounded-md border border-border bg-surface-1 px-1.5 py-1 text-[12px] tabular-nums text-ink outline-none"
                />
              </label>
              <span className="text-[11px] text-ink-faint">KB/s</span>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                className="ml-auto size-4 accent-accent"
                title={t('action.enable')}
              />
              <button
                className="rounded p-1 text-ink-faint transition hover:text-danger"
                onClick={() => onChange(enabled, rules.filter((_, i) => i !== index))}
                aria-label={t('action.remove')}
              >
                ✕
              </button>
            </div>
          ))}

          <button
            className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-ink-dim transition hover:bg-surface-3"
            onClick={() =>
              onChange(enabled, [
                ...rules,
                {
                  id: `rule-${Date.now()}`,
                  enabled: true,
                  days: [1, 2, 3, 4, 5],
                  from: '22:00',
                  to: '07:00',
                  downloadLimit: 500,
                  uploadLimit: 100
                }
              ])
            }
          >
            + {t('settings.addRule')}
          </button>
          <p className="text-[11px] text-ink-faint">{t('settings.scheduleHint')}</p>
        </div>
      )}
    </div>
  )
}
