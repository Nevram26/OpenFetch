import { join } from 'node:path'
import { downloadOptionsSchema, type DownloadOptions } from '../../shared/download-options.js'
import { parseSourceUrl } from '../../shared/source-url.js'

const OF =
  'download:[OF] %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(info.id)s'
const OFPP = 'postprocess:[OFPP] %(progress.status)s|%(progress.postprocessor)s|%(info.id)s'
// H.264 + AAC when offered, else anything; verify.ts rejects what that fallback produces.
const MP4_FORMAT = 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b'

/**
 * Download-specific yt-dlp args only; the process wrapper prepends the base args.
 * `url` must be the canonical URL from parseSourceUrl. Anything else throws.
 */
export function buildDownloadArgs(
  options: DownloadOptions,
  { url, stagingDir }: { url: string; stagingDir: string }
): string[] {
  const o = downloadOptionsSchema.parse(options)
  const src = parseSourceUrl(url)
  if (!src.ok || src.url !== url) throw new Error('buildDownloadArgs: url is not canonical')

  const format =
    o.format === 'mp3'
      ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', `${o.bitrateKbps}K`]
      : [
          '-f',
          MP4_FORMAT,
          ...(o.maxHeight === 'best' ? [] : ['-S', `res:${o.maxHeight}`]),
          '--merge-output-format',
          'mp4'
        ]
  return [
    '--no-playlist',
    '--retries',
    '1',
    '--fragment-retries',
    '1',
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '1',
    ...format,
    '--embed-metadata',
    '--embed-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '-P',
    `home:${join(stagingDir, 'out')}`,
    '-P',
    `temp:${join(stagingDir, 'tmp')}`,
    '-o',
    '%(title).150B [%(id)s].%(ext)s',
    '--windows-filenames',
    '--newline',
    '--progress',
    '--progress-template',
    OF,
    '--progress-template',
    OFPP,
    '--print',
    'after_move:[OFPATH] %(filepath)j',
    '--',
    url
  ]
}
