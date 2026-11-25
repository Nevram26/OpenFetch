import { z } from 'zod'
import type { Dialog, IpcMain, Shell } from 'electron'
import { guard } from '../ipc.js'
import { createLibraryService } from './service.js'

export function registerLibraryIpc(options: {
  ipcMain: IpcMain
  allowedOrigin: string
  dataDir: string
  dialog: Dialog
  shell: Shell
}): void {
  const { ipcMain, allowedOrigin, dataDir, dialog, shell } = options
  const library = createLibraryService(dataDir)
  const id = z.string().uuid()
  ipcMain.handle(
    'library:list',
    guard(allowedOrigin, z.undefined(), () => library.list())
  )
  ipcMain.handle(
    'library:removeRecord',
    guard(allowedOrigin, id, (itemId) => library.removeRecord(itemId))
  )
  ipcMain.handle(
    'library:deleteFile',
    guard(allowedOrigin, id, async (itemId) => {
      const item = await library.item(itemId)
      const answer = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Delete file', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Delete downloaded file?',
        message: `Delete "${item.source.title}" from your device?`,
        detail: 'This permanently deletes the tracked media file.'
      })
      if (answer.response === 0) await library.deleteFile(itemId)
    })
  )
  ipcMain.handle(
    'library:openFile',
    guard(allowedOrigin, id, async (itemId) => {
      const error = await shell.openPath(await library.filePath(itemId))
      if (error) throw new Error(error)
    })
  )
  ipcMain.handle(
    'library:revealFile',
    guard(allowedOrigin, id, async (itemId) => {
      shell.showItemInFolder(await library.filePath(itemId))
    })
  )
}
