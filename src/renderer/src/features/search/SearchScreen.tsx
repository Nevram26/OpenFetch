import { useState } from 'react'
import { FileAudio, FileVideo, ListOrdered, Music, Search, X } from 'lucide-react'
import { Button } from '../../components/ui'
import { DownloadOptionsDialog, type Format } from './DownloadOptionsDialog'
import { formatDuration, formatViews, sampleResults, type SearchResult } from './sample-results'

const durations = {
  any: { label: 'Any duration', test: () => true },
  short: { label: 'Under 4 minutes', test: (s: number) => s < 240 },
  medium: { label: '4–20 minutes', test: (s: number) => s >= 240 && s <= 1200 },
  long: { label: 'Over 20 minutes', test: (s: number) => s > 1200 }
}
type DurationKey = keyof typeof durations

export function SearchScreen({ onOpenDownloads }: { onOpenDownloads: () => void }) {
  const [query, setQuery] = useState('acoustic guitar')
  const [submitted, setSubmitted] = useState('acoustic guitar')
  const [duration, setDuration] = useState<DurationKey>('any')
  const [selected, setSelected] = useState<{ result: SearchResult; format: Format } | null>(null)

  // Unknown duration only passes the "any" filter: never guess.
  const results = sampleResults.filter(
    (r) => duration === 'any' || (r.durationSeconds !== undefined && durations[duration].test(r.durationSeconds))
  )

  return (
    <>
      <h1 className="sr-only">Search</h1>
      <form
        role="search"
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) setSubmitted(query.trim()) // empty queries never start a search
        }}
      >
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search for a song, artist or video"
            placeholder="Search for a song, artist or video"
            value={query}
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
        <Button type="submit" variant="primary" className="px-6">
          Search
        </Button>
      </form>

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

      <div className="mt-5 mb-3 flex items-baseline gap-4">
        <h2 className="text-lg font-bold">Search results for “{submitted}”</h2>
        <span className="text-sm text-muted">{results.length} results</span>
      </div>
      <p role="status" className="mb-3 rounded-md bg-leaf-50 px-3 py-2 text-sm text-leaf-700">
        Showing sample results. Live search is connected in a later update.
      </p>

      <ul className="flex flex-col gap-3">
        {results.map((r) => (
          <li key={r.sourceId} className="flex items-center gap-4 rounded-lg border border-line p-2.5">
            <div className="relative grid h-[68px] w-[120px] shrink-0 place-items-center rounded-md bg-gradient-to-br from-leaf-300 to-leaf-600 text-white">
              <Music size={24} aria-hidden />
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
              {r.viewCount !== undefined && <p className="text-xs text-muted">{formatViews(r.viewCount)}</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setSelected({ result: r, format: 'mp3' })} aria-label={`Download MP3: ${r.title}`}>
                <FileAudio size={16} aria-hidden /> MP3
              </Button>
              <Button
                variant="primary"
                onClick={() => setSelected({ result: r, format: 'mp4' })}
                aria-label={`Download MP4: ${r.title}`}
              >
                <FileVideo size={16} aria-hidden /> MP4
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {selected && (
        <DownloadOptionsDialog result={selected.result} initialFormat={selected.format} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
