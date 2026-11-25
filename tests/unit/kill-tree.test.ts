import { spawn, type ChildProcess, type execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { killTree, removeStaging } from '../../src/main/engine/kill-tree.js'

const win = process.platform === 'win32'
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function until(cond: () => boolean, ms = 10000) {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  return cond()
}
const idle = 'setInterval(()=>{},1000)'
const spawned: ChildProcess[] = []
afterAll(() => {
  for (const c of spawned)
    if (c.pid && alive(c.pid))
      try {
        process.kill(c.pid)
      } catch {
        /* gone */
      }
})

describe('killTree', () => {
  it('rejects invalid pids before running taskkill', async () => {
    const run = vi.fn() as unknown as typeof execFile
    for (const bad of [0, -1, 1.5, NaN, '123' as unknown as number, process.pid]) {
      await expect(killTree(bad, run)).rejects.toThrow(/invalid pid/)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it.skipIf(!win)('kills parent and grandchild, spares a sibling', async () => {
    const sibling = spawn(process.execPath, ['-e', idle], { stdio: 'ignore' })
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `const c=require('child_process').spawn(process.execPath,['-e','${idle}'],{stdio:'ignore'});console.log(c.pid);${idle}`
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    spawned.push(sibling, parent)
    const grandchild = await new Promise<number>((r) =>
      parent.stdout!.once('data', (d) => r(Number(String(d).trim())))
    )
    expect(alive(grandchild)).toBe(true)

    await killTree(parent.pid!)

    expect(await until(() => !alive(parent.pid!) && !alive(grandchild))).toBe(true)
    expect(alive(sibling.pid!)).toBe(true)
  })

  it.skipIf(!win)('resolves for an already-exited pid', async () => {
    const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' })
    await new Promise((r) => c.once('exit', r))
    await expect(killTree(c.pid!)).resolves.toBeUndefined()
  })
})

describe('removeStaging', () => {
  it('deletes a job dir but refuses root, outside, and traversal', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kt-'))
    const root = join(base, 'staging')
    const job = join(root, 'job1')
    const sibling = join(base, 'other')
    await mkdir(job, { recursive: true })
    await mkdir(sibling)
    try {
      await expect(removeStaging(root, root)).rejects.toThrow()
      await expect(removeStaging(root, sibling)).rejects.toThrow()
      await expect(removeStaging(root, join(root, '..', 'x'))).rejects.toThrow()
      await expect(removeStaging(root, join(root, 'job1', '..', '..', 'other'))).rejects.toThrow()
      await stat(root)
      await stat(sibling)
      await removeStaging(root, job)
      await expect(stat(job)).rejects.toThrow()
      await stat(root)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
