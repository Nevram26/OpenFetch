# OpenFetch — Architecture Decision Records

Each record has a status of **Proposed**, **Accepted**, **Rejected** or **Superseded**. The maintainer accepted every record below on 2026-11-25. To change a decision, add a new record rather than editing an accepted one. The spec, [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), reflects these decisions.

## ADR-001 — Electron + React + TypeScript desktop shell

- **Status:** Accepted (confirms the spec's §2 choice)
- **Context:** The app must be a self-contained Windows app with an accessible UI and Node access in the main process. Tauri was considered and not chosen.
- **Decision:**
  - Electron 45.x with electron-vite 6, React 19, and TypeScript ~6.0.
  - Not TypeScript 7: typescript-eslint doesn't support it yet.
  - Upgrade to Electron 46 after v1.
- **Consequences:** The installer is large, so the binaries need a size budget. Only the latest 3 Electron majors get support, so the app needs a regular upgrade rhythm.

## ADR-002 — Local JSON persistence

- **Status:** Accepted (confirms the spec)
- **Decision:**
  - Versioned JSON files in `userData`.
  - Every file wrapped in `{ schemaVersion, data }`.
  - Atomic writes, done by writing to a temp file and renaming it.
  - Only one write at a time per file.
  - A corrupted file is set aside and replaced with defaults.
- **Consequences:** Nothing extra to install. Moving to SQLite later is optional; the library would need it only if it grows to thousands of items.

## ADR-003 — yt-dlp for search and download; no YouTube Data API

- **Status:** Accepted
- **Context:** The YouTube Data API's developer policies forbid storing copies, offline playback, and splitting audio from video. Those are the app's core purpose.
- **Decision:**
  - Use the documented `ytsearchN:` search in yt-dlp.
  - When YouTube blocks or rate-limits a request, show a classified error. Don't work around it.
- **Consequences:** Search and download can break whenever YouTube changes. ADR-006 covers how the engine gets updated when that happens.

## ADR-004 — Cancel by killing the whole process tree with `taskkill`

- **Status:** Accepted
- **Context:**
  - `yt-dlp.exe` is a PyInstaller bootloader that starts a second process.
  - On Windows, `child.kill()` ends only the bootloader, so yt-dlp, FFmpeg and Deno keep running.
  - The `tree-kill` package only shells out to `taskkill`.
- **Decision:**
  - Cancel with `execFile('taskkill', ['/PID', pid, '/T', '/F'])`, with no shell and no extra dependency.
  - Delete only that job's staging folder afterwards.
- **Consequences:** A forced kill leaves partial files, so every job must have its own staging folder. If the app itself crashes, the job's processes can be left running. Windows Job Objects would fix that; add them only if Phase 1 or later testing shows orphaned processes.

## ADR-005 — Manual app updates unless the app is code-signed

- **Status:** Accepted (D1)
- **Context:**
  - electron-updater skips signature checks for unsigned Windows builds. The only remaining check is a sha512 that comes from the same release, which spec §7.3 says is not enough.
  - The portable target can't auto-update at all.
- **Decision:**
  - Apply for free open-source signing through the SignPath Foundation.
  - Until the app is signed: an in-app "Check for updates" link that opens the release page, plus published checksums.
  - Once signed: electron-updater for NSIS builds only, with `verifyUpdateCodeSignature` on.
- **Consequences:** Users update by hand at first. SmartScreen warnings remain until the app is signed.

## ADR-006 — OpenFetch's own verified engine updater

- **Status:** Accepted (D2)
- **Context:** yt-dlp's built-in `-U` checks only a SHA-256 from the same release. Each yt-dlp release also publishes a GPG-signed `SHA2-256SUMS.sig`.
- **Decision:**
  - Always pass `--no-update`.
  - Pin yt-dlp's public key inside the app.
  - Verify the signature with openpgp.js, then the SHA-256 of the asset.
  - Stage the new version and run a health check.
  - Switch over only when no jobs are active, and keep the previous version for rollback.
  - FFmpeg and Deno, which publish no signatures, update only with app releases. Their hashes are pinned at build time.
  - Default to the stable channel. The updater may install a verified nightly build when the current stable release is broken for YouTube.
- **Consequences:** One new dependency (`openpgp`). The engine can be fixed without a new app release.

## ADR-007 — Fake engine fixtures for CI

- **Status:** Accepted
- **Context:** CI must never contact YouTube or download copyrighted media.
- **Decision:**
  - `EngineProcess` takes an injectable spawn function.
  - Integration tests run a small Node replay script (through `process.execPath`). It prints the stdout and stderr recorded in Phase 1, waits as the recording did, and exits with the recorded code.
  - Live checks are opt-in and run only with `npm run test:live`.
- **Consequences:** Fixtures go stale when yt-dlp's output changes. Re-record them whenever the pinned engine version is updated.

## ADR-008 — Local media served through a protocol that resolves library IDs

- **Status:** Accepted
- **Decision:**
  - Register a privileged scheme `{ standard, secure, stream: true }` before the app's `ready` event.
  - `protocol.handle` maps `media://<libraryId>` to a tracked file and supports HTTP Range (206 responses).
  - No `file://` access for the renderer.
- **Consequences:** Seeking works and the renderer can't reach arbitrary paths. The handler must be unit-tested against path traversal.

## Decision log (2026-11-25)

The maintainer accepted these open decisions as recommended.

| # | Decision | Outcome |
| --- | --- | --- |
| D1 | Code signing vs. manual updates | Apply for SignPath Foundation signing. v1 ships with manual updates if signing is not approved in time (ADR-005) |
| D2 | yt-dlp release channel | Stable by default; the verified engine updater may install nightly when stable is broken (ADR-006) |
| D3 | M4A in v1 | Deferred until after v1. v1 ships MP3 and MP4 |
| D4 | `yt-dlp.exe` (onefile) vs. `yt-dlp_win.zip` (onedir) | Measure startup time in Phase 1, then record the choice here |
| D5 | Search thumbnails | Load directly from the YouTube thumbnail host, with a narrow CSP `img-src` allowlist |
| D6 | `EnableNodeCliInspectArguments` fuse | Disabled in release builds. Playwright E2E runs against unpackaged builds; packaged builds get a launch smoke test |
