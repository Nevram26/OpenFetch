// THROWAWAY engine spike (issue #3): records yt-dlp runs to tests/fixtures/engine/*.json and measures.
// Run: npm run spike:record [scenario-substring | measure]. Not a test; CI never executes it.
import { spawn, execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync
} from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'binaries')
const YT = join(BIN, 'yt-dlp.exe')
const OUT = join(root, 'tests', 'fixtures', 'engine')
const SPIKE = join(root, 'spike-output')
const C = [
  '--ignore-config',
  '--no-update',
  '--js-runtimes',
  `deno:${join(BIN, 'deno.exe')}`,
  '--ffmpeg-location',
  BIN
]
const LICENSED = 'aqz-KE-bpKQ' // Big Buck Bunny, uploader "Blender"; yt-dlp license field = CC BY
const LICENSE =
  'Creative Commons Attribution license (reuse allowed) per yt-dlp license field; uploader Blender (Blender Foundation official channel); (c) Blender Foundation, www.bigbuckbunny.org'
const tmpl = [
  '--newline',
  '--progress',
  '--progress-template',
  'download:[OF] %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(info.id)s',
  '--progress-template',
  'postprocess:[OFPP] %(progress.status)s|%(progress.postprocessor)s|%(info.id)s',
  '--print',
  'after_move:[OFPATH] %(filepath)j'
]
const dl = (kind: 'mp3' | 'mp4', stage: string) => [
  ...C,
  '--no-playlist',
  ...(kind === 'mp3'
    ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '192K']
    : [
        '-f',
        'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b',
        '-S',
        'res:720',
        '--merge-output-format',
        'mp4'
      ]),
  '--embed-metadata',
  '--embed-thumbnail',
  '--convert-thumbnails',
  'jpg',
  '-P',
  `home:${stage}\\out`,
  '-P',
  `temp:${stage}\\tmp`,
  '-o',
  '%(title).150B [%(id)s].%(ext)s',
  '--windows-filenames',
  ...tmpl,
  '--',
  LICENSED
]

const procs = () => {
  const pids: string[] = []
  for (const n of ['yt-dlp.exe', 'ffmpeg.exe', 'deno.exe'])
    for (const l of execFileSync('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${n}`], {
      encoding: 'utf8'
    }).split('\n'))
      if (l.startsWith('"')) pids.push(l.split('","').slice(0, 2).join(':').replace(/"/g, ''))
  return pids
}
const ls = (d: string): string[] =>
  !existsSync(d)
    ? []
    : readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? ls(join(d, e.name)).map((f) => `${e.name}/${f}`)
          : [`${e.name} (${statSync(join(d, e.name)).size} B)`]
      )
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const kill = (pid: number) =>
  new Promise<void>((r) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => r()))

// Keep first 5, last 5 and every 25th progress line; everything else verbatim.
function thin(s: string) {
  const lines = s.split('\n')
  let n = 0
  const isP = (l: string) => /^\[OF(PP)?\] /.test(l)
  const total = lines.filter(isP).length
  const keep = lines.filter((l) => !isP(l) || ++n <= 5 || n > total - 5 || n % 25 === 0)
  const kept = keep.filter(isP).length
  return {
    text: keep.join('\n'),
    thinned: total > kept ? `${total} progress lines thinned to ${kept}` : ''
  }
}

type Opts = {
  notes?: string
  license?: string
  cancelOn?: (line: string) => boolean
  cancelDelayMs?: number
  stage?: string
}
async function run(name: string, args: string[], o: Opts = {}) {
  if (process.argv[2] && !name.includes(process.argv[2])) return
  if (o.stage) {
    rmSync(o.stage, { recursive: true, force: true })
    mkdirSync(o.stage, { recursive: true })
  }
  const before = new Set(procs())
  const startedAt = new Date().toISOString(),
    t0 = performance.now()
  const p = spawn(YT, args, { shell: false, windowsHide: true })
  let stdout = '',
    stderr = '',
    cancelledAt: number | undefined
  const chunks: [number, string, number][] = []
  p.stdout.setEncoding('utf8')
  p.stderr.setEncoding('utf8')
  const bufs = { o: '', e: '' }
  const onData = (k: 'o' | 'e') => (d: string) => {
    chunks.push([Math.round(performance.now() - t0), k, d.length])
    if (k === 'o') stdout += d
    else stderr += d
    const parts = (bufs[k] + d).split('\n')
    bufs[k] = parts.pop()!
    for (const l of parts)
      if (o.cancelOn?.(l) && cancelledAt === undefined) {
        cancelledAt = Math.round(performance.now() - t0)
        setTimeout(() => kill(p.pid!), o.cancelDelayMs ?? 0)
      }
  }
  p.stdout.on('data', onData('o'))
  p.stderr.on('data', onData('e'))
  const exitCode = await new Promise<number | null>((r) => p.on('close', r))
  const durationMs = Math.round(performance.now() - t0)
  const extra: Record<string, unknown> = {}
  if (o.cancelOn) {
    await sleep(2000)
    extra.cancel = {
      cancelledAtMs: cancelledAt ?? null,
      ownedProcessesRemaining: procs().filter((x) => !before.has(x)),
      stagingFilesAfterKill: o.stage ? ls(o.stage) : []
    }
  } else if (o.stage) extra.stagingFilesAfter = ls(o.stage)
  const so = thin(stdout),
    se = thin(stderr)
  const notes = [
    o.notes,
    so.thinned && `stdout: ${so.thinned}`,
    se.thinned && `stderr: ${se.thinned}`
  ]
    .filter(Boolean)
    .join(' | ')
  const chunkTimings = chunks.length > 200 ? chunks.filter((_, i) => i < 5 || i % 25 === 0) : chunks // thinned if >200
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify(
      {
        args: args.map((a) => a.replaceAll(BIN, '<BIN>').replaceAll(root, '<ROOT>')),
        stdout: so.text,
        stderr: se.text,
        exitCode,
        durationMs,
        startedAt,
        notes,
        ...(o.license ? { license: o.license } : {}),
        chunkTimings,
        ...extra
      },
      null,
      1
    )
  )
  console.log(name, exitCode, `${durationMs}ms`, JSON.stringify(extra).slice(0, 300))
}

mkdirSync(OUT, { recursive: true })
mkdirSync(SPIKE, { recursive: true })
// ---- search / inspect (metadata only) ----
await run(
  'search-blender-open-movie',
  [...C, '--flat-playlist', '-J', '--', 'ytsearch20:blender open movie'],
  { notes: 'metadata only, 20 results' }
)
await run(
  'search-no-results',
  [...C, '--flat-playlist', '-J', '--', 'ytsearch20:zzqxj kkvwpl 9f8e7d6c5b4a qqzzxxjj'],
  { notes: 'nonsense query' }
)
await run('inspect-video', [...C, '--no-playlist', '-J', '--', LICENSED], {
  notes:
    'Big Buck Bunny; metadata only; the license field here is the evidence for the download scenarios'
})
await run(
  'inspect-short',
  [...C, '--no-playlist', '-J', '--', 'https://www.youtube.com/shorts/6dBlxB1pBa8'],
  { notes: 'Blender Studio Short, metadata only' }
)
await run(
  'inspect-playlist',
  [
    ...C,
    '--yes-playlist',
    '--flat-playlist',
    '--playlist-items',
    '1:5',
    '-J',
    '--',
    'https://www.youtube.com/playlist?list=PLa1F2ddGya_8NhFM-rx_xh5SlIGbHyrZZ'
  ],
  { notes: 'Blender Feature Demos playlist, items 1:5, metadata only' }
)
await run('inspect-unavailable', [...C, '--no-playlist', '-J', '--', 'AAAAAAAAAAA'], {
  notes: 'nonexistent video ID: error classification sample'
})
// ---- downloads of the CC BY video ----
const L = { license: LICENSE }
const prog = (min: number) => (l: string) =>
  l.startsWith('[OF] downloading|') && Number(l.split('|')[1]) > min
await run('download-mp3', dl('mp3', join(SPIKE, 'st-mp3')), {
  ...L,
  stage: join(SPIKE, 'st-mp3'),
  notes: 'MP3 192, full'
})
await run('download-mp4', dl('mp4', join(SPIKE, 'st-mp4')), {
  ...L,
  stage: join(SPIKE, 'st-mp4'),
  notes: 'MP4 720, full'
})
await run('cancel-mp3-download', dl('mp3', join(SPIKE, 'st-c1')), {
  ...L,
  stage: join(SPIKE, 'st-c1'),
  cancelOn: prog(1e6),
  cancelDelayMs: 500,
  notes: 'taskkill /T /F ~0.5s after 1MB'
})
await run('cancel-mp3-postprocess', dl('mp3', join(SPIKE, 'st-c2')), {
  ...L,
  stage: join(SPIKE, 'st-c2'),
  cancelOn: (l) => l.startsWith('[OFPP] started|ExtractAudio'),
  cancelDelayMs: 100,
  notes: 'taskkill during first postprocessor'
})
await run('cancel-mp4-download', dl('mp4', join(SPIKE, 'st-c3')), {
  ...L,
  stage: join(SPIKE, 'st-c3'),
  cancelOn: prog(5e6),
  cancelDelayMs: 500,
  notes: 'taskkill /T /F ~0.5s after 5MB'
})
await run('cancel-mp4-merge', dl('mp4', join(SPIKE, 'st-c4')), {
  ...L,
  stage: join(SPIKE, 'st-c4'),
  cancelOn: (l) => l.startsWith('[OFPP] started|Merger'),
  cancelDelayMs: 100,
  notes: 'taskkill while ffmpeg merges'
})

// ---- measurements ----
if (!process.argv[2] || process.argv[2] === 'measure') {
  const sums = readFileSync(join(BIN, 'yt-dlp.SHA2-256SUMS'), 'utf8')
  const ver = execFileSync(YT, ['--version'], { encoding: 'utf8' }).trim()
  const zip = join(SPIKE, 'yt-dlp_win.zip'),
    dir = join(SPIKE, 'onedir')
  if (!existsSync(zip))
    writeFileSync(
      zip,
      Buffer.from(
        await (
          await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${ver}/yt-dlp_win.zip`)
        ).arrayBuffer()
      )
    )
  const h = createHash('sha256').update(readFileSync(zip)).digest('hex')
  if (
    !sums
      .split('\n')
      .find((l) => l.endsWith(' yt-dlp_win.zip'))
      ?.startsWith(h)
  )
    throw new Error(`onedir zip hash ${h} not in signed SUMS`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir)
  execFileSync('C:\\Windows\\System32\\tar.exe', ['-xf', zip, '-C', dir])
  const time = (exe: string) => {
    const t: number[] = []
    for (let i = 0; i < 5; i++) {
      const s = performance.now()
      execFileSync(exe, ['--version'], { windowsHide: true })
      t.push(Math.round(performance.now() - s))
    }
    return { runs: t, medianMs: [...t].sort((a, b) => a - b)[2] }
  }
  const m: Record<string, unknown> = {
    ytdlpVersion: ver,
    zipSha256: h,
    zipHashInSignedSums: true,
    onefileSizeBytes: statSync(YT).size,
    onedirFileCount: ls(dir).length,
    onefileStartup: time(YT),
    onedirStartup: time(join(dir, 'yt-dlp.exe'))
  }
  const lat: number[] = []
  for (let i = 0; i < 3; i++) {
    const s = performance.now()
    execFileSync(YT, [...C, '--flat-playlist', '-J', '--', 'ytsearch20:blender open movie'], {
      maxBuffer: 1 << 28,
      windowsHide: true
    })
    lat.push(Math.round(performance.now() - s))
  }
  m.searchLatencyMs = lat
  const pr: Record<string, unknown> = {}
  for (const [k, d] of [
    ['mp3', 'st-mp3'],
    ['mp4', 'st-mp4']
  ] as const)
    for (const f of ls(join(SPIKE, d, 'out'))
      .map((s) => s.replace(/ \(\d+ B\)$/, ''))
      .filter((f) => /\.(mp3|mp4)$/.test(f))) {
      const j = JSON.parse(
        execFileSync(
          join(BIN, 'ffprobe.exe'),
          [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_streams',
            '-show_format',
            join(SPIKE, d, 'out', f)
          ],
          { encoding: 'utf8' }
        )
      )
      pr[k] = {
        file: f,
        bitRate: j.format.bit_rate,
        duration: j.format.duration,
        streams: j.streams.map((s: Record<string, unknown>) => ({
          type: s.codec_type,
          codec: s.codec_name,
          profile: s.profile,
          width: s.width,
          height: s.height,
          bit_rate: s.bit_rate
        }))
      }
    }
  m.ffprobe = pr
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(m, null, 1))
  console.log(JSON.stringify(m, null, 1))
}
