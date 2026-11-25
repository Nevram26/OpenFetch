import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { BinaryPaths } from '../../src/main/engine/binaries.js'
import { runEngine, type SpawnFn } from '../../src/main/engine/process.js'
import { createEngineService, createHistory } from '../../src/main/engine/service.js'
import { killTree } from '../../src/main/engine/kill-tree.js'
import { createJsonStore } from '../../src/main/persistence/json-store.js'
import { classifyError } from '../../src/shared/errors.js'

const win = process.platform === 'win32'
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const fixture = (name: string) => here(`../fixtures/engine/${name}.json`)
const fakeScript = here('../fake-engine.mjs')
const paths: BinaryPaths = {
  ytDlp: 'C:\\bin\\yt-dlp\\yt-dlp.exe',
  ffmpegDir: 'C:\\bin',
  ffprobe: 'C:\\bin\\ffprobe.exe',
  deno: 'C:\\bin\\deno.exe'
}

/** Runs the REAL spawn path (process.ts) against the fake engine; one [fixture, delayMs] per call. */
function fake(...plan: [string, number?][]) {
  const calls: string[][] = []
  const spawn: SpawnFn = (_exe, args, options) => {
    calls.push(args)
    const [file, delay = 0] = plan.shift()!
    return nodeSpawn(process.execPath, [fakeScript, file, String(delay)], options)
  }
  return { spawn, calls }
}
const svcFor = (spawn: SpawnFn, kill?: (pid: number) => Promise<void>) =>
  createEngineService({ paths, spawn, kill })

describe('search through the fake engine', () => {
  it('replays a recorded search and normalizes it', async () => {
    const { spawn, calls } = fake([fixture('search-blender-open-movie')])
    const r = await svcFor(spawn).search('  blender open movie ', 'r1')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.data).toHaveLength(20)
    expect(r.data[0]).toEqual({
      provider: 'youtube',
      sourceId: 'WhWc3b3KhnY',
      url: 'https://www.youtube.com/watch?v=WhWc3b3KhnY',
      title: 'Spring - Blender Open Movie',
      channel: 'Blender Studio',
      durationSeconds: 465,
      thumbnailUrl: expect.stringMatching(/^https:\/\/i\.ytimg\.com\//),
      viewCount: 11008567
    })
    // exact argv: base args, then the search flags, then `--` before the (trimmed) query
    expect(calls[0]).toEqual([
      '--ignore-config',
      '--no-update',
      '--js-runtimes',
      `deno:${paths.deno}`,
      '--ffmpeg-location',
      paths.ffmpegDir,
      '--flat-playlist',
      '-J',
      '--',
      'ytsearch20:blender open movie'
    ])
  })

  it('leaves missing fields absent and drops foreign thumbnails and unusable entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eng-'))
    try {
      const file = join(dir, 'sparse.json')
      const entries = [
        { id: 'aaaaaaaaaaa', title: 'Bare' },
        {
          id: 'bbbbbbbbbbb',
          title: 'Foreign thumb',
          duration: 61.4,
          thumbnails: [{ url: 'https://evil.example/x.jpg' }, { url: 'http://i.ytimg.com/a.jpg' }]
        },
        { id: 'ccccccccccc' }, // no title
        { title: 'no id' },
        { id: 'not-eleven', title: 'bad id' },
        null
      ]
      await writeFile(file, JSON.stringify({ stdout: JSON.stringify({ entries }), exitCode: 0 }))
      const r = await svcFor(fake([file]).spawn).search('x', 'r')
      expect(r).toEqual({
        ok: true,
        data: [
          {
            provider: 'youtube',
            sourceId: 'aaaaaaaaaaa',
            url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
            title: 'Bare'
          },
          {
            provider: 'youtube',
            sourceId: 'bbbbbbbbbbb',
            url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
            title: 'Foreign thumb',
            durationSeconds: 61
          }
        ]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats an empty entries list as no results, not an error', async () => {
    const r = await svcFor(fake([fixture('search-no-results')]).spawn).search('zzz', 'r')
    expect(r).toEqual({ ok: true, data: [] })
  })

  it('reports an engine failure with a code and a redacted stderr tail', async () => {
    const r = await svcFor(fake([here('../fixtures/synthetic/network-error.json')]).spawn).search(
      'zzz',
      'r'
    )
    expect(r).toMatchObject({ ok: false, code: 'network' })
    expect(JSON.stringify(r)).not.toContain('zzz') // the line that echoes the query is dropped
  })

  it('reports a missing engine binary', async () => {
    const spawn: SpawnFn = (_e, _a, o) => nodeSpawn('C:\\definitely\\missing\\yt-dlp.exe', [], o)
    expect(await svcFor(spawn).search('x', 'r')).toMatchObject({
      ok: false,
      code: 'engine_missing'
    })
  })
})

describe('inspect through the fake engine', () => {
  it('inspects a video with the canonical URL', async () => {
    const { spawn, calls } = fake([fixture('inspect-video')])
    const r = await svcFor(spawn).inspect('https://youtu.be/aqz-KE-bpKQ?si=tracking')
    expect(r).toMatchObject({
      ok: true,
      data: { sourceId: 'aqz-KE-bpKQ', channel: 'Blender', durationSeconds: 635 }
    })
    expect(calls[0]!.slice(6)).toEqual([
      '--no-playlist',
      '-J',
      '--',
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
    ])
  })

  it('maps an unavailable video to its error code', async () => {
    const r = await svcFor(fake([fixture('inspect-unavailable')]).spawn).inspect(
      'https://www.youtube.com/watch?v=AAAAAAAAAAA'
    )
    expect(r).toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('previews a playlist, bounded to 200 items', async () => {
    const { spawn, calls } = fake([fixture('inspect-playlist')])
    const url = 'https://www.youtube.com/playlist?list=PLa1F2ddGya_8NhFM-rx_xh5SlIGbHyrZZ'
    const r = await svcFor(spawn).inspectPlaylist(url)
    expect(r).toMatchObject({ ok: true, data: { title: 'Blender Feature Demos', skipped: 0 } })
    if (r.ok) expect(r.data.entries).toHaveLength(1)
    expect(calls[0]!.slice(6)).toEqual([
      '--yes-playlist',
      '--flat-playlist',
      '--playlist-items',
      '1:200',
      '-J',
      '--',
      url
    ])
  })
})

describe('hostile input never reaches spawn', () => {
  const ok = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const list = 'https://www.youtube.com/playlist?list=PLa1F2ddGya_8NhFM-rx_xh5SlIGbHyrZZ'
  const hostile = [
    '--exec',
    '--exec calc.exe',
    '-o C:\\x',
    ` --exec ${ok}`,
    `${ok} --exec calc`,
    `${ok}\n--exec calc`,
    `${ok}\u0000`,
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'file:///C:/Windows/win.ini',
    'ytsearch5:cats',
    '',
    '   '
  ]

  it('rejects every hostile URL for inspect and playlist:inspect', async () => {
    const spawn = vi.fn()
    const svc = svcFor(spawn as unknown as SpawnFn)
    for (const input of hostile) {
      expect(await svc.inspect(input)).toMatchObject({ ok: false, code: 'invalid_input' })
      expect(await svc.inspectPlaylist(input)).toMatchObject({ ok: false, code: 'invalid_input' })
    }
    // a valid URL of the wrong kind is rejected too
    expect(await svc.inspect(list)).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await svc.inspectPlaylist(ok)).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('never spawns for empty or control-character queries', async () => {
    const spawn = vi.fn()
    const svc = svcFor(spawn as unknown as SpawnFn)
    expect(await svc.search('   ', 'r')).toEqual({ ok: true, data: [] })
    for (const q of ['a\nb', 'a\u0000b', 'a\u001b[31m', 'x'.repeat(201)]) {
      expect(await svc.search(q, 'r')).toMatchObject({ ok: false, code: 'invalid_input' })
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('keeps a leading-dash query behind the ytsearch prefix and `--`', async () => {
    const { spawn, calls } = fake([fixture('search-no-results')])
    await svcFor(spawn).search('--exec calc', 'r')
    expect(calls[0]!.slice(-2)).toEqual(['--', 'ytsearch20:--exec calc'])
  })
})

describe.skipIf(!win)('cancelling', () => {
  it('a second search kills the first process tree; only the second result is returned', async () => {
    const { spawn } = fake(
      [fixture('search-blender-open-movie'), 30_000],
      [fixture('search-no-results')]
    )
    const kill = vi.fn((pid: number) => killTree(pid))
    const svc = svcFor(spawn, kill)
    const first = svc.search('first', 'r1')
    const second = svc.search('second', 'r2')
    expect(await first).toEqual({ ok: false, cancelled: true })
    expect(await second).toEqual({ ok: true, data: [] })
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('cancelSearch stops the running search', async () => {
    const { spawn } = fake([fixture('search-blender-open-movie'), 30_000])
    const svc = svcFor(spawn)
    const p = svc.search('x', 'r1')
    svc.cancelSearch('other') // unknown id: ignored
    svc.cancelSearch('r1')
    expect(await p).toEqual({ ok: false, cancelled: true })
  })

  it('kills a run that exceeds its time limit', async () => {
    const { spawn } = fake([fixture('search-no-results'), 30_000])
    const r = await runEngine([], { paths, spawn, timeoutMs: 300 }).done
    expect(r).toMatchObject({ timedOut: true, cancelled: false })
  })
})

describe('runEngine', () => {
  it('splits stdout and stderr into lines separately and buffers partial lines', async () => {
    const code = `
      process.stdout.write('a\\nb'); process.stderr.write('x\\ny');
      setTimeout(() => process.stdout.write('c\\nd\\n'), 150)`
    const spawn: SpawnFn = (_e, _a, o) => nodeSpawn(process.execPath, ['-e', code], o)
    const lines: [string, string][] = []
    const r = await runEngine([], { paths, spawn, onLine: (s, l) => lines.push([s, l]) }).done
    expect(lines.filter(([s]) => s === 'stdout').map(([, l]) => l)).toEqual(['a', 'bc', 'd'])
    expect(lines.filter(([s]) => s === 'stderr').map(([, l]) => l)).toEqual(['x', 'y'])
    expect(r).toMatchObject({ stdout: 'a\nbc\nd\n', stderr: 'x\ny', exitCode: 0 })
  })

  it('stops a run that exceeds the output limit', async () => {
    const kill = vi.fn(async () => {})
    const { spawn } = fake([fixture('inspect-video')])
    const r = await runEngine([], { paths, spawn, kill, maxOutputBytes: 1000 }).done
    expect(r.outputTooLarge).toBe(true)
    expect(kill).toHaveBeenCalled()
    expect(r.stdout.length).toBeLessThanOrEqual(1000)
  })

  it('launches without a shell, hidden', () => {
    const spawn = vi.fn(() => nodeSpawn(process.execPath, ['-e', '0'])) as unknown as SpawnFn
    runEngine(['--', 'x'], { paths, spawn })
    expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({ shell: false, windowsHide: true })
    expect(vi.mocked(spawn).mock.calls[0]![0]).toBe(paths.ytDlp)
  })
})

describe('classifyError', () => {
  it.each([
    ['ERROR: [youtube] AAAAAAAAAAA: This video is unavailable', 'unavailable'],
    ['ERROR: [youtube] x: Private video. Sign in if you have been granted access', 'private'],
    ["ERROR: [youtube] x: Sign in to confirm you're not a bot", 'bot_check'],
    ['ERROR: unable to download video data: HTTP Error 429: Too Many Requests', 'rate_limited'],
    [
      'ERROR: [youtube] x: The uploader has not made this video available in your country',
      'geo_restricted'
    ],
    ['ERROR: [youtube] x: Requested format is not available', 'no_compatible_format'],
    [
      'ERROR: [youtube] x: Unable to download webpage: <urlopen error getaddrinfo failed>',
      'network'
    ],
    ['ERROR: Postprocessing: ffmpeg exited with code 1', 'postprocess_failed'],
    ['ERROR: [Errno 28] No space left on device', 'disk_full'],
    ['ERROR: [Errno 13] Permission denied', 'permission_denied'],
    ['ERROR: something new', 'unknown'],
    ['WARNING: Unknown codec iamf.001.001.Opus', 'unknown']
  ] as const)('%s -> %s', (stderr, code) => {
    expect(classifyError(1, stderr)).toBe(code)
  })

  it('treats exit 2 as invalid input and ignores warnings', () => {
    expect(classifyError(2, 'Usage: yt-dlp')).toBe('invalid_input')
    expect(classifyError(1, 'WARNING: HTTP Error 429\nERROR: nope')).toBe('unknown')
  })
})

describe('search history', () => {
  it('keeps most recent first, de-duplicates case-insensitively, caps at 20, clears', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hist-'))
    try {
      const h = createHistory(
        createJsonStore(dir, 'h.json', {
          version: 1,
          defaults: () => [] as string[],
          validator: z.array(z.string()).max(20)
        })
      )
      await h.add('Cats')
      await h.add('dogs')
      await h.add('  cats  ')
      await h.add('   ')
      expect(await h.list()).toEqual(['cats', 'dogs'])
      for (let i = 0; i < 30; i++) await h.add(`q${i}`)
      const all = await h.list()
      expect(all).toHaveLength(20)
      expect(all[0]).toBe('q29')
      await h.clear()
      expect(await h.list()).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
