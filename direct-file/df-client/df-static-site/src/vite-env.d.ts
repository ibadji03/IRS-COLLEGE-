/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly STATIC_SITE_GOOGLE_MAPS_API_KEY?: string;
}

interface Window {
  google?: any;
}
