import { dialog, ipcMain } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import { guard } from '../ipc.js'
import { createJsonStore, type JsonStore } from '../persistence/json-store.js'

const settingsSchema = z.object({
  musicFolder: z.string().min(1).max(4096),
  videoFolder: z.string().min(1).max(4096),
  concurrency: z.union([z.literal(1), z.literal(2), z.literal(3)])
})
export type DownloadSettings = z.infer<typeof settingsSchema>
export type DownloadFormat = 'music' | 'video'
export type DownloadFolderDefaults = string | { music: string; video: string }

const defaultPath = (defaults: DownloadFolderDefaults, format: DownloadFormat) =>
  path.resolve(typeof defaults === 'string' ? defaults : defaults[format])

export function createDownloadSettings(
  store: JsonStore<DownloadSettings>,
  defaultFolder: DownloadFolderDefaults
) {
  return {
    async getSettings(): Promise<DownloadSettings> {
      const saved = await store.read()
      return {
        musicFolder: path.isAbsolute(saved.musicFolder)
          ? path.resolve(saved.musicFolder)
          : defaultPath(defaultFolder, 'music'),
        videoFolder: path.isAbsolute(saved.videoFolder)
          ? path.resolve(saved.videoFolder)
          : defaultPath(defaultFolder, 'video'),
        concurrency: saved.concurrency
      }
    },
    async getFolder(format: DownloadFormat): Promise<string> {
      const folder = (await store.read())[format === 'music' ? 'musicFolder' : 'videoFolder']
      return path.isAbsolute(folder) ? path.resolve(folder) : defaultPath(defaultFolder, format)
    },
    async setFolder(format: DownloadFormat, folder: string): Promise<string> {
      if (!path.isAbsolute(folder)) throw new Error('Download folder must be an absolute path')
      const resolved = path.resolve(folder)
      const current = await store.read()
      await store.write({
        ...current,
        [format === 'music' ? 'musicFolder' : 'videoFolder']: resolved
      })
      return resolved
    },
    async setConcurrency(concurrency: 1 | 2 | 3): Promise<void> {
      const current = await store.read()
      await store.write({ ...current, concurrency })
    }
  }
}

/** Registers main-process folder setting and native picker handlers. */
export function registerDownloadSettingsIpc(
  uiOrigin: string,
  userDataDir: string,
  defaultFolder: DownloadFolderDefaults,
  chooseFolder: typeof dialog.showOpenDialog = dialog.showOpenDialog,
  onConcurrencyChanged?: (concurrency: 1 | 2 | 3) => void | Promise<void>
): void {
  const store = createJsonStore(userDataDir, 'download-settings.json', {
    version: 3,
    defaults: () => ({
      musicFolder: defaultPath(defaultFolder, 'music'),
      videoFolder: defaultPath(defaultFolder, 'video'),
      concurrency: 1 as const
    }),
    validator: settingsSchema,
    migrations: {
      1: (data) => {
        const old = z.object({ downloadFolder: z.string().min(1).max(4096) }).parse(data)
        return { musicFolder: old.downloadFolder, videoFolder: old.downloadFolder }
      },
      2: (data) => ({ ...(data as { musicFolder: string; videoFolder: string }), concurrency: 1 })
    }
  })
  const settings = createDownloadSettings(store, defaultFolder)
  const format = z.enum(['music', 'video'])
  ipcMain.handle(
    'settings:downloads:get',
    guard(uiOrigin, z.undefined(), () => settings.getSettings())
  )
  ipcMain.handle(
    'settings:downloads:set-concurrency',
    guard(uiOrigin, z.union([z.literal(1), z.literal(2), z.literal(3)]), async (value) => {
      await settings.setConcurrency(value)
      await onConcurrencyChanged?.(value)
    })
  )
  ipcMain.handle(
    'settings:downloads:get-folder',
    guard(uiOrigin, format, (kind) => settings.getFolder(kind))
  )
  ipcMain.handle(
    'settings:downloads:choose-folder',
    guard(uiOrigin, format, async (kind) => {
      const result = await chooseFolder({
        title: 'Choose download folder',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled || !result.filePaths[0]
        ? null
        : settings.setFolder(kind, result.filePaths[0])
    })
  )
}
