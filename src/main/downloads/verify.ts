import { z } from 'zod'
import type { ActualOutput, DownloadOptions } from '../../shared/download-options.js'

const probe = z.object({
  format: z.object({
    format_name: z.string(),
    bit_rate: z.coerce.number().optional(),
    duration: z.coerce.number().optional()
  }),
  streams: z.array(
    z.object({
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      bit_rate: z.coerce.number().optional(),
      disposition: z.object({ attached_pic: z.number().optional() }).optional()
    })
  )
})

/** ffprobe `-show_streams -show_format -of json` -> ActualOutput. null if unrecognised. */
export function parseFfprobe(json: unknown): ActualOutput | null {
  const p = probe.safeParse(json)
  if (!p.success) return null
  const { format, streams } = p.data
  const names = format.format_name.split(',')
  const container = names.includes('mp3') ? 'mp3' : names.includes('mp4') ? 'mp4' : null
  if (!container) return null
  // Embedded cover art is an mjpeg "video" stream; it is not the video.
  const real = streams.filter((s) => s.disposition?.attached_pic !== 1 && s.codec_name !== 'mjpeg')
  const v = real.find((s) => s.codec_type === 'video')
  const a = real.find((s) => s.codec_type === 'audio')
  const bps = container === 'mp3' ? (a?.bit_rate ?? format.bit_rate) : format.bit_rate
  return {
    container,
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
    height: v?.width && v.height ? Math.min(v.width, v.height) : undefined,
    bitrateKbps: bps ? Math.round(bps / 1000) : undefined,
    durationSeconds: format.duration
  }
}

export type MatchResult = { ok: true; notice?: string } | { ok: false; reason: string }

const no = (reason: string): MatchResult => ({ ok: false, reason })

/** Does the measured output satisfy the request? Lower height is ok with a notice (never upscale). */
export function matchesRequest(options: DownloadOptions, actual: ActualOutput): MatchResult {
  if (actual.container !== options.format)
    return no(`expected ${options.format} container, got ${actual.container}`)
  if (!actual.acodec) return no('no audio stream')
  if (options.format === 'mp3') {
    const want = options.bitrateKbps
    // ponytail: fixed 10% tolerance; widen if real encodes drift
    return actual.acodec !== 'mp3'
      ? no(`expected mp3 audio, got ${actual.acodec}`)
      : actual.bitrateKbps === undefined || Math.abs(actual.bitrateKbps - want) > want * 0.1
        ? no(`expected about ${want} kbps, got ${actual.bitrateKbps ?? 'unknown'}`)
        : { ok: true }
  }
  if (actual.vcodec !== 'h264') return no(`expected h264 video, got ${actual.vcodec ?? 'none'}`)
  if (actual.acodec !== 'aac') return no(`expected aac audio, got ${actual.acodec}`)
  const cap = options.maxHeight
  if (cap === 'best') return { ok: true }
  if (!actual.height) return no('video height unknown')
  if (actual.height > cap) return no(`height ${actual.height}p exceeds ${cap}p`)
  // ponytail: any shortfall gets a notice, even oddly cropped 1080p (e.g. 1920x800)
  return actual.height < cap
    ? { ok: true, notice: `${cap}p unavailable, used ${actual.height}p` }
    : { ok: true }
}
