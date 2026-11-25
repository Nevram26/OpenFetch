// The complete surface the preload exposes to the renderer as `window.openfetch`.
// Every function maps to one validated IPC channel in the main process.
import type { ErrorCode } from './errors.js'
import type { LibraryEntry } from './library.js'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
}

/** Optional metadata is absent, never invented. */
export interface MediaSource {
  provider: 'youtube'
  sourceId: string
  url: string
  title: string
  channel?: string
  durationSeconds?: number
  thumbnailUrl?: string
  viewCount?: number
}

export interface PlaylistPreview {
  id: string
  title?: string
  entries: MediaSource[]
  /** Entries the engine returned without a usable id or title (unavailable, private...). */
  skipped: number
}

/** Engine calls never reject over IPC for expected failures; `cancelled` means superseded or stopped. */
export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; code: ErrorCode; stderrTail: string }

export interface OpenFetchApi {
  getAppInfo(): Promise<AppInfo>
  search(query: string, requestId: string): Promise<Outcome<MediaSource[]>>
  cancelSearch(requestId: string): Promise<void>
  inspect(url: string): Promise<Outcome<MediaSource>>
  inspectPlaylist(url: string): Promise<Outcome<PlaylistPreview>>
  historyList(): Promise<string[]>
  historyClear(): Promise<void>
  /** Clipboard write via main: the renderer has no clipboard permission (all permissions are denied). */
  copyText(text: string): Promise<void>
  libraryList(): Promise<LibraryEntry[]>
  libraryRemoveRecord(id: string): Promise<void>
  libraryDeleteFile(id: string): Promise<void>
  libraryOpenFile(id: string): Promise<void>
  libraryRevealFile(id: string): Promise<void>
}
