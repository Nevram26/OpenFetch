import type { MediaSource } from './api.js'
import type { ActualOutput, DownloadOptions } from './download-options.js'

export interface LibraryItem {
  id: string
  jobId: string
  source: MediaSource
  filePath: string
  requested: DownloadOptions
  actual: ActualOutput
  sizeBytes: number
  addedAt: string
}

export interface LibraryEntry extends LibraryItem {
  missing: boolean
}

export const mediaUrl = (id: string): string => `media://${encodeURIComponent(id)}/`
