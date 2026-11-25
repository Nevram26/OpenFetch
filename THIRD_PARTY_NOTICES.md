# Third-party notices

OpenFetch is licensed under the GNU General Public License v3.0 (see `LICENSE`). It bundles and runs
the components below, each under its own license. Installed copies keep these files under
`<install dir>\resources\` (`LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses\`).
OpenFetch is an independent project and is not affiliated with YouTube or Google.

## Bundled engine binaries (`resources\binaries\`)

Exact versions, URLs and SHA-256 hashes are pinned in `resources/binary-manifest.json`.

### yt-dlp 2026.11.23 (`binaries\yt-dlp\`, the `yt-dlp_win.zip` onedir build)

- yt-dlp's own source is Unlicense. The Windows build bundles GPLv3+ code, so the combined executable
  is distributed under **GPL-3.0-or-later**. It also bundles mutagen (GPL-2.0-or-later), Python
  (PSF-2.0), OpenSSL, curl_cffi and others.
- The complete third-party license texts for everything inside the build are in
  `binaries\yt-dlp\_internal\THIRD_PARTY_LICENSES.txt` (shipped unmodified, from the official zip).
- Corresponding source:
  - yt-dlp 2026.11.23: release asset `yt-dlp.tar.gz` at
    <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.23>
  - mutagen 1.48.1 (version pinned by yt-dlp's `bundle/requirements/default.txt` at that tag):
    <https://github.com/quodlibet/mutagen/tree/release-1.48.1>
  - Python dependencies bundled by PyInstaller are the versions pinned in that same `bundle/requirements/`
    folder of the yt-dlp tag.
- Every OpenFetch release attaches the yt-dlp and mutagen source archives.

### FFmpeg and FFprobe 9.1 (`binaries\ffmpeg.exe`, `binaries\ffprobe.exe`)

- GPL build ("essentials") by gyan.dev, license **GPL-3.0-or-later**. Full text: `LICENSE`.
- Binary: <https://github.com/GyanD/codexffmpeg/releases/tag/9.1>
- Corresponding FFmpeg source, commit `74e4393595cf2b5857f0da925c4e0dd74ea306e5` (the commit the build
  states it was made from): <https://github.com/FFmpeg/FFmpeg/commit/74e4393595>. Every OpenFetch release
  attaches this archive.
- The build statically links third-party libraries (for example x264 and x265, which are GPL). Their
  names, versions and upstream source locations are listed by the build's author at
  <https://www.gyan.dev/ffmpeg/builds/#libraries>. The FFmpeg archive above does not contain those
  libraries' source.

### Deno 2.9.8 (`binaries\deno.exe`)

- License: **MIT**. Text: `licenses/deno-MIT.txt`. Source: <https://github.com/denoland/deno/tree/v2.9.8>.
- yt-dlp uses it as the JavaScript runtime for YouTube challenges.

## Application runtime

### Electron and Chromium

- Electron is MIT licensed (`LICENSE.electron.txt` in the install directory, shipped by electron-builder).
- Chromium and its dependencies carry many licenses. The full list is `LICENSES.chromium.html` in the
  install directory (shipped by electron-builder next to `OpenFetch.exe`).
- Source: <https://github.com/electron/electron>.

### npm packages bundled into the app

| Package | Version | License | Text |
| ------- | ------- | ------- | ---- |
| openpgp | 6.3.3 | LGPL-3.0-or-later | `licenses/openpgp-LGPL-3.0.txt`. Source: <https://github.com/openpgpjs/openpgpjs/tree/v6.3.3> |
| zod | 4.6.7 | MIT | `licenses/zod-MIT.txt` |
| react | 19.3.1 | MIT | `licenses/react-MIT.txt` (bundled into the renderer) |
| react-dom | 19.3.1 | MIT | `licenses/react-dom-MIT.txt` (bundled into the renderer) |
| scheduler | 0.28.0 | MIT | `licenses/scheduler-MIT.txt` (react-dom dependency, bundled into the renderer) |
| lucide-react | 1.80.0 | ISC | `licenses/lucide-react-ISC.txt` (icons bundled into the renderer) |

openpgp is used to verify yt-dlp's signed checksums. OpenFetch is GPL-3.0-or-later, which is compatible
with LGPL-3.0; the LGPL library can be replaced because OpenFetch's source is public.

Build tools and other development-only dependencies are not shipped.
