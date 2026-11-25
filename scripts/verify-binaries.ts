// Verification logic for pinned engine binaries. Fail closed: every function throws on any mismatch.
// Importable by tests and by fetch-binaries.ts; runs as a CLI when executed directly.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname, resolve, basename, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as openpgp from 'openpgp'

export interface ManifestBinary {
  name: string
  version: string
  arch: string
  url: string // exact asset URL
  sha256: string // of the downloaded asset
  files: Record<string, string> // installed exe path (relative to resources/binaries) -> sha256
  extractTo?: string // onedir: extract the whole zip into this folder
  treeSha256?: string // onedir: digest of every file under extractTo (see treeDigest)
  license: string
  source: string
  verification: 'gpg+sha256' | 'pinned-sha256'
  sumsUrl?: string // gpg+sha256 only
  sigUrl?: string
}
export interface Manifest {
  schemaVersion: number
  ytdlpKey: { path: string; fingerprint: string }
  binaries: ManifestBinary[]
}

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SUMS_FILE = 'yt-dlp.SHA2-256SUMS'
export const SIG_FILE = 'yt-dlp.SHA2-256SUMS.sig'

export async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(join(root, 'resources/binary-manifest.json'), 'utf8'))
}

export function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', fail)
      .on('end', () => ok(h.digest('hex')))
  })
}

export async function assertSha256(path: string, expected: string): Promise<void> {
  const got = await sha256File(path)
  if (got !== expected.toLowerCase())
    throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, got ${got}`)
}

/** Verify the detached binary signature over the SUMS file with the pinned key, then return the signed sums. */
export async function verifySignedSums(
  sums: Uint8Array,
  sig: Uint8Array,
  armoredKey: string,
  fingerprint: string
): Promise<string> {
  const key = await openpgp.readKey({ armoredKey })
  if (key.getFingerprint() !== fingerprint.toLowerCase())
    throw new Error('pinned yt-dlp key fingerprint mismatch')
  const res = await openpgp.verify({
    message: await openpgp.createMessage({ binary: sums }),
    signature: await openpgp.readSignature({ binarySignature: sig }),
    verificationKeys: key
  })
  const first = res.signatures[0]
  if (!first) throw new Error('SHA2-256SUMS has no signature')
  await first.verified // throws on bad signature or signer not in verificationKeys
  return Buffer.from(sums).toString('utf8')
}

/** Hash for `name` from a signed `<sha256>  <name>` sums listing. */
export function sumFor(sums: string, name: string): string {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line)
    if (m && m[2] === name) return m[1]!.toLowerCase()
  }
  throw new Error(`${name} is not listed in the signed SHA2-256SUMS`)
}

/**
 * Digest of every file under `dir`: sha256 over sorted `<sha256>  <relative path>` lines.
 * Any changed, added or removed file (exe, .pyd, .dll, .pyc archive...) changes it.
 */
export async function treeDigest(dir: string): Promise<string> {
  const lines: string[] = []
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue
    const full = join(e.parentPath, e.name)
    const rel = full.slice(dir.length + 1).replaceAll(sep, '/')
    lines.push(`${await sha256File(full)}  ${rel}\n`)
  }
  return createHash('sha256').update(lines.sort().join('')).digest('hex')
}

/** yt-dlp asset (zip): signed sums -> its hash must be in them AND equal the manifest pin. */
export async function verifyYtDlp(
  exe: string,
  sumsPath: string,
  sigPath: string,
  armoredKey: string,
  fingerprint: string,
  pinned: string
): Promise<void> {
  const sums = await verifySignedSums(
    await readFile(sumsPath),
    await readFile(sigPath),
    armoredKey,
    fingerprint
  )
  const name = basename(exe)
  const listed = sumFor(sums, name)
  const actual = await sha256File(exe)
  if (actual !== listed) throw new Error(`${name} hash ${actual} not in signed sums (${listed})`)
  if (actual !== pinned.toLowerCase())
    throw new Error(`${name} hash ${actual} differs from manifest pin ${pinned}`)
}

/**
 * Verify an install directory (fetch output) against the manifest. The yt-dlp zip's signed-sums
 * check happens at fetch time (the zip is not kept); here the extracted tree is held to the pin.
 */
export async function verifyDir(dir: string, m: Manifest): Promise<void> {
  for (const b of m.binaries) {
    for (const [exe, hash] of Object.entries(b.files)) await assertSha256(join(dir, exe), hash)
    if (b.extractTo) {
      const got = await treeDigest(join(dir, b.extractTo))
      if (got !== b.treeSha256)
        throw new Error(`${b.name} tree digest ${got} != pin ${b.treeSha256}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyDir(join(root, 'resources/binaries'), await loadManifest())
    console.log('binaries verified')
  } catch (e) {
    console.error('VERIFY FAILED:', (e as Error).message)
    process.exit(1)
  }
}
