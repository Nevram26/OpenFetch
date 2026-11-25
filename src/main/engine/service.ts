import { classifyError, type ErrorCode } from '../../shared/errors.js'
import { parseSourceUrl } from '../../shared/source-url.js'
import type { MediaSource, Outcome, PlaylistPreview } from '../../shared/api.js'
import type { JsonStore } from '../persistence/json-store.js'
import { runEngine, type EngineOptions, type EngineRun } from './process.js'

export const MAX_QUERY = 200
export const SEARCH_RESULTS = 20
export const PLAYLIST_PREVIEW = 200
export const HISTORY_MAX = 20

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const THUMB = /^https:\/\/i\.ytimg\.com\//i // D5: same host as the CSP img-src

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

/** Flat-search entry or full info dict -> MediaSource. Unknown fields stay absent; the URL is rebuilt, not trusted. */
export function normalizeEntry(raw: unknown): MediaSource | null {
  const e = rec(raw)
  const id = str(e['id'])
  const title = str(e['title'])
  if (!id || !VIDEO_ID.test(id) || !title) return null
  const thumbs = Array.isArray(e['thumbnails']) ? e['thumbnails'].map((t) => rec(t)['url']) : []
  const thumbnailUrl = [e['thumbnail'], ...thumbs].find(
    (u): u is string => typeof u === 'string' && THUMB.test(u)
  )
  const duration = num(e['duration'])
  const views = num(e['view_count'])
  const channel = str(e['channel']) ?? str(e['uploader'])
  return {
    provider: 'youtube',
    sourceId: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    ...(channel && { channel }),
    ...(duration !== undefined && { durationSeconds: Math.round(duration) }),
    ...(thumbnailUrl && { thumbnailUrl }),
    ...(views !== undefined && { viewCount: Math.round(views) })
  }
}

const entriesOf = (json: unknown): unknown[] => {
  const entries = rec(json)['entries']
  return Array.isArray(entries) ? entries : []
}

const fail = (code: ErrorCode, stderrTail = ''): Outcome<never> => ({ ok: false, code, stderrTail })

/** Last lines of stderr for "Copy diagnostics". Lines mentioning the query are dropped, the binaries folder masked. */
function diagnostics(stderr: string, secret: string | undefined, root: string): string {
  const q = secret?.toLowerCase()
  return stderr
    .split(/\r?\n/)
    .filter((l) => l && !(q && l.toLowerCase().includes(q))) // ponytail: drops whole lines, so a 1-char query can empty the tail
    .slice(-20)
    .join('\n')
    .split(root)
    .join('<bin>')
    .slice(-2000)
}

export function createEngineService(deps: Omit<EngineOptions, 'timeoutMs' | 'onLine'>) {
  const runs = new Set<EngineRun>()
  let current: { id: string; run: EngineRun } | undefined

  async function exec<T>(
    args: string[],
    timeoutMs: number,
    parse: (json: unknown) => T,
    secret?: string,
    track?: (run: EngineRun) => void
  ): Promise<Outcome<T>> {
    let run: EngineRun
    try {
      run = runEngine(args, { ...deps, timeoutMs })
    } catch (e) {
      return fail('unknown', String((e as Error).message))
    }
    runs.add(run)
    track?.(run)
    try {
      const r = await run.done
      if (r.cancelled) return { ok: false, cancelled: true }
      const tail = diagnostics(r.stderr, secret, deps.paths.ffmpegDir)
      if (r.timedOut) return fail('network', `timed out\n${tail}`)
      if (r.outputTooLarge) return fail('unknown', `output too large\n${tail}`)
      if (r.exitCode !== 0) return fail(classifyError(r.exitCode, r.stderr), tail)
      try {
        return { ok: true, data: parse(JSON.parse(r.stdout)) }
      } catch {
        return fail('unknown', `unreadable engine output\n${tail}`)
      }
    } catch (e) {
      return fail((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'engine_missing' : 'unknown')
    } finally {
      runs.delete(run)
    }
  }

  async function inspectUrl<T>(
    input: string,
    kind: 'video' | 'playlist',
    flags: string[],
    parse: (json: unknown, id: string) => T
  ): Promise<Outcome<T>> {
    const p = parseSourceUrl(input) // the only gate: nothing unvalidated reaches spawn
    if (!p.ok || p.kind !== kind) return fail('invalid_input')
    return exec([...flags, '--', p.url], 60_000, (j) => parse(j, p.id))
  }

  return {
    async search(query: string, requestId: string): Promise<Outcome<MediaSource[]>> {
      const q = query.trim()
      if (!q) return { ok: true, data: [] } // never spawn for an empty query
      if (q.length > MAX_QUERY || CONTROL.test(q)) return fail('invalid_input')
      current?.run.cancel() // a newer search supersedes the older one
      const out = await exec(
        ['--flat-playlist', '-J', '--', `ytsearch${SEARCH_RESULTS}:${q}`],
        30_000,
        (j) => entriesOf(j).flatMap((e) => normalizeEntry(e) ?? []),
        q,
        (run) => (current = { id: requestId, run })
      )
      if (current?.id !== requestId) return { ok: false, cancelled: true } // stale: drop it
      current = undefined
      return out
    },

    cancelSearch(requestId: string): void {
      if (current?.id === requestId) current.run.cancel()
    },

    inspect: (url: string) =>
      inspectUrl(url, 'video', ['--no-playlist', '-J'], (j) => {
        const m = normalizeEntry(j)
        if (!m) throw new Error('no metadata')
        return m
      }),

    inspectPlaylist: (url: string) =>
      inspectUrl(
        url,
        'playlist',
        ['--yes-playlist', '--flat-playlist', '--playlist-items', `1:${PLAYLIST_PREVIEW}`, '-J'],
        (j, id): PlaylistPreview => {
          const all = entriesOf(j)
          const entries = all.flatMap((e) => normalizeEntry(e) ?? [])
          const title = str(rec(j)['title'])
          return { id, ...(title && { title }), entries, skipped: all.length - entries.length }
        }
      ),

    /** App quit: leave no engine process behind. */
    shutdown(): void {
      for (const r of runs) r.cancel()
    }
  }
}

export type EngineService = ReturnType<typeof createEngineService>

/** Most recent first, case-insensitive de-duplication, capped. Never logged. */
export function createHistory(store: JsonStore<string[]>) {
  return {
    list: () => store.read(),
    async add(query: string): Promise<void> {
      const q = query.trim()
      if (!q) return
      const rest = (await store.read()).filter((h) => h.toLowerCase() !== q.toLowerCase())
      await store.write([q, ...rest].slice(0, HISTORY_MAX))
    },
    clear: () => store.write([])
  }
}
