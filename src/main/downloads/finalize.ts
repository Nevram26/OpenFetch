import { constants } from 'node:fs'
import { copyFile, link, mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_PATH = 259

// eslint-disable-next-line no-control-regex -- control characters are illegal in Windows names
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const code = (e: unknown) => (e as NodeJS.ErrnoException).code

/** A Windows-safe, length-bounded `[stem, ext]`. Keeps a trailing ` [id]` when truncating. */
function safeName(name: string, destDir: string): [string, string] {
  const ext = extname(name).replace(ILLEGAL, '_')
  let stem = basename(name, extname(name))
    .replace(ILLEGAL, '_')
    .replace(/[. ]+$/, '')
  if (!stem) stem = 'download'
  if (RESERVED.test(stem.split('.')[0]!)) stem = `_${stem}`
  // room for "<dir>\<stem> (99)<ext>"
  const room = Math.max(16, MAX_PATH - destDir.length - 1 - ext.length - 5)
  if (stem.length > room) {
    const id = /\s\[[\w-]+\]$/.exec(stem)?.[0] ?? ''
    stem = (stem.slice(0, room - id.length).replace(/[. ]+$/, '') || 'download') + id
  }
  return [stem, ext]
}

/**
 * Move a staged file into destDir without ever overwriting: a taken name gets " (2)", " (3)"...
 * Exclusive create (hard link, else exclusive copy across volumes), then the source is removed.
 */
export async function finalizeFile(stagedPath: string, destDir: string): Promise<string> {
  // A missing source makes link/copy fail with ENOENT before dest is created; the cleanup below
  // would then delete someone else's file at dest. Fail early instead (staging is ours alone).
  await stat(stagedPath)
  await mkdir(destDir, { recursive: true })
  const [stem, ext] = safeName(basename(stagedPath), destDir)
  for (let n = 1; ; n++) {
    const dest = join(destDir, n === 1 ? `${stem}${ext}` : `${stem} (${n})${ext}`)
    try {
      await link(stagedPath, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      // EXDEV (other volume), EPERM (no hard links, e.g. exFAT): exclusive copy instead
      try {
        await copyFile(stagedPath, dest, constants.COPYFILE_EXCL)
      } catch (e2) {
        if (code(e2) === 'EEXIST') continue
        await rm(dest, { force: true }) // our partial copy; EXCL means nobody else's file
        throw e2
      }
    }
    await rm(stagedPath, { force: true })
    return dest
  }
}
