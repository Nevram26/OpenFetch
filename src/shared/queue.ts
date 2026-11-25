import { z } from 'zod'
import { downloadOptionsSchema } from './download-options.js'
import type { MediaSource } from './api.js'

export const queueStatusSchema = z.enum([
  'queued',
  'resolving',
  'downloading',
  'processing',
  'completed',
  'failed',
  'canceling',
  'canceled',
  'interrupted'
])
export const errorCodeSchema = z.enum([
  'rate_limited',
  'bot_check',
  'unavailable',
  'private',
  'geo_restricted',
  'no_compatible_format',
  'network',
  'postprocess_failed',
  'disk_full',
  'permission_denied',
  'engine_missing',
  'invalid_input',
  'unknown'
])
export const queueJobSchema = z.strictObject({
  id: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  source: z.strictObject({
    provider: z.literal('youtube'),
    sourceId: z.string().min(1).max(128),
    url: z.string().url().max(2048),
    title: z.string().min(1).max(1024),
    channel: z.string().max(512).optional(),
    durationSeconds: z.number().finite().nonnegative().optional(),
    thumbnailUrl: z.string().url().max(2048).optional(),
    viewCount: z.number().finite().nonnegative().optional()
  }),
  options: downloadOptionsSchema,
  destination: z.string().min(1).max(4096),
  status: queueStatusSchema,
  progressPercent: z.number().min(0).max(100).optional(),
  downloadedBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  speedBytesPerSecond: z.number().nonnegative().optional(),
  etaSeconds: z.number().nonnegative().optional(),
  attempts: z.number().int().nonnegative(),
  outputPath: z.string().max(4096).optional(),
  errorCode: errorCodeSchema.optional(),
  errorMessage: z.string().max(2048).optional(),
  notice: z.string().max(1024).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type QueueJob = z.infer<typeof queueJobSchema>
export type QueueStatus = z.infer<typeof queueStatusSchema>
export const queueDataSchema = z.array(queueJobSchema).max(1000)

export const transitions: Record<QueueStatus, readonly QueueStatus[]> = {
  queued: ['resolving', 'canceled'],
  resolving: ['downloading', 'processing', 'failed', 'canceling'],
  downloading: ['processing', 'failed', 'canceling'],
  processing: ['completed', 'failed', 'canceling'],
  completed: [],
  failed: ['queued'],
  canceling: ['canceled'],
  canceled: ['queued'],
  interrupted: ['queued']
}
export function assertTransition(from: QueueStatus, to: QueueStatus): void {
  if (!transitions[from].includes(to))
    throw new Error(`Illegal download transition: ${from} -> ${to}`)
}

export function duplicateKey(
  source: MediaSource,
  options: z.infer<typeof downloadOptionsSchema>,
  destination: string
): string {
  return JSON.stringify([source.sourceId, options, destination])
}
