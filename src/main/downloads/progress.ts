export type ProgressEvent =
  | {
      kind: 'download'
      percent?: number
      downloadedBytes?: number
      totalBytes?: number
      speed?: number
      eta?: number
    }
  | { kind: 'postprocess'; status: string; postprocessor: string }
  | { kind: 'path'; path: string }

/** `NA`, empty and garbage are absent, never 0 or NaN. */
const num = (s: string | undefined): number | undefined => {
  if (!s || s === 'NA') return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Parse one line of yt-dlp output. `[OF]`/`[OFPATH]` come on stdout, `[OFPP]` on stderr
 * (docs/ENGINE_FINDINGS.md). Never throws. The path is only trusted from stdout.
 */
export function parseLine(line: string, stream: 'stdout' | 'stderr'): ProgressEvent | null {
  const l = line.trim()
  if (l.startsWith('[OF] ')) {
    const [, dl, total, est, speed, eta] = l.slice(5).split('|')
    const downloadedBytes = num(dl)
    const totalBytes = num(total) ?? num(est)
    const percent =
      downloadedBytes !== undefined && totalBytes
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : undefined
    return {
      kind: 'download',
      percent,
      downloadedBytes,
      totalBytes,
      speed: num(speed),
      eta: num(eta)
    }
  }
  if (l.startsWith('[OFPP] ')) {
    const [status, postprocessor] = l.slice(7).split('|')
    return status && postprocessor ? { kind: 'postprocess', status, postprocessor } : null
  }
  if (stream === 'stdout' && l.startsWith('[OFPATH] ')) {
    try {
      const path: unknown = JSON.parse(l.slice(9))
      return typeof path === 'string' && path ? { kind: 'path', path } : null
    } catch {
      return null
    }
  }
  return null
}
