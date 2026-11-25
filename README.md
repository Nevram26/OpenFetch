# OpenFetch

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
| Packaging | electron-builder + NSIS | Installed and portable Windows executables |
| Application updates | electron-updater | GitHub Releases-based update flow for installed builds |
| Testing | Vitest + React Testing Library + Playwright (Electron) | Unit, component and desktop smoke tests |
| CI/CD | GitHub Actions | Windows builds, tests and tagged releases |

Use maintained, mutually compatible versions and commit a lockfile. Do not invent dependency versions or APIs. Verify them using official documentation and Context7 before implementation. Use npm consistently. SQLite is an optional future migration if JSON becomes unsuitable; do not introduce a database server, NestJS, Supabase, Firebase, Express or a separate HTTP service.

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

- Accept valid HTTPS YouTube video URLs, shortened youtu.be links, Shorts URLs and playlist URLs. Normalize known URL shapes to a canonical source ID or playlist ID.
- Reject malformed URLs, unsupported hosts and schemes, embedded credentials, local network addresses and arbitrary executable arguments.
- A video URL with a playlist parameter defaults to the individual video; downloading the playlist requires an explicit user choice.
- Inspect metadata without downloading. Show title, channel, thumbnail and available quality choices.
- For a playlist, present a bounded preview with selectable entries, count and confirmation. Do not silently download an entire playlist.
- Skip unavailable/private/restricted entries with a clear per-item explanation. Do not request login credentials or cookies.
- A valid source URL is not itself proof of permission. The UI must communicate authorized-use requirements before starting downloads.

### 4.3 Download formats and quality

| Mode | Formats | Quality options | Default |
| --- | --- | --- | --- |
| Music | MP3; M4A optional | MP3 128, 192, 320 kbps | MP3 192 kbps |
| Video | MP4 | 360p, 480p, 720p, 1080p, best compatible available | MP4 720p |

- MP3 uses FFmpeg to convert the available source audio. Requested bitrates are encoding targets, not a guarantee of improved source quality.
- M4A should preserve a compatible source stream when possible; bitrate settings must reflect actual conversion behavior.
- Prefer compatible H.264 video and AAC audio for MP4 playback. Use FFmpeg to merge separate streams or transcode only when necessary. An MP4 extension alone does not guarantee codec compatibility.
- Never promise an unavailable resolution or upscale automatically. When the selected quality is unavailable, choose the nearest lower compatible option with a clear notice, or ask before proceeding when the fallback materially changes the request.
- Preserve title and useful source metadata where available. Embedded artwork and artist tags are best-effort; do not mislabel a channel as the actual recording artist.
- Do not download a video merely to extract audio when a suitable audio-only source is available.
- All arguments are generated from validated application-controlled options. No arbitrary CLI flags in the renderer.

### 4.4 Queue and lifecycle

Support individual downloads, selecting multiple results, and playlist batches. Each entry becomes an independent job.

~~~text
queued -> resolving -> downloading -> processing -> completed
              |             |             |
              +-------------+-------------+--> failed
              +-------------+-------------+--> canceling -> canceled

failed / canceled / interrupted -> queued (explicit retry)
~~~

- Default to one active media job to keep resource usage low; allow a bounded setting of 1–3 concurrent jobs after testing.
- Queue is FIFO by default. Active jobs do not block search or the interface.
- Show status, percentage when known, speed, ETA, file size and a distinct conversion/merging stage. Unknown progress is indeterminate, not 0% forever.
- Prefer documented machine-readable progress output (e.g. yt-dlp progress templates) and final output-path reporting. Buffer partial stdout lines, handle stderr separately, and do not assume every event contains all fields.
- Do not mark a job complete solely because download progress reaches 100%; require successful process termination, successful post-processing and a verified final file.
- Cancel must stop the job's process tree, including child FFmpeg processes, on Windows. Never terminate unrelated processes. Clean up only known job-owned temporary files.
- Retry transient network failures with limited backoff (proposed maximum two automatic retries); do not retry permanent restrictions or invalid input. Provide a manual retry action.
- Detect duplicates using source ID + format + requested quality + destination. Warn and allow an explicit re-download with a non-conflicting filename. Missing local files must not prevent re-downloading.
- Save queue state atomically on meaningful changes. On restart, previously active jobs become interrupted; do not claim byte-level resume unless tested. Queued jobs require user confirmation before restarting.
- Keep a job-specific staging directory; commit completed files to the chosen destination without overwriting unrelated files. Handle disk-full errors, filesystem permissions and Windows path length/reserved names.
- Failed and canceled jobs must never appear as playable library items.

### 4.5 Local media library

- Only successfully completed files enter the library.
- Display title, source/channel, duration, actual format, file size and date added.
- Support search and filtering by music/video.
- Play local supported media offline with HTML audio/video controls, or open via the OS default player if unsupported.
- Provide play/pause, seek, volume and next/previous for music. Keep playback independent from download state.
- Open file and reveal in File Explorer. If a file was moved or removed externally, show a missing-file state and allow removing the record.
- Distinguish Remove from library (metadata only) from Delete file (destructive; confirmation required). Never delete a user's directory or an untracked file.
- Preview online media through a supported official YouTube playback path or open the canonical video in the default browser. Do not proxy media streams or grant remote web pages access to privileged IPC.
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
| updates:check / install | Explicit update workflow |

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

type DownloadOptions =
  | { format: 'mp3'; bitrateKbps: 128 | 192 | 320 }
  | { format: 'm4a' }
  | { format: 'mp4'; maxHeight: 360 | 480 | 720 | 1080 | 'best' };

interface DownloadJob {
  id: string;
  source: MediaSource;
  options: DownloadOptions;
  destination: string;
  status: JobStatus;
  progressPercent?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  attempts: number;
  outputPath?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

interface LibraryItem {
  id: string;
  jobId: string;
  source: MediaSource;
  filePath: string;
  format: 'mp3' | 'm4a' | 'mp4';
  sizeBytes: number;
  durationSeconds?: number;
  addedAt: string;
}
~~~

Store dates as ISO 8601 timestamps, use stable IDs, and distinguish requested settings from actual output properties.

## 6. Security and reliability requirements

- Enable contextIsolation and sandbox; disable nodeIntegration in renderer.
- Validate IPC callers, payloads, URL allowlists, numeric bounds and filesystem paths in the main process.
- Use spawn with an absolute executable path, an argument array, shell: false and windowsHide: true. Ignore arbitrary local yt-dlp configuration; explicitly configure approved binary paths. Never construct executable command strings from user input.
- Run binaries without admin privileges. Do not expose shell, arbitrary file paths, environment variables or secrets to the renderer.
- Use a restrictive Content Security Policy, block unexpected navigation/window creation, and open only validated HTTPS source links externally. Remote content must not inherit desktop privileges.
- Serve local playback only through an appropriately scoped mechanism (e.g. a custom protocol resolving known library IDs); do not expose the filesystem through unrestricted file URLs.
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

Fetch pinned versions from official or vetted upstream sources in a reproducible build script. Record versions, exact asset URLs, expected SHA-256 hashes, architecture and license/source information in a binary manifest. Verify assets before use. Do not commit large binaries to normal Git history.

Use electron-builder extraResources to place executables outside ASAR. Resolve development vs packaged paths explicitly, using process.resourcesPath for bundled resources. Perform startup health checks, passing absolute FFmpeg and Deno locations to the engine as required by the selected version. End users must not install Python, Node.js, FFmpeg or Deno separately.

### Independent updates

1. Application: use electron-updater with the project's GitHub Releases for installed builds; portable builds can show a link to a newer release.
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
  licenses/
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
- Build on Windows runners. Public standard GitHub-hosted Actions runners and GitHub Releases are the intended zero-infrastructure-cost distribution mechanism, subject to provider limits and terms.
- Pull requests: npm ci, lint, format check, typecheck, unit/integration tests and desktop smoke/build checks.
- Release: only on an explicit version tag such as v1.0.0; verify package version matches the tag, fetch verified binaries, build both targets, test packaged app, generate checksums, and publish a GitHub Release. Use least-privilege workflow permissions and grant contents: write only to the release job.
- Pin third-party actions to reviewed commit SHAs; never expose publishing credentials to untrusted PR code.
- Test installation, uninstallation, startup, search, authorized sample downloads, local playback and cancellation on a clean Windows environment with no development tools.
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
| 1. Engine feasibility | Verify binary versions and licenses; test keyword search, metadata, authorized MP3/MP4 download and cancellation on Windows | Recorded fixtures, documented commands and observed failures; no extra user-installed runtimes |
| 2. Desktop foundation | Scaffold Electron/React/TS, secure preload, validation, test tooling, navigation | App opens; typecheck and tests pass; renderer has no raw Node/IPC access |
| 3. Search and links | Search service, results UI, direct URL metadata, error handling | Search and URL inspection work; stale requests canceled; absent fields handled |
| 4. Core downloads | Quality options, process manager, progress, single download, cancel/retry, save folders | Verified MP3/MP4 files; no incomplete library records; cancellation kills owned child processes |
| 5. Queue and persistence | FIFO, batch selection, playlist confirmation, dedupe, settings and restart recovery | Multiple jobs complete independently; failed jobs retry; no implicit whole-playlist downloads |
| 6. Library and playback | Local library, playback, file actions and metadata/artwork | Offline playback; missing file and deletion cases covered |
| 7. Release and updates | Binary manifest, updater and rollback, NSIS/portable, CI release automation, licensing docs | Clean Windows machine can install and use app; verified update or documented safe manual fallback |
| 8. Public v1 polish | Accessibility, diagnostics, docs, end-to-end regression and user testing | All required acceptance tests pass; publish first tested release |

### Scope boundaries

Required for first public release: search, direct links, audio/video, quality choices, queue, batch and playlist selection, cancel/retry, local library, playback, settings, duplicate handling, verified dependency updates, installer and portable build.

Later: Filipino UI, dark theme, USB export, custom playlists, advanced metadata, clipboard detection, additional providers and true portable data mode. No cloud sync, mobile app, accounts or monetization in v1.

## 11. Test and acceptance checklist

Use local fixtures and explicitly authorized test media. Never make CI depend on live YouTube access or downloading copyrighted test content; live integration checks should be separate, opt-in and documented.

- [ ] Search returns normalized results and handles missing metadata, empty results, timeouts, cancellation, offline and rate limits.
- [ ] Invalid URLs, suspicious hostnames, path traversal and injection strings are rejected before process execution.
- [ ] Audio and video outputs match actual supported formats and quality; use FFprobe verification.
- [ ] Download progress distinguishes transfer and processing; failed conversion never marks completed.
- [ ] FIFO queue, batch selection, duplicate handling, retry bounds and per-item failures work.
- [ ] Cancellation stops all owned processes and removes only job-owned partial files.
- [ ] Settings, history and queue survive restart; corrupted JSON recovers safely.
- [ ] Library playback works offline; missing files, record removal and confirmed deletion behave correctly.
- [ ] Unverified binary updates are rejected; failed updates roll back.
- [ ] Packaged installer and portable executable work without external developer tools.
- [ ] Accessibility: keyboard-only navigation, visible focus, readable labels, contrast and status announcements.
- [ ] Release includes checksums, third-party notices, required source availability and instructions.

## 12. Instructions for AI coding agents

This README is the initial product specification. Follow it unless a maintainer explicitly approves a change.

1. Inspect the repository before editing; determine what exists and what is missing.
2. Use Context7 and official documentation to confirm library APIs, current compatibility, binary requirements and packaging behavior. Do not introduce outdated dependencies or speculative flags.
3. Start with Phase 1 and propose small implementation tasks. Do not generate the entire product in a single commit.
4. Maintain separation between renderer, preload, main services and shared types/schemas. Never move privileged operations into the renderer to simplify development.
5. Write tests alongside features; mock external process execution and use recorded fixture data where possible. Report what was actually executed versus what requires Windows/manual testing.
6. Keep the project local-first and free to operate. Do not add paid services, backend servers, required API keys or telemetry.
7. Preserve the GPL license and third-party obligations. Review license compatibility and redistribution requirements before adding or bundling dependencies.
8. Do not publish a release, claim completed features, or promise supported formats until they have been verified. Maintain a changelog and update the README as functionality ships.
9. For ambiguous non-critical details, use the simplest reversible choice and document it. Raise material security, licensing or architectural changes before implementing them.
10. Keep pull requests focused; include summary, test evidence, known limitations and any follow-up tasks.

## 13. License and documentation

OpenFetch is licensed under the [GNU General Public License v3.0](LICENSE). Bundled dependencies retain their own licenses. Before publishing binaries, audit the actual yt-dlp, FFmpeg, FFprobe, Deno and Electron distributions and all other dependencies; include their required notices and corresponding source or valid source offers as applicable. The OpenFetch license alone is not sufficient to satisfy third-party obligations.

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

Context7 library IDs previously investigated: `/electron/electron`, `/yt-dlp/yt-dlp`, `/tauri-apps/tauri-docs` (Tauri was considered but not selected).
