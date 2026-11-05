/**
 * IPC payload validation: every schema must accept good input and reject
 * the dangerous/malformed cases the renderer could accidentally send.
 */
import { describe, expect, it } from 'vitest'
import {
  addTorrentSchema,
  commandSchema,
  metaSchema,
  optionsSchema,
  PAYLOAD_SCHEMAS,
  prioritiesSchema,
  removeSchema,
  setTrackersSchema,
  updateSettingsSchema,
  IPC_CHANNELS
} from '../src/shared/ipc'

const HASH = 'a'.repeat(40)

describe('IPC channel contract', () => {
  it('declares a schema for every channel that carries a payload', () => {
    for (const channel of Object.keys(PAYLOAD_SCHEMAS)) {
      expect(IPC_CHANNELS).toContain(channel)
    }
  })
})

describe('addTorrentSchema', () => {
  it('accepts a magnet url', () => {
    const parsed = addTorrentSchema.parse({ urls: [`magnet:?xt=urn:btih:${HASH}`] })
    expect(parsed.urls).toHaveLength(1)
  })

  it('accepts base64 torrent files', () => {
    const parsed = addTorrentSchema.parse({ files: [{ name: 'a.torrent', data: 'AAEC' }] })
    expect(parsed.files?.[0].name).toBe('a.torrent')
  })

  it('rejects an empty request', () => {
    expect(addTorrentSchema.safeParse({}).success).toBe(false)
  })

  it('rejects non-magnet/non-http sources', () => {
    expect(addTorrentSchema.safeParse({ urls: ['file:///etc/passwd'] }).success).toBe(false)
    expect(addTorrentSchema.safeParse({ urls: ['javascript:alert(1)'] }).success).toBe(false)
    expect(addTorrentSchema.safeParse({ urls: ['ftp://example.com/x'] }).success).toBe(false)
  })

  it('rejects absurd payload sizes', () => {
    const big = 'x'.repeat(46_000_000)
    expect(addTorrentSchema.safeParse({ files: [{ name: 'big.torrent', data: big }] }).success).toBe(false)
  })

  it('rejects oversized url lists', () => {
    const urls = Array.from({ length: 201 }, () => `magnet:?xt=urn:btih:${HASH}`)
    expect(addTorrentSchema.safeParse({ urls }).success).toBe(false)
  })
})

describe('commandSchema', () => {
  it('accepts the supported actions', () => {
    for (const action of ['pause', 'resume', 'stop', 'recheck', 'reannounce']) {
      expect(commandSchema.safeParse({ action, hashes: [HASH] }).success).toBe(true)
    }
  })

  it('rejects an unknown action', () => {
    expect(commandSchema.safeParse({ action: 'explode', hashes: [HASH] }).success).toBe(false)
  })

  it('rejects malformed hashes', () => {
    expect(commandSchema.safeParse({ action: 'pause', hashes: ['not-a-hash'] }).success).toBe(false)
    expect(commandSchema.safeParse({ action: 'pause', hashes: [] }).success).toBe(false)
  })
})

describe('removeSchema', () => {
  it('requires an explicit deleteFiles decision', () => {
    expect(removeSchema.safeParse({ hashes: [HASH] }).success).toBe(false)
    expect(removeSchema.safeParse({ hashes: [HASH], deleteFiles: true }).success).toBe(true)
  })
})

describe('prioritiesSchema', () => {
  it('accepts priorities in the 0..7 range', () => {
    expect(prioritiesSchema.safeParse({ hash: HASH, priorities: [0, 4, 7] }).success).toBe(true)
  })

  it('rejects out-of-range priorities', () => {
    expect(prioritiesSchema.safeParse({ hash: HASH, priorities: [9] }).success).toBe(false)
    expect(prioritiesSchema.safeParse({ hash: HASH, priorities: [-1] }).success).toBe(false)
  })
})

describe('optionsSchema', () => {
  it('rejects an empty patch', () => {
    expect(optionsSchema.safeParse({ hash: HASH }).success).toBe(false)
  })

  it('accepts a single limit', () => {
    expect(optionsSchema.safeParse({ hash: HASH, downloadLimit: 1024 }).success).toBe(true)
  })

  it('rejects negative limits', () => {
    expect(optionsSchema.safeParse({ hash: HASH, uploadLimit: -5 }).success).toBe(false)
  })
})

describe('setTrackersSchema', () => {
  it('accepts udp/http trackers', () => {
    const parsed = setTrackersSchema.parse({
      hash: HASH,
      trackers: ['udp://tracker.example:1337/announce', 'https://tracker.example/announce']
    })
    expect(parsed.trackers).toHaveLength(2)
  })

  it('rejects tracker urls with a dangerous scheme', () => {
    expect(
      setTrackersSchema.safeParse({ hash: HASH, trackers: ['file:///etc/passwd'] }).success
    ).toBe(false)
    expect(setTrackersSchema.safeParse({ hash: HASH, trackers: ['javascript:x'] }).success).toBe(false)
  })
})

describe('metaSchema', () => {
  it('accepts category, tags and note', () => {
    const parsed = metaSchema.parse({ hash: HASH, category: 'Movies', tags: ['hd'], note: 'x' })
    expect(parsed.category).toBe('Movies')
  })

  it('rejects an over-long note', () => {
    expect(metaSchema.safeParse({ hash: HASH, note: 'x'.repeat(5000) }).success).toBe(false)
  })

  it('rejects a missing hash', () => {
    expect(metaSchema.safeParse({ category: 'x' }).success).toBe(false)
  })
})

describe('updateSettingsSchema', () => {
  it('accepts an arbitrary settings patch object', () => {
    expect(updateSettingsSchema.safeParse({ general: { theme: 'dark' } }).success).toBe(true)
  })

  it('rejects non-object payloads', () => {
    expect(updateSettingsSchema.safeParse('dark').success).toBe(false)
    expect(updateSettingsSchema.safeParse(null).success).toBe(false)
  })
})
