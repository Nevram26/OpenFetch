import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FolderOpen,
  Music,
  Search,
  Trash2,
  Video
} from 'lucide-react'
import { Button, EmptyState, PageHeader } from '../../components/ui'
import type { LibraryEntry } from '../../../../shared/library'
import { mediaUrl } from '../../../../shared/library'

type Filter = 'audio' | 'video'

export function LibraryScreen() {
  const [items, setItems] = useState<LibraryEntry[]>([])
  const [filter, setFilter] = useState<Filter>('audio')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<string>()
  const [error, setError] = useState('')
  const refresh = () =>
    window.openfetch
      .libraryList()
      .then(setItems)
      .catch(() => setError('Could not load your library.'))
  useEffect(() => {
    void refresh()
  }, [])
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === 'audio'
            ? item.actual.container === 'mp3'
            : item.actual.container === 'mp4') &&
          `${item.source.title} ${item.source.channel ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
      ),
    [items, filter, query]
  )
  const playable = visible.filter((item) => !item.missing)
  const active = playable.find((item) => item.id === playing)
  const act = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
      await refresh()
    } catch {
      setError('That library action could not be completed.')
    }
  }
  const move = (direction: number) => {
    if (!playable.length) return
    const i = playable.findIndex((item) => item.id === playing)
    setPlaying(playable[(i + direction + playable.length) % playable.length]?.id)
  }

  return (
    <>
      <PageHeader
        icon={<FolderOpen size={24} />}
        title="My library"
        subtitle="Your completed downloads, ready to play offline."
      />
      <div className="mb-5 flex flex-wrap gap-3" role="group" aria-label="Library type">
        <Button
          variant={filter === 'audio' ? 'soft' : 'secondary'}
          aria-pressed={filter === 'audio'}
          onClick={() => {
            setFilter('audio')
            setPlaying(undefined)
          }}
        >
          <Music size={16} aria-hidden /> Music (
          {items.filter((i) => i.actual.container === 'mp3').length})
        </Button>
        <Button
          variant={filter === 'video' ? 'soft' : 'secondary'}
          aria-pressed={filter === 'video'}
          onClick={() => {
            setFilter('video')
            setPlaying(undefined)
          }}
        >
          <Video size={16} aria-hidden /> Videos (
          {items.filter((i) => i.actual.container === 'mp4').length})
        </Button>
        <label className="relative ml-auto w-72">
          <span className="sr-only">Search in library</span>
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in library"
            className="w-full rounded-md border border-line py-2 pr-3 pl-9 text-sm"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      {active && (
        <section
          className="mb-5 rounded-lg border border-line bg-side p-4"
          aria-label="Now playing"
        >
          <h2 className="mb-3 font-semibold">Now playing: {active.source.title}</h2>
          <div className="mb-3 flex gap-2">
            <Button aria-label="Previous track" onClick={() => move(-1)}>
              <ArrowLeft size={16} aria-hidden /> Previous
            </Button>
            <Button aria-label="Next track" onClick={() => move(1)}>
              Next <ArrowRight size={16} aria-hidden />
            </Button>
          </div>
          {active.actual.container === 'mp3' ? (
            <audio
              key={active.id}
              controls
              autoPlay
              className="w-full"
              src={mediaUrl(active.id)}
              onEnded={() => move(1)}
            />
          ) : (
            <video
              key={active.id}
              controls
              autoPlay
              className="max-h-96 w-full rounded"
              src={mediaUrl(active.id)}
            />
          )}
        </section>
      )}
      {visible.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={32} />}
          title={items.length ? 'No matching downloads' : 'Your library is empty'}
        >
          {items.length
            ? 'Try a different search or filter.'
            : 'Verified completed downloads appear here and play offline.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line p-4"
            >
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{item.source.title}</h2>
                <p className="text-sm text-muted">
                  {item.source.channel ?? 'Unknown source'} | {item.actual.container.toUpperCase()}
                  {item.actual.height ? ` ${item.actual.height}p` : ''}
                  {item.actual.bitrateKbps ? ` ${item.actual.bitrateKbps} kbps` : ''} |{' '}
                  {item.actual.durationSeconds
                    ? `${Math.round(item.actual.durationSeconds)} sec | `
                    : ''}
                  {item.sizeBytes.toLocaleString()} bytes |{' '}
                  {new Date(item.addedAt).toLocaleDateString()}
                </p>
                {item.missing && <p className="text-sm text-danger">File missing</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!item.missing && (
                  <Button variant="primary" onClick={() => setPlaying(item.id)}>
                    Play
                  </Button>
                )}
                <Button
                  disabled={item.missing}
                  onClick={() => void act(() => window.openfetch.libraryOpenFile(item.id))}
                >
                  <ExternalLink size={16} aria-hidden /> Open
                </Button>
                <Button
                  disabled={item.missing}
                  onClick={() => void act(() => window.openfetch.libraryRevealFile(item.id))}
                >
                  <FolderOpen size={16} aria-hidden /> Show file
                </Button>
                <Button
                  onClick={() => void act(() => window.openfetch.libraryRemoveRecord(item.id))}
                >
                  Remove
                </Button>
                <Button onClick={() => void act(() => window.openfetch.libraryDeleteFile(item.id))}>
                  <Trash2 size={16} aria-hidden /> Delete file
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
