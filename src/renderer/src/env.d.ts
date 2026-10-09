/// <reference types="vite/client" />

import type { AeroxApi } from '@shared/api'

declare global {
  interface Window {
    aerox: AeroxApi
  }
}

export {}
