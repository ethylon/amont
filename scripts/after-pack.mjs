/* Hook `afterPack` d'electron-builder (AUDIT.md §4, item durcissement) : bascule les fuses
   Electron sur le binaire packagé, une fois tous les fichiers en place mais avant toute
   signature de code — le point exact que documente @electron/fuses.

   RunAsNode / EnableNodeCliInspectArguments / EnableNodeOptionsEnvironmentVariable off :
   ferment les portes dérobées qui feraient tourner le binaire packagé comme un Node nu
   (ELECTRON_RUN_AS_NODE, --inspect, NODE_OPTIONS) — sans intérêt pour cette app et un risque
   pur si le binaire signé venait à fuiter. OnlyLoadAppFromAsar + intégrité asar : le
   chargement ne se fait que depuis app.asar, contenu vérifié — un fichier posé à côté du
   binaire ne peut pas se substituer au code embarqué.

   Only the win32 (nsis) target is packaged today (electron-builder.yml); the executable path
   below is Windows-specific. Adapt it if mac/linux ever join the release targets. */
import { join } from 'node:path';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

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
