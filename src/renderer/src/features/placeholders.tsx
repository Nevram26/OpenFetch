// Empty states for screens whose backend arrives later (#9/#10 downloads, #11 library).
import { Download, FolderOpen, Music, Search, Trash2, Video } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '../components/ui'

export function DownloadsScreen() {
  return (
    <>
      <PageHeader
        icon={<Download size={24} />}
        title="Downloads"
        subtitle="Manage your download queue and completed files."
        action={
          <Button disabled>
            <Trash2 size={16} aria-hidden /> Clear completed
          </Button>
        }
      />
      <EmptyState icon={<Download size={32} />} title="No downloads yet">
        Choose MP3 or MP4 on a search result to start a download. Progress, cancel and retry appear
        here.
      </EmptyState>
    </>
  )
}

export function LibraryScreen() {
  return (
    <>
      <PageHeader
        icon={<FolderOpen size={24} />}
        title="My library"
        subtitle="Your downloaded music and videos, organized in one place."
      />
      <div className="mb-5 flex gap-3" role="group" aria-label="Library type">
        <Button variant="soft" aria-pressed="true">
          <Music size={16} aria-hidden /> Music (0)
        </Button>
        <Button aria-pressed="false">
          <Video size={16} aria-hidden /> Videos (0)
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
            placeholder="Search in library…"
            className="w-full rounded-md border border-line py-2 pr-3 pl-9 text-sm"
          />
        </label>
      </div>
      <EmptyState icon={<FolderOpen size={32} />} title="Your library is empty">
        Completed downloads appear here and play offline.
      </EmptyState>
    </>
  )
}
