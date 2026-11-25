import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { DownloadJob } from '../../src/shared/download-job.js'
import { createDownloadService } from '../../src/main/downloads/service.js'
import type { SpawnFn } from '../../src/main/engine/process.js'

const source = {
  provider: 'youtube' as const,
  sourceId: 'aqz-KE-bpKQ',
  url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  title: 'Sample'
}
const job = (id: string, destination: string): DownloadJob => ({
  id,
  source,
  destination,
  options: { format: 'mp3', bitrateKbps: 192 }
})
const mp3Probe = {
  format: { format_name: 'mp3', bit_rate: 192000, duration: 4 },
  streams: [{ codec_type: 'audio', codec_name: 'mp3', bit_rate: 192000 }]
}

function spawnFor(
  behavior: (args: string[], stdout: PassThrough, stderr: PassThrough, child: EventEmitter) => void
): SpawnFn {
  return (_exe, args) => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdout: PassThrough
      stderr: PassThrough
    }
    child.pid = 12345
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    queueMicrotask(() => behavior(args, child.stdout, child.stderr, child))
    return child as unknown as ChildProcess
  }
}

function finish(child: EventEmitter, stdout: PassThrough, stderr: PassThrough, code = 0) {
  stdout.end()
  stderr.end()
  child.emit('close', code)
}

describe('download service', () => {
  it('completes only a verified output and reports a fallback notice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    const dest = join(root, 'dest')
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor(async (args, out, err, child) => {
        const home = args.find((arg) => arg.startsWith('home:'))!.slice(5)
        await mkdir(home, { recursive: true })
        const path = join(home, 'Sample.mp3')
        await writeFile(path, 'verified bytes')
        out.write(`[OFPATH] ${JSON.stringify(path)}\n`)
        out.write('[OF] downloading|4|4|NA|1|0|1|id\n')
        finish(child, out, err)
      }),
      ffprobe: async () => mp3Probe
    })
    const updates: unknown[] = []
    const result = await service.run(job('one', dest), (event) => updates.push(event))
    expect(result).toMatchObject({
      ok: true,
      completed: { actualOutput: { container: 'mp3' }, finalPath: join(dest, 'Sample.mp3') }
    })
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'downloading', progressPercent: 100 })
    )
    await expect(readFile(join(dest, 'Sample.mp3'), 'utf8')).resolves.toBe('verified bytes')
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a failed conversion and a reported path outside staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    let mode: 'failed' | 'escape' = 'failed'
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor(async (args, out, err, child) => {
        const home = args.find((arg) => arg.startsWith('home:'))!.slice(5)
        await mkdir(home, { recursive: true })
        const path = mode === 'escape' ? join(root, 'outside.mp3') : join(home, 'bad.mp3')
        await writeFile(path, 'not complete')
        out.write(`[OFPATH] ${JSON.stringify(path)}\n`)
        err.write(mode === 'failed' ? 'ERROR: ffmpeg conversion failed\n' : '')
        finish(child, out, err, mode === 'failed' ? 1 : 0)
      }),
      ffprobe: async () => mp3Probe
    })
    expect(await service.run(job('bad', root), () => {})).toMatchObject({
      ok: false,
      failure: { code: 'postprocess_failed' }
    })
    mode = 'escape'
    expect(await service.run(job('escape', root), () => {})).toMatchObject({
      ok: false,
      failure: { code: 'postprocess_failed' }
    })
    await rm(root, { recursive: true, force: true })
  })

  it('classifies local disk and permission errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor(async (args, out, err, child) => {
        const home = args.find((arg) => arg.startsWith('home:'))!.slice(5)
        await mkdir(home, { recursive: true })
        const path = join(home, 'Sample.mp3')
        await writeFile(path, 'sample')
        out.write(`[OFPATH] ${JSON.stringify(path)}\n`)
        finish(child, out, err)
      }),
      ffprobe: async () => {
        const error = new Error('disk full') as NodeJS.ErrnoException
        error.code = 'ENOSPC'
        throw error
      }
    })
    expect(await service.run(job('disk', root), () => {})).toMatchObject({
      ok: false,
      failure: { code: 'disk_full' }
    })
    await rm(root, { recursive: true, force: true })
  })

  it('retries network failures at most twice and does not retry permanent failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    let count = 0
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor((_args, out, err, child) => {
        count++
        err.write('ERROR: Unable to download API page: connection reset\n')
        finish(child, out, err, 1)
      })
    })
    expect(await service.run(job('network', root), () => {})).toMatchObject({
      ok: false,
      failure: { code: 'network', retryable: true }
    })
    expect(count).toBe(3)
    count = 0
    const permanent = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage2'),
      spawn: spawnFor((_args, out, err, child) => {
        count++
        err.write('ERROR: This video is private\n')
        finish(child, out, err, 1)
      })
    })
    expect(await permanent.run(job('private', root), () => {})).toMatchObject({
      ok: false,
      failure: { code: 'private', retryable: false }
    })
    expect(count).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('uses a non-conflicting final name for a repeated download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor(async (args, out, err, child) => {
        const home = args.find((arg) => arg.startsWith('home:'))!.slice(5)
        await mkdir(home, { recursive: true })
        const path = join(home, 'Sample.mp3')
        await writeFile(path, 'sample')
        out.write(`[OFPATH] ${JSON.stringify(path)}\n`)
        finish(child, out, err)
      }),
      ffprobe: async () => mp3Probe
    })
    const first = await service.run(job('first', root), () => {})
    const second = await service.run(job('second', root), () => {})
    expect(first).toMatchObject({ ok: true, completed: { finalPath: join(root, 'Sample.mp3') } })
    expect(second).toMatchObject({
      ok: true,
      completed: { finalPath: join(root, 'Sample (2).mp3') }
    })
    await rm(root, { recursive: true, force: true })
  })

  it('cancel waits for process termination and staging cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor((_args, out, err, child) => {
        setTimeout(() => finish(child, out, err, 1), 20)
      }),
      kill: async () => {}
    })
    const run = service.run(job('cancel', root), () => {})
    await new Promise((resolve) => setTimeout(resolve, 5))
    await service.cancel('cancel')
    expect(await run).toMatchObject({ ok: false })
    await expect(readFile(join(root, 'cancel-partial'))).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it('cancellation during verification cannot finalize a stale completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'of-service-'))
    let enteredProbe!: () => void
    let releaseProbe!: () => void
    const probing = new Promise<void>((resolve) => (enteredProbe = resolve))
    const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve))
    const service = createDownloadService({
      paths: { ytDlp: 'yt-dlp', ffmpegDir: 'bin', ffprobe: 'ffprobe', deno: 'deno' },
      stagingRoot: join(root, 'stage'),
      spawn: spawnFor(async (args, out, err, child) => {
        const home = args.find((arg) => arg.startsWith('home:'))!.slice(5)
        await mkdir(home, { recursive: true })
        const path = join(home, 'Sample.mp3')
        await writeFile(path, 'staged')
        out.write(`[OFPATH] ${JSON.stringify(path)}\n`)
        finish(child, out, err)
      }),
      ffprobe: async () => {
        enteredProbe()
        await probeGate
        return mp3Probe
      }
    })
    const run = service.run(job('late-cancel', root), () => {})
    await probing
    let cancelDone = false
    const cancel = service.cancel('late-cancel').then(() => (cancelDone = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(cancelDone).toBe(false)
    releaseProbe()
    await cancel
    expect(await run).toMatchObject({ ok: false })
    await expect(readFile(join(root, 'Sample.mp3'))).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })
})
