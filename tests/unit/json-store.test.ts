import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createJsonStore } from '../../src/main/persistence/json-store.js'

type S = { n: number }
const validator = {
  parse(x: unknown): S {
    if (!x || typeof x !== 'object' || typeof (x as S).n !== 'number') throw new Error('bad')
    return { n: (x as S).n }
  }
}
let dir: string
const mk = (version = 1, migrations?: Record<number, (d: unknown) => unknown>) =>
  createJsonStore<S>(dir, 'a.json', { version, defaults: () => ({ n: 0 }), validator, migrations })
const file = () => path.join(dir, 'a.json')
const names = async () => (await fsp.readdir(dir)).sort()
const corrupt = async () => (await names()).filter((f) => f.includes('.corrupt-'))

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jstore-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(dir, { recursive: true, force: true })
})

test('missing file returns defaults; round-trip works', async () => {
  const s = mk()
  expect(await s.read()).toEqual({ n: 0 })
  await s.write({ n: 7 })
  expect(await mk().read()).toEqual({ n: 7 })
  expect(JSON.parse(await fsp.readFile(file(), 'utf8'))).toEqual({
    schemaVersion: 1,
    data: { n: 7 }
  })
  expect(await names()).toEqual(['a.json'])
})

test('50 concurrent writes: last wins, file valid, no temp left', async () => {
  const s = mk()
  const ps = Array.from({ length: 50 }, (_, i) => s.write({ n: i }))
  await Promise.all(ps)
  expect(await mk().read()).toEqual({ n: 49 })
  expect(await names()).toEqual(['a.json'])
})

test('crash between temp write and rename keeps previous file', async () => {
  const s = mk()
  await s.write({ n: 1 })
  vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('boom'), { code: 'EIO' }))
  await expect(s.write({ n: 2 })).rejects.toThrow('boom')
  vi.restoreAllMocks()
  expect(await s.read()).toEqual({ n: 1 })
  expect(await names()).toEqual(['a.json'])
  await s.write({ n: 3 }) // queue not poisoned
  expect(await s.read()).toEqual({ n: 3 })
})

test('stale temp file from a real crash is cleaned and old file is intact', async () => {
  await mk().write({ n: 5 })
  await fsp.writeFile(`${file()}.tmp-999-0`, '{"schemaVersion":1,"da')
  expect(await mk().read()).toEqual({ n: 5 })
  expect(await names()).toEqual(['a.json'])
})

test.each([
  ['garbage', 'not json at all \u0000\u0001'],
  ['truncated', '{"schemaVersion":1,"data":{"n":'],
  ['wrong envelope', '{"n":3}'],
  ['wrong schema', '{"schemaVersion":1,"data":{"n":"x"}}'],
  ['newer version', '{"schemaVersion":99,"data":{"n":3}}']
])('%s recovers to defaults and keeps a .corrupt copy', async (_n, content) => {
  await fsp.writeFile(file(), content)
  expect(await mk().read()).toEqual({ n: 0 })
  const c = await corrupt()
  expect(c).toHaveLength(1)
  expect(await fsp.readFile(path.join(dir, c[0]!), 'utf8')).toBe(content)
  expect(JSON.parse(await fsp.readFile(file(), 'utf8'))).toEqual({
    schemaVersion: 1,
    data: { n: 0 }
  })
})

test('older schemaVersion is migrated in sequence and rewritten', async () => {
  await fsp.writeFile(file(), '{"schemaVersion":1,"data":{"count":4}}')
  const s = mk(3, {
    1: (d) => ({ n: (d as { count: number }).count }),
    2: (d) => ({ n: (d as S).n * 10 })
  })
  expect(await s.read()).toEqual({ n: 40 })
  expect(JSON.parse(await fsp.readFile(file(), 'utf8'))).toEqual({
    schemaVersion: 3,
    data: { n: 40 }
  })
  expect(await corrupt()).toHaveLength(0)
})

test('failed migration persist keeps valid data, never quarantines it', async () => {
  const old = '{"schemaVersion":1,"data":{"count":4}}'
  await fsp.writeFile(file(), old)
  vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('boom'), { code: 'EIO' }))
  expect(await mk(2, { 1: (d) => ({ n: (d as { count: number }).count }) }).read()).toEqual({
    n: 4
  })
  vi.restoreAllMocks()
  expect(await fsp.readFile(file(), 'utf8')).toBe(old)
  expect(await corrupt()).toHaveLength(0)
})
