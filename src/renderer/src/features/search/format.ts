// Display helpers for media metadata (durations and view counts). Unknown values stay undefined.

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
