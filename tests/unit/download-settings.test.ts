import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJsonStore } from '../../src/main/persistence/json-store.js'
import { createDownloadSettings, type DownloadSettings } from '../../src/main/settings/downloads.js'
import { z } from 'zod'

describe('download settings', () => {
  it('persists separate absolute folders and falls back from relative stored data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'of-settings-'))
    const store = createJsonStore<DownloadSettings>(dir, 'settings.json', {
      version: 1,
      defaults: () => ({
        musicFolder: 'relative',
        videoFolder: 'relative',
        concurrency: 1 as const
      }),
      validator: z.object({
        musicFolder: z.string(),
        videoFolder: z.string(),
        concurrency: z.union([z.literal(1), z.literal(2), z.literal(3)])
      })
    })
    const settings = createDownloadSettings(store, {
      music: join(dir, 'music-default'),
      video: join(dir, 'video-default')
    })
    await settings.setFolder('music', join(dir, 'music'))
    expect(await settings.getFolder('music')).toBe(join(dir, 'music'))
    expect(await settings.getFolder('video')).toBe(join(dir, 'video-default'))
    await settings.setConcurrency(3)
    expect(await settings.getSettings()).toMatchObject({ concurrency: 3 })
    await expect(settings.setFolder('video', 'relative')).rejects.toThrow(/absolute/)
    await rm(dir, { recursive: true, force: true })
  })

  it('migrates the previous single-folder setting to both formats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'of-settings-'))
    await writeFile(
      join(dir, 'download-settings.json'),
      JSON.stringify({ schemaVersion: 1, data: { downloadFolder: join(dir, 'saved') } })
    )
    const store = createJsonStore(dir, 'download-settings.json', {
      version: 3,
      defaults: () => ({ musicFolder: dir, videoFolder: dir, concurrency: 1 as const }),
      validator: z.object({
        musicFolder: z.string(),
        videoFolder: z.string(),
        concurrency: z.union([z.literal(1), z.literal(2), z.literal(3)])
      }),
      migrations: {
        1: (data) => ({
          musicFolder: (data as { downloadFolder: string }).downloadFolder,
          videoFolder: (data as { downloadFolder: string }).downloadFolder
        }),
        2: (data) => ({ ...(data as { musicFolder: string; videoFolder: string }), concurrency: 1 })
      }
    })
    const settings = createDownloadSettings(store, dir)
    expect(await settings.getFolder('music')).toBe(join(dir, 'saved'))
    expect(await settings.getFolder('video')).toBe(join(dir, 'saved'))
    await rm(dir, { recursive: true, force: true })
  })
})
