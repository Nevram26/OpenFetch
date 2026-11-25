import path from 'node:path'
import { app } from 'electron'

export interface BinaryPaths {
  ytDlp: string
  /** Folder holding ffmpeg.exe and ffprobe.exe (for --ffmpeg-location). */
  ffmpegDir: string
  ffprobe: string
  deno: string
}

/** D4 = onedir: `yt-dlp/yt-dlp.exe` plus the other tools beside it. All paths absolute. */
export function binaryPaths(): BinaryPaths {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'binaries')
    : path.join(app.getAppPath(), 'resources', 'binaries')
  return {
    ytDlp: path.join(root, 'yt-dlp', 'yt-dlp.exe'),
    ffmpegDir: root,
    ffprobe: path.join(root, 'ffprobe.exe'),
    deno: path.join(root, 'deno.exe')
  }
}
