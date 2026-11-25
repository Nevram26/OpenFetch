// Illustrative data from the UI mockup. Replaced by the real search service in #8.
// Shape follows the spec's MediaSource; optional fields may be absent in real results.

export interface SearchResult {
  sourceId: string
  title: string
  channel?: string
  durationSeconds?: number
  viewCount?: number
}

export const sampleResults: SearchResult[] = [
  {
    sourceId: 'sample-1',
    title: 'Relaxing Acoustic Guitar · Chill Instrumental',
    channel: 'Acoustic Vibes',
    durationSeconds: 232,
    viewCount: 1_200_000
  },
  {
    sourceId: 'sample-2',
    title: 'Acoustic Guitar Backing Track in G Major',
    channel: 'Guitar Essentials',
    durationSeconds: 258,
    viewCount: 384_000
  },
  {
    sourceId: 'sample-3',
    title: 'Peaceful Acoustic Guitar Music for Study & Focus',
    channel: 'Happy Strings',
    durationSeconds: 506,
    viewCount: 2_600_000
  },
  {
    sourceId: 'sample-4',
    title: 'Fingerstyle Acoustic Session (Live)',
    channel: 'Porch Sessions',
    durationSeconds: 1_520
  },
  {
    sourceId: 'sample-5',
    title: 'Acoustic Guitar for Sleep – 1 Hour',
    durationSeconds: 3_610,
    viewCount: 92_000
  }
]

export function formatDuration(seconds?: number): string | undefined {
  if (seconds === undefined) return undefined
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const formatViews = (n?: number) =>
  n === undefined
    ? undefined
    : `${new Intl.NumberFormat('en', { notation: 'compact' }).format(n)} views`
