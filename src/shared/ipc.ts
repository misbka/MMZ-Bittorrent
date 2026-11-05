/**
 * IPC contract between renderer and main.
 *
 * The preload bridge only forwards channels declared here, and the main
 * process validates every payload with the matching zod schema before doing
 * anything with it — the renderer can never reach an arbitrary channel or
 * smuggle malformed data past the boundary.
 */
import { z } from 'zod'
import type { MainToRendererEvent } from './types'

/** Single push channel used for every main -> renderer event. */
export const EVENT_CHANNEL = 'mmz:event'

export const IPC_CHANNELS = [
  'app:info',
  'app:quit',
  'app:openPath',
  'app:revealPath',
  'settings:get',
  'settings:update',
  'settings:reset',
  'settings:export',
  'settings:import',
  'dialog:chooseDirectory',
  'dialog:openTorrents',
  'torrents:add',
  'torrents:command',
  'torrents:remove',
  'torrents:files',
  'torrents:peers',
  'torrents:trackers',
  'torrents:pieces',
  'torrents:priorities',
  'torrents:options',
  'torrents:setTrackers',
  'torrents:meta',
  'session:stats',
  'log:get',
  'history:get',
  'history:clear',
  'categories:list',
  'engine:status'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

// ---------------------------------------------------------------------------
// payload schemas
// ---------------------------------------------------------------------------

const hash = z.string().regex(/^[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$/, 'invalid info hash')
const hashes = z.array(hash).min(1).max(2000)
const url = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => /^(magnet:\?|https?:\/\/)/i.test(v.trim()), 'only magnet: and http(s):// sources are accepted')

export const addTorrentSchema = z
  .object({
    urls: z.array(url).max(200).optional(),
    files: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          // base64 of the raw .torrent bytes (engine caps at 32 MB)
          data: z.string().max(45_000_000)
        })
      )
      .max(500)
      .optional(),
    category: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    paused: z.boolean().optional(),
    sequential: z.boolean().optional(),
    savePath: z.string().max(4096).optional(),
    filePriorities: z.array(z.number().int().min(0).max(7)).max(1_000_000).optional()
  })
  .refine((v) => (v.urls?.length ?? 0) + (v.files?.length ?? 0) > 0, {
    message: 'nothing to add'
  })

export type AddTorrentPayload = z.infer<typeof addTorrentSchema>

export const commandSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop', 'recheck', 'reannounce']),
  hashes
})

export const removeSchema = z.object({
  hashes,
  deleteFiles: z.boolean()
})

export const hashSchema = z.object({ hash })

export const prioritiesSchema = z.object({
  hash,
  priorities: z.array(z.number().int().min(0).max(7)).min(1).max(1_000_000)
})

export const optionsSchema = z
  .object({
    hash,
    downloadLimit: z.number().int().min(0).max(1_000_000_000).optional(),
    uploadLimit: z.number().int().min(0).max(1_000_000_000).optional(),
    maxConnections: z.number().int().min(0).max(10_000).optional(),
    sequential: z.boolean().optional(),
    superSeeding: z.boolean().optional(),
    savePath: z.string().max(4096).optional()
  })
  .refine(
    (v) =>
      v.downloadLimit !== undefined ||
      v.uploadLimit !== undefined ||
      v.maxConnections !== undefined ||
      v.sequential !== undefined ||
      v.superSeeding !== undefined ||
      v.savePath !== undefined,
    { message: 'empty options' }
  )

export const setTrackersSchema = z.object({
  hash,
  trackers: z
    .array(
      z
        .string()
        .min(1)
        .max(1024)
        .refine((v) => /^(udp|https?):\/\//i.test(v.trim()), 'invalid tracker url')
    )
    .max(500)
})

export const metaSchema = z.object({
  hash,
  category: z.string().max(64).optional(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  note: z.string().max(4000).optional()
})

export const updateSettingsSchema = z.record(z.string(), z.unknown())

export const logQuerySchema = z.object({
  since: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  hash: hash.optional()
})

export const pathSchema = z.string().min(1).max(4096)

export const exportSettingsSchema = z.object({ filePath: pathSchema })
export const importSettingsSchema = z.object({ filePath: pathSchema })

export const chooseDirectorySchema = z
  .object({
    title: z.string().max(200).optional(),
    defaultPath: z.string().max(4096).optional()
  })
  .optional()

/** Payload schema per channel (used by the main process handler). */
export const PAYLOAD_SCHEMAS: Partial<Record<IpcChannel, z.ZodTypeAny>> = {
  'torrents:add': addTorrentSchema,
  'torrents:command': commandSchema,
  'torrents:remove': removeSchema,
  'torrents:files': hashSchema,
  'torrents:peers': hashSchema,
  'torrents:trackers': hashSchema,
  'torrents:pieces': hashSchema,
  'torrents:priorities': prioritiesSchema,
  'torrents:options': optionsSchema,
  'torrents:setTrackers': setTrackersSchema,
  'torrents:meta': metaSchema,
  'settings:update': updateSettingsSchema,
  'settings:export': exportSettingsSchema,
  'settings:import': importSettingsSchema,
  'dialog:chooseDirectory': chooseDirectorySchema,
  'dialog:openTorrents': chooseDirectorySchema,
  'log:get': logQuerySchema,
  'app:openPath': pathSchema,
  'app:revealPath': pathSchema
}

export type RendererEventCallback = (event: MainToRendererEvent) => void

/** API exposed on `window.mmz` by the preload script. */
export interface MmzBridge {
  invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T>
  onEvent(callback: RendererEventCallback): () => void
  platform: string
}
