import type { OpenFetchApi } from '../../shared/api'

declare global {
  interface Window {
    openfetch: OpenFetchApi
  }
}
