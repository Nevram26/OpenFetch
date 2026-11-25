import path from 'node:path'
import { expect, test } from 'vitest'
import { resolveAppFile } from '../../src/main/app-protocol.js'

const root = path.resolve('out/renderer')

test.each([
  ['app://openfetch/', 'index.html'],
  ['app://openfetch/index.html', 'index.html'],
  ['app://openfetch/assets/index-abc.js', path.join('assets', 'index-abc.js')]
])('serves %s from the renderer folder', (url, rel) => {
  expect(resolveAppFile(root, url)).toBe(path.join(root, rel))
})

test('dot segments are normalized by the URL parser and stay inside the folder', () => {
  expect(resolveAppFile(root, 'app://openfetch/%2e%2e/main/index.js')).toBe(path.join(root, 'main', 'index.js'))
})

test.each([
  'app://openfetch/assets/%2e%2e%2f%2e%2e%2fpackage.json',
  'app://openfetch/..%2F..%2Fpackage.json',
  'app://openfetch/%2e%2e%5c%2e%2e%5cpackage.json',
  'app://openfetch/C:%5CWindows%5Cwin.ini',
  'app://openfetch/index.html%00.js',
  'app://openfetch/%E0%A4%A',
  'app://evil/index.html',
  'https://openfetch/index.html'
])('refuses %s', (url) => {
  expect(resolveAppFile(root, url)).toBeNull()
})
