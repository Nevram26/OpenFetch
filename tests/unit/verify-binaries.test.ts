import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as openpgp from 'openpgp'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import {
  verifyDir,
  verifyYtDlp,
  treeDigest,
  loadManifest,
  SUMS_FILE,
  SIG_FILE,
  type Manifest
} from '../../scripts/verify-binaries.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
let tmp: string
let armored: string
let fp: string
let privateKey: openpgp.PrivateKey
let wrongKey: openpgp.PrivateKey
const asset = Buffer.from('pretend yt-dlp.exe')

async function sign(text: string, key: openpgp.PrivateKey): Promise<Buffer> {
  const sig = await openpgp.sign({
    message: await openpgp.createMessage({ binary: Buffer.from(text) }),
    signingKeys: key,
    detached: true,
    format: 'binary'
  })
  return Buffer.from(sig as Uint8Array)
}

/** Lay out a fixture dir; overrides let each test break exactly one thing. */
async function layout(o: { exe?: Buffer; sums?: string; sig?: Buffer } = {}) {
  const dir = await mkdtemp(join(tmp, 'd-'))
  const sums = o.sums ?? `${sha(asset)}  yt-dlp.exe\n`
  await writeFile(join(dir, 'yt-dlp.exe'), o.exe ?? asset)
  await writeFile(join(dir, SUMS_FILE), sums)
  await writeFile(join(dir, SIG_FILE), o.sig ?? (await sign(sums, privateKey)))
  return dir
}
const check = (dir: string, pin = sha(asset), fpr = fp) =>
  verifyYtDlp(join(dir, 'yt-dlp.exe'), join(dir, SUMS_FILE), join(dir, SIG_FILE), armored, fpr, pin)

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'of-test-'))
  const gen = async (n: string) =>
    openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: n }],
      format: 'object'
    })
  const a = await gen('good')
  privateKey = a.privateKey
  armored = a.publicKey.armor()
  fp = a.publicKey.getFingerprint()
  wrongKey = (await gen('evil')).privateKey
})
afterAll(() => rm(tmp, { recursive: true, force: true }))

describe('yt-dlp signature chain', () => {
  it('accepts a valid signed asset', async () => {
    await check(await layout())
  })
  it('rejects a flipped byte in the asset', async () => {
    const bad = Buffer.from(asset)
    bad[0]! ^= 1
    await expect(check(await layout({ exe: bad }))).rejects.toThrow(/not in signed sums/)
  })
  it('rejects a corrupted signature', async () => {
    const sig = await sign(`${sha(asset)}  yt-dlp.exe\n`, privateKey)
    sig[sig.length - 1]! ^= 1
    await expect(check(await layout({ sig }))).rejects.toThrow()
  })
  it('rejects a signature over different sums (tampered sums file)', async () => {
    const sig = await sign(`${sha(asset)}  yt-dlp.exe\n`, privateKey)
    await expect(
      check(await layout({ sums: `${sha(asset)}  yt-dlp.exe\n# x\n`, sig }))
    ).rejects.toThrow()
  })
  it('rejects a signature from the wrong key', async () => {
    const sums = `${sha(asset)}  yt-dlp.exe\n`
    await expect(check(await layout({ sums, sig: await sign(sums, wrongKey) }))).rejects.toThrow()
  })
  it('rejects a pinned key whose fingerprint does not match', async () => {
    await expect(check(await layout(), sha(asset), 'ab'.repeat(20))).rejects.toThrow(/fingerprint/)
  })
  it('rejects an asset missing from the signed sums', async () => {
    const sums = `${sha(asset)}  other.exe\n`
    await expect(check(await layout({ sums, sig: await sign(sums, privateKey) }))).rejects.toThrow(
      /not listed/
    )
  })
  it('rejects when signed sums are fine but the manifest pin differs', async () => {
    await expect(check(await layout(), '0'.repeat(64))).rejects.toThrow(/manifest pin/)
  })
})

describe('verifyDir with the real manifest shape', () => {
  it('fails on a flipped byte in a pinned-sha256 exe', async () => {
    const real = await loadManifest()
    const deno = Buffer.from('fake deno')
    const m: Manifest = {
      ...real,
      binaries: [{ ...real.binaries[2]!, files: { 'deno.exe': sha(deno) } }]
    }
    const dir = await mkdtemp(join(tmp, 'v-'))
    await writeFile(join(dir, 'deno.exe'), deno)
    await verifyDir(dir, m)
    deno[0]! ^= 1
    await writeFile(join(dir, 'deno.exe'), deno)
    await expect(verifyDir(dir, m)).rejects.toThrow(/SHA-256 mismatch/)
  })
  it('real manifest pins the committed key fingerprint', async () => {
    const m = await loadManifest()
    const key = await openpgp.readKey({
      armoredKey: await readFile(join(import.meta.dirname, '../../', m.ytdlpKey.path), 'utf8')
    })
    expect(key.getFingerprint()).toBe(m.ytdlpKey.fingerprint)
  })
})

describe('yt-dlp onedir zip layout', () => {
  const zip = Buffer.from('pretend yt-dlp_win.zip')
  const zipCheck = async (sums: string, sig: Buffer, pin = sha(zip)) => {
    const dir = await mkdtemp(join(tmp, 'z-'))
    await writeFile(join(dir, 'yt-dlp_win.zip'), zip)
    await writeFile(join(dir, SUMS_FILE), sums)
    await writeFile(join(dir, SIG_FILE), sig)
    return verifyYtDlp(
      join(dir, 'yt-dlp_win.zip'),
      join(dir, SUMS_FILE),
      join(dir, SIG_FILE),
      armored,
      fp,
      pin
    )
  }
  it('accepts a zip listed in the signed sums', async () => {
    const sums = `${sha(zip)} *yt-dlp_win.zip\n`
    await zipCheck(sums, await sign(sums, privateKey))
  })
  it('rejects a zip whose name is not in the signed sums', async () => {
    const sums = `${sha(zip)}  yt-dlp.exe\n`
    await expect(zipCheck(sums, await sign(sums, privateKey))).rejects.toThrow(/not listed/)
  })
  it('rejects a zip differing from the manifest pin', async () => {
    const sums = `${sha(zip)}  yt-dlp_win.zip\n`
    await expect(zipCheck(sums, await sign(sums, privateKey), '0'.repeat(64))).rejects.toThrow(
      /manifest pin/
    )
  })

  it('verifyDir fails on any tampered, added or removed file in the extracted tree', async () => {
    const real = await loadManifest()
    const dir = await mkdtemp(join(tmp, 'o-'))
    const root = join(dir, 'yt-dlp')
    await mkdir(join(root, '_internal'), { recursive: true })
    await writeFile(join(root, 'yt-dlp.exe'), 'exe')
    await writeFile(join(root, '_internal', 'a.pyd'), 'pyd')
    const m: Manifest = {
      ...real,
      binaries: [
        {
          ...real.binaries[0]!,
          files: { 'yt-dlp/yt-dlp.exe': sha(Buffer.from('exe')) },
          extractTo: 'yt-dlp',
          treeSha256: await treeDigest(root)
        }
      ]
    }
    await verifyDir(dir, m)
    await writeFile(join(root, '_internal', 'a.pyd'), 'pyD')
    await expect(verifyDir(dir, m)).rejects.toThrow(/tree digest/)
    await writeFile(join(root, '_internal', 'a.pyd'), 'pyd')
    await writeFile(join(root, '_internal', 'extra.dll'), 'x')
    await expect(verifyDir(dir, m)).rejects.toThrow(/tree digest/)
    await rm(join(root, '_internal', 'extra.dll'))
    await writeFile(join(root, 'yt-dlp.exe'), 'EXE')
    await expect(verifyDir(dir, m)).rejects.toThrow(/SHA-256 mismatch/)
  })
  it('real manifest is onedir: zip asset, exe pin and tree pin', async () => {
    const y = (await loadManifest()).binaries[0]!
    expect(y.url).toMatch(/\/2026\.11\.23\/yt-dlp_win\.zip$/)
    expect(y.extractTo).toBe('yt-dlp')
    expect(y.treeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(y.files)).toEqual(['yt-dlp/yt-dlp.exe'])
  })
})
