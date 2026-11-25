import path from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'openfetch'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Maps an app://openfetch/... URL to a file inside `rootDir`, or null when it would escape it. */
export function resolveAppFile(rootDir: string, requestUrl: string): string | null {
  let pathname: string
  try {
    const u = new URL(requestUrl)
    if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null
    pathname = decodeURIComponent(u.pathname) // %2e%2e must not sneak past the containment check
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  const root = path.resolve(rootDir)
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const rel = path.relative(root, file)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? file : null
}
