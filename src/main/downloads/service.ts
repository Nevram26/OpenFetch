import { execFile as nodeExecFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { downloadOptionsSchema } from '../../shared/download-options.js'
import type {
  CompletedDownload,
  DownloadJob,
  DownloadRunResult,
  DownloadUpdate
} from '../../shared/download-job.js'
import { classifyError, type ErrorCode } from '../../shared/errors.js'
import { parseSourceUrl } from '../../shared/source-url.js'
import { buildDownloadArgs } from './args.js'
import { finalizeFile } from './finalize.js'
import { parseLine } from './progress.js'
import { matchesRequest, parseFfprobe } from './verify.js'
import { runEngine, type EngineOptions, type EngineRun } from '../engine/process.js'
import { removeStaging } from '../engine/kill-tree.js'

const execFile = promisify(nodeExecFile)

export interface DownloadServiceOptions extends Omit<EngineOptions, 'timeoutMs' | 'onLine'> {
  ffprobe?: (path: string, signal: AbortSignal) => Promise<unknown>
  stagingRoot?: string
}

const failure = (code: ErrorCode, message: string): DownloadRunResult => ({
  ok: false,
  failure: { code, message, retryable: code === 'network' }
})

function localFailure(error: unknown, options: DownloadServiceOptions): ErrorCode {
  const e = error as NodeJS.ErrnoException
  if (['ENOSPC', 'EDQUOT'].includes(e.code ?? '')) return 'disk_full'
  if (['EACCES', 'EPERM', 'EROFS'].includes(e.code ?? '')) return 'permission_denied'
  if (e.code === 'ENOENT' && (e.path === options.paths.ytDlp || e.path === options.paths.ffprobe))
    return 'engine_missing'
  return 'postprocess_failed'
}

async function probeFile(path: string, ffprobe: string, signal: AbortSignal): Promise<unknown> {
  const execution = execFile(
    ffprobe,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
      signal
    }
  )
  const closed = new Promise<void>((resolve) => execution.child.once('close', () => resolve()))
  try {
    const { stdout } = await execution
    return JSON.parse(stdout)
  } finally {
    await closed
  }
}

function contained(root: string, file: string): boolean {
  const rel = relative(root, file)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export function createDownloadService(options: DownloadServiceOptions) {
  const active = new Map<string, EngineRun>()
  const lifetimes = new Map<string, Promise<DownloadRunResult>>()
  const probes = new Map<string, AbortController>()
  const canceled = new Set<string>()
  let shuttingDown = false
  const root = resolve(options.stagingRoot ?? join(tmpdir(), 'OpenFetch-downloads'))

  async function runJob(
    job: DownloadJob,
    onUpdate: (update: DownloadUpdate) => void,
    signal: AbortSignal
  ): Promise<DownloadRunResult> {
    const id = job.id
    try {
      if (shuttingDown) return failure('unknown', 'Download service is shutting down')
      if (!id || id.length > 128 || lifetimes.has(id))
        return failure('invalid_input', 'Invalid or active job id')
      const parsed = parseSourceUrl(job.source.url)
      if (
        !parsed.ok ||
        parsed.kind !== 'video' ||
        parsed.url !== job.source.url ||
        parsed.id !== job.source.sourceId
      )
        return failure('invalid_input', 'Download source is invalid')
      const parsedOptions = downloadOptionsSchema.parse(job.options)
      if (!isAbsolute(job.destination))
        return failure('invalid_input', 'Destination must be an absolute folder path')
      canceled.delete(id)
      onUpdate({ status: 'resolving' })

      for (let attempt = 0; attempt <= 2; attempt++) {
        if (canceled.has(id) || shuttingDown) return failure('unknown', 'Download canceled')
        let stagingDir: string | undefined
        let pathEvent: string | undefined
        try {
          await mkdir(root, { recursive: true })
          stagingDir = await mkdtemp(
            join(root, `${id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}-`)
          )
          const args = buildDownloadArgs(parsedOptions, { url: parsed.url, stagingDir })
          const engine = runEngine(args, {
            ...options,
            timeoutMs: 30 * 60_000,
            onLine: (stream, line) => {
              const event = parseLine(line, stream)
              if (!event) return
              if (event.kind === 'download') {
                onUpdate({
                  status: 'downloading',
                  progressPercent: event.percent,
                  downloadedBytes: event.downloadedBytes,
                  totalBytes: event.totalBytes,
                  speed: event.speed,
                  eta: event.eta
                })
              } else if (event.kind === 'postprocess') {
                onUpdate({ status: 'processing' })
              } else pathEvent = event.path
            }
          })
          active.set(id, engine)
          if (canceled.has(id) || shuttingDown) engine.cancel()
          const result = await engine.done
          active.delete(id)
          if (canceled.has(id) || result.cancelled || shuttingDown)
            return failure('unknown', 'Download canceled')
          if (result.timedOut) {
            const f = failure('network', 'Download timed out')
            if (attempt < 2) continue
            return f
          }
          if (result.exitCode !== 0 || result.outputTooLarge) {
            const code = result.outputTooLarge
              ? 'unknown'
              : classifyError(result.exitCode, result.stderr)
            if (code === 'network' && attempt < 2) continue
            return failure(code, result.stderr.slice(-2000) || 'Download process failed')
          }
          if (!pathEvent)
            return failure('postprocess_failed', 'Engine did not report an output file')
          const reported = resolve(pathEvent)
          const stageReal = await realpath(stagingDir)
          const reportedReal = await realpath(reported)
          if (!contained(stageReal, reportedReal))
            return failure('postprocess_failed', 'Reported output is outside job staging')
          const file = await lstat(reported)
          if (!file.isFile() || file.isSymbolicLink())
            return failure('postprocess_failed', 'Reported output is not a regular file')
          const probe = await (
            options.ffprobe ?? ((p, s) => probeFile(p, options.paths.ffprobe, s))
          )(reported, signal)
          const actualOutput = parseFfprobe(probe)
          if (!actualOutput)
            return failure('postprocess_failed', 'Could not verify output metadata')
          const match = matchesRequest(parsedOptions, actualOutput)
          if (!match.ok) return failure('postprocess_failed', match.reason)
          if (canceled.has(id) || shuttingDown) return failure('unknown', 'Download canceled')
          const finalPath = await finalizeFile(reported, job.destination)
          if (canceled.has(id) || shuttingDown) {
            await rm(finalPath, { force: true })
            return failure('unknown', 'Download canceled')
          }
          const completed: CompletedDownload = {
            jobId: id,
            source: job.source,
            options: parsedOptions,
            actualOutput,
            finalPath
          }
          onUpdate({ status: 'processing', ...(match.notice && { notice: match.notice }) })
          return { ok: true, completed }
        } catch (error) {
          active.delete(id)
          const code = localFailure(error, options)
          return failure(code, error instanceof Error ? error.message : String(error))
        } finally {
          active.delete(id)
          if (stagingDir) await removeStaging(root, stagingDir).catch(() => {})
        }
      }
      return failure('network', 'Automatic network retries exhausted')
    } catch (error) {
      return failure('invalid_input', error instanceof Error ? error.message : String(error))
    } finally {
      active.delete(id)
      canceled.delete(id)
    }
  }

  return {
    async run(
      job: DownloadJob,
      onUpdate: (update: DownloadUpdate) => void
    ): Promise<DownloadRunResult> {
      if (lifetimes.has(job.id)) return failure('invalid_input', 'Invalid or active job id')
      const controller = new AbortController()
      probes.set(job.id, controller)
      const task = runJob(job, onUpdate, controller.signal)
      if (job.id) lifetimes.set(job.id, task)
      try {
        return await task
      } finally {
        if (lifetimes.get(job.id) === task) lifetimes.delete(job.id)
        probes.delete(job.id)
      }
    },
    async cancel(id: string): Promise<void> {
      canceled.add(id)
      probes.get(id)?.abort()
      active.get(id)?.cancel()
      await lifetimes.get(id)
    },
    async shutdown(): Promise<void> {
      shuttingDown = true
      const ids = [...lifetimes.keys()]
      await Promise.all(
        ids.map(async (id) => {
          canceled.add(id)
          probes.get(id)?.abort()
          active.get(id)?.cancel()
          await lifetimes.get(id)
        })
      )
    }
  }
}

export type DownloadService = ReturnType<typeof createDownloadService>
