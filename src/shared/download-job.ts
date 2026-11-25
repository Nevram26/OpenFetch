import type { MediaSource } from './api.js'
import type { ActualOutput, DownloadOptions } from './download-options.js'
import type { ErrorCode } from './errors.js'

export type DownloadStatus = 'resolving' | 'downloading' | 'processing'

export interface DownloadJob {
  id: string
  source: MediaSource
  options: DownloadOptions
  destination: string
}

export interface DownloadUpdate {
  status: DownloadStatus
  progressPercent?: number
  downloadedBytes?: number
  totalBytes?: number
  speed?: number
  eta?: number
  notice?: string
}

export interface CompletedDownload {
  jobId: string
  source: MediaSource
  options: DownloadOptions
  actualOutput: ActualOutput
  finalPath: string
}

export type DownloadRunResult =
  | { ok: true; completed: CompletedDownload }
  | { ok: false; failure: { code: ErrorCode; message: string; retryable: boolean } }
