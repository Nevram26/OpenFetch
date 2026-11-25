// Verification logic for pinned engine binaries. Fail closed: every function throws on any mismatch.
// Importable by tests and by fetch-binaries.ts; runs as a CLI when executed directly.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as openpgp from 'openpgp';

export interface ManifestBinary {
  name: string;
  version: string;
  arch: string;
  url: string; // exact asset URL
  sha256: string; // of the downloaded asset
  files: Record<string, string>; // installed exe name -> sha256 of the extracted exe
  license: string;
  source: string;
  verification: 'gpg+sha256' | 'pinned-sha256';
  sumsUrl?: string; // gpg+sha256 only
  sigUrl?: string;
}
export interface Manifest {
  schemaVersion: number;
  ytdlpKey: { path: string; fingerprint: string };
  binaries: ManifestBinary[];
}

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SUMS_FILE = 'yt-dlp.SHA2-256SUMS';
export const SIG_FILE = 'yt-dlp.SHA2-256SUMS.sig';

export async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(join(root, 'resources/binary-manifest.json'), 'utf8'));
}

export function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('error', fail).on('end', () => ok(h.digest('hex')));
  });
}

export async function assertSha256(path: string, expected: string): Promise<void> {
  const got = await sha256File(path);
  if (got !== expected.toLowerCase()) throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, got ${got}`);
}

/** Verify the detached binary signature over the SUMS file with the pinned key, then return the signed sums. */
export async function verifySignedSums(sums: Uint8Array, sig: Uint8Array, armoredKey: string, fingerprint: string): Promise<string> {
  const key = await openpgp.readKey({ armoredKey });
  if (key.getFingerprint() !== fingerprint.toLowerCase()) throw new Error('pinned yt-dlp key fingerprint mismatch');
  const res = await openpgp.verify({
    message: await openpgp.createMessage({ binary: sums }),
    signature: await openpgp.readSignature({ binarySignature: sig }),
    verificationKeys: key,
  });
  const first = res.signatures[0];
  if (!first) throw new Error('SHA2-256SUMS has no signature');
  await first.verified; // throws on bad signature or signer not in verificationKeys
  return Buffer.from(sums).toString('utf8');
}

/** Hash for `name` from a signed `<sha256>  <name>` sums listing. */
export function sumFor(sums: string, name: string): string {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
  throw new Error(`${name} is not listed in the signed SHA2-256SUMS`);
}

/** yt-dlp: signed sums -> exe hash must be in them AND equal the manifest pin. */
export async function verifyYtDlp(exe: string, sumsPath: string, sigPath: string, armoredKey: string, fingerprint: string, pinned: string): Promise<void> {
  const sums = await verifySignedSums(await readFile(sumsPath), await readFile(sigPath), armoredKey, fingerprint);
  const listed = sumFor(sums, 'yt-dlp.exe');
  const actual = await sha256File(exe);
  if (actual !== listed) throw new Error(`yt-dlp.exe hash ${actual} not in signed sums (${listed})`);
  if (actual !== pinned.toLowerCase()) throw new Error(`yt-dlp.exe hash ${actual} differs from manifest pin ${pinned}`);
}

/** Verify an install directory (fetch output) against the manifest. */
export async function verifyDir(dir: string, m: Manifest): Promise<void> {
  const armoredKey = await readFile(join(root, m.ytdlpKey.path), 'utf8');
  for (const b of m.binaries) {
    if (b.verification === 'gpg+sha256') {
      await verifyYtDlp(join(dir, 'yt-dlp.exe'), join(dir, SUMS_FILE), join(dir, SIG_FILE), armoredKey, m.ytdlpKey.fingerprint, b.files['yt-dlp.exe']!);
    } else {
      for (const [exe, hash] of Object.entries(b.files)) await assertSha256(join(dir, exe), hash);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyDir(join(root, 'resources/binaries'), await loadManifest());
    console.log('binaries verified');
  } catch (e) {
    console.error('VERIFY FAILED:', (e as Error).message);
    process.exit(1);
  }
}
