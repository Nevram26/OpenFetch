import { contextBridge, ipcRenderer } from 'electron'
import type { OpenFetchApi } from '../shared/api.js'

// Narrow, typed functions only: never expose ipcRenderer or arbitrary channel names.
const api: OpenFetchApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  search: (query, requestId) => ipcRenderer.invoke('search:start', { query, requestId }),
  cancelSearch: (requestId) => ipcRenderer.invoke('search:cancel', requestId),
  inspect: (url) => ipcRenderer.invoke('media:inspect', url),
  inspectPlaylist: (url) => ipcRenderer.invoke('playlist:inspect', url),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  downloadsEnqueue: (entries, confirmDuplicates) =>
    ipcRenderer.invoke('downloads:enqueue', { entries, confirmDuplicates }),
  downloadsList: () => ipcRenderer.invoke('downloads:list'),
  downloadsHasRecovery: () => ipcRenderer.invoke('downloads:has-recovery'),
  downloadsCancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
  downloadsRetry: (id) => ipcRenderer.invoke('downloads:retry', id),
  downloadsClearFinished: () => ipcRenderer.invoke('downloads:clear-finished'),
  downloadsConfirmResume: () => ipcRenderer.invoke('downloads:confirm-resume'),
  downloadsOnChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, jobs: Parameters<typeof callback>[0]) =>
      callback(jobs)
    ipcRenderer.on('downloads:changed', listener)
    return () => ipcRenderer.removeListener('downloads:changed', listener)
  },
  downloadsGetFolder: (format) => ipcRenderer.invoke('settings:downloads:get-folder', format),
  downloadsChooseFolder: (format) => ipcRenderer.invoke('settings:downloads:choose-folder', format),
  downloadsGetSettings: () => ipcRenderer.invoke('settings:downloads:get'),
  downloadsSetConcurrency: (value) =>
    ipcRenderer.invoke('settings:downloads:set-concurrency', value),
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryRemoveRecord: (id) => ipcRenderer.invoke('library:removeRecord', id),
  libraryDeleteFile: (id) => ipcRenderer.invoke('library:deleteFile', id),
  libraryOpenFile: (id) => ipcRenderer.invoke('library:openFile', id),
  libraryRevealFile: (id) => ipcRenderer.invoke('library:revealFile', id)
}

contextBridge.exposeInMainWorld('openfetch', api)
