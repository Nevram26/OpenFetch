import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type { AppInfo } from '../../../../shared/api'

// Read-only defaults (spec §4.6) until settings are persisted in #9.
const rows: [string, string][] = [
  ['Music folder', 'Downloads\\OpenFetch\\Music'],
  ['Video folder', 'Downloads\\OpenFetch\\Videos'],
  ['Default audio', 'MP3 · 192 kbps'],
  ['Default video', 'MP4 · 720p'],
  ['Downloads at once', '1'],
  ['Telemetry', 'None. Everything stays on this computer.']
]

export function SettingsScreen() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    window.openfetch.getAppInfo().then(setInfo, () => setInfo(null))
  }, [])

  return (
    <>
      <PageHeader icon={<Settings size={24} />} title="Settings" subtitle="Defaults for new downloads. Editing arrives in a later update." />
      <dl className="max-w-2xl divide-y divide-line rounded-lg border border-line">
        {[...rows, ['OpenFetch version', info ? `${info.version} (Electron ${info.electron})` : '…'] as [string, string]].map(
          ([k, v]) => (
            <div key={k} className="flex justify-between gap-6 px-4 py-3 text-sm">
              <dt className="font-medium">{k}</dt>
              <dd className="text-right text-muted">{v}</dd>
            </div>
          )
        )}
      </dl>
    </>
  )
}
