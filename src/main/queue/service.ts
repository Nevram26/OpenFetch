import { randomUUID } from 'node:crypto'
import type { DownloadRunResult, DownloadUpdate } from '../../shared/download-job.js'
import {
  assertTransition,
  duplicateKey,
  queueDataSchema,
  type QueueJob,
  type QueueStatus
} from '../../shared/queue.js'
import type { MediaSource } from '../../shared/api.js'
import type { DownloadOptions } from '../../shared/download-options.js'

type Store = { read(): Promise<QueueJob[]>; write(data: QueueJob[]): Promise<void> }
type Runner = {
  run(
    job: Pick<QueueJob, 'id' | 'source' | 'options' | 'destination'>,
    update: (u: DownloadUpdate) => void
  ): Promise<DownloadRunResult>
  cancel(id: string): Promise<void>
  shutdown(): Promise<void>
}
type Options = {
  store: Store
  runner: Runner
  completed?: (result: Extract<DownloadRunResult, { ok: true }>['completed']) => Promise<void>
  concurrency?: number
  now?: () => string
}
const terminal = new Set<QueueStatus>(['completed', 'failed', 'canceled', 'interrupted'])

export function createDownloadQueue(opts: Options) {
  const now = opts.now ?? (() => new Date().toISOString())
  let concurrency = Math.max(1, Math.min(3, opts.concurrency ?? 1))
  let jobs: QueueJob[] = []
  let loaded = false
  let initPromise: Promise<QueueJob[]> | undefined
  let pumping = false
  let closing = false
  let resumePending = false
  const active = new Set<string>()
  const completing = new Map<string, Promise<void>>()
  const subscribers = new Set<(jobs: QueueJob[]) => void>()
  let writes = Promise.resolve()
  const persist = () => {
    const snapshot = structuredClone(jobs)
    writes = writes.catch(() => {}).then(() => opts.store.write(snapshot))
    return writes.then(() => {
      const snapshot = list()
      for (const f of subscribers) f(snapshot)
    })
  }
  const mutate = (id: string, fn: (job: QueueJob) => QueueJob) => {
    const i = jobs.findIndex((j) => j.id === id)
    if (i < 0) throw new Error('Download job not found')
    jobs = jobs.map((j, n) => (n === i ? fn(j) : j))
  }
  const transition = (id: string, status: QueueStatus, extra: Partial<QueueJob> = {}) => {
    mutate(id, (j) => {
      assertTransition(j.status, status)
      return { ...j, ...extra, status, updatedAt: now() }
    })
  }
  async function initialize(): Promise<QueueJob[]> {
    if (loaded) return list()
    if (initPromise) return initPromise
    initPromise = (async () => {
      jobs = queueDataSchema.parse(await opts.store.read())
      let changed = false
      jobs = jobs.map((j) => {
        if (['resolving', 'downloading', 'processing', 'canceling'].includes(j.status)) {
          changed = true
          return {
            ...j,
            status: 'interrupted',
            errorMessage: 'Application closed while this download was active.',
            updatedAt: now()
          }
        }
        if (j.status === 'queued') changed = true
        return j
      })
      loaded = true
      resumePending = jobs.some((j) => j.status === 'queued')
      if (changed) await persist()
      return list()
    })()
    try {
      return await initPromise
    } finally {
      initPromise = undefined
    }
  }
  function list(): QueueJob[] {
    return structuredClone(jobs)
  }
  async function enqueue(
    entries: { source: MediaSource; options: DownloadOptions; destination: string }[],
    confirmedDuplicates = false
  ): Promise<string[]> {
    if (!loaded) await initialize()
    if (!entries.length || entries.length > 200)
      throw new Error('Select between 1 and 200 downloads')
    const seen = new Set(
      jobs
        .filter((j) => !terminal.has(j.status) || j.status === 'completed')
        .map((j) => duplicateKey(j.source, j.options, j.destination))
    )
    const duplicates = entries.filter((e) => {
      const key = duplicateKey(e.source, e.options, e.destination)
      const duplicate = seen.has(key)
      seen.add(key)
      return duplicate
    })
    if (duplicates.length && !confirmedDuplicates)
      throw Object.assign(
        new Error('DUPLICATE_DOWNLOAD: Some downloads already exist in the queue or library.'),
        {
          code: 'duplicate'
        }
      )
    const batchId = entries.length > 1 ? randomUUID() : undefined
    const added = entries.map((e) => {
      const t = now()
      return {
        id: randomUUID(),
        ...(batchId ? { batchId } : {}),
        ...e,
        status: 'queued' as const,
        attempts: 0,
        createdAt: t,
        updatedAt: t
      }
    })
    if (jobs.length + added.length > 1000) throw new Error('Download queue is full')
    jobs = [...jobs, ...added]
    await persist()
    void pump()
    return added.map((j) => j.id)
  }
  async function pump(): Promise<void> {
    if (pumping || closing || resumePending || !loaded) return
    pumping = true
    try {
      while (!closing && active.size < concurrency) {
        const next = jobs.find((j) => j.status === 'queued' && !active.has(j.id))
        if (!next) break
        active.add(next.id)
        void execute(next.id)
      }
    } finally {
      pumping = false
    }
  }
  async function execute(id: string): Promise<void> {
    try {
      transition(id, 'resolving', { attempts: jobs.find((j) => j.id === id)!.attempts + 1 })
      await persist()
      const current = jobs.find((j) => j.id === id)!
      const result = await opts.runner.run(current, (u) => {
        const j = jobs.find((x) => x.id === id)
        if (!j || j.status === 'canceling') return
        const status = u.status
        if (j.status !== status) {
          if (status === 'processing' && j.status === 'resolving') transition(id, 'downloading')
          transition(id, status, {
            progressPercent: u.progressPercent,
            downloadedBytes: u.downloadedBytes,
            totalBytes: u.totalBytes,
            speedBytesPerSecond: u.speed,
            etaSeconds: u.eta,
            notice: u.notice
          })
        } else
          mutate(id, (x) => ({
            ...x,
            progressPercent: u.progressPercent,
            downloadedBytes: u.downloadedBytes,
            totalBytes: u.totalBytes,
            speedBytesPerSecond: u.speed,
            etaSeconds: u.eta,
            notice: u.notice,
            updatedAt: now()
          }))
        void persist().catch(() => {})
      })
      const job = jobs.find((j) => j.id === id)
      if (!job || job.status === 'canceling') {
        if (job) transition(id, 'canceled')
        await persist()
        return
      }
      if (result.ok) {
        if (job.status === 'resolving') transition(id, 'downloading')
        if (job.status !== 'processing') transition(id, 'processing')
        // The file is finalized; cancellation must wait for its library record to commit.
        const completion = (async () => {
          await opts.completed?.(result.completed)
          transition(id, 'completed', {
            outputPath: result.completed.finalPath,
            progressPercent: 100,
            errorCode: undefined,
            errorMessage: undefined
          })
          await persist()
        })()
        completing.set(id, completion)
        await completion
      } else {
        transition(id, 'failed', {
          errorCode: result.failure.code,
          errorMessage: result.failure.message
        })
        await persist()
      }
    } catch (e) {
      const j = jobs.find((x) => x.id === id)
      if (j && !terminal.has(j.status) && j.status !== 'canceling') {
        if (j.status !== 'failed')
          transition(id, 'failed', {
            errorCode: 'unknown',
            errorMessage: e instanceof Error ? e.message : 'Download failed'
          })
        await persist().catch(() => {})
      }
    } finally {
      completing.delete(id)
      active.delete(id)
      void pump()
    }
  }
  async function cancel(id: string): Promise<void> {
    if (!loaded) await initialize()
    if (completing.has(id)) return completing.get(id)
    const job = jobs.find((j) => j.id === id)
    if (!job) throw new Error('Download job not found')
    if (job.status === 'queued') {
      transition(id, 'canceled')
      await persist()
      return
    }
    if (!['resolving', 'downloading', 'processing'].includes(job.status))
      throw new Error('Download cannot be canceled')
    transition(id, 'canceling')
    await persist()
    await opts.runner.cancel(id)
  }
  async function retry(id: string): Promise<void> {
    if (!loaded) await initialize()
    transition(id, 'queued', {
      errorCode: undefined,
      errorMessage: undefined,
      progressPercent: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      speedBytesPerSecond: undefined,
      etaSeconds: undefined
    })
    await persist()
    void pump()
  }
  async function resume(): Promise<void> {
    if (!loaded) await initialize()
    for (const j of jobs.filter((j) => j.status === 'interrupted'))
      transition(j.id, 'queued', { errorMessage: undefined })
    resumePending = false
    await persist()
    void pump()
  }
  async function clearFinished(): Promise<void> {
    jobs = jobs.filter((j) => !terminal.has(j.status))
    await persist()
  }
  async function shutdown(): Promise<void> {
    closing = true
    await opts.runner.shutdown()
    await persist()
  }
  return {
    initialize,
    list,
    enqueue,
    cancel,
    retry,
    resume,
    clearFinished,
    shutdown,
    subscribe(f: (jobs: QueueJob[]) => void) {
      subscribers.add(f)
      return () => subscribers.delete(f)
    },
    setConcurrency(value: number) {
      if (!Number.isInteger(value) || value < 1 || value > 3)
        throw new Error('Concurrency must be between 1 and 3')
      concurrency = value
      void pump()
    },
    get hasActive() {
      return active.size > 0
    },
    get hasQueuedRecovery() {
      return resumePending
    }
  }
}
