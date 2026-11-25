import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDownloadArgs } from '../../src/main/downloads/args.js'
import { finalizeFile } from '../../src/main/downloads/finalize.js'
import { parseLine } from '../../src/main/downloads/progress.js'
import { matchesRequest, parseFfprobe } from '../../src/main/downloads/verify.js'
import type { ActualOutput } from '../../src/shared/download-options.js'

const fx = (n: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/engine', `${n}.json`), 'utf8'))
const URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

describe('buildDownloadArgs', () => {
  const a = buildDownloadArgs({ format: 'mp3', bitrateKbps: 192 }, { url: URL, stagingDir: 'S' })
  it('mp3 matches the spike', () => {
    expect(a.slice(0, 5)).toEqual(['--no-playlist', '--retries', '1', '--fragment-retries', '1'])
    expect(a.slice(5, 9)).toEqual(['--sleep-interval', '1', '--max-sleep-interval', '1'])
    expect(a.slice(9, 16)).toEqual([
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '192K'
    ])
    expect(a.slice(-2)).toEqual(['--', URL])
  })
  it('mp4 caps by res, best does not', () => {
    const m = buildDownloadArgs({ format: 'mp4', maxHeight: 720 }, { url: URL, stagingDir: 'S' })
    expect(m).toContain('res:720')
    expect(m).toContain('--merge-output-format')
    const b = buildDownloadArgs({ format: 'mp4', maxHeight: 'best' }, { url: URL, stagingDir: 'S' })
    expect(b).not.toContain('-S')
  })
  it('rejects invalid options and non-canonical urls', () => {
    const o = { format: 'mp3', bitrateKbps: 192 } as const
    expect(() =>
      buildDownloadArgs({ format: 'mp3', bitrateKbps: 1 } as never, { url: URL, stagingDir: 'S' })
    ).toThrow()
    expect(() =>
      buildDownloadArgs({ format: 'mp4', maxHeight: '720; rm' } as never, {
        url: URL,
        stagingDir: 'S'
      })
    ).toThrow()
    for (const url of ['--exec=calc', 'aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ'])
      expect(() => buildDownloadArgs(o, { url, stagingDir: 'S' })).toThrow(/canonical/)
  })
})

describe('parseLine on real fixtures', () => {
  for (const n of [
    'download-mp3',
    'download-mp4',
    'cancel-mp3-download',
    'cancel-mp3-postprocess',
    'cancel-mp4-download',
    'cancel-mp4-merge'
  ]) {
    it(`${n}: every tagged line parses, nothing throws`, () => {
      const f = fx(n)
      let tagged = 0
      for (const stream of ['stdout', 'stderr'] as const)
        for (const line of (f[stream] as string).split('\n')) {
          const ev = parseLine(line, stream) // must not throw on any line
          if (/^\[OF(PP|PATH)?\] /.test(line)) {
            tagged++
            expect(ev, line).not.toBeNull()
          }
        }
      expect(tagged).toBeGreaterThan(5)
    })
  }
  it('values: NA is absent, path is decoded, percent is derived', () => {
    expect(parseLine('[OF] downloading|1024|30767611|NA|954649.3|NA|NA|x', 'stdout')).toMatchObject(
      {
        kind: 'download',
        downloadedBytes: 1024,
        totalBytes: 30767611,
        speed: 954649.3,
        eta: undefined
      }
    )
    const e = parseLine('[OF] downloading|50|NA|100|NA|NA|NA|x', 'stdout')
    expect(e).toMatchObject({ percent: 50, totalBytes: 100 })
    const none = parseLine('[OF] downloading|NA|NA|NA|NA|NA|NA|x', 'stdout')
    expect(none).toEqual({
      kind: 'download',
      percent: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      speed: undefined,
      eta: undefined
    })
    expect(parseLine('[OFPP] started|Merger|x', 'stderr')).toEqual({
      kind: 'postprocess',
      status: 'started',
      postprocessor: 'Merger'
    })
    expect(parseLine('[OFPATH] "C:\\\\a\\\\b \\u00e9.mp3"', 'stdout')).toEqual({
      kind: 'path',
      path: 'C:\\a\\b \u00e9.mp3'
    })
    expect(parseLine('[OFPATH] "C:\\\\a.mp3"', 'stderr')).toBeNull()
    expect(parseLine('[OFPATH] {bad', 'stdout')).toBeNull()
    expect(parseLine('WARNING: Unknown codec', 'stderr')).toBeNull()
  })
})

describe('ffprobe verification', () => {
  // measurements.json holds a trimmed ffprobe; rebuild the JSON shape ffprobe prints.
  const m = fx('measurements').ffprobe
  const asProbe = (k: 'mp3' | 'mp4') => ({
    format: {
      format_name: k === 'mp3' ? 'mp3' : 'mov,mp4,m4a,3gp,3g2,mj2',
      bit_rate: m[k].bitRate,
      duration: m[k].duration
    },
    streams: m[k].streams.map((s: Record<string, unknown>) => ({
      codec_type: s.type,
      codec_name: s.codec,
      width: s.width,
      height: s.height,
      bit_rate: s.bit_rate
    }))
  })
  const mp3 = parseFfprobe(asProbe('mp3'))!
  const mp4 = parseFfprobe(asProbe('mp4'))!

  it('ignores the mjpeg cover', () => {
    expect(mp3).toMatchObject({
      container: 'mp3',
      acodec: 'mp3',
      bitrateKbps: 192,
      vcodec: undefined
    })
    expect(mp4).toMatchObject({ container: 'mp4', vcodec: 'h264', acodec: 'aac', height: 720 })
  })
  it('ignores attached_pic and uses the shorter side', () => {
    const p = parseFfprobe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 720, height: 1280 },
        {
          codec_type: 'video',
          codec_name: 'png',
          width: 5000,
          height: 5000,
          disposition: { attached_pic: 1 }
        },
        { codec_type: 'audio', codec_name: 'aac' }
      ]
    })
    expect(p).toMatchObject({ vcodec: 'h264', height: 720 })
    expect(parseFfprobe({ nope: 1 })).toBeNull()
  })
  it('matches the recorded outputs', () => {
    expect(matchesRequest({ format: 'mp3', bitrateKbps: 192 }, mp3)).toEqual({ ok: true })
    expect(matchesRequest({ format: 'mp3', bitrateKbps: 320 }, mp3).ok).toBe(false)
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, mp4)).toEqual({ ok: true })
    expect(matchesRequest({ format: 'mp4', maxHeight: 'best' }, mp4)).toEqual({ ok: true })
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, mp3).ok).toBe(false)
  })
  it('rejects taller than the cap; shorter passes with a notice', () => {
    const tall: ActualOutput = { ...mp4, height: 1080 }
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, tall)).toMatchObject({ ok: false })
    const short: ActualOutput = { ...mp4, height: 480 }
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, short)).toEqual({
      ok: true,
      notice: '720p unavailable, used 480p'
    })
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, { ...mp4, vcodec: 'vp9' }).ok).toBe(
      false
    )
    expect(matchesRequest({ format: 'mp4', maxHeight: 720 }, { ...mp4, acodec: 'opus' }).ok).toBe(
      false
    )
  })
})

describe('finalizeFile', () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-fin-'))
    const staged = async (name: string, body = 'new') => {
      const p = join(root, `staged-${name}`)
      await writeFile(p, body)
      return p
    }
    return { dest: join(root, 'dest'), staged }
  }
  it('never overwrites: collisions get (2), (3)', async () => {
    const { dest, staged } = await setup()
    const first = await finalizeFile(await staged('a', 'one'), dest)
    // staged name drives the final name, so reuse one name via separate dirs
    const mk = async (body: string) => {
      const p = first.replace(dest, join(dest, '..')) // sibling path with same basename
      await writeFile(p, body)
      return p
    }
    const second = await finalizeFile(await mk('two'), dest)
    const third = await finalizeFile(await mk('three'), dest)
    expect(second).toBe(`${first} (2)`)
    expect(third.endsWith('staged-a (3)')).toBe(true)
    expect(await readFile(first, 'utf8')).toBe('one')
    expect(await readFile(second, 'utf8')).toBe('two')
  })
  it('keeps pre-existing destination bytes and removes the source', async () => {
    const { dest, staged } = await setup()
    await finalizeFile(await staged('x.mp3', 'seed'), dest) // creates dest/staged-x.mp3 = seed
    const s = await staged('x.mp3')
    const out = await finalizeFile(s, dest)
    expect(out.endsWith('staged-x (2).mp3')).toBe(true)
    expect(await readFile(join(dest, 'staged-x.mp3'), 'utf8')).toBe('seed')
    await expect(readFile(s)).rejects.toThrow()
  })
  it('a missing staged file throws and never deletes a same-named destination file', async () => {
    const { dest, staged } = await setup()
    const existing = await finalizeFile(await staged('y.mp3', 'user file'), dest)
    await expect(finalizeFile(join(dest, '..', 'staged-y.mp3'), dest)).rejects.toThrow()
    expect(await readFile(existing, 'utf8')).toBe('user file')
  })
  it('makes reserved names, trailing dots and long names safe', async () => {
    const dest = join((await setup()).dest, 'd'.repeat(120)) // long dir shrinks the name budget
    const base = await mkdtemp(join(tmpdir(), 'of-src-'))
    const run = async (name: string) => {
      const p = join(base, name)
      await writeFile(p, 'x')
      return (await finalizeFile(p, dest)).slice(dest.length + 1)
    }
    expect(await run('CON.mp3')).toBe('_CON.mp3')
    expect(await run('song. .mp3')).toBe('song.mp3')
    const long = await run(`${'a'.repeat(150)} [aqz-KE-bpKQ].mp3`)
    expect(long.endsWith(' [aqz-KE-bpKQ].mp3')).toBe(true)
    expect(join(dest, long).length).toBeLessThanOrEqual(259)
    expect((await readdir(dest)).length).toBe(3)
  })
})
