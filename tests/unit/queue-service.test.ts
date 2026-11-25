import { describe, expect, it, vi } from 'vitest'
import { assertTransition, transitions, type QueueJob } from '../../src/shared/queue.js'
import { createDownloadQueue } from '../../src/main/queue/service.js'
import type { MediaSource } from '../../src/shared/api.js'

const source: MediaSource = {
  provider: 'youtube',
  sourceId: 'abcdefghijk',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  title: 'Song'
}
const entry = {
  source,
  options: { format: 'mp3' as const, bitrateKbps: 192 as const },
  destination: 'C:/Downloads'
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('queue transition table', () => {
  it('allows only declared state changes', () => {
    const expected: Record<string, string[]> = {
      queued: ['resolving', 'canceled'],
      resolving: ['downloading', 'processing', 'failed', 'canceling'],
      downloading: ['processing', 'failed', 'canceling'],
      processing: ['completed', 'failed', 'canceling'],
      completed: [],
      failed: ['queued'],
      canceling: ['canceled'],
      canceled: ['queued'],
      interrupted: ['queued']
    }
    expect(transitions).toEqual(expected)
    for (const [from, allowed] of Object.entries(expected)) {
      for (const to of Object.keys(transitions)) {
        if (allowed.includes(to as never))
          expect(() => assertTransition(from as never, to as never)).not.toThrow()
        else expect(() => assertTransition(from as never, to as never)).toThrow()
      }
    }
  })
})

describe('download queue', () => {
  it('persists before running, processes FIFO, isolates failure and detects duplicates in batch', async () => {
    let saved: QueueJob[] = []
    const store = {
      read: async () => saved,
      write: async (v: QueueJob[]) => {
        saved = structuredClone(v)
      }
    }
    const order: string[] = []
    const runner = {
      run: vi.fn(async (job: QueueJob) => {
        order.push(job.source.title)
        return job.source.title === 'bad'
          ? {
              ok: false as const,
              failure: { code: 'unknown' as const, message: 'failed', retryable: false }
            }
          : {
              ok: true as const,
              completed: {
                jobId: job.id,
                source: job.source,
                options: job.options,
                actualOutput: { container: 'mp3' as const },
                finalPath: `/${job.id}.mp3`
              }
            }
      }),
      cancel: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {})
    }
    const q = createDownloadQueue({ store, runner, concurrency: 1 })
    await q.initialize()
    const items = [
      { ...entry, source: { ...source, title: 'first' } },
      {
        ...entry,
        source: {
          ...source,
          sourceId: 'lmnopqrstuv',
          url: 'https://www.youtube.com/watch?v=lmnopqrstuv',
          title: 'bad'
        }
      },
      {
        ...entry,
        source: {
          ...source,
          sourceId: 'zyxwvutsrq1',
          url: 'https://www.youtube.com/watch?v=zyxwvutsrq1',
          title: 'third'
        }
      }
    ]
    const ids = await q.enqueue(items)
    await tick()
    await tick()
    await tick()
    expect(saved.map((j) => j.id)).toEqual(ids)
    expect(order).toEqual(['first', 'bad', 'third'])
    expect(q.list().map((j) => j.status)).toEqual(['completed', 'failed', 'completed'])
    await expect(q.enqueue([entry, { ...entry }])).rejects.toMatchObject({ code: 'duplicate' })
    await q.retry(ids[1]!)
    await tick()
    await tick()
    expect(order.at(-1)).toBe('bad')
  })

  it('requires explicit recovery confirmation after restart', async () => {
    const stale: QueueJob = {
      id: 'cc497594-b7ca-44e9-8e33-98e6159590ea',
      ...entry,
      status: 'downloading',
      attempts: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    let saved = [stale]
    const store = {
      read: async () => saved,
      write: async (v: QueueJob[]) => {
        saved = structuredClone(v)
      }
    }
    const runner = {
      run: vi.fn(async () => ({
        ok: false as const,
        failure: { code: 'unknown' as const, message: 'x', retryable: false }
      })),
      cancel: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {})
    }
    const q = createDownloadQueue({ store, runner })
    await q.initialize()
    expect(q.list()[0]?.status).toBe('interrupted')
    await q.retry(stale.id).catch(() => {})
    expect(runner.run).not.toHaveBeenCalled()
    await q.resume()
    await tick()
    expect(runner.run).toHaveBeenCalledOnce()
  })

  it('caps concurrent jobs at the configured maximum', async () => {
    const release: (() => void)[] = []
    let running = 0,
      maximum = 0
    const store = { read: async () => [] as QueueJob[], write: async () => {} }
    const runner = {
      run: async () => {
        running++
        maximum = Math.max(maximum, running)
        await new Promise<void>((r) => release.push(r))
        running--
        return {
          ok: false as const,
          failure: { code: 'unknown' as const, message: 'done', retryable: false }
        }
      },
      cancel: async () => {},
      shutdown: async () => {}
    }
    const q = createDownloadQueue({ store, runner, concurrency: 3 })
    await q.initialize()
    await q.enqueue(
      [0, 1, 2, 3].map((i) => ({
        ...entry,
        source: {
          ...source,
          sourceId: `abcdefghij${i}`,
          url: `https://www.youtube.com/watch?v=abcdefghij${i}`,
          title: `${i}`
        }
      }))
    )
    await tick()
    expect(maximum).toBe(3)
    release.splice(0).forEach((r) => r())
    await tick()
    await tick()
    release.splice(0).forEach((r) => r())
    await tick()
    await tick()
    release.splice(0).forEach((r) => r())
  })
})
