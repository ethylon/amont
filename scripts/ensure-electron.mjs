import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const distDir = join(electronDir, 'dist')
const sentinels = [
  process.platform === 'win32' ? 'electron.exe' : 'electron',
  'icudtl.dat',
  'version',
]

if (!sentinels.every((file) => existsSync(join(distDir, file)))) {
  console.log('Electron dist missing or incomplete, downloading...')
  rmSync(distDir, { recursive: true, force: true })
  execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
}
