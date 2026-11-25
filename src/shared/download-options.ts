import { z } from 'zod'

/** Spec §5 DownloadOptions. M4A is deferred past v1. */
export const downloadOptionsSchema = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('mp3'),
    bitrateKbps: z.union([z.literal(128), z.literal(192), z.literal(320)])
  }),
  z.object({
    format: z.literal('mp4'),
    maxHeight: z.union([
      z.literal(360),
      z.literal(480),
      z.literal(720),
      z.literal(1080),
      z.literal('best')
    ])
  })
])

export type DownloadOptions = z.infer<typeof downloadOptionsSchema>

/** Measured with FFprobe, never copied from the request (spec §5). */
export interface ActualOutput {
  container: 'mp3' | 'mp4'
  vcodec?: string
  acodec?: string
  /** Shorter side of the frame, to match `-S res:<n>` (spec §4.3). */
  height?: number
  bitrateKbps?: number
  durationSeconds?: number
}
