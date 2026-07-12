/* PO catalogs are compiled to modules by @lingui/vite-plugin (cf. electron.vite.config.mjs);
   this tells TypeScript what `import { messages } from "@/locales/xx.po"` resolves to. */
declare module "*.po" {
  import type { Messages } from "@lingui/core"
  export const messages: Messages
}
