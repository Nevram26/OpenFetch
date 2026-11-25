import { useRef, useState } from 'react'
import { FileAudio, FileVideo, Link2, Music, Download } from 'lucide-react'
import type { MediaSource, PlaylistPreview } from '../../../../shared/api'
import type { ErrorCode } from '../../../../shared/errors'
import { parseSourceUrl, type RejectReason } from '../../../../shared/source-url'
import { Button, EngineError, PageHeader } from '../../components/ui'
import { formatDuration } from '../search/format'
import { DownloadOptionsDialog, type Format } from '../search/DownloadOptionsDialog'

const reasonText: Record<RejectReason, string> = {
  empty: 'Paste a YouTube link.',
  'too-long': 'This link is too long.',
  'leading-dash': 'This does not look like a link.',
  'control-or-whitespace': 'Remove spaces and line breaks from the link.',
  'invalid-url': 'This is not a valid link.',
  'bad-scheme': 'Only https:// links are supported.',
  credentials: 'Links with a username or password are not supported.',
  'bad-port': 'Links with a port number are not supported.',
  'bad-host': 'Only YouTube links are supported.',
  'unsupported-path': 'This YouTube link is not a video, Short or playlist.',
  'bad-id': 'The video ID in this link looks wrong.',
  'bad-playlist-id': 'This playlist link is not supported (mixes and personal lists are excluded).'
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'video'; video: MediaSource; playlistId?: string }
  | { status: 'playlist'; list: PlaylistPreview }
  | { status: 'error'; code: ErrorCode; stderrTail: string }

export function PasteLinkScreen({ onOpenDownloads }: { onOpenDownloads: () => void }) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [download, setDownload] = useState<{ source: MediaSource; format: Format }>()
  const [playlistFormat, setPlaylistFormat] = useState<Format>('mp3')
  const latest = useRef(0) // drops answers to an older click

  const parsed = input.trim() ? parseSourceUrl(input) : undefined
  const invalid = parsed && !parsed.ok ? reasonText[parsed.reason] : undefined

  async function check(url: string) {
    const p = parseSourceUrl(url)
    if (!p.ok) return
    const n = ++latest.current
    setState({ status: 'loading' })
    try {
      if (p.kind === 'video') {
        const r = await window.openfetch.inspect(p.url)
        if (n !== latest.current) return
        if (r.ok) setState({ status: 'video', video: r.data, playlistId: p.playlistId })
        else if (!r.cancelled) setState({ status: 'error', code: r.code, stderrTail: r.stderrTail })
      } else {
        const r = await window.openfetch.inspectPlaylist(p.url)
        if (n !== latest.current) return
        if (r.ok) {
          setPicked(new Set(r.data.entries.map((e) => e.sourceId)))
          setState({ status: 'playlist', list: r.data })
        } else if (!r.cancelled)
          setState({ status: 'error', code: r.code, stderrTail: r.stderrTail })
      }
    } catch {
      if (n === latest.current) setState({ status: 'error', code: 'unknown', stderrTail: '' })
    }
  }

  return (
    <>
      {download && (
        <DownloadOptionsDialog
          result={download.source}
          initialFormat={download.format}
          onClose={() => setDownload(undefined)}
          onQueue={async (source, options, destination) => {
            const selected =
              state.status === 'playlist'
                ? state.list.entries.filter((e) => picked.has(e.sourceId))
                : [source]
            if (
              selected.length > 1 &&
              !window.confirm(
                `Add ${selected.length} selected playlist items to the download queue?`
              )
            )
              return
            const entries = selected.map((item) => ({
              source: item,
              options,
              ...(destination ? { destination } : {})
            }))
            try {
              await window.openfetch.downloadsEnqueue(entries)
            } catch (e) {
              if (
                !(
                  typeof e === 'object' &&
                  e !== null &&
                  'message' in e &&
                  String(e.message).startsWith('DUPLICATE_DOWNLOAD:')
                ) ||
                !window.confirm(
                  'Some exact downloads already exist. Add copies with non-conflicting filenames?'
                )
              )
                throw e
              await window.openfetch.downloadsEnqueue(entries, true)
            }
            onOpenDownloads()
          }}
        />
      )}
      <PageHeader
        icon={<Link2 size={24} />}
        title="Paste link"
        subtitle="Download a single video or choose items from a playlist."
      />
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void check(input)
        }}
      >
        <input
          type="text"
          aria-label="Video or playlist link"
          aria-invalid={invalid ? true : undefined}
          aria-describedby="link-help"
          placeholder="https://www.youtube.com/watch?v=…"
          value={input}
          maxLength={2048}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 rounded-md border border-line px-3 py-2.5 text-[15px] focus:border-leaf-600 aria-[invalid=true]:border-danger"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!parsed?.ok || state.status === 'loading'}
        >
          Check link
        </Button>
      </form>
      <p
        id="link-help"
        role="status"
        aria-live="polite"
        className={`mt-2 mb-6 min-h-5 text-sm ${invalid ? 'text-danger' : 'text-muted'}`}
      >
        {invalid ??
          (state.status === 'loading'
            ? 'Checking link…'
            : 'Only download media you are allowed to save.')}
      </p>

      {state.status === 'error' && (
        <EngineError
          code={state.code}
          stderrTail={state.stderrTail}
          onRetry={() => void check(input)}
        />
      )}

      {state.status === 'video' && (
        <div className="flex items-center gap-4 rounded-lg border border-line p-2.5">
          <Thumb item={state.video} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{state.video.title}</h2>
            {state.video.channel && <p className="text-sm text-muted">{state.video.channel}</p>}
            {state.playlistId && (
              <button
                type="button"
                className="mt-1 text-sm text-leaf-700 underline"
                onClick={() =>
                  void check(`https://www.youtube.com/playlist?list=${state.playlistId}`)
                }
              >
                This video is part of a playlist: show the playlist instead
              </button>
            )}
          </div>
          <Downloads onPick={(format) => setDownload({ source: state.video, format })} />
        </div>
      )}

      {state.status === 'playlist' && (
        <section aria-label="Playlist preview">
          <h2 className="text-lg font-bold">{state.list.title ?? 'Playlist'}</h2>
          <p className="mb-3 text-sm text-muted">
            {picked.size} of {state.list.entries.length} selected
            {state.list.skipped > 0 && ` · ${state.list.skipped} unavailable skipped`}
            {' · showing the first 200 items'}
          </p>
          <ul className="flex flex-col gap-2">
            {state.list.entries.map((e) => (
              <li key={e.sourceId}>
                <label className="flex items-center gap-3 rounded-lg border border-line p-2.5">
                  <input
                    type="checkbox"
                    checked={picked.has(e.sourceId)}
                    onChange={(ev) =>
                      setPicked((s) => {
                        const next = new Set(s)
                        if (ev.target.checked) next.add(e.sourceId)
                        else next.delete(e.sourceId)
                        return next
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                  <span className="text-sm text-muted">
                    {[e.channel, formatDuration(e.durationSeconds)].filter(Boolean).join(' · ')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm">
              Download format{' '}
              <select
                aria-label="Playlist download format"
                value={playlistFormat}
                onChange={(e) => setPlaylistFormat(e.target.value as Format)}
                className="ml-2 rounded border border-line px-2 py-1"
              >
                <option value="mp3">MP3 · 192 kbps</option>
                <option value="mp4">MP4 · 720p</option>
              </select>
            </label>
            <Button
              variant="primary"
              disabled={!picked.size}
              onClick={() => {
                const source = state.list.entries.find((e) => picked.has(e.sourceId))
                if (source) setDownload({ source, format: playlistFormat })
              }}
            >
              <Download size={16} aria-hidden /> Download {picked.size} selected
            </Button>
          </div>
        </section>
      )}
    </>
  )
}

function Thumb({ item }: { item: MediaSource }) {
  return (
    <div className="relative grid h-[68px] w-[120px] shrink-0 place-items-center overflow-hidden rounded-md bg-gradient-to-br from-leaf-300 to-leaf-600 text-white">
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <Music size={24} aria-hidden />
      )}
    </div>
  )
}

// Downloads are wired in Phase 4 (#9/#10).
function Downloads({ onPick }: { onPick: (format: Format) => void }) {
  return (
    <div className="flex gap-2">
      <Button onClick={() => onPick('mp3')}>
        <FileAudio size={16} aria-hidden /> MP3
      </Button>
      <Button variant="primary" onClick={() => onPick('mp4')}>
        <FileVideo size={16} aria-hidden /> MP4
      </Button>
    </div>
  )
}
