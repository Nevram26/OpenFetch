import { mkdtemp, readFile, writeFile, rm, lstat, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLibraryService } from '../../src/main/library/service.js'
import { parseByteRange, registerMediaProtocol } from '../../src/main/library/protocol.js'

const source = {
  provider: 'youtube' as const,
  sourceId: 'abc',
  url: 'https://www.youtube.com/watch?v=abc',
  title: 'Track'
}
const options = { format: 'mp3' as const, bitrateKbps: 192 as const }
const actual = { container: 'mp3' as const, acodec: 'mp3', bitrateKbps: 192 }
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'openfetch-library-'))
  const file = resolve(dir, 'track.mp3')
  await writeFile(file, '0123456789')
  return { dir, file, service: createLibraryService(dir) }
}

describe('library persistence and file boundaries', () => {
  it('records verified completions only and persists requested and measured data', async () => {
    const { dir, file, service } = await setup()
    await expect(
      service.recordCompleted({
        jobId: 'j',
        source,
        options,
        actualOutput: { ...actual, acodec: 'aac' },
        finalPath: file
      })
    ).rejects.toThrow(/verification/)
    const item = await service.recordCompleted({
      jobId: 'j',
      source,
      options,
      actualOutput: actual,
      finalPath: file
    })
    expect(item).toMatchObject({ jobId: 'j', requested: options, actual, sizeBytes: 10 })
    expect(await service.list()).toMatchObject([{ id: item.id, missing: false }])
    expect(JSON.parse(await readFile(join(dir, 'library.json'), 'utf8')).data.items).toHaveLength(1)
    await rm(dir, { recursive: true })
  })
  it('serializes concurrent completed records without losing any', async () => {
    const { dir, file, service } = await setup()
    await Promise.all(
      Array.from({ length: 6 }, (_, n) =>
        service.recordCompleted({
          jobId: `j${n}`,
          source: { ...source, sourceId: `id${n}` },
          options,
          actualOutput: actual,
          finalPath: file
        })
      )
    )
    expect(await service.list()).toHaveLength(6)
    await rm(dir, { recursive: true })
  })
  it('removing a record preserves media; delete removes only the tracked file', async () => {
    const { dir, file, service } = await setup()
    const item = await service.recordCompleted({
      jobId: 'j',
      source,
      options,
      actualOutput: actual,
      finalPath: file
    })
    await service.removeRecord(item.id)
    expect(await lstat(file)).toBeTruthy()
    const next = await service.recordCompleted({
      jobId: 'j2',
      source,
      options,
      actualOutput: actual,
      finalPath: file
    })
    await service.deleteFile(next.id)
    await expect(lstat(file)).rejects.toThrow()
    expect(await service.list()).toHaveLength(0)
    await rm(dir, { recursive: true })
  })
  it('reports externally missing files and refuses deletion', async () => {
    const { dir, file, service } = await setup()
    const item = await service.recordCompleted({
      jobId: 'j',
      source,
      options,
      actualOutput: actual,
      finalPath: file
    })
    await rename(file, resolve(dir, 'moved.mp3'))
    expect((await service.list())[0]?.missing).toBe(true)
    await expect(service.deleteFile(item.id)).rejects.toThrow(/missing/)
    await rm(dir, { recursive: true })
  })
  it('rejects unknown IDs and refuses to record directories as media', async () => {
    const { dir, service } = await setup()
    await expect(service.filePath('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /Unknown/
    )
    await expect(
      service.recordCompleted({
        jobId: 'directory',
        source,
        options,
        actualOutput: actual,
        finalPath: dir
      })
    ).rejects.toThrow(/regular file/)
    await rm(dir, { recursive: true })
  })
})

describe('media byte ranges', () => {
  it('handles full, bounded, open-ended and suffix ranges', () => {
    expect(parseByteRange(null, 10)).toBeNull()
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 })
  })
  it('rejects malformed, multipart, zero suffix and unsatisfiable ranges', () => {
    for (const h of [
      'bytes=10-',
      'bytes=4-2',
      'bytes=-0',
      'bytes=1-2,4-5',
      'items=0-1',
      'bytes=x-y'
    ])
      expect(parseByteRange(h, 10)).toBe(false)
  })

  it('serves only known library IDs and streams correct byte ranges', async () => {
    const { dir, file, service } = await setup()
    const item = await service.recordCompleted({
      jobId: 'media',
      source,
      options,
      actualOutput: actual,
      finalPath: file
    })
    let handle: ((request: Request) => Promise<Response>) | undefined
    registerMediaProtocol(
      {
        handle: (_scheme: string, handler: (request: Request) => Promise<Response>) =>
          (handle = handler)
      } as never,
      dir
    )
    const request = (url: string, range?: string) =>
      handle?.({
        url,
        headers: new Headers(range ? { range } : {})
      } as Request) as Promise<Response>

    const partial = await request(`media://${item.id}/`, 'bytes=3-6')
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(partial.headers.get('content-length')).toBe('4')
    expect(await partial.text()).toBe('3456')

    expect((await request('media://00000000-0000-4000-8000-000000000000/')).status).toBe(404)
    expect((await request(`media://${item.id}/../other`)).status).toBe(404)
    expect((await request(`media://${item.id}:123/`)).status).toBe(404)
    const invalid = await request(`media://${item.id}/`, 'bytes=100-')
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */10')
    await rm(dir, { recursive: true })
  })
})
