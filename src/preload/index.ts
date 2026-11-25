import { contextBridge, ipcRenderer } from 'electron'
import type { OpenFetchApi } from '../shared/api.js'

// Narrow, typed functions only: never expose ipcRenderer or arbitrary channel names.
const api: OpenFetchApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info')
}

contextBridge.exposeInMainWorld('openfetch', api)
