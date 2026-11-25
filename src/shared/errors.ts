export type ErrorCode =
  | 'rate_limited'
  | 'bot_check'
  | 'unavailable'
  | 'private'
  | 'geo_restricted'
  | 'no_compatible_format'
  | 'network'
  | 'postprocess_failed'
  | 'disk_full'
  | 'permission_denied'
  | 'engine_missing'
  | 'invalid_input'
  | 'unknown'

// First match wins, so the specific messages come before the generic ones.
// yt-dlp's English `ERROR:` lines only; warnings (e.g. "Unknown codec iamf") never count.
const RULES: [ErrorCode, RegExp][] = [
  ['private', /private video|video is private/i],
  ['bot_check', /not a bot|confirm you.re not/i],
  ['rate_limited', /HTTP Error 429|too many requests|rate-limited|try again later/i],
  ['geo_restricted', /available in your country|blocked it in your country|geo.?restrict/i],
  [
    'unavailable',
    /video unavailable|this video is unavailable|has been removed|no longer available/i
  ],
  ['no_compatible_format', /requested format is not available|no video formats found/i],
  ['disk_full', /no space left on device|errno 28/i],
  ['permission_denied', /permission denied|errno 13/i],
  ['postprocess_failed', /postprocessing|ffmpeg|ffprobe/i],
  [
    'network',
    /unable to download|getaddrinfo|name resolution|timed out|connection (reset|refused|aborted)|network is unreachable|urlopen error|transporterror/i
  ]
]

/** Maps a finished yt-dlp run to an ErrorCode. A killed process is NOT an error: callers track cancellation. */
export function classifyError(exitCode: number | null, stderr: string): ErrorCode {
  const errors = stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ERROR:'))
    .join('\n')
  for (const [code, re] of RULES) if (re.test(errors)) return code
  return exitCode === 2 ? 'invalid_input' : 'unknown'
}
