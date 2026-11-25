# OpenFetch

**Search. Download. Enjoy offline.**

OpenFetch is a free, open-source Windows desktop application designed to make finding, saving, and enjoying media easier. Search for videos or music directly within the app, save content you are authorized to download, and access your local collection without an internet connection.

Built with simplicity in mind, OpenFetch aims to be accessible to everyone, including people who are not familiar with technical software. No accounts, subscriptions, advertisements, or command-line tools are required for the planned desktop experience.

> **Development status:** OpenFetch is currently in pre-development. The features and usage instructions below describe the intended first release. No working installer has been published yet.

## Features

Planned for the first public release:

- **Built-in search** — Find videos, songs, and artists without leaving the application.
- **Video and music downloads** — Save authorized media as MP4 video or MP3 audio, with selectable quality.
- **Direct links** — Paste a supported YouTube video or playlist link instead of searching.
- **Batch and playlist downloads** — Select multiple items and manage them in a download queue.
- **Download management** — View progress, cancel downloads, retry failures, and avoid duplicates.
- **Local media library** — Browse and play downloaded music and videos offline.
- **Custom save locations** — Choose where your files are stored.
- **Local-first experience** — No required account, cloud storage, paid API key, or telemetry.

## Download

When the first stable release is available, download OpenFetch from the [GitHub Releases page](https://github.com/Nevram26/OpenFetch/releases).

| Version | Description |
| --- | --- |
| `OpenFetch-Setup-x64.exe` | Recommended Windows installer for everyday use. |
| `OpenFetch-Portable-x64.exe` | Run the application without installing it. |

The planned builds include the required media-processing tools, so users will not need to install Node.js, Python, FFmpeg, or yt-dlp separately.

**Initial target:** Windows 11 (64-bit). Windows 10 support will depend on compatibility testing. An internet connection is required for search, downloading, and update checks; downloaded media can be played offline.

Early unsigned releases may trigger Windows security warnings. Only download builds from the official repository, verify the published checksums, and keep your security protections enabled.

## How to use OpenFetch

The intended workflow is simple:

1. Launch OpenFetch and search for a song, artist, or video.
2. Select a result, or paste a supported video URL.
3. Choose **MP3** for music or **MP4** for video.
4. Choose the quality and confirm the save location.
5. Start the download and follow its progress in **Downloads**.
6. Open the completed file from **My Library** or File Explorer.

You can also select multiple results or individual playlist entries and queue them together.

By default, OpenFetch plans to save files under the Windows Downloads folder:

```text
Downloads/
  OpenFetch/
    Music/
    Videos/
```

## Built with

OpenFetch is planned around [Electron](https://www.electronjs.org/), React, TypeScript, Vite, Tailwind CSS, and shadcn/ui, with [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/), and Deno for local media operations.

## Development and contributions

OpenFetch is an open-source project. Bug reports, feature suggestions, and contributions are welcome.

- [Product direction and technical specification](docs/PRODUCT_DIRECTION.md) — product goals, business logic, architecture, security, development roadmap, and acceptance criteria.
- [Issues](https://github.com/Nevram26/OpenFetch/issues) — report bugs or propose improvements.
- [Releases](https://github.com/Nevram26/OpenFetch/releases) — official application builds once available.

The project is not yet scaffolded. Developer setup and build instructions will be added once the application foundation is implemented.

## Responsible use

Only download content you own, have permission to download, or are otherwise authorized to save under applicable law and the service's terms. Search results do not grant permission to download. OpenFetch is an independent project and is not affiliated with YouTube or Google.

## License

OpenFetch is licensed under the [GNU General Public License v3.0](LICENSE). Third-party components are subject to their respective licenses.
