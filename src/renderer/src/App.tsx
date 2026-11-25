import { useState } from 'react'
import { CloudDownload, Download, FolderOpen, Link2, Search, Settings } from 'lucide-react'
import { SearchScreen } from './features/search/SearchScreen'
import { PasteLinkScreen } from './features/link/PasteLinkScreen'
import { DownloadsScreen } from './features/downloads/DownloadsScreen'
import { LibraryScreen } from './features/library/LibraryScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'

const screens = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'link', label: 'Paste link', icon: Link2 },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'library', label: 'My library', icon: FolderOpen },
  { id: 'settings', label: 'Settings', icon: Settings }
] as const

export type ScreenId = (typeof screens)[number]['id']

export function App() {
  const [screen, setScreen] = useState<ScreenId>('search')

  return (
    <div className="flex h-full">
      <nav
        aria-label="Main"
        className="flex w-56 shrink-0 flex-col gap-1 border-r border-line bg-side p-3"
      >
        <div className="mb-4 flex items-center gap-2 px-2 pt-1 text-lg font-bold text-forest">
          <span
            className="grid size-8 place-items-center rounded-lg bg-leaf-600 text-white"
            aria-hidden
          >
            <CloudDownload size={18} />
          </span>
          OpenFetch
        </div>
        {screens.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={screen === id ? 'page' : undefined}
            onClick={() => setScreen(id)}
            className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
              screen === id ? 'bg-leaf-200 text-leaf-700' : 'text-ink hover:bg-leaf-100'
            }`}
          >
            <Icon size={18} aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
        {screen === 'search' && <SearchScreen onOpenDownloads={() => setScreen('downloads')} />}
        {screen === 'link' && <PasteLinkScreen onOpenDownloads={() => setScreen('downloads')} />}
        {screen === 'downloads' && <DownloadsScreen />}
        {screen === 'library' && <LibraryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}
