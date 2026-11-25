import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { guard, originOf } from '../../src/main/ipc.js'

const frame = (url: string | null) => ({ senderFrame: url === null ? null : { url } }) as never
const handler = guard('app://openfetch', z.strictObject({ n: z.number().int() }), ({ n }) => n * 2)

describe('guard', () => {
  test('runs the handler for our UI with a valid payload', () => {
    expect(handler(frame('app://openfetch/index.html'), { n: 21 })).toBe(42)
  })

  test.each([
    ['wrong type', { n: 'x' }],
    ['extra key', { n: 1, evil: true }],
    ['missing payload', undefined]
  ])('rejects a malformed payload (%s)', (_name, payload) => {
    expect(() => handler(frame('app://openfetch/index.html'), payload)).toThrow()
  })

  test.each([
    ['remote page', 'https://evil.example/'],
    ['other custom host', 'app://evil/index.html'],
    ['file URL', 'file:///C:/index.html'],
    ['destroyed frame', null]
  ])('rejects an unexpected sender (%s)', (_name, url) => {
    expect(() => handler(frame(url), { n: 1 })).toThrow('unexpected sender')
  })
})

test('originOf handles custom schemes, where URL.origin would be "null"', () => {
  expect(originOf('app://openfetch/assets/x.js')).toBe('app://openfetch')
  expect(originOf('http://localhost:5173/')).toBe('http://localhost:5173')
  expect(originOf('not a url')).toBeNull()
})
