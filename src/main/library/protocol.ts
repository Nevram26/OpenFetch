import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { Protocol } from 'electron'
import { createLibraryService } from './service.js'

export function registerMediaSchemePrivileges(
  protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>
): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, stream: true } }
  ])
}

export function parseByteRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | false {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return false
  let start: number, end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!suffix) return false
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return false
  return { start, end: Math.min(end, size - 1) }
}

export function registerMediaProtocol(protocol: Pick<Protocol, 'handle'>, dataDir: string): void {
  const library = createLibraryService(dataDir)
  protocol.handle('media', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    if (
      url.protocol !== 'media:' ||
      !url.hostname ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search ||
      url.hash ||
      !/^[0-9a-f-]{36}$/i.test(url.hostname)
    )
      return new Response('Not found', { status: 404 })
    let item
    try {
      item = await library.item(url.hostname)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    let file: string
    try {
      file = await library.filePath(item.id)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const range = parseByteRange(request.headers.get('range'), stat.size)
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': item.actual.container === 'mp3' ? 'audio/mpeg' : 'video/mp4'
    })
    if (range === false) {
      headers.set('Content-Range', `bytes */${stat.size}`)
      return new Response(null, { status: 416, headers })
    }
    const start = range?.start ?? 0,
      end = range?.end ?? stat.size - 1
    headers.set('Content-Length', String(Math.max(0, end - start + 1)))
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    const stream = createReadStream(file, stat.size ? { start, end } : undefined)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers
    })
  })
}
