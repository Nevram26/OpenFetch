import { spawn } from 'node:child_process'
import path from 'node:path'
import { app, clipboard, ipcMain } from 'electron'
import { z } from 'zod'
import { guard } from '../ipc.js'
import { createJsonStore } from '../persistence/json-store.js'
import { binaryPaths } from './binaries.js'
import type { SpawnFn } from './process.js'
import { createEngineService, createHistory, HISTORY_MAX, MAX_QUERY } from './service.js'

/** Dev/E2E only: replay a recorded fixture instead of running yt-dlp (ADR-007). Ignored when packaged. */
function fakeEngine(): SpawnFn | undefined {
  const fixture = app.isPackaged ? undefined : process.env['OPENFETCH_FAKE_ENGINE']
  if (!fixture) return undefined
  const script = path.join(app.getAppPath(), 'tests', 'fake-engine.mjs')
  return (_exe, _args, options) =>
    spawn(process.execPath, [script, fixture], {
      ...options,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
}

export function registerEngineIpc(uiOrigin: string): void {
  const engine = createEngineService({ paths: binaryPaths(), spawn: fakeEngine() })
  const history = createHistory(
    createJsonStore(app.getPath('userData'), 'search-history.json', {
      version: 1,
      defaults: () => [] as string[],
      validator: z.array(z.string().max(MAX_QUERY)).max(HISTORY_MAX)
    })
  )
  app.on('before-quit', () => engine.shutdown())

  const url = z.string().max(2048)
  ipcMain.handle(
    'search:start',
    guard(
      uiOrigin,
      z.strictObject({ query: z.string().max(MAX_QUERY), requestId: z.string().min(1).max(64) }),
      async ({ query, requestId }) => {
        const out = await engine.search(query, requestId)
        if (out.ok && query.trim()) await history.add(query).catch(() => {}) // history is best effort
        return out
      }
    )
  )
  ipcMain.handle(
    'search:cancel',
    guard(uiOrigin, z.string().min(1).max(64), (id) => engine.cancelSearch(id))
  )
  ipcMain.handle(
    'media:inspect',
    guard(uiOrigin, url, (u) => engine.inspect(u))
  )
  ipcMain.handle(
    'playlist:inspect',
    guard(uiOrigin, url, (u) => engine.inspectPlaylist(u))
  )
  ipcMain.handle(
    'history:list',
    guard(uiOrigin, z.undefined(), () => history.list())
  )
  ipcMain.handle(
    'history:clear',
    guard(uiOrigin, z.undefined(), () => history.clear())
  )
  ipcMain.handle(
    'clipboard:write',
    guard(uiOrigin, z.string().max(4096), (text) => clipboard.writeText(text))
  )
}
