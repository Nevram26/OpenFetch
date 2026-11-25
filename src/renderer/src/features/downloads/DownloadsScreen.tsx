import { useEffect, useState } from 'react'
import { Download, RotateCcw, Trash2, X } from 'lucide-react'
import type { QueueJob } from '../../../../shared/queue.js'
import { Button, EmptyState, PageHeader } from '../../components/ui'

function detail(job: QueueJob): string {
  if (job.status === 'downloading') {
    const parts = [
      job.progressPercent !== undefined ? `${Math.round(job.progressPercent)}%` : 'Downloading',
      job.speedBytesPerSecond ? `${(job.speedBytesPerSecond / 1024 / 1024).toFixed(1)} MB/s` : '',
      job.etaSeconds ? `${Math.ceil(job.etaSeconds)}s left` : ''
    ].filter(Boolean)
    return parts.join(' · ')
  }
  return (
    job.errorMessage ??
    (
      {
        queued: 'Waiting in queue',
        resolving: 'Finding media…',
        processing: 'Converting and verifying…',
        completed: 'Completed',
        failed: 'Download failed',
        canceling: 'Stopping…',
        canceled: 'Canceled',
        interrupted: 'Interrupted'
      } as const
    )[job.status]
  )
}

export function DownloadsScreen() {
  const [jobs, setJobs] = useState<QueueJob[]>([])
  const [recover, setRecover] = useState(false)
  const refresh = () =>
    void Promise.all([window.openfetch.downloadsList(), window.openfetch.downloadsHasRecovery()])
      .then(([next, hasRecovery]) => {
        setJobs(next)
        setRecover(hasRecovery)
      })
      .catch(() => {})
  useEffect(() => {
    refresh()
    return window.openfetch.downloadsOnChanged(setJobs)
  }, [])
  const finished = jobs.some((j) =>
    ['completed', 'failed', 'canceled', 'interrupted'].includes(j.status)
  )
  return (
    <>
      <PageHeader
        icon={<Download size={24} />}
        title="Downloads"
        subtitle="Manage your download queue and completed files."
        action={
          <Button
            disabled={!finished}
            onClick={() => void window.openfetch.downloadsClearFinished().then(refresh)}
          >
            <Trash2 size={16} aria-hidden /> Clear finished
          </Button>
        }
      />
      {recover && (
        <div
          className="mb-4 flex items-center justify-between rounded-lg border border-line bg-leaf-100 p-3"
          role="status"
        >
          <span>Some downloads were interrupted when OpenFetch closed. Resume them?</span>
          <Button
            variant="primary"
            onClick={() => {
              setRecover(false)
              void window.openfetch.downloadsConfirmResume().then(refresh)
            }}
          >
            Resume queued downloads
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {jobs.filter((j) => ['resolving', 'downloading', 'processing'].includes(j.status)).length}{' '}
        active downloads
      </p>
      {!jobs.length ? (
        <EmptyState icon={<Download size={32} />} title="No downloads yet">
          Choose MP3 or MP4 on a search result to start a download.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-lg border border-line p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{job.source.title}</h2>
                  <p className="text-sm text-muted">
                    {job.source.channel ?? 'YouTube'} · {job.options.format.toUpperCase()} ·{' '}
                    {detail(job)}
                  </p>
                  {job.status === 'downloading' && job.progressPercent !== undefined && (
                    <progress
                      className="mt-2 h-2 w-full accent-leaf-600"
                      max="100"
                      value={job.progressPercent}
                      aria-label={`Download progress for ${job.source.title}`}
                    />
                  )}
                </div>
                {['queued', 'resolving', 'downloading', 'processing'].includes(job.status) ? (
                  <Button
                    onClick={() => void window.openfetch.downloadsCancel(job.id)}
                    aria-label={`Cancel ${job.source.title}`}
                  >
                    <X size={16} aria-hidden /> Cancel
                  </Button>
                ) : null}
                {['failed', 'canceled', 'interrupted'].includes(job.status) ? (
                  <Button onClick={() => void window.openfetch.downloadsRetry(job.id)}>
                    <RotateCcw size={16} aria-hidden /> Retry
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
