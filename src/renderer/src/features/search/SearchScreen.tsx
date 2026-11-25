import { useEffect, useRef, useState } from 'react'
import { FileAudio, FileVideo, ListOrdered, Music, Search, X } from 'lucide-react'
import type { MediaSource } from '../../../../shared/api'
import type { ErrorCode } from '../../../../shared/errors'
import { Button, EmptyState, EngineError } from '../../components/ui'
import { formatDuration, formatViews } from './format'

const durations = {
  any: { label: 'Any duration', test: () => true },
  short: { label: 'Under 4 minutes', test: (s: number) => s < 240 },
  medium: { label: '4–20 minutes', test: (s: number) => s >= 240 && s <= 1200 },
  long: { label: 'Over 20 minutes', test: (s: number) => s > 1200 }
}
type DurationKey = keyof typeof durations
let searchSequence = 0

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; query: string; results: MediaSource[] }
  | { status: 'error'; code: ErrorCode; stderrTail: string }

export function SearchScreen({ onOpenDownloads }: { onOpenDownloads: () => void }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const [history, setHistory] = useState<string[]>([])
  const [duration, setDuration] = useState<DurationKey>('any')
  const latest = useRef<string | null>(null) // requestId of the search whose answer we still want

  const refreshHistory = () => void window.openfetch.historyList().then(setHistory)
  useEffect(refreshHistory, [])
  useEffect(
    () => () => {
      if (latest.current) void window.openfetch.cancelSearch(latest.current)
    },
    []
  )

  function run(raw: string) {
    const text = raw.trim()
    if (!text) return // empty queries never start a search
    const id = `search-${++searchSequence}`
    latest.current = id
    setQuery(text)
    setState({ status: 'loading' })
    window.openfetch
      .search(text, id)
      .then((r) => {
        if (latest.current !== id) return // stale: a newer search or a cancel took over
        if (r.ok) {
          setState({ status: 'done', query: text, results: r.data })
          refreshHistory()
        } else if (!r.cancelled) {
          setState({ status: 'error', code: r.code, stderrTail: r.stderrTail })
        }
      })
      .catch(() => {
        if (latest.current === id) setState({ status: 'error', code: 'unknown', stderrTail: '' })
      })
  }

  function cancel() {
    if (latest.current) void window.openfetch.cancelSearch(latest.current)
    latest.current = null
    setState({ status: 'idle' })
  }

  // Unknown duration only passes the "any" filter: never guess.
  const results =
    state.status === 'done'
      ? state.results.filter(
          (r) =>
            duration === 'any' ||
            (r.durationSeconds !== undefined && durations[duration].test(r.durationSeconds))
        )
      : []
  const status =
    state.status === 'loading'
      ? 'Searching…'
      : state.status === 'done'
        ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
        : ''

  return (
    <>
      <h1 className="sr-only">Search</h1>
      <form
        role="search"
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
      >
        <div className="relative flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search for a song, artist or video"
            placeholder="Search for a song, artist or video"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-line py-2.5 pr-10 pl-10 text-[15px] focus:border-leaf-600"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        {state.status === 'loading' ? (
          <Button className="px-6" onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Button type="submit" variant="primary" className="px-6">
            Search
          </Button>
        )}
      </form>

      {history.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Recent searches"
        >
          <span className="text-sm text-muted">Recent:</span>
          {history.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => run(h)}
              className="max-w-48 truncate rounded-full bg-leaf-100 px-3 py-1 text-sm text-leaf-700 hover:bg-leaf-200"
            >
              {h}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void window.openfetch.historyClear().then(() => setHistory([]))}
            className="px-2 text-sm text-muted underline hover:text-ink"
          >
            Clear history
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Filter by duration</span>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value as DurationKey)}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm"
          >
            {Object.entries(durations).map(([key, d]) => (
              <option key={key} value={key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="soft" onClick={onOpenDownloads} className="py-1.5">
          <ListOrdered size={16} aria-hidden /> Queue: 0
        </Button>
      </div>

      <p role="status" aria-live="polite" className="mt-5 mb-3 text-sm text-muted">
        {state.status === 'done' && (
          <span className="mr-4 text-lg font-bold text-ink">
            Search results for “{state.query}”
          </span>
        )}
        {status}
      </p>

      {state.status === 'idle' && (
        <EmptyState icon={<Search size={32} />} title="Search for music or videos">
          Type a song, artist or video title, then press Enter.
        </EmptyState>
      )}
      {state.status === 'error' && (
        <EngineError code={state.code} stderrTail={state.stderrTail} onRetry={() => run(query)} />
      )}
      {state.status === 'done' && results.length === 0 && (
        <EmptyState icon={<Search size={32} />} title="No results">
          {state.results.length
            ? 'No result matches this duration filter.'
            : 'Try different words, or check the spelling.'}
        </EmptyState>
      )}

      <ul className="flex flex-col gap-3">
        {results.map((r) => (
          <li
            key={r.sourceId}
            className="flex items-center gap-4 rounded-lg border border-line p-2.5"
          >
            <div className="relative grid h-[68px] w-[120px] shrink-0 place-items-center overflow-hidden rounded-md bg-gradient-to-br from-leaf-300 to-leaf-600 text-white">
              {r.thumbnailUrl ? (
                <img
                  src={r.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <Music size={24} aria-hidden />
              )}
              {r.durationSeconds !== undefined && (
                <span className="absolute right-1.5 bottom-1.5 rounded bg-ink/85 px-1.5 text-xs font-semibold">
                  <span className="sr-only">Duration </span>
                  {formatDuration(r.durationSeconds)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold">{r.title}</h3>
              {r.channel && <p className="text-sm text-muted">{r.channel}</p>}
              {r.viewCount !== undefined && (
                <p className="text-xs text-muted">{formatViews(r.viewCount)}</p>
              )}
            </div>
            {/* Downloads are wired in Phase 4 (#9/#10). */}
            <div className="flex gap-2">
              <Button
                disabled
                title="Downloads arrive in a later update"
                aria-label={`Download MP3: ${r.title}`}
              >
                <FileAudio size={16} aria-hidden /> MP3
              </Button>
              <Button
                variant="primary"
                disabled
                title="Downloads arrive in a later update"
                aria-label={`Download MP4: ${r.title}`}
              >
                <FileVideo size={16} aria-hidden /> MP4
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
