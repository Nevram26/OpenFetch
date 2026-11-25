// Runs against the built, unpackaged app (`npm run test:e2e` builds first). Packaged builds disable
// the inspect fuse, which Playwright needs, so they only get a launch smoke test (#12).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, test } from '@playwright/test'

// Search and inspect run through tests/fake-engine.mjs replaying a recorded fixture (dev builds only),
// so these tests never start yt-dlp and never contact YouTube. Thumbnail requests are aborted too.
const userData = () => mkdtempSync(join(tmpdir(), 'openfetch-e2e-'))
const fixture = (name: string) => resolve('tests/fixtures', `${name}.json`)

async function launch(fixtureName: string, dir = userData()) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dir}`],
    env: { ...process.env, OPENFETCH_FAKE_ENGINE: fixture(fixtureName) }
  })
  await app.context().route('https://i.ytimg.com/**', (r) => r.abort())
  return { app, dir, win: await app.firstWindow() }
}

test('search shows fixture results, rejects hostile links, reports engine errors', async () => {
  const { app, win } = await launch('engine/search-blender-open-movie')
  const search = win.getByRole('searchbox', { name: 'Search for a song, artist or video' })
  await expect(win.getByText('Search for music or videos')).toBeVisible()
  await search.fill('blender open movie')
  await search.press('Enter')
  await expect(win.getByRole('status').filter({ hasText: '20 results' })).toBeVisible()
  await expect(win.getByRole('heading', { name: 'Spring - Blender Open Movie' })).toBeVisible()
  await expect(win.getByRole('button', { name: /^Download MP3:/ }).first()).toBeEnabled()
  await win
    .getByRole('button', { name: /^Download MP3:/ })
    .first()
    .click()
  await expect(win.getByRole('dialog', { name: 'Download options' })).toBeVisible()
  await win.getByRole('button', { name: 'Cancel' }).click()
  await expect(win.getByRole('button', { name: 'blender open movie', exact: true })).toBeVisible() // history chip
  await win.getByRole('button', { name: 'Clear history' }).click()
  await expect(win.getByRole('group', { name: 'Recent searches' })).toHaveCount(0)

  await win.getByRole('button', { name: 'Paste link', exact: true }).click()
  const link = win.getByRole('textbox', { name: 'Video or playlist link' })
  for (const bad of ['--exec calc', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'not a url']) {
    await link.fill(bad)
    await expect(link).toHaveAttribute('aria-invalid', 'true')
    await expect(win.getByRole('button', { name: 'Check link' })).toBeDisabled()
  }
  await link.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await expect(link).not.toHaveAttribute('aria-invalid', 'true')
  await expect(win.getByRole('button', { name: 'Check link' })).toBeEnabled()
  await app.close()
})

test('an offline engine failure shows a retryable error with diagnostics', async () => {
  const { app, win } = await launch('synthetic/network-error')
  await win.getByRole('searchbox', { name: 'Search for a song, artist or video' }).fill('anything')
  await win.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(win.getByRole('alert')).toContainText('You appear to be offline')
  await win.getByRole('button', { name: 'Copy diagnostics' }).click()
  await expect(win.getByRole('button', { name: 'Copied' })).toBeVisible()
  await app.close()
})

test('pasting a video link inspects it', async () => {
  const { app, win } = await launch('engine/inspect-video')
  await win.getByRole('button', { name: 'Paste link', exact: true }).click()
  await win
    .getByRole('textbox', { name: 'Video or playlist link' })
    .fill('https://youtu.be/aqz-KE-bpKQ')
  await win.getByRole('button', { name: 'Check link' }).click()
  await expect(win.getByRole('heading', { name: /Big Buck Bunny/ })).toBeVisible()
  await app.close()
})

test('renderer is isolated, screens are keyboard reachable, second instance exits', async () => {
  const dir = userData()
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] })
  const win = await app.firstWindow()

  // Loaded over app://, with no Node or raw IPC in the page; only the typed bridge.
  expect(win.url()).toBe('app://openfetch/index.html')
  const globals = await win.evaluate(() => {
    const g = globalThis as Record<string, unknown>
    return [
      typeof g['require'],
      typeof g['process'],
      typeof g['ipcRenderer'],
      typeof g['openfetch']
    ]
  })
  expect(globals).toEqual(['undefined', 'undefined', 'undefined', 'object'])

  // Every screen reachable with the keyboard alone.
  for (const [nav, heading] of [
    ['Paste link', 'Paste link'],
    ['Downloads', 'Downloads'],
    ['My library', 'My library'],
    ['Settings', 'Settings'],
    ['Search', 'Search']
  ]) {
    await win.getByRole('button', { name: nav, exact: true }).focus()
    await win.keyboard.press('Enter')
    await expect(win.getByRole('heading', { level: 1, name: heading })).toBeAttached()
  }

  // The validated IPC round trip works.
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(win.getByText(/\(Electron \d+/)).toBeVisible()

  // A second launch hands over to the first instance and exits on its own.
  const code = await new Promise<number | null>((resolve, reject) => {
    const second = spawn(electronPath as unknown as string, ['.', `--user-data-dir=${dir}`], {
      stdio: 'ignore'
    })
    const timer = setTimeout(
      () => (second.kill(), reject(new Error('second instance did not exit'))),
      15_000
    )
    second.on('exit', (c) => (clearTimeout(timer), resolve(c)))
  })
  expect(code).toBe(0)
  expect(app.windows()).toHaveLength(1)

  await app.close()
})
