import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type { AppInfo } from '../../../../shared/api'

export function SettingsScreen() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<{
    musicFolder: string
    videoFolder: string
    concurrency: 1 | 2 | 3
  }>()
  const refresh = () =>
    void window.openfetch
      .downloadsGetSettings()
      .then(setSettings)
      .catch(() => {})
  useEffect(() => {
    window.openfetch.getAppInfo().then(setInfo, () => setInfo(null))
    refresh()
  }, [])

  return (
    <>
      <PageHeader
        icon={<Settings size={24} />}
        title="Settings"
        subtitle="Choose where downloads are saved and how many run at once."
      />
      <div className="max-w-2xl divide-y divide-line rounded-lg border border-line">
        {(['music', 'video'] as const).map((format) => (
          <div key={format} className="flex items-center gap-4 px-4 py-3 text-sm">
            <label className="w-28 font-medium" htmlFor={`${format}-folder`}>
              {format === 'music' ? 'Music folder' : 'Video folder'}
            </label>
            <span id={`${format}-folder`} className="min-w-0 flex-1 truncate text-right text-muted">
              {settings?.[format === 'music' ? 'musicFolder' : 'videoFolder'] ?? '…'}
            </span>
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 hover:bg-leaf-100"
              onClick={async () => {
                const folder = await window.openfetch.downloadsChooseFolder(format)
                if (folder) refresh()
              }}
            >
              Browse…
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 text-sm">
          <label htmlFor="download-concurrency" className="font-medium">
            Downloads at once
          </label>
          <select
            id="download-concurrency"
            value={settings?.concurrency ?? 1}
            onChange={async (e) => {
              await window.openfetch.downloadsSetConcurrency(Number(e.target.value) as 1 | 2 | 3)
              refresh()
            }}
            className="rounded-md border border-line bg-white px-3 py-1.5"
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </div>
        <div className="flex justify-between gap-6 px-4 py-3 text-sm">
          <span className="font-medium">Default audio</span>
          <span className="text-right text-muted">MP3 · 192 kbps</span>
        </div>
        <div className="flex justify-between gap-6 px-4 py-3 text-sm">
          <span className="font-medium">Default video</span>
          <span className="text-right text-muted">MP4 · 720p</span>
        </div>
        <div className="flex justify-between gap-6 px-4 py-3 text-sm">
          <span className="font-medium">Telemetry</span>
          <span className="text-right text-muted">None. Everything stays on this computer.</span>
        </div>
        <div className="flex justify-between gap-6 px-4 py-3 text-sm">
          <span className="font-medium">OpenFetch version</span>
          <span className="text-right text-muted">
            {info ? `${info.version} (Electron ${info.electron})` : '…'}
          </span>
        </div>
      </div>
    </>
  )
}
