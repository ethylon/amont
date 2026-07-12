/* electron-vite injects build-env variables prefixed with MAIN_VITE_ into import.meta.env at
   build time (from the shell / CI, cf. .github/workflows/release.yml). Typed here because the
   Node-side tsconfig (tsconfig.node.json) deliberately doesn't pull in vite/client — only the
   renderer does. Merges with the ImportMeta that @types/node already declares (url/dirname/…),
   it only adds `env`. */
interface ImportMetaEnv {
  /** "development" under `electron-vite dev`, "production" in a packaged build. */
  readonly MODE: string
  /** Sentry DSN, baked in at build time from the build environment. Absent → no telemetry. */
  readonly MAIN_VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
