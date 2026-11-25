// Fake yt-dlp (ADR-007): replays a recorded fixture's stdout, stderr and exit code.
// usage: node fake-engine.mjs <fixture.json> [delayMs]. Extra argv (the real yt-dlp args) is ignored.
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const [, , fixture, delay] = process.argv
const { stdout = '', stderr = '', exitCode = 0 } = JSON.parse(readFileSync(fixture, 'utf8'))
const write = (stream, text) => new Promise((done) => (text ? stream.write(text, done) : done()))

await sleep(Number(delay) || 0)
await write(process.stderr, stderr)
await write(process.stdout, stdout)
process.exit(exitCode)
