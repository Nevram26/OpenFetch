import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { relative, isAbsolute, resolve } from 'node:path'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Kill pid and all descendants (ADR-004). `run` is injectable for tests only. */
export function killTree(pid: number, run: typeof execFile = execFile): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) {
    return Promise.reject(new Error(`killTree: invalid pid ${String(pid)}`))
  }
  return new Promise((ok, fail) => {
    run(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      (err, _out, stderr) => {
        // taskkill exits 128 for both "not found" and "access denied" and its text is localized,
        // so on any failure we ask the OS whether the pid is still there.
        if (!err || !alive(pid)) return ok()
        fail(new Error(`taskkill failed for pid ${pid}: ${String(stderr).trim() || err.message}`))
      }
    )
  })
}

/** Delete jobDir recursively, only if it is strictly inside stagingRoot. */
export async function removeStaging(stagingRoot: string, jobDir: string): Promise<void> {
  const rel = relative(resolve(stagingRoot), resolve(jobDir))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`removeStaging: ${jobDir} is not inside ${stagingRoot}`)
  }
  await rm(resolve(jobDir), { recursive: true, force: true })
}
