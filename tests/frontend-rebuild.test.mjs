// Checks the file webpack reads when the frontend is rebuilt
// (see overlay/services/web/config/settings.frontend.cjs).
//
//   locally:            node --test tests/frontend-rebuild.test.mjs
//   inside the image:   node --test /tests/frontend-rebuild.test.mjs
//
// This is the part of the optional frontend rebuild that can be checked without
// running webpack, and it is worth checking precisely because webpack would not
// complain: a registry entry that points at a path that does not exist, or a key
// that is misspelled, fails the build in a way that is easy to misread, and an
// *empty* registry fails it not at all (it produces the bundle the base image
// already had).

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)

const settingsPath = [
  process.env.OVERLEAF_FRONTEND_SETTINGS,
  '/overleaf/services/web/config/settings.frontend.cjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/config/settings.frontend.cjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!settingsPath) {
  throw new Error('cannot find settings.frontend.cjs')
}

const settings = require(settingsPath)
const settingsDir = dirname(settingsPath)

// The one registry key this image fills, and the strings that prove it reached
// the bundle (`tests/verify-overlay.sh` greps for the second one).
const KEY = 'sourceEditorSymbolPalette'
const COMPONENT = 'modules/symbol-palette/frontend/js/components/symbol-palette'
const MARKER = 'symbol-palette-close-button-outer'

test('the registry has the key the core frontend asks for', () => {
  // frontend/js/features/ide-react/components/editor/symbol-palette-pane.tsx
  // calls importOverleafModules('sourceEditorSymbolPalette'), and the macro
  // throws when the key is missing.
  assert.ok(settings.overleafModuleImports, 'overleafModuleImports is missing')
  assert.ok(
    Array.isArray(settings.overleafModuleImports[KEY]),
    `${KEY} is not an array`
  )
  assert.equal(settings.overleafModuleImports[KEY].length, 1)
})

test('the registered path resolves to a file webpack can find', () => {
  const [registered] = settings.overleafModuleImports[KEY]
  // webpack resolves the extension itself, so the extensionless path is right -
  // but something has to be there.
  const candidates = ['', '.js', '.jsx', '.ts', '.tsx'].map(
    extension => registered + extension
  )
  assert.ok(
    candidates.some(existsSync),
    `nothing at ${registered} (tried ${candidates.length} extensions)`
  )
  assert.ok(
    registered.split(sep).join('/').endsWith(COMPONENT),
    `the registry should point at ${COMPONENT}, not ${registered}`
  )
})

test('the path is written relatively, so it survives being copied into the image', () => {
  // The overlay is copied to /overleaf/services/web, where the same relative
  // layout holds. An absolute path into this repository, or one that names the
  // overlay directory, would resolve locally and nowhere else - and webpack
  // would fail in the image instead of here.
  const [registered] = settings.overleafModuleImports[KEY]
  const webDir = dirname(settingsDir) // .../services/web
  assert.ok(
    registered.startsWith(webDir + sep),
    `${registered} is not under ${webDir}`
  )

  const source = readFileSync(settingsPath, 'utf8')
  assert.ok(
    source.includes(`'../${COMPONENT}'`),
    `the file should resolve its path relative to itself, with '../${COMPONENT}'`
  )
  for (const absolute of ['/overleaf/', 'overlay/', 'sharelatex/', ':\\']) {
    assert.ok(
      !source.includes(absolute),
      `the file contains the absolute path fragment ${JSON.stringify(absolute)}`
    )
  }
})

test('the marker the image check greps for is in the component', () => {
  // tests/verify-overlay.sh greps public/js for this string, and CSS is
  // extracted into public/stylesheets, so a hit proves the module's JavaScript
  // was bundled. If the component is ever changed, this test fails first.
  const [registered] = settings.overleafModuleImports[KEY]
  const componentPath = ['', '.js', '.jsx', '.ts', '.tsx']
    .map(extension => registered + extension)
    .find(existsSync)
  const closed = join(dirname(componentPath), 'symbol-palette-close-button.js')
  assert.ok(existsSync(closed), `${closed} is missing`)
  assert.ok(
    readFileSync(closed, 'utf8').includes(MARKER),
    `${closed} no longer contains "${MARKER}", so tests/verify-overlay.sh would look for the wrong string`
  )
})

test('the file that exists is the one under the image layout', () => {
  // A guard against the test passing for the wrong reason: the settings file
  // must not have been found inside a build output directory.
  assert.ok(
    resolve(settingsPath).includes(join('services', 'web', 'config')),
    `unexpected location: ${settingsPath}`
  )
})
