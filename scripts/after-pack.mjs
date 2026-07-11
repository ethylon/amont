/* electron-builder's `afterPack` hook (AUDIT.md §4, hardening item): flips the Electron
   fuses on the packaged binary, once every file is in place but before any code
   signing — the exact point @electron/fuses documents.

   RunAsNode / EnableNodeCliInspectArguments / EnableNodeOptionsEnvironmentVariable off:
   close the backdoors that would let the packaged binary run as a bare Node process
   (ELECTRON_RUN_AS_NODE, --inspect, NODE_OPTIONS) — pointless for this app and a pure
   risk if the signed binary were ever to leak. OnlyLoadAppFromAsar + asar integrity:
   loading only happens from app.asar, content verified — a file dropped next to the
   binary can't substitute itself for the embedded code.

   Only the win32 (nsis) target is packaged today (electron-builder.yml); the executable path
   below is Windows-specific. Adapt it if mac/linux ever join the release targets. */
import { join } from "node:path";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}
