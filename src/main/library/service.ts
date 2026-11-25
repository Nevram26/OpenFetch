import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { createJsonStore } from '../persistence/json-store.js'
import { matchesRequest } from '../downloads/verify.js'
import { downloadOptionsSchema } from '../../shared/download-options.js'
import type { ActualOutput } from '../../shared/download-options.js'
import type { MediaSource } from '../../shared/api.js'
import type { LibraryEntry, LibraryItem } from '../../shared/library.js'

const sourceSchema = z.object({
  provider: z.literal('youtube'),
  sourceId: z.string().min(1),
  url: z.url(),
  title: z.string().min(1),
  channel: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  thumbnailUrl: z.url().optional(),
  viewCount: z.number().nonnegative().optional()
})
const actualSchema = z.object({
  container: z.enum(['mp3', 'mp4']),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  height: z.number().positive().optional(),
  bitrateKbps: z.number().positive().optional(),
  durationSeconds: z.number().nonnegative().optional()
})
const itemSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().min(1),
  source: sourceSchema,
  filePath: z.string().min(1),
  requested: downloadOptionsSchema,
  actual: actualSchema,
  sizeBytes: z.number().int().nonnegative(),
  addedAt: z.iso.datetime()
})
const dataSchema = z.object({ items: z.array(itemSchema) })
interface CompletedDownload {
  jobId: string
  source: MediaSource
  options: import('../../shared/download-options.js').DownloadOptions
  actualOutput: ActualOutput
  finalPath: string
}
const chains = new Map<string, Promise<unknown>>()
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(action)
  const tail = next.catch(() => {})
  chains.set(key, tail)
  void tail.then(() => chains.get(key) === tail && chains.delete(key))
  return next
}

export function createLibraryService(dataDir: string) {
  const key = path.resolve(dataDir, 'library.json')
  const store = createJsonStore(dataDir, 'library.json', {
    version: 1,
    defaults: () => ({ items: [] }),
    validator: dataSchema
  })
  async function tracked(id: string): Promise<LibraryItem> {
    const entry = (await store.read()).items.find((item) => item.id === id)
    if (!entry) throw new Error('Unknown library item')
    return entry
  }
  async function existingFile(item: LibraryItem): Promise<string | undefined> {
    const resolved = path.resolve(item.filePath)
    if (resolved !== item.filePath) return undefined
    try {
      const s = await fsp.lstat(resolved)
      return s.isFile() && !s.isSymbolicLink() ? resolved : undefined
    } catch {
      return undefined
    }
  }
  return {
    async recordCompleted(done: CompletedDownload): Promise<LibraryItem> {
      const opts = downloadOptionsSchema.parse(done.options)
      const output = actualSchema.parse(done.actualOutput)
      const match = matchesRequest(opts, output)
      if (!match.ok) throw new Error(`Output failed verification: ${match.reason}`)
      const filePath = path.resolve(done.finalPath)
      if (filePath !== done.finalPath)
        throw new Error('Output path must be absolute and normalized')
      const stat = await fsp.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('Completed output is not a regular file')
      const entry: LibraryItem = {
        id: randomUUID(),
        jobId: done.jobId,
        source: sourceSchema.parse(done.source),
        filePath,
        requested: opts,
        actual: output,
        sizeBytes: stat.size,
        addedAt: new Date().toISOString()
      }
      return serialize(key, async () => {
        const data = await store.read()
        data.items.unshift(entry)
        await store.write(data)
        return entry
      })
    },
    async list(): Promise<LibraryEntry[]> {
      return Promise.all(
        (await store.read()).items.map(async (item) => ({
          ...item,
          missing: !(await existingFile(item))
        }))
      )
    },
    async removeRecord(id: string): Promise<void> {
      return serialize(key, async () => {
        const data = await store.read()
        data.items = data.items.filter((item) => item.id !== id)
        await store.write(data)
      })
    },
    async deleteFile(id: string): Promise<void> {
      return serialize(key, async () => {
        const item = await tracked(id)
        const file = await existingFile(item)
        if (!file) throw new Error('Tracked file is missing or not a regular file')
        await fsp.unlink(file)
        const data = await store.read()
        data.items = data.items.filter((entry) => entry.id !== id)
        await store.write(data)
      })
    },
    async filePath(id: string): Promise<string> {
      const item = await tracked(id)
      const file = await existingFile(item)
      if (!file) throw new Error('Tracked file is missing or not a regular file')
      return file
    },
    async item(id: string): Promise<LibraryItem> {
      return tracked(id)
    }
  }
}
