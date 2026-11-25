# OpenFetch — Product Direction

> Search. Download. Enjoy offline.

OpenFetch is a planned free, open-source Windows desktop media application with integrated YouTube search, video and audio downloads for authorized content, and a local media library. It is designed first for non-technical users, including the developer's father, and second for the wider open-source community.

**Project status:** specification / pre-development. The features below are requirements, not claims of implemented functionality. No installer is available until a tested release is published.

## 1. Product goals and constraints

- Let users discover videos and songs without opening a browser or manually copying a URL.
- Make saving authorized media as MP3 or MP4 straightforward.
- Provide a familiar, accessible interface for people who are not comfortable with technical software.
- Allow users to organize and play downloaded files offline.
- Distribute a self-contained Windows installer and a portable executable through GitHub Releases.
- Keep recurring infrastructure costs at zero: no hosted backend, cloud database, paid API, required API key, account, subscription, advertising, or telemetry.
- Keep all preferences, download history and media files on the user's computer.
- Support Windows 11 x64 initially; Windows 10 compatibility is a best-effort target only if supported by the selected Electron version and tested. Other platforms and architectures are out of scope initially.
- Use the app only for media the user is permitted to download under applicable law and service terms. Do not implement DRM circumvention, access-control bypass, automated authentication/cookie extraction, geo-restriction bypass, or rate-limit evasion. Search availability does not imply download permission. Unofficial search/download integrations can fail or be restricted; do not claim affiliation with YouTube.

## 2. Technical stack

| Layer | Technology | Role |
| --- | --- | --- |
| Desktop shell | Electron | Windows application and privileged main process |
| Frontend | React + TypeScript | User interface |
| Build tooling | electron-vite + Vite | Main, preload and renderer builds |
| Styling | Tailwind CSS + shadcn/ui | Accessible, consistent UI components |
| Icons | Lucide React | Recognizable controls |
| Local backend | Node.js / Electron main process | Process management, filesystem and orchestration |
| Validation | Zod | Runtime validation across IPC and persistence boundaries |
| Download and search engine | yt-dlp standalone Windows x64 executable | Search, metadata extraction and authorized downloads |
| Media processing | FFmpeg + FFprobe | Audio conversion, compatible video merging and metadata inspection |
| JavaScript runtime | Deno | Supported yt-dlp JavaScript runtime for YouTube extraction |
| Local persistence | Versioned JSON files via Node.js filesystem | Settings, queue, library and search history |
| Packaging | electron-builder + NSIS + @electron/fuses | Installed and portable Windows executables; hardened Electron fuses |
| Application updates | electron-updater (signed NSIS builds only) | GitHub Releases-based update flow; manual updates until builds are code-signed (§7) |
| Engine update verification | openpgp.js | Verifies yt-dlp's signed release checksums |
| Testing | Vitest + React Testing Library + Playwright (Electron, experimental) | Unit, component and desktop smoke tests |
| CI/CD | GitHub Actions | Windows builds, tests and tagged releases |

Use maintained, mutually compatible versions and commit a lockfile. Do not invent dependency versions or APIs. Verify them using official documentation and Context7 before implementation. Use npm consistently. SQLite is an optional future migration if JSON becomes unsuitable; do not introduce a database server, NestJS, Supabase, Firebase, Express or a separate HTTP service.

### Version baseline (verified 2026-11-25)

| Component | Target | Notes |
| --- | --- | --- |
| Electron | 45.x (Node 24, Chromium M156) | Only the latest three majors are supported. Plan the Electron 46 (Node 26) upgrade after v1 |
| electron-vite / Vite | 6.0.x / 8.x | `@vitejs/plugin-react` 6.x requires Vite 8 |
| React / React Testing Library | 19.x / 16.x | RTL requires `@testing-library/dom` ^10 |
| TypeScript | ~6.0 | **Not 7.x**: typescript-eslint does not support it yet |
| Tailwind CSS | 4.x via `@tailwindcss/vite` | No `tailwind.config` file; leave that field blank in shadcn's `components.json` |
| Zod | 4.x | Use v4 APIs (`error`, `z.strictObject`, top-level `z.url`) |
| Vitest / Playwright | 5.x / 1.65.x | Playwright's Electron support is experimental |
| electron-builder / electron-updater | 26.x / 6.x | |
| yt-dlp | latest stable, pinned per release | Windows 10+ x64 standalone build; needs Deno ≥ 2.3 |
| Deno | 2.x | MIT |
| FFmpeg | GPL build, pinned to a versioned release | gyan.dev (`GyanD/codexffmpeg`) or a monthly BtbN tag; never a moving `latest` |
| CI Node / runner | Node 24 / `windows-2025` | Hosted runners are Windows Server, not Windows 11 |

Re-check this table when starting each phase; bump versions deliberately and record them in the changelog.

## 3. User experience

The default landing screen is **Search**, not a URL form.

### Main navigation

| Screen | Responsibilities |
| --- | --- |
| Search | Keyword input, search history, result list, selection and quick download actions |
| Paste link | Single video URL or playlist URL; inspect metadata and select items |
| Downloads | Active jobs, queue, progress, failures, retry, cancellation |
| My library | Completed downloads, local playback, search, filtering and file actions |
| Settings | Save locations, defaults, concurrency, engine versions, updates and privacy |

### Design requirements

- Desktop-first, clean Windows-friendly layout. Use a left sidebar, a prominent search bar, readable result rows, and a clear download queue indicator.
- Use a neutral light theme with a restrained jade/olive accent as the initial proposed visual direction; dark mode is optional.
- Large readable labels and controls, keyboard navigation, visible focus states, accessible names and sufficient contrast. Never rely on icons or color alone.
- Result rows display thumbnails, title, channel, duration (when available), and MP3 / MP4 actions.
- Keep advanced format and quality options in an accessible dialog. A quick-download action can use saved defaults; show the chosen format and location.
- Display friendly loading, empty, offline, unavailable and error states. Provide a way to copy diagnostic details without exposing personal data.
- Avoid unnecessary dashboards, complex configuration, excessive animations and modal chains.
- Use the user's default system language initially (English UI for v1); Filipino localization is a later enhancement.
- Do not imitate YouTube branding or imply official endorsement.

## 4. Business logic and functional requirements

### 4.1 Search and discovery

1. User enters a song, artist, video title or keyword and presses Enter or Search.
2. Validate and trim the query. Empty queries never start a process. Submit explicitly rather than issuing network requests for every keystroke.
3. The main process calls a search-provider abstraction. The initial provider is yt-dlp's documented keyword search.
4. Retrieve up to 20 flat results initially, normalize them, and render them as soon as the response is ready.
5. Search results include a stable source ID, title, optional channel, duration, thumbnail URL and canonical source URL. Missing metadata must not crash the UI.
6. Cancel the previous search when a newer one begins; ignore stale responses. Support retry, a bounded timeout and a clear no-results state.
7. If adding Load more, fetch a larger bounded result set and deduplicate by source ID. Do not pretend that yt-dlp provides true cursor pagination.
8. Selecting a result can fetch detailed metadata only when needed. Use available source metadata for quality selection and preview.
9. Keep a small local search history, allow clearing it, and avoid logging queries unnecessarily.
10. All results can be downloaded as audio or video if eligible; a Music filter must not claim accurate song classification without a reliable provider.

Initial engine experiment (PowerShell):

~~~powershell
.\yt-dlp.exe --ignore-config --flat-playlist --dump-single-json --skip-download "ytsearch20:acoustic music"
~~~

The command is an example, not a verified runtime test. Flat extraction may omit metadata. Validate actual output against current yt-dlp documentation and recorded fixtures. Use an explicit process argument array in production, not a shell command string.

Search must not require the official YouTube Data API or a shared API key. Do not combine that API with downloading in a way that conflicts with its developer policies. If the unofficial provider is restricted or breaks, report the failure clearly instead of evading restrictions.

### 4.2 Direct URL and playlist workflow

- Accept valid HTTPS YouTube video URLs, shortened youtu.be links, Shorts URLs and playlist URLs. Allowed hosts: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com` and `youtu.be`. Normalize known URL shapes to a canonical source ID or playlist ID.
- Reject malformed URLs, unsupported hosts and schemes, embedded credentials, IP-address and local network hosts, look-alike hostnames, and any value that could be parsed as an engine option. Always pass `--` before the URL or query.
- A video URL with a playlist parameter defaults to the individual video; downloading the playlist requires an explicit user choice.
- Inspect metadata without downloading. Show title, channel, thumbnail and available quality choices.
- For a playlist, present a bounded preview with selectable entries, count and confirmation. Do not silently download an entire playlist.
- Skip unavailable/private/restricted entries with a clear per-item explanation. Do not request login credentials or cookies.
- A valid source URL is not itself proof of permission. The UI must communicate authorized-use requirements before starting downloads.

### 4.3 Download formats and quality

| Mode | Formats | Quality options | Default |
| --- | --- | --- | --- |
| Music | MP3 (M4A after v1) | MP3 128, 192, 320 kbps | MP3 192 kbps |
| Video | MP4 | 360p, 480p, 720p, 1080p, best compatible available | MP4 720p |

- MP3 uses FFmpeg to convert the available source audio. Requested bitrates are encoding targets, not a guarantee of improved source quality.
- M4A is deferred until after v1. When added, it should preserve a compatible source stream when possible, and bitrate settings must reflect actual conversion behavior.
- Prefer compatible H.264 video and AAC audio for MP4 playback. Use FFmpeg to merge separate streams or transcode only when necessary. An MP4 extension alone does not guarantee codec compatibility. Verify the output with FFprobe (container, codecs, height, bitrate) before marking a job completed.
- Apply quality caps to the frame's shorter side (yt-dlp `-S res:<n>`) so vertical Shorts are not downscaled.
- Never promise an unavailable resolution or upscale automatically. When the selected quality is unavailable, choose the nearest lower compatible option with a clear notice, or ask before proceeding when the fallback materially changes the request.
- Preserve title and useful source metadata where available. Embedded artwork and artist tags are best-effort; do not mislabel a channel as the actual recording artist.
- Do not download a video merely to extract audio when a suitable audio-only source is available.
- All arguments are generated from validated application-controlled options. No arbitrary CLI flags in the renderer.

### 4.4 Queue and lifecycle

Support individual downloads, selecting multiple results, and playlist batches. Each entry becomes an independent job.

~~~text
queued -> resolving -> downloading -> processing -> completed
  |           |             |             |
  |           +-------------+-------------+--> failed
  |           +-------------+-------------+--> canceling -> canceled
  |           +-------------+-------------+--> interrupted (startup recovery only)
  +--> canceled

failed / canceled / interrupted -> queued (explicit retry)
~~~

Allowed transitions. Reject every other transition, and unit-test the rejection.

| From | To |
| --- | --- |
| queued | resolving, canceled |
| resolving / downloading / processing | the next stage, failed, canceling, interrupted (startup recovery only) |
| processing | completed (only after exit code 0, successful post-processing and an FFprobe-verified final file) |
| canceling | canceled |
| failed / canceled / interrupted | queued (explicit retry only) |

- Default to one active media job to keep resource usage low; allow a bounded setting of 1–3 concurrent jobs after testing.
- Queue is FIFO by default. Active jobs do not block search or the interface.
- Show status, percentage when known, speed, ETA, file size and a distinct conversion/merging stage. Unknown progress is indeterminate, not 0% forever.
- Prefer documented machine-readable progress output (e.g. yt-dlp progress templates) and final output-path reporting. Buffer partial stdout lines, handle stderr separately, and do not assume every event contains all fields.
- Do not mark a job complete solely because download progress reaches 100%; require successful process termination, successful post-processing and a verified final file.
- Cancel must stop the job's process tree on Windows. `yt-dlp.exe` is a PyInstaller bootloader that starts a second process, so `child.kill()` alone leaves yt-dlp, FFmpeg and Deno running. Terminate the tree with `taskkill /PID <pid> /T /F` through `execFile` (no shell). Never terminate unrelated processes. Afterwards, delete only that job's staging directory.
- Classify failures from the exit code and stderr into a fixed `ErrorCode` set: rate limited, bot check, unavailable, private, geo-restricted, no compatible format, network, post-processing failed, disk full, permission denied, engine missing, invalid input, unknown.
- Set the engine's internal `--retries` explicitly and keep it low. The app makes at most two automatic retries, and only for `network` errors. Never retry permanent restrictions, bot checks or invalid input. Provide a manual retry action.
- Space out requests in batches and playlists (`--sleep-interval`) to stay within guest rate limits. This respects the limits; it is not evasion.
- When the user quits with active jobs, ask for confirmation, then terminate each job's process tree and save the queue.
- Detect duplicates using source ID + format + requested quality + destination. Warn and allow an explicit re-download with a non-conflicting filename. Missing local files must not prevent re-downloading.
- Save queue state atomically on meaningful changes. On restart, previously active jobs become interrupted; do not claim byte-level resume unless tested. Queued jobs require user confirmation before restarting.
- Each job must have its own staging directory (pass both yt-dlp `-P home:` and `-P temp:` inside it), because a forced kill leaves partial files behind. Move completed files to the chosen destination without overwriting unrelated files. Handle disk-full errors, filesystem permissions and Windows path length/reserved names.
- Failed and canceled jobs must never appear as playable library items.

### 4.5 Local media library

- Only successfully completed files enter the library.
- Display title, source/channel, duration, actual format, file size and date added.
- Support search and filtering by music/video.
- Play local supported media offline with HTML audio/video controls, or open via the OS default player if unsupported.
- Provide play/pause, seek, volume and next/previous for music. Keep playback independent from download state.
- Open file and reveal in File Explorer. If a file was moved or removed externally, show a missing-file state and allow removing the record.
- Distinguish Remove from library (metadata only) from Delete file (destructive; confirmation required). Never delete a user's directory or an untracked file.
- Preview online media in v1 only by opening the canonical video in the default browser. An embedded YouTube player falls under the YouTube API developer policies. Do not proxy media streams or grant remote web pages access to privileged IPC.
- Future: copying selected media to a USB drive, custom local playlists, advanced tags and sorting.

### 4.6 Settings and local storage

Defaults:
- Save folder: OS Downloads directory / OpenFetch / Music or Videos.
- Audio: MP3 192 kbps. Video: MP4 720p.
- Concurrency: 1. No telemetry or analytics.
- Keep local history; allow clearing it independently of deleting files.
- Show application and engine versions and provide update checks.

Use Electron's app.getPath('userData') for versioned settings, queue, library and history files. Store media separately in the user-selected directory. Use validated schemas, atomic writes, serialized mutations and migration tests; recover safely from malformed or corrupted settings rather than crashing.

For v1, the portable executable means no installation is required; it may still use the same Windows user-data directory. A truly self-contained portable data mode is a future explicit option.

## 5. Architecture

~~~text
React renderer
  | typed, narrow IPC
Electron preload (contextBridge)
  |
Electron main process
  +-- SearchService --> SearchProvider (yt-dlp)
  +-- MetadataService
  +-- DownloadQueue --> DownloadService --> EngineProcess
  |                                          +-- yt-dlp
  |                                          +-- FFmpeg / FFprobe
  |                                          +-- Deno
  +-- LibraryService / SettingsService --> local persistence
  +-- BinaryManager / UpdateService --> verified upstream releases
  +-- FileService --> approved local paths
~~~

### Process boundaries

- Renderer: presentation, user interaction, state derived from IPC responses. No direct Node.js access, executable invocation or unrestricted filesystem access.
- Preload: narrow typed functions and event subscriptions, with unsubscribe callbacks. Never expose raw ipcRenderer or arbitrary channel names.
- Main: authoritative validation, business rules, process lifecycle, persistence and filesystem operations.
- Services: independent of React components and easily unit-tested using injected dependencies.

Suggested IPC contract (names are proposals):

| Operation | Input / output |
| --- | --- |
| search:start | Query and request ID -> normalized results |
| search:cancel | Request ID |
| media:inspect | Canonical source URL -> metadata and supported options |
| downloads:enqueue | Validated media selection and format options -> job IDs |
| downloads:list | Queue snapshot |
| downloads:cancel / retry | Existing job ID |
| downloads:changed | Job snapshot event |
| library:list | Library entries |
| library:open / reveal / remove | Library item ID, with explicit deletion flag where applicable |
| settings:get / update | Validated settings / patch |
| settings:chooseFolder | Native directory dialog -> approved path |
| history:list / clear | Local search history |
| playlist:inspect | Playlist URL -> bounded, selectable entry preview |
| downloads:clearFinished | Removes completed, failed and canceled entries from the queue view |
| downloads:confirmResume | User decision on jobs queued in a previous session |
| library:delete | Library item ID -> deletes the tracked file after confirmation (separate from remove) |
| engine:status | Engine versions, health and staleness |
| app:diagnostics | Sanitized diagnostic text for copying |
| updates:check / install | Explicit update workflow |

Throttle progress events to the renderer (for example, at most four per second per job).

### Core data model

Use TypeScript types plus runtime schemas. Optional source metadata is nullable or absent, not fabricated.

~~~typescript
type JobStatus =
  | 'queued' | 'resolving' | 'downloading' | 'processing'
  | 'completed' | 'failed' | 'canceling' | 'canceled' | 'interrupted';

interface MediaSource {
  provider: 'youtube';
  sourceId: string;
  url: string;
  title: string;
  channel?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

type DownloadOptions =                       // 'm4a' is added after v1
  | { format: 'mp3'; bitrateKbps: 128 | 192 | 320 }
  | { format: 'mp4'; maxHeight: 360 | 480 | 720 | 1080 | 'best' };

type ErrorCode =
  | 'rate_limited' | 'bot_check' | 'unavailable' | 'private' | 'geo_restricted'
  | 'no_compatible_format' | 'network' | 'postprocess_failed' | 'disk_full'
  | 'permission_denied' | 'engine_missing' | 'invalid_input' | 'unknown';

interface ActualOutput {                     // measured with FFprobe, never copied from the request
  container: 'mp3' | 'mp4';
  vcodec?: string;
  acodec?: string;
  height?: number;
  bitrateKbps?: number;
  durationSeconds?: number;
}

interface DownloadJob {
  id: string;
  batchId?: string;                          // groups multiple selections and playlist entries
  source: MediaSource;
  options: DownloadOptions;
  destination: string;
  status: JobStatus;
  progressPercent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  attempts: number;
  outputPath?: string;
  errorCode?: ErrorCode;
  notice?: string;                           // e.g. "720p unavailable, used 480p"
  createdAt: string;
  updatedAt: string;
}

interface LibraryItem {
  id: string;
  jobId: string;
  source: MediaSource;
  filePath: string;
  requested: DownloadOptions;                // needed for duplicate detection
  actual: ActualOutput;
  sizeBytes: number;
  addedAt: string;
}

interface PersistedFile<T> {                 // envelope for every JSON file
  schemaVersion: number;
  data: T;
}
~~~

Store dates as ISO 8601 timestamps, use stable IDs, and keep requested settings (`requested`) separate from measured output properties (`actual`).

## 6. Security and reliability requirements

- Enable contextIsolation and sandbox; disable nodeIntegration in renderer.
- Bundle the preload into a single file. Since Electron 45, a sandboxed preload can only `require('electron')`. Keep validation (Zod) in main, not in the preload.
- Apply Electron fuses at package time: disable `RunAsNode`; enable `EnableEmbeddedAsarIntegrityValidation` together with `OnlyLoadAppFromAsar`; disable `EnableNodeCliInspectArguments` in release builds. Disabling that last fuse breaks Playwright on packaged builds, so E2E tests run against unpackaged builds.
- Load the app shell from a custom protocol, not `file://`.
- Call `app.requestSingleInstanceLock()`. A second instance focuses the first and exits, so two processes never write the same JSON state.
- Validate IPC callers, payloads, URL allowlists, numeric bounds and filesystem paths in the main process. Every handler checks the origin of `event.senderFrame` and rejects a missing frame.
- Deny `will-navigate`. `setWindowOpenHandler` returns `{ action: 'deny' }`, and validated HTTPS links open with `shell.openExternal`. The session permission request handler denies all requests.
- Use spawn with an absolute executable path, an argument array, shell: false and windowsHide: true. Ignore arbitrary local yt-dlp configuration; explicitly configure approved binary paths. Never construct executable command strings from user input.
- Run binaries without admin privileges. Do not expose shell, arbitrary file paths, environment variables or secrets to the renderer.
- Use a restrictive Content Security Policy. `img-src` allows only the YouTube thumbnail host(s) actually used (for example `https://i.ytimg.com`), and thumbnails load directly from there. Remote content must not inherit desktop privileges.
- Serve local playback only through a custom protocol that resolves known library IDs:
  - Register the scheme with `registerSchemesAsPrivileged` before the app is `ready`, using `{ standard, secure, stream: true }`.
  - The `protocol.handle` handler supports HTTP `Range` requests (206 responses with `Content-Range`, `Accept-Ranges` and `Content-Length`), so audio and video can seek.
  - Never expose the filesystem through `file://` URLs or path segments.
- Treat external titles, thumbnails and metadata as untrusted. Escape content, validate URLs, sanitize filenames and prevent path traversal.
- Bound subprocess output, search duration, batch size, queue concurrency and memory usage. Clean up on app shutdown and failure.
- Never log credentials, cookies, sensitive paths or complete diagnostics by default. Provide opt-in sanitized error reports.
- No DRM bypass, credential collection, proxy rotation, anti-bot evasion or unrestricted scraping features.
- Show meaningful errors for offline state, rate limiting, restricted content, unsupported format, missing dependencies, disk space, permissions, conversion failure and canceled jobs.

## 7. Binary management and updates

Bundle a compatible set of Windows x64 executables with every release:
- yt-dlp.exe (official standalone build; verify EJS support for selected release)
- ffmpeg.exe
- ffprobe.exe
- deno.exe

Fetch pinned versions from official or vetted upstream sources in a reproducible build script. Record versions, exact asset URLs, expected SHA-256 hashes, architecture, license/source information and the verification method in a binary manifest. Verify assets before use and fail closed. Do not commit large binaries to normal Git history.

- **yt-dlp:** each release publishes `SHA2-256SUMS` and a GPG signature, `SHA2-256SUMS.sig`. Pin yt-dlp's public key and verify the signature (openpgp.js), then check the asset's SHA-256. Always pass `--no-update`. The built-in `-U` checks only an unsigned checksum from the same release.
- **FFmpeg and Deno:** neither publishes a signature. Pin their hashes at build time from a versioned (non-`latest`) release.
- Pass `--js-runtimes deno:<absolute path>` and `--ffmpeg-location <absolute path>` explicitly.
- Default to yt-dlp's stable channel. The engine updater may install a verified nightly build when the current stable release is broken for YouTube.
- Show a staleness warning when the installed engine is older than about 90 days.
- Choose between `yt-dlp.exe` (onefile) and `yt-dlp_win.zip` (onedir) from the startup measurements in Phase 1.
- Keep the installer within a documented size budget (about 150–250 MB, to be confirmed in Phase 1).

Use electron-builder extraResources to place executables outside ASAR. Resolve development vs packaged paths explicitly, using process.resourcesPath for bundled resources. Perform startup health checks, passing absolute FFmpeg and Deno locations to the engine as required by the selected version. End users must not install Python, Node.js, FFmpeg or Deno separately.

### Independent updates

1. Application:
   - Until builds are code-signed, v1 uses manual updates: Check for updates opens the newer GitHub Release, which carries checksums. For unsigned builds, electron-updater skips signature verification and relies only on a checksum from the same release, which point 3 rules out.
   - Apply for free open-source code signing (SignPath Foundation).
   - Once signed, enable electron-updater for NSIS builds only, with `verifyUpdateCodeSignature` on.
   - Portable builds always link to the release page; electron-builder's portable target has no auto-update.
2. Engine: seed a writable app-data binary directory from verified packaged defaults. Check trusted upstream release metadata independently so yt-dlp can be updated without a full app release.
3. Verify authenticity/integrity using appropriate upstream signatures, pinned trust keys or a trusted release manifest. HTTPS or a checksum obtained from the same untrusted download location is not sufficient on its own for authenticity.
4. Download to staging, verify version and compatibility, wait until no dependent jobs are active, atomically switch versions, health-check and retain a rollback version. On failure, keep the working version and display a clear message.
5. FFmpeg and Deno may initially update with app releases rather than independently; keep their versions tracked.
6. Provide Check for updates, visible version information, a progress/error state, and user confirmation before app restart. Do not require a paid update service.
7. Do not silently execute unverified updates. For unsigned builds, validate the actual updater behavior and ship manual verified updates if safe automatic app updates cannot be guaranteed.

## 8. Repository layout

Proposed structure; create only modules needed for the current milestone.

~~~text
OpenFetch/
  .github/workflows/
    ci.yml
    release.yml
  src/
    main/
      index.ts
      ipc/
      services/
        search.service.ts
        metadata.service.ts
        download.service.ts
        queue.service.ts
        library.service.ts
        settings.service.ts
        binary-manager.ts
        updater.service.ts
      persistence/
    preload/
      index.ts
    renderer/
      src/
        components/
        features/
          search/
          downloads/
          library/
          settings/
        hooks/
        App.tsx
    shared/
      types/
      schemas/
  resources/
    binaries/
    binary-manifest.json
  scripts/
    fetch-binaries.ts
    verify-binaries.ts
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  docs/
    DECISIONS.md
  licenses/
  CHANGELOG.md
  electron-builder.yml
  electron.vite.config.ts
  package.json
  package-lock.json
  README.md
  LICENSE
  THIRD_PARTY_NOTICES.md
~~~

## 9. Windows distribution and CI/CD

- Primary deliverable: OpenFetch-Setup-x64.exe (NSIS installer, per-user by default, Start Menu and optional desktop shortcut).
- Secondary deliverable: OpenFetch-Portable-x64.exe (no installation).
- Include versioned assets or stable documented names, SHA256SUMS.txt, release notes, source archives and required third-party notices/source availability. Include updater metadata when applicable.
- Build on pinned `windows-2025` runners. Public standard GitHub-hosted Actions runners and GitHub Releases are the intended zero-infrastructure-cost distribution mechanism, subject to provider limits and terms.
- Give the `nsis` and `portable` targets separate `artifactName`s.
- Pull requests: npm ci, lint, format check, typecheck, unit/integration tests and desktop smoke/build checks. Do not upload a build for every PR, and keep artifact retention short (the free tier allows 500 MB of artifact storage).
- Release:
  - Only on an explicit version tag such as v1.0.0, and the package version must match the tag.
  - Fetch verified binaries, build both targets, run a launch smoke test on the packaged app, and generate checksums.
  - Publish as a **draft** GitHub Release, and make it public after review.
  - Use least-privilege workflow permissions and grant `contents: write` only to the release job.
- Pin third-party actions to reviewed commit SHAs; never expose publishing credentials to untrusted PR code.
- Hosted runners are Windows Server, so every release candidate must pass a **manual** test on a clean Windows 11 machine with no development tools: installation, uninstallation, startup, search, authorized sample downloads, local playback and cancellation.
- Unsigned executables can trigger Windows SmartScreen warnings. Document the limitation and checksum verification; do not instruct users to disable security protections.
- No mandatory code-signing purchase or Microsoft Store publication for v1.

### Expected developer commands

These are proposed scripts to implement and document, not currently available.

~~~bash
npm ci
npm run binaries:fetch
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build:win
~~~

## 10. Implementation roadmap

Work in order. Each milestone should be a reviewable pull request (or small set of PRs) with acceptance checks. Do not attempt the entire application in one change.

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 1. Engine feasibility | Binary manifest and fetch/verify scripts (GPG for yt-dlp); test keyword search, metadata, authorized MP3/MP4 download and process-tree cancellation on Windows 11; measure onefile vs onedir startup | Verify fails closed on tampering; recorded fixtures; zero owned processes left after cancel; documented commands and observed failures; no extra user-installed runtimes |
| 2. Desktop foundation | Scaffold Electron/React/TS, secure preload, fuses, custom app protocol, single-instance lock, IPC validation with sender checks, atomic JSON store, test tooling, navigation | App opens; typecheck and tests pass; renderer has no raw Node/IPC access; the JSON store recovers from corrupted files |
| 3. Search and links | Engine process wrapper, search service, results UI, URL validation, direct URL metadata, error handling | Search and URL inspection work; stale requests canceled; absent fields handled; hostile inputs rejected before any process starts |
| 4. Core downloads | Quality options, progress parsing, staging, FFprobe verification, error classification, single download, cancel/retry, save folders | FFprobe-verified MP3/MP4 files; no incomplete library records; cancellation kills owned process trees and cleans only staging |
| 5. Queue and persistence | FIFO with enforced transitions, batch selection, playlist confirmation, dedupe, request spacing, settings and restart recovery | Multiple jobs complete independently; failed jobs retry; illegal transitions rejected; no implicit whole-playlist downloads |
| 6. Library and playback | Local library, Range-capable media protocol, playback, file actions and metadata/artwork | Offline playback with seeking; missing file, traversal and deletion cases covered |
| 7. Release and updates | Verified engine updater with rollback, manual app updates (electron-updater once signed), NSIS/portable, draft-release CI automation, licensing and source bundles | Clean Windows 11 machine can install and use the app; tampered engine updates rejected; failed updates roll back |
| 8. Public v1 polish | Accessibility, diagnostics, engine staleness warning, docs, end-to-end regression and user testing | All required acceptance tests pass, including the manual Windows 11 gate; publish first tested release |

### Scope boundaries

Required for first public release: search, direct links, audio/video, quality choices, queue, batch and playlist selection, cancel/retry, local library, playback, settings, duplicate handling, verified dependency updates, installer and portable build.

Later: M4A, Filipino UI, dark theme, USB export, custom playlists, advanced metadata, clipboard detection, additional providers and true portable data mode. No cloud sync, mobile app, accounts or monetization in v1.

## 11. Test and acceptance checklist

Use local fixtures and explicitly authorized test media. Never make CI depend on live YouTube access or downloading copyrighted test content; live integration checks should be separate, opt-in (`npm run test:live`) and documented.

- The engine process wrapper takes an injectable spawn function. Integration tests replay the stdout, stderr and exit codes recorded in Phase 1 through a small Node fake-engine script. Re-record the fixtures whenever the pinned engine version changes.
- Playwright E2E runs against the unpackaged app. The packaged app gets a launch smoke test.

- [ ] Search returns normalized results and handles missing metadata, empty results, timeouts, cancellation, offline and rate limits.
- [ ] Invalid URLs, suspicious hostnames, path traversal and injection strings are rejected before process execution.
- [ ] Audio and video outputs match actual supported formats and quality; use FFprobe verification.
- [ ] Download progress distinguishes transfer and processing; failed conversion never marks completed.
- [ ] FIFO queue, batch selection, duplicate handling, retry bounds and per-item failures work.
- [ ] Cancellation stops all owned processes and removes only job-owned partial files.
- [ ] Settings, history and queue survive restart; corrupted JSON recovers safely.
- [ ] Library playback works offline; missing files, record removal and confirmed deletion behave correctly.
- [ ] Every job-state transition not in the allowed table is rejected.
- [ ] Unverified binary updates are rejected; failed updates roll back.
- [ ] Packaged installer and portable executable work without external developer tools.
- [ ] Accessibility: keyboard-only navigation, visible focus, readable labels, contrast and status announcements.
- [ ] Release includes checksums, third-party notices, required source availability and instructions.

## 12. Instructions for AI coding agents

This document is the initial product specification. Follow it unless a maintainer explicitly approves a change.

1. Inspect the repository before editing; determine what exists and what is missing.
2. Use Context7 and official documentation to confirm library APIs, current compatibility, binary requirements and packaging behavior. Do not introduce outdated dependencies or speculative flags.
3. Start with Phase 1 and propose small implementation tasks. Do not generate the entire product in a single commit.
4. Maintain separation between renderer, preload, main services and shared types/schemas. Never move privileged operations into the renderer to simplify development.
5. Write tests alongside features; mock external process execution and use recorded fixture data where possible. Report what was actually executed versus what requires Windows/manual testing.
6. Keep the project local-first and free to operate. Do not add paid services, backend servers, required API keys or telemetry.
7. Preserve the GPL license and third-party obligations. Review license compatibility and redistribution requirements before adding or bundling dependencies.
8. Do not publish a release, claim completed features, or promise supported formats until they have been verified. Maintain a changelog and update the product direction and public README as functionality ships.
9. For ambiguous non-critical details, use the simplest reversible choice and document it. Raise material security, licensing or architectural changes before implementing them.
10. Keep pull requests focused; include summary, test evidence, known limitations and any follow-up tasks.

## 13. License and documentation

OpenFetch is licensed under the [GNU General Public License v3.0](../LICENSE). Bundled dependencies retain their own licenses. Before publishing binaries, audit the actual yt-dlp, FFmpeg, FFprobe, Deno and Electron distributions and all other dependencies; include their required notices and corresponding source or valid source offers as applicable. The OpenFetch license alone is not sufficient to satisfy third-party obligations.

Known obligations, verified 2026-11-25:

- yt-dlp's source code is Unlicense, but the standalone executable bundles GPLv3+ code, so the combined work is GPLv3+. It also includes mutagen (GPL-2.0+), Python (PSF), OpenSSL and curl_cffi. Ship its `THIRD_PARTY_LICENSES` with releases, along with corresponding source.
- FFmpeg GPL builds are compatible with GPLv3. Provide corresponding source for the exact pinned build.
- Deno is MIT; include its notice.

OpenFetch is an independent project and is not affiliated with YouTube or Google.

### Technical references

- [Electron documentation](https://www.electronjs.org/docs/latest/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-vite](https://electron-vite.org/)
- [electron-builder](https://www.electron.build/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [yt-dlp EJS runtime documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [FFmpeg](https://ffmpeg.org/)
- [FFmpeg legal information](https://ffmpeg.org/legal.html)
- [Deno](https://deno.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [YouTube Terms of Service](https://www.youtube.com/t/terms)
- [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies)

Context7 library IDs previously investigated: `/electron/electron`, `/websites/electron_build`, `/websites/electron-vite_guide`, `/websites/ui_shadcn`, `/yt-dlp/yt-dlp`, `/openpgpjs/openpgpjs`, `/tauri-apps/tauri-docs` (Tauri was considered but not selected).

Architecture decisions are recorded in [DECISIONS.md](DECISIONS.md).
