/**
 * Settings: defaults, validation, merging and the engine mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  mergeSettings,
  settingsSchema,
  toEngineSettings
} from '../src/shared/settings'

describe('settings schema', () => {
  it('accepts the defaults unchanged', () => {
    expect(settingsSchema.safeParse(defaultSettings).success).toBe(true)
  })

  it('rejects an out-of-range listen port', () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      connection: { ...defaultSettings.connection, listenPort: 70000 }
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown theme', () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      general: { ...defaultSettings.general, theme: 'neon' }
    })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed schedule rule time', () => {
    const result = settingsSchema.safeParse({
      ...defaultSettings,
      speed: {
        ...defaultSettings.speed,
        scheduleEnabled: true,
        scheduleRules: [
          { id: 'r1', enabled: true, days: [1], from: '25:00', to: '06:00', downloadLimit: 100, uploadLimit: 10 }
        ]
      }
    })
    expect(result.success).toBe(false)
  })
})

describe('mergeSettings', () => {
  it('deep-merges a partial patch over the base', () => {
    const merged = mergeSettings(defaultSettings, {
      general: { theme: 'dark' },
      speed: { downloadLimit: 512 }
    })
    expect(merged.general.theme).toBe('dark')
    // untouched keys survive
    expect(merged.general.language).toBe(defaultSettings.general.language)
    expect(merged.speed.downloadLimit).toBe(512)
    expect(merged.speed.uploadLimit).toBe(0)
  })

  it('merges nested proxy settings without losing siblings', () => {
    const merged = mergeSettings(defaultSettings, {
      connection: { proxy: { host: '127.0.0.1' } }
    })
    expect(merged.connection.proxy.host).toBe('127.0.0.1')
    expect(merged.connection.proxy.port).toBe(defaultSettings.connection.proxy.port)
    expect(merged.connection.proxy.type).toBe('none')
    expect(merged.connection.listenPort).toBe(defaultSettings.connection.listenPort)
  })

  it('throws on an invalid merged value', () => {
    expect(() => mergeSettings(defaultSettings, { general: { language: 'fr' } })).toThrow()
  })

  it('does not mutate the base object', () => {
    const before = JSON.stringify(defaultSettings)
    mergeSettings(defaultSettings, { general: { theme: 'dark' } })
    expect(JSON.stringify(defaultSettings)).toBe(before)
  })
})

describe('toEngineSettings', () => {
  const engine = toEngineSettings(defaultSettings)

  it('maps every key the engine accepts', () => {
    // keys must be known to engine/bittorrent/config.DEFAULTS
    const expected = [
      'listenPort',
      'upnp',
      'natpmp',
      'ipv6',
      'maxConnections',
      'maxConnectionsPerTorrent',
      'proxy',
      'downloadRateLimit',
      'uploadRateLimit',
      'torrentDownloadRateLimit',
      'torrentUploadRateLimit',
      'maxActiveDownloads',
      'maxActiveSeeds',
      'maxActiveTorrents',
      'dht',
      'pex',
      'lsd',
      'encryption',
      'anonymousMode',
      'announceToAllTrackers',
      'downloadDirectory',
      'temporaryDirectory',
      'startAddedTorrents',
      'resumeOnStart',
      'recheckOnStart',
      'sequentialDownload',
      'userAgent'
    ]
    for (const key of expected) expect(engine).toHaveProperty(key)
  })

  it('converts KB/s limits to bytes/s', () => {
    const mapped = toEngineSettings({
      ...defaultSettings,
      speed: { ...defaultSettings.speed, downloadLimit: 1024, uploadLimit: 256 }
    })
    expect(mapped['downloadRateLimit']).toBe(1024 * 1024)
    expect(mapped['uploadRateLimit']).toBe(256 * 1024)
  })

  it('passes booleans through untouched', () => {
    const mapped = toEngineSettings({
      ...defaultSettings,
      bittorrent: { ...defaultSettings.bittorrent, dht: false, pex: false }
    })
    expect(mapped['dht']).toBe(false)
    expect(mapped['pex']).toBe(false)
  })
})
