// Downloads + verifies the pinned binaries in a staging dir, then swaps it in as resources/binaries/.
// Any failure leaves the previous resources/binaries/ untouched (or absent) and exits non-zero.
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  SIG_FILE,
  SUMS_FILE,
  assertSha256,
  loadManifest,
  root,
  verifyDir,
  verifyYtDlp,
  type Manifest
} from './verify-binaries.js'

async function download(url: string, dest: string): Promise<void> {
  if (!url.startsWith('https://')) throw new Error(`refusing non-https URL ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status}: ${url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

async function findFile(dir: string, name: string): Promise<string> {
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name === name) return join(e.parentPath, e.name)
  }
  throw new Error(`${name} not found in archive`)
}

export async function fetchAll(m: Manifest, out = join(root, 'resources/binaries')): Promise<void> {
  const staging = join(root, 'resources/.staging')
  const work = join(staging, 'work')
  const next = join(staging, 'binaries')
  await rm(staging, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await mkdir(next, { recursive: true })
  try {
    for (const b of m.binaries) {
      const file = join(work, b.url.split('/').pop()!)
      console.log(`fetch ${b.name} ${b.version}`)
      await download(b.url, file)
      await assertSha256(file, b.sha256) // verify the archive before extracting it
      if (b.verification === 'gpg+sha256') {
        // zip hash must be in the GPG-signed SHA2-256SUMS and equal the pin
        await download(b.sumsUrl!, join(work, SUMS_FILE))
        await download(b.sigUrl!, join(work, SIG_FILE))
        await verifyYtDlp(
          file,
          join(work, SUMS_FILE),
          join(work, SIG_FILE),
          await readFile(join(root, m.ytdlpKey.path), 'utf8'),
          m.ytdlpKey.fingerprint,
          b.sha256
        )
      }
      const ex = b.extractTo ? join(next, b.extractTo) : join(work, b.name)
      await mkdir(ex, { recursive: true })
      // bsdtar ships with Windows 11 and reads zip; Git Bash's GNU tar does not, so use it by full path.
      execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), [
        '-xf',
        file,
        '-C',
        ex
      ])
      if (!b.extractTo)
        for (const exe of Object.keys(b.files))
          await rename(await findFile(ex, exe), join(next, exe))
    }
    await verifyDir(next, m) // hashes + onedir tree digest on exactly what will be installed
    await rm(out, { recursive: true, force: true })
    await rename(next, out)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await fetchAll(await loadManifest())
    console.log('binaries fetched and verified')
  } catch (e) {
    console.error('FETCH FAILED:', (e as Error).message)
    process.exit(1)
  }
}
