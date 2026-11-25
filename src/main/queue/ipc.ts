import { app, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import { guard } from '../ipc.js'
import { createJsonStore } from '../persistence/json-store.js'
import { createDownloadService } from '../downloads/service.js'
import { createDownloadQueue } from './service.js'
import { queueDataSchema } from '../../shared/queue.js'
import { downloadOptionsSchema } from '../../shared/download-options.js'
import { createLibraryService } from '../library/service.js'
import {
  registerDownloadSettingsIpc,
  createDownloadSettings,
  type DownloadSettings
} from '../settings/downloads.js'
import { binaryPaths } from '../engine/binaries.js'

const sourceSchema = z.strictObject({
  provider: z.literal('youtube'),
  sourceId: z.string().min(1).max(128),
  url: z.string().url().max(2048),
  title: z.string().min(1).max(1024),
  channel: z.string().max(512).optional(),
  durationSeconds: z.number().finite().nonnegative().optional(),
  thumbnailUrl: z.string().url().max(2048).optional(),
  viewCount: z.number().finite().nonnegative().optional()
})
const folderSchema = z.string().min(1).max(4096)

export function registerQueueIpc(
  uiOrigin: string,
  getWindow: () => BrowserWindow | null
): ReturnType<typeof createDownloadQueue> {
  const dataDir = app.getPath('userData')
  const music = path.join(app.getPath('downloads'), 'OpenFetch', 'Music')
  const videos = path.join(app.getPath('downloads'), 'OpenFetch', 'Videos')
  const settingsStore = createJsonStore<DownloadSettings>(dataDir, 'download-settings.json', {
    version: 3,
    defaults: () => ({ musicFolder: music, videoFolder: videos, concurrency: 1 }),
    validator: z.strictObject({
      musicFolder: folderSchema,
      videoFolder: folderSchema,
      concurrency: z.union([z.literal(1), z.literal(2), z.literal(3)])
    }),
    migrations: {
      1: (data) => {
        const old = z.object({ downloadFolder: folderSchema }).parse(data)
        return { musicFolder: old.downloadFolder, videoFolder: old.downloadFolder }
      },
      2: (data) => ({ ...(data as { musicFolder: string; videoFolder: string }), concurrency: 1 })
    }
  })
  const settings = createDownloadSettings(settingsStore, { music, video: videos })
  const store = createJsonStore(dataDir, 'download-queue.json', {
    version: 1,
    defaults: () => [],
    validator: queueDataSchema
  })
  const library = createLibraryService(dataDir)
  const queue = createDownloadQueue({
    store,
    runner: createDownloadService({ paths: binaryPaths() }),
    completed: async (item) => {
      await library.recordCompleted(item)
    }
  })
  registerDownloadSettingsIpc(uiOrigin, dataDir, { music, video: videos }, undefined, (n) =>
    queue.setConcurrency(n)
  )
  void settings.getSettings().then((s) => queue.setConcurrency(s.concurrency))
  const changed = () => getWindow()?.webContents.send('downloads:changed', queue.list())
  queue.subscribe(changed)
  const id = z.string().uuid()
  ipcMain.handle(
    'downloads:enqueue',
    guard(
      uiOrigin,
      z.strictObject({
        entries: z
          .array(
            z.strictObject({
              source: sourceSchema,
              options: downloadOptionsSchema,
              destination: folderSchema.optional()
            })
          )
          .min(1)
          .max(200),
        confirmDuplicates: z.boolean().optional()
      }),
      async ({ entries, confirmDuplicates }) => {
        const prepared = await Promise.all(
          entries.map(async (e) => ({
            ...e,
            destination:
              e.destination ??
              (await settings.getFolder(e.options.format === 'mp3' ? 'music' : 'video'))
          }))
        )
        if (!confirmDuplicates) {
          const existing = await library.list()
          if (
            prepared.some((candidate) =>
              existing.some(
                (item) =>
                  item.source.sourceId === candidate.source.sourceId &&
                  JSON.stringify(item.requested) === JSON.stringify(candidate.options) &&
                  path.dirname(item.filePath) === path.resolve(candidate.destination)
              )
            )
          )
            throw new Error(
              'DUPLICATE_DOWNLOAD: Some downloads already exist in the queue or library.'
            )
        }
        return queue.enqueue(prepared, confirmDuplicates)
      }
    )
  )
  ipcMain.handle(
    'downloads:list',
    guard(uiOrigin, z.undefined(), () => queue.list())
  )
  ipcMain.handle(
    'downloads:has-recovery',
    guard(uiOrigin, z.undefined(), () => queue.hasQueuedRecovery)
  )
  ipcMain.handle(
    'downloads:cancel',
    guard(uiOrigin, id, (jobId) => queue.cancel(jobId))
  )
  ipcMain.handle(
    'downloads:retry',
    guard(uiOrigin, id, (jobId) => queue.retry(jobId))
  )
  ipcMain.handle(
    'downloads:clear-finished',
    guard(uiOrigin, z.undefined(), () => queue.clearFinished())
  )
  ipcMain.handle(
    'downloads:confirm-resume',
    guard(uiOrigin, z.undefined(), () => queue.resume())
  )
  return queue
}
