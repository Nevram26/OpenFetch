// Trust boundary: only a canonical URL returned from here may reach the engine.

export type RejectReason =
  | 'empty'
  | 'too-long'
  | 'leading-dash'
  | 'control-or-whitespace'
  | 'invalid-url'
  | 'bad-scheme'
  | 'credentials'
  | 'bad-port'
  | 'bad-host'
  | 'unsupported-path'
  | 'bad-id'
  | 'bad-playlist-id'

export type SourceUrlResult =
  | { ok: true; kind: 'video'; id: string; url: string; playlistId?: string }
  | { ok: true; kind: 'playlist'; id: string; url: string }
  | { ok: false; reason: RejectReason }

/** Max accepted input length (after trim). Real YouTube URLs are well under 200 chars. */
export const MAX_INPUT_LENGTH = 2048

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be'
])
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
/**
 * Playlist IDs: known public prefixes (PL user, UU uploads, FL favourites, OLAK5uy_ album)
 * + 10..60 safe chars. Auto-generated mixes (RD...) are NOT playlists: they are dynamic,
 * per-viewer and unbounded. On a video URL a `list=RD...` is silently dropped (video only).
 * Account-bound lists (LL, WL) are rejected too: they need cookies.
 */
const PLAYLIST_ID = /^(PL|UU|FL|OLAK5uy_)[A-Za-z0-9_-]{10,60}$/

const no = (reason: RejectReason): SourceUrlResult => ({ ok: false, reason })

export function parseSourceUrl(input: string): SourceUrlResult {
  const s = input.trim()
  if (!s) return no('empty')
  if (s.length > MAX_INPUT_LENGTH) return no('too-long')
  if (s.startsWith('-')) return no('leading-dash')
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point of this check
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(s)) return no('control-or-whitespace')

  let u: URL
  try {
    u = new URL(s)
  } catch {
    return no('invalid-url')
  }

  if (u.protocol !== 'https:') return no('bad-scheme')
  if (u.username || u.password) return no('credentials')
  if (u.port) return no('bad-port') // WHATWG blanks the default 443
  // WHATWG already lowercases, punycodes and normalises IPv4 forms, so exact-match is enough.
  if (!HOSTS.has(u.hostname)) return no('bad-host')

  const q = u.searchParams
  const one = (k: string) => (q.getAll(k).length > 1 ? null : q.get(k)) // duplicate params are ambiguous
  const withList = (id: string): SourceUrlResult => {
    const list = one('list')
    const video = {
      ok: true,
      kind: 'video',
      id,
      url: `https://www.youtube.com/watch?v=${id}`
    } as const
    return list && PLAYLIST_ID.test(list) ? { ...video, playlistId: list } : video
  }

  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1)
    if (!id || id.includes('/')) return no('unsupported-path')
    return VIDEO_ID.test(id) ? withList(id) : no('bad-id')
  }
  if (u.pathname === '/watch') {
    const v = one('v')
    return v && VIDEO_ID.test(v) ? withList(v) : no('bad-id')
  }
  const shorts = /^\/shorts\/([^/]*)$/.exec(u.pathname)
  if (shorts) return VIDEO_ID.test(shorts[1]!) ? withList(shorts[1]!) : no('bad-id')
  if (u.pathname === '/playlist') {
    const list = one('list')
    return list && PLAYLIST_ID.test(list)
      ? {
          ok: true,
          kind: 'playlist',
          id: list,
          url: `https://www.youtube.com/playlist?list=${list}`
        }
      : no('bad-playlist-id')
  }
  return no('unsupported-path')
}
