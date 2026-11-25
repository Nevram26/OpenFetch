# Engine findings (Phase 1 spike, issue #3)

Recorded on Windows 11 Home, Node 22, yt-dlp 2026.11.23 (pinned), by `npm run spike:record`. Fixtures are in `tests/fixtures/engine/*.json`. They are recordings, not tests, and CI does not execute them. Every process was started with `spawn(abs, args, { shell: false, windowsHide: true })`, `--` before the URL or query, and the base arguments `--ignore-config --no-update --js-runtimes deno:<abs> --ffmpeg-location <abs dir>`.

## Test media and licence

All downloads used one video: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film" (`aqz-KE-bpKQ`, 635 s), uploaded by the official `Blender` channel. yt-dlp's `license` field returned `Creative Commons Attribution license (reuse allowed)` (CC BY). This is recorded in the `license` key of every download fixture, and the evidence is in `inspect-video.json`. I tested other Blender Studio open movies first (Coffee Run, CHARGE, WING IT!, Spring, Sprite Fright, Tears of Steel) with metadata only. They returned `license: NA`, so nothing was downloaded from them. Search and inspect scenarios were metadata only. No cookies, plugins or evasion were used. Media was written to the gitignored `spike-output/` and deleted afterwards.

## Scenarios

| Fixture | Result |
|---|---|
| search-blender-open-movie | exit 0, 20 entries, 2.4-3.3 s |
| search-no-results | exit 0, `entries: []`. No error, so "no results" is not an error state |
| inspect-video / inspect-short | exit 0. `inspect-short` is about 680 KB and `inspect-video` about 180 KB of JSON, kept whole |
| inspect-playlist | exit 0, `--flat-playlist --playlist-items 1:5`, 5 entries |
| inspect-unavailable | exit 1, stderr `ERROR: [youtube] AAAAAAAAAAA: This video is unavailable`, empty stdout |
| download-mp3 | exit 0, about 16 s, 15.3 MB |
| download-mp4 | exit 0, about 22 s, 182 MB |
| cancel-mp3-download, cancel-mp3-postprocess, cancel-mp4-download, cancel-mp4-merge | killed with `taskkill /PID <pid> /T /F`. Node sees exit code 1 |

Skipped: a genuinely private video. I had no known private ID, so a nonexistent ID stands in. A real private video prints a different message (`Private video. Sign in ...`), which still needs a fixture later.

Progress lines in fixtures are thinned (first 5, last 5, every 25th `[OF]` line, with the count in `notes`). Known slip: the thinning regex also matches `[OFPP]` lines, so `download-mp3` stderr kept 10 of its 12. All cancel fixtures still keep their final `[OFPP]` lines. Chunk timings are in `chunkTimings` as `[ms, 'o'|'e', length]`, thinned past 200 chunks.

## (a) Startup: onefile vs onedir

`--version`, 5 runs each, median. The full spike was run three times, so all three medians are shown. The first run of each batch is the slowest (cold file cache and antivirus scan).

| Run | onefile `yt-dlp.exe` | onedir `yt-dlp_win.zip` |
|---|---|---|
| 1 | 2004 ms | 688 ms |
| 2 | 1437 ms | 533 ms |
| 3 | 1755 ms | 650 ms |
| 4 (last, `measurements.json`) | 2004 ms | 839 ms |

Onedir is about 2.3-2.9x faster. The onefile exe is 23.6 MB, and the onedir zip extracts to 143 files. The zip (`sha256 824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f`) was downloaded from the GitHub release, and the script confirmed this hash is in the GPG-signed `yt-dlp.SHA2-256SUMS`. Extraction used `C:\Windows\System32\tar.exe`. Git Bash's GNU tar fails on `C:` paths.

## (b) Search latency

`ytsearch20:` with `--flat-playlist -J`: 2.3-3.3 s per call. 2.3-3.0 s of that is spawn plus startup plus network. Three direct measurements: 2.5 / 2.3 / 2.3 s, and 2.7 / 3.0 / 3.0 s in a different run. Onedir would save about 1 s per search.

## (c) Processes after cancel

After each kill the script waited 2 s, then listed `yt-dlp.exe`, `ffmpeg.exe` and `deno.exe` PIDs and subtracted those present before the run. Fixture field: `cancel.ownedProcessesRemaining`.

| Scenario | Killed at | Owned processes remaining |
|---|---|---|
| cancel-mp3-download | during download, after 1 MB | 0 |
| cancel-mp3-postprocess | `[OFPP] started\|ExtractAudio` (ffmpeg running) | 0 |
| cancel-mp4-download | during download, after 5 MB | 0 |
| cancel-mp4-merge | `[OFPP] started\|Merger` (ffmpeg running) | 0 |

`taskkill /T /F` on the onefile exe left no `yt-dlp.exe`, `ffmpeg.exe` or `deno.exe` behind.

## (d) Staging folder after a kill (`-P temp:` folder)

Nothing appeared in `out/` (the home folder) in any cancelled run. All leftovers were in `tmp/`:

- MP3, killed during download: the cover `.jpg` and `<title>.m4a.part`, whose size depends on when the kill landed (8-11 MB in different runs).
- MP3, killed during ExtractAudio: `.jpg`, the complete `.m4a` (30.7 MB) and a truncated `.mp3` (262144 B).
- MP4, killed during download: `.jpg` and `<title>.f298.mp4.part`. Audio was not started yet.
- MP4, killed during merge: `.jpg`, the complete `.f298.mp4` and `.f258.m4a`, and a partial `<title>.temp.mp4`.

Consequences: the job's staging folder must be deleted recursively on cancel or failure. Only `out/` is ever promoted, and only after `[OFPATH]` appears. `.part` files must not be trusted as resumable.

## (e) FFprobe

- MP4 (`bitRate` about 2.29 Mb/s): video `h264` (Main profile) 1280x720, audio `aac` (LC) 386 kb/s. The format string with `-S res:720` selected 720p 60 fps avc1 plus mp4a. There is also a third stream, an `mjpeg` cover (1278x720) from `--embed-thumbnail`. A "has a video stream" check must account for it.
- MP3: `mp3` audio at exactly 192000 b/s (container 192.9 kb/s, 634.6 s), plus an `mjpeg` cover.

## (f) Postprocess progress template fields (verified)

Download template, on stdout: `[OF] %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(info.id)s`.

- `status` is `downloading` or `finished`. `NA` appears for unknown fields (the first line has no speed or eta). `speed` is a float and `eta` is an integer or `NA`. `fragment_index` was `NA` for these progressive downloads.
- Video and audio streams are separate downloads, and `downloaded_bytes` restarts for each. The MP4 run had one `finished` line per stream.

Postprocess template: `[OFPP] %(progress.status)s|%(progress.postprocessor)s|%(info.id)s`.

- The only progress fields are `status` (`started` or `finished`) and `postprocessor`. `%(progress)j` printed `{"status", "postprocessor", "_default_template"}`. There is no percent or bytes.
- `info.id` works from the `info` dict.
- Observed postprocessor names, in order. MP3: `ThumbnailsConvertor`, `FixupM4a`, `ExtractAudio`, `Metadata`, `EmbedThumbnail`, `MoveFiles`. MP4: `ThumbnailsConvertor`, `Merger`, `Metadata`, `EmbedThumbnail`, `MoveFiles`.
- **`[OFPP]` lines are written to stderr, not stdout.** `[OF]` and `[OFPATH]` are on stdout. The parser must read both streams. Stdout-only parsing silently loses all postprocess progress. This is why `cancel-mp3-postprocess` initially never fired.
- `[OFPATH] "<abs path with \\ escapes>"` is JSON on stdout and is only printed after `MoveFiles`.

## (g) Observed failures and gotchas

- `inspect-unavailable`: exit 1, `ERROR: [youtube] <id>: This video is unavailable`, no stdout.
- `search-no-results`: not a failure. Empty `entries`, exit 0.
- No 403, bot check or 429 occurred. No error-classification fixture for those exists yet.
- Benign stderr warning on every video call: `WARNING: Unknown codec iamf.001.001.Opus`. It must not be classified as an error.
- Passing a POSIX-style `/c/...` path from Git Bash for `--js-runtimes deno:` produced `No supported JavaScript runtime could be found`. Native Windows paths (what Node's `path.join` gives) work. Always pass `C:\...` paths.
- A killed yt-dlp exits 1, the same as a download error. Cancellation must be tracked by the job state, not by exit code.
- `cancel-mp3-postprocess` and `cancel-mp4-merge` need a trigger on the stderr stream (see (f)).

## D4 recommendation: onedir

Use `yt-dlp_win.zip` (onedir). Every search, inspect and download pays process startup. Onedir was about 0.5-0.8 s against 1.4-2.0 s for onefile, a consistent saving of about 1 s per call, and it avoids the onefile self-extract to `%TEMP%` on every launch, which antivirus can scan. The costs: 143 files instead of one, so the manifest pins the zip hash (already in the signed SUMS), and the installer must extract it to a fixed folder and verify the extracted `yt-dlp.exe`. Cancellation was only tested with the onefile exe (no leftovers). Re-run the cancel scenarios against onedir once the binary manifest handles the zip.

D4 is recorded in [DECISIONS.md](DECISIONS.md).

## Reproduce

`npm ci && npm run binaries:verify && npm run spike:record` (about 2 minutes, needs network; downloads about 200 MB into `spike-output/`). Pass a substring (for example `cancel` or `measure`) to run only matching scenarios.
