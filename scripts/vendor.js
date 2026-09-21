// Copies the dependency-free ESM build of oauth4webapi into src/vendor so the
// extension ships without a bundler or node_modules.
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const source = require.resolve('oauth4webapi')
const target = join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'vendor', 'oauth4webapi.js')

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log(`vendored ${source} -> ${target}`)
