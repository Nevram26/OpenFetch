import { describe, expect, test } from 'vitest'
import { parseSourceUrl, type RejectReason } from '../../src/shared/source-url.js'

const V = 'dQw4w9WgXcQ'
const PL = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
const VIDEO = `https://www.youtube.com/watch?v=${V}`
const PLAYLIST = `https://www.youtube.com/playlist?list=${PL}`

const accepted: [string, object][] = [
  [`https://www.youtube.com/watch?v=${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://youtube.com/watch?v=${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://m.youtube.com/watch?v=${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://music.youtube.com/watch?v=${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://youtu.be/${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://www.youtube.com/shorts/${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`  https://WWW.YouTube.com/watch?v=${V}\n`, { kind: 'video', id: V, url: VIDEO }],
  [`https://www.youtube.com:443/watch?v=${V}`, { kind: 'video', id: V, url: VIDEO }],
  [`https://youtu.be/${V}?si=abc&t=42`, { kind: 'video', id: V, url: VIDEO }],
  [
    `https://www.youtube.com/watch?v=${V}&feature=share&t=10s&si=x`,
    { kind: 'video', id: V, url: VIDEO }
  ],
  [
    'https://www.youtube.com/watch?v=-_-_-_-_-_-',
    { kind: 'video', id: '-_-_-_-_-_-', url: 'https://www.youtube.com/watch?v=-_-_-_-_-_-' }
  ],
  [
    `https://www.youtube.com/watch?v=${V}&list=${PL}&index=3`,
    { kind: 'video', id: V, url: VIDEO, playlistId: PL }
  ],
  [`https://youtu.be/${V}?list=${PL}`, { kind: 'video', id: V, url: VIDEO, playlistId: PL }],
  [`https://www.youtube.com/watch?v=${V}&list=RDdQw4w9WgXcQ`, { kind: 'video', id: V, url: VIDEO }], // mix dropped
  [`https://www.youtube.com/playlist?list=${PL}`, { kind: 'playlist', id: PL, url: PLAYLIST }],
  [
    `https://music.youtube.com/playlist?list=${PL}&si=z`,
    { kind: 'playlist', id: PL, url: PLAYLIST }
  ]
]

const rejected: [string, RejectReason][] = [
  ['', 'empty'],
  ['   ', 'empty'],
  ['--exec calc', 'leading-dash'],
  ['-f b', 'leading-dash'],
  ['file:///C:/Windows', 'bad-scheme'],
  [`http://www.youtube.com/watch?v=${V}`, 'bad-scheme'],
  ['http://127.0.0.1', 'bad-scheme'],
  ['javascript:alert(1)', 'bad-scheme'],
  ['data:text/html,hi', 'bad-scheme'],
  ['not a url', 'control-or-whitespace'],
  [`youtube.com/watch?v=${V}`, 'invalid-url'],
  [`https://127.0.0.1/watch?v=${V}`, 'bad-host'],
  [`https://0x7f.1/watch?v=${V}`, 'bad-host'],
  ['https://[::1]/', 'bad-host'],
  [`https://localhost/watch?v=${V}`, 'bad-host'],
  [`https://user:pw@youtube.com/watch?v=${V}`, 'credentials'],
  [`https://user@youtube.com/watch?v=${V}`, 'credentials'],
  [`https://youtube.com.evil.com/watch?v=${V}`, 'bad-host'],
  [`https://evil.com/?u=https://youtube.com/watch?v=${V}`, 'bad-host'],
  [`https://www.youtube.com@evil.com/watch?v=${V}`, 'credentials'],
  [`https://youtube.com./watch?v=${V}`, 'bad-host'],
  [`https://evilyoutube.com/watch?v=${V}`, 'bad-host'],
  [`https://studio.youtube.com/watch?v=${V}`, 'bad-host'],
  [`https://xn--yutube-wqf.com/watch?v=${V}`, 'bad-host'], // youtube.com with a Cyrillic o
  [`https://y\u043eutube.com/watch?v=${V}`, 'bad-host'], // same, unpunycoded in the input
  [`https://youtube.com:8443/watch?v=${V}`, 'bad-port'],
  ['https://www.youtube.com/watch?v=../../etc', 'bad-id'],
  ['https://www.youtube.com/watch?v=short', 'bad-id'],
  [`https://www.youtube.com/watch?v=${V}x`, 'bad-id'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXc!', 'bad-id'],
  ['https://www.youtube.com/watch', 'bad-id'],
  [`https://www.youtube.com/watch?v=${V}&v=${V}`, 'bad-id'],
  ['https://youtu.be/short', 'bad-id'],
  ['https://youtu.be/', 'unsupported-path'],
  [`https://youtu.be/${V}/extra`, 'unsupported-path'],
  ['https://www.youtube.com/shorts/short', 'bad-id'],
  ['https://www.youtube.com/channel/UC1234567890', 'unsupported-path'],
  [`https://www.youtube.com/watch/?v=${V}`, 'unsupported-path'],
  ['https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ', 'bad-playlist-id'],
  ['https://www.youtube.com/playlist?list=WL', 'bad-playlist-id'],
  ['https://www.youtube.com/playlist?list=PLshort', 'bad-playlist-id'],
  ['https://www.youtube.com/playlist?list=PL../../etc/passwd', 'bad-playlist-id'],
  ['https://www.youtube.com/playlist', 'bad-playlist-id'],
  [`https://www.youtube.com/watch?v=${V}${'a'.repeat(10_000)}`, 'too-long'],
  ['a'.repeat(10_240), 'too-long'],
  [
    `https://www.youtube.com/watch?v=${V}\u0000`.replace('youtube', 'you\u0000tube'),
    'control-or-whitespace'
  ],
  [`https://www.youtube.com/watch?v=${V}&x=a\nb`, 'control-or-whitespace'],
  [`https://www.youtube.com/wat\tch?v=${V}`, 'control-or-whitespace']
]

describe('parseSourceUrl', () => {
  test.each(accepted)('accepts %s', (input, expected) => {
    expect(parseSourceUrl(input)).toEqual({ ok: true, ...expected })
  })

  test.each(rejected)('rejects %j -> %s', (input, reason) => {
    expect(parseSourceUrl(input)).toEqual({ ok: false, reason })
  })
})
