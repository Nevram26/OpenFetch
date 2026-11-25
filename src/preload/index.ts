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
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text)
}

contextBridge.exposeInMainWorld('openfetch', api)
