// Runs against the built, unpackaged app (`npm run test:e2e` builds first). Packaged builds disable
// the inspect fuse, which Playwright needs, so they only get a launch smoke test (#12).
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { _electron as electron, expect, test } from '@playwright/test'

test('renderer is isolated, screens are keyboard reachable, second instance exits', async () => {
  const app = await electron.launch({ args: ['.'] })
  const win = await app.firstWindow()

  // Loaded over app://, with no Node or raw IPC in the page; only the typed bridge.
  expect(win.url()).toBe('app://openfetch/index.html')
  const globals = await win.evaluate(() => {
    const g = globalThis as Record<string, unknown>
    return [typeof g['require'], typeof g['process'], typeof g['ipcRenderer'], typeof g['openfetch']]
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

  // Download options open as a modal and close with Escape.
  await win.getByRole('button', { name: 'Search', exact: true }).click()
  await win.getByRole('button', { name: /^Download MP3:/ }).first().click()
  await expect(win.getByRole('dialog', { name: 'Download options' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('dialog')).toHaveCount(0)

  // A second launch hands over to the first instance and exits on its own.
  const code = await new Promise<number | null>((resolve, reject) => {
    const second = spawn(electronPath as unknown as string, ['.'], { stdio: 'ignore' })
    const timer = setTimeout(() => (second.kill(), reject(new Error('second instance did not exit'))), 15_000)
    second.on('exit', (c) => (clearTimeout(timer), resolve(c)))
  })
  expect(code).toBe(0)
  expect(app.windows()).toHaveLength(1)

  await app.close()
})
