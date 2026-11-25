import { useEffect, useRef, useState } from 'react'
import { Download, FileAudio, FileVideo, Folder, X } from 'lucide-react'
import { Button } from '../../components/ui'
import type { MediaSource } from '../../../../shared/api'
import { formatDuration } from './format'

export type Format = 'mp3' | 'mp4'

// Spec §4.3: MP3 128/192/320 (default 192), MP4 360–1080 or best (default 720).
const qualities: Record<Format, { value: string; label: string; hint?: string }[]> = {
  mp3: [
    { value: '128', label: '128 kbps', hint: 'Smaller file' },
    { value: '192', label: '192 kbps', hint: 'Recommended' },
    { value: '320', label: '320 kbps', hint: 'Higher bitrate' }
  ],
  mp4: [
    { value: '360', label: '360p', hint: 'Smallest' },
    { value: '480', label: '480p' },
    { value: '720', label: '720p', hint: 'Recommended' },
    { value: '1080', label: '1080p' },
    { value: 'best', label: 'Best', hint: 'Best compatible' }
  ]
}
const defaults: Record<Format, string> = { mp3: '192', mp4: '720' }
const folders: Record<Format, string> = {
  mp3: 'Downloads\\OpenFetch\\Music',
  mp4: 'Downloads\\OpenFetch\\Videos'
}

const choice =
  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 has-checked:border-leaf-600 has-checked:bg-leaf-100 has-focus-visible:outline-3 has-focus-visible:outline-leaf-600'

export function DownloadOptionsDialog({
  result,
  initialFormat,
  onQueue,
  onClose
}: {
  result: MediaSource
  initialFormat: Format
  onQueue: (
    source: MediaSource,
    options:
      | { format: 'mp3'; bitrateKbps: 128 | 192 | 320 }
      | { format: 'mp4'; maxHeight: 360 | 480 | 720 | 1080 | 'best' },
    destination?: string
  ) => Promise<void>
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [format, setFormat] = useState<Format>(initialFormat)
  const [quality, setQuality] = useState(defaults[initialFormat])
  const [folder, setFolder] = useState('')
  const [customFolder, setCustomFolder] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.openfetch
      .downloadsGetFolder(format === 'mp3' ? 'music' : 'video')
      .then(setFolder)
      .catch(() => {})
  }, [format])

  // Native modal <dialog>: focus trap, Esc to close and an inert background for free.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="download-options-title"
      className="m-auto w-[560px] max-w-[calc(100%-2rem)] rounded-xl p-6 text-ink shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="download-options-title" className="flex items-center gap-2 text-xl font-bold">
          <Download size={20} aria-hidden /> Download options
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => ref.current?.close()}
          className="rounded p-1 text-muted hover:text-ink"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      <p className="font-semibold">{result.title}</p>
      <p className="mb-5 text-sm text-muted">
        {[result.channel, formatDuration(result.durationSeconds)].filter(Boolean).join(' · ')}
      </p>

      <fieldset className="mb-4">
        <legend className="mb-2 font-semibold">Format</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['mp3', 'mp4'] as const).map((f) => (
            <label key={f} className={`${choice} justify-center border-line py-2.5`}>
              <input
                type="radio"
                name="format"
                className="accent-leaf-600"
                checked={format === f}
                onChange={() => {
                  setFormat(f)
                  setQuality(defaults[f])
                  setCustomFolder(undefined)
                }}
              />
              {f === 'mp3' ? (
                <FileAudio size={16} aria-hidden />
              ) : (
                <FileVideo size={16} aria-hidden />
              )}
              {f === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="mb-2 font-semibold">Quality</legend>
        <div className="grid grid-cols-3 gap-2">
          {qualities[format].map((q) => (
            <label key={q.value} className={`${choice} border-line`}>
              <input
                type="radio"
                name="quality"
                className="accent-leaf-600"
                checked={quality === q.value}
                onChange={() => setQuality(q.value)}
              />
              <span>
                <span className="block text-sm font-medium">{q.label}</span>
                {q.hint && <span className="block text-xs text-muted">{q.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {format === 'mp3'
            ? 'Bitrate is an encoding target; it cannot improve the quality of the source.'
            : 'If this resolution is unavailable, the nearest lower one is used and you are told.'}
        </p>
      </fieldset>

      <div className="mb-6">
        <p className="mb-2 font-semibold">Save location</p>
        <div className="flex gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
            <Folder size={16} aria-hidden />{' '}
            <span className="truncate">{customFolder ?? folder ?? folders[format]}</span>
          </p>
          <Button
            onClick={async () => {
              const selected = await window.openfetch.downloadsChooseFolder(
                format === 'mp3' ? 'music' : 'video'
              )
              if (selected) {
                setFolder(selected)
                setCustomFolder(selected)
              }
            }}
          >
            Browse…
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button onClick={() => ref.current?.close()}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              const options =
                format === 'mp3'
                  ? { format, bitrateKbps: Number(quality) as 128 | 192 | 320 }
                  : {
                      format,
                      maxHeight: (quality === 'best' ? 'best' : Number(quality)) as
                        360 | 480 | 720 | 1080 | 'best'
                    }
              await onQueue(result, options, customFolder)
              ref.current?.close()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not add download')
              setBusy(false)
            }
          }}
        >
          <Download size={16} aria-hidden /> Download
        </Button>
      </div>
    </dialog>
  )
}
