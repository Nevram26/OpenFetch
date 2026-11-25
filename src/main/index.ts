import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { APP_ORIGIN, APP_SCHEME, resolveAppFile } from './app-protocol.js'
import { guard, originOf } from './ipc.js'
import { registerEngineIpc } from './engine/ipc.js'
import {
  registerLibraryIpc,
  registerMediaProtocol,
  registerMediaSchemePrivileges
} from './library/index.js'
import type { AppInfo } from '../shared/api.js'

// Dev loads the electron-vite server; everything else loads the built UI over app://, never file://.
const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const uiOrigin = devUrl ? originOf(devUrl)! : APP_ORIGIN
const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url))

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

registerMediaSchemePrivileges(protocol)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'OpenFetch',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (originOf(url) !== uiOrigin) event.preventDefault()
  })
  win.on('closed', () => (mainWindow = null))
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`)
  mainWindow = win
}

if (!app.requestSingleInstanceLock()) {
  // Another OpenFetch is running: it gets focused via 'second-instance', and we leave
  // before touching any shared state (queue/settings JSON).
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)

    protocol.handle(APP_SCHEME, (request) => {
      const file = resolveAppFile(rendererDir, request.url)
      return file
        ? net.fetch(pathToFileURL(file).toString())
        : new Response('Not found', { status: 404 })
    })

    ipcMain.handle(
      'app:info',
      guard(uiOrigin, z.undefined(), (): AppInfo => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome
      }))
    )

    registerEngineIpc(uiOrigin)
    registerLibraryIpc({
      ipcMain,
      allowedOrigin: uiOrigin,
      dataDir: app.getPath('userData'),
      dialog,
      shell
    })
    registerMediaProtocol(protocol, app.getPath('userData'))

    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
