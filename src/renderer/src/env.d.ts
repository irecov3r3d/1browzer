/// <reference types="vite/client" />

import type { OneBrowzerApi } from '../../../shared/api'

declare global {
  interface Window {
    onebrowzer: OneBrowzerApi
  }
}

export {}
