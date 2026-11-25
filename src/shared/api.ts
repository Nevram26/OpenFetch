// The complete surface the preload exposes to the renderer as `window.openfetch`.
// Every function maps to one validated IPC channel in the main process.

export interface AppInfo {
  version: string
  electron: string
  chrome: string
}

export interface OpenFetchApi {
  getAppInfo(): Promise<AppInfo>
}
