import fsp from 'node:fs/promises' // default import on purpose: tests spy on fsp.rename
import path from 'node:path'

export interface PersistedFile<T> {
  schemaVersion: number
  data: T
}

export interface JsonStoreOptions<T> {
  /** Current schema version written by this code. */
  version: number
  defaults: () => T
  /** Anything with parse() that throws on bad input (a Zod schema fits). */
  validator: { parse(input: unknown): T }
  /** migrations[n] upgrades the payload from version n to n + 1. */
  migrations?: Record<number, (data: unknown) => unknown>
}

export interface JsonStore<T> {
  /** Never throws on bad content: recovers to defaults. Real I/O errors (EACCES...) still throw. */
  read(): Promise<T>
  /** Atomic; calls to the same file run strictly in order, so the last call wins. */
  write(data: T): Promise<void>
}

// One promise chain per absolute path, shared by every store instance.
const chains = new Map<string, Promise<unknown>>()
let seq = 0

function serialized<R>(file: string, task: () => Promise<R>): Promise<R> {
  const p = (chains.get(file) ?? Promise.resolve()).then(task)
  const tail = p.catch(() => {}) // a failed write must not block the next one
  chains.set(file, tail)
  void tail.then(() => chains.get(file) === tail && chains.delete(file))
  return p
}

const code = (e: unknown) => (e as NodeJS.ErrnoException).code

/**
 * Windows: rename() replaces an existing target (libuv MoveFileExW + MOVEFILE_REPLACE_EXISTING)
 * but fails with EPERM/EBUSY/EACCES while AV/indexers/another reader hold the target open
 * without FILE_SHARE_DELETE. Those locks are brief, so retry a few times.
 */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to)
    } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code(e) as string)) throw e
      await new Promise((r) => setTimeout(r, 20 * (i + 1)))
    }
  }
}

export function createJsonStore<T>(
  dir: string,
  name: string,
  opts: JsonStoreOptions<T>
): JsonStore<T> {
  const file = path.resolve(dir, name)

  async function writeNow(data: T): Promise<void> {
    const body = JSON.stringify({ schemaVersion: opts.version, data } satisfies PersistedFile<T>)
    await fsp.mkdir(dir, { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${seq++}` // same directory => same volume => atomic rename
    try {
      const fh = await fsp.open(tmp, 'wx')
      try {
        await fh.writeFile(body, 'utf8')
        await fh.sync() // flush to disk before the rename makes it visible
      } finally {
        await fh.close()
      }
      await renameRetry(tmp, file)
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {}) // old file untouched
      throw e
    }
  }

  async function quarantine(): Promise<T> {
    await fsp.rename(file, `${file}.corrupt-${Date.now()}-${seq++}`)
    const d = opts.defaults()
    await writeNow(d)
    return d
  }

  async function readNow(): Promise<T> {
    // Leftovers of crashed writes. Runs inside the per-file queue, so never races our own writes.
    // ponytail: assumes one process owns the dir (true for an Electron userData); add a pid check if not.
    for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
      if (f.startsWith(`${name}.tmp-`))
        await fsp.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
    let text: string
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch (e) {
      if (code(e) === 'ENOENT') return opts.defaults()
      throw e
    }
    let parsed: T
    let migrated: boolean
    try {
      const env = JSON.parse(text) as Partial<PersistedFile<unknown>>
      if (
        !env ||
        typeof env !== 'object' ||
        !Number.isInteger(env.schemaVersion) ||
        !('data' in env)
      ) {
        throw new Error('bad envelope')
      }
      let v = env.schemaVersion as number
      // Newer than this code: quarantine (kept intact as .corrupt-*) rather than overwrite or downgrade it.
      if (v > opts.version || v < 1) throw new Error(`unsupported schemaVersion ${v}`)
      let data = env.data
      for (; v < opts.version; v++) {
        const m = opts.migrations?.[v]
        if (!m) throw new Error(`no migration from ${v}`)
        data = m(data)
      }
      parsed = opts.validator.parse(data)
      migrated = env.schemaVersion !== opts.version
    } catch {
      return quarantine()
    }
    // Persist the migration outside the try above: an I/O failure here must not quarantine valid data.
    // The old-version file stays intact and is migrated again on the next read or replaced by the next write.
    if (migrated) await writeNow(parsed).catch(() => {})
    return parsed
  }

  return {
    read: () => serialized(file, readNow),
    write: (data) => serialized(file, () => writeNow(opts.validator.parse(data)))
  }
}
