import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { BinaryPaths } from './binaries.js'
import { killTree } from './kill-tree.js'

export type SpawnFn = (exe: string, args: string[], options: SpawnOptions) => ChildProcess

export interface EngineOptions {
  paths: BinaryPaths
  spawn?: SpawnFn
  kill?: (pid: number) => Promise<void>
  /** Combined stdout + stderr cap. */
  maxOutputBytes?: number
  timeoutMs?: number
  /** Called once per complete line, per stream; a trailing partial line is flushed at the end. */
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}

export interface EngineResult {
  /** null when the process ended without an exit code. yt-dlp killed by taskkill exits 1, so use `cancelled`. */
  exitCode: number | null
  stdout: string
  stderr: string
  cancelled: boolean
  timedOut: boolean
  outputTooLarge: boolean
}

export interface EngineRun {
  /** Rejects only when the process cannot be started (e.g. ENOENT). */
  done: Promise<EngineResult>
  cancel(): void
}

/** Shared prefix of every yt-dlp call; the per-call args follow (and put `--` before any URL or query). */
export function baseArgs(p: BinaryPaths): string[] {
  return [
    '--ignore-config',
    '--no-update',
    '--js-runtimes',
    `deno:${p.deno}`,
    '--ffmpeg-location',
    p.ffmpegDir
  ]
}

export function runEngine(args: string[], opts: EngineOptions): EngineRun {
  const { maxOutputBytes = 16 * 1024 * 1024, timeoutMs = 60_000 } = opts
  const child = (opts.spawn ?? nodeSpawn)(opts.paths.ytDlp, [...baseArgs(opts.paths), ...args], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const kill = opts.kill ?? killTree
  const text = { stdout: '', stderr: '' }
  let bytes = 0
  let closed = false
  let cancelled = false
  let timedOut = false
  let outputTooLarge = false

  const stop = () => {
    if (!closed && child.pid) kill(child.pid).catch(() => {}) // ponytail: a failed kill is retried by nothing; the timeout still fires first
  }

  function readLines(stream: Readable, which: 'stdout' | 'stderr') {
    stream.setEncoding('utf8') // decodes multi-byte characters split across chunks
    let partial = ''
    stream.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxOutputBytes) {
        if (!outputTooLarge) {
          outputTooLarge = true
          stop()
        }
        return
      }
      text[which] += chunk
      if (!opts.onLine) return
      const lines = (partial + chunk).split(/\r?\n/)
      partial = lines.pop()!
      for (const line of lines) opts.onLine(which, line)
    })
    stream.on('end', () => partial && opts.onLine?.(which, partial))
  }
  readLines(child.stdout!, 'stdout')
  readLines(child.stderr!, 'stderr')

  const timer = setTimeout(() => ((timedOut = true), stop()), timeoutMs)
  const done = new Promise<EngineResult>((resolve, reject) => {
    child.once('error', (e) => (clearTimeout(timer), (closed = true), reject(e)))
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      closed = true
      resolve({ exitCode, ...text, cancelled, timedOut, outputTooLarge })
    })
  })

  return {
    done,
    cancel() {
      if (closed) return
      cancelled = true
      stop()
    }
  }
}
