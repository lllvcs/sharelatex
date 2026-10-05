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

// Every registry key this image has to fill, and the module file behind it. The
// core frontend calls importOverleafModules('<key>') for each of these, and the
// macro throws when a key is missing - so a key that the base image does not
// define has to be added here, and one that exists but is empty means the
// feature exists in the bundle with nothing in it.
const EXPECTED = {
  // symbol palette: the core renders whatever is registered under it
  sourceEditorSymbolPalette:
    'modules/symbol-palette/frontend/js/components/symbol-palette',
  // reference picker: the base image ships a basic index and no picker
  referenceIndices:
    'modules/reference-picker/frontend/js/reference-index/advanced-reference-index',
  mainEditorLayoutModals:
    'modules/reference-picker/frontend/js/components/reference-picker-controller',
  autoCompleteExtensions:
    'modules/reference-picker/frontend/js/extensions/reference-picker-keybinding',
  // the AI assistant and the error assistant
  rootContextProviders:
    'modules/workbench/frontend/js/context/workbench-settings-context',
  mainEditorLayoutPanels:
    'modules/workbench/frontend/js/components/workbench-dock',
  railEntries: 'modules/workbench/frontend/js/workbench-rail-entry',
  sourceEditorExtensions:
    'modules/error-assistant/frontend/js/extensions/previous-fix',
  pdfLogEntryHeaderActionComponents:
    'modules/error-assistant/frontend/js/components/suggest-fix-button',
  pdfLogEntryComponents:
    'modules/error-assistant/frontend/js/components/error-assistant',
  pdfLogEntriesComponents:
    'modules/error-assistant/frontend/js/components/previous-fix-entry',
}

// The strings that prove a component reached the bundle; `tests/verify-overlay.sh`
// greps public/js for them. CSS is extracted elsewhere, so a hit in the
// JavaScript means the module's own code was compiled in.
//
// Each string has to be unique to its module: a string the core frontend also
// contains would make the check meaningless. `ai-paywall-notification` for
// example looks distinctive but lives in three core files, so it is not used.
const MARKERS = {
  'symbol-palette-close-button-outer':
    'modules/symbol-palette/frontend/js/components/symbol-palette-close-button.js',
  'references-search-modal':
    'modules/reference-picker/frontend/js/components/reference-picker-modal.tsx',
  'workbench-ai-message':
    'modules/workbench/frontend/js/components/workbench-chat.tsx',
}

test('the registry has every key the core frontend asks for', () => {
  assert.ok(settings.overleafModuleImports, 'overleafModuleImports is missing')
  for (const key of Object.keys(EXPECTED)) {
    assert.ok(
      Array.isArray(settings.overleafModuleImports[key]),
      `${key} is not an array`
    )
    assert.equal(
      settings.overleafModuleImports[key].length,
      1,
      `${key} should have exactly one entry`
    )
  }
})

test('every registered path resolves to a file webpack can find', () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const [registered] = settings.overleafModuleImports[key]
    // webpack resolves the extension itself, so the extensionless path is right -
    // but something has to be there, and it has to be the file the key means.
    assert.ok(
      ['', '.js', '.jsx', '.ts', '.tsx'].some(extension =>
        existsSync(registered + extension)
      ),
      `nothing at ${registered} (for ${key})`
    )
    assert.ok(
      registered.split(sep).join('/').endsWith(expected),
      `${key} should point at ${expected}, not ${registered}`
    )
  }
})

test('every path is written relatively, so it survives being copied into the image', () => {
  // The overlay is copied to /overleaf/services/web, where the same relative
  // layout holds. An absolute path into this repository, or one that names the
  // overlay directory, would resolve locally and nowhere else - and webpack
  // would fail in the image instead of here.
  const webDir = dirname(settingsDir) // .../services/web
  for (const key of Object.keys(EXPECTED)) {
    for (const registered of settings.overleafModuleImports[key]) {
      assert.ok(
        registered.startsWith(webDir + sep),
        `${registered} (${key}) is not under ${webDir}`
      )
    }
  }

  const source = readFileSync(settingsPath, 'utf8')
  assert.ok(
    source.includes("Path.resolve(__dirname, '../modules'"),
    'the file should resolve its paths relative to itself'
  )
  for (const absolute of ['/overleaf/', 'overlay/', 'sharelatex/', ':\\']) {
    assert.ok(
      !source.includes(absolute),
      `the file contains the absolute path fragment ${JSON.stringify(absolute)}`
    )
  }
})

test('the markers the image check greps for are in the components', () => {
  // tests/verify-overlay.sh greps public/js for these strings, and CSS is
  // extracted into public/stylesheets, so a hit proves the module's JavaScript
  // was bundled. If one of the components is ever changed, this test fails first
  // rather than the image check failing silently.
  for (const [marker, relative] of Object.entries(MARKERS)) {
    const component = join(dirname(settingsPath), '..', relative)
    const found = ['', '.js', '.jsx', '.ts', '.tsx']
      .map(extension => component + extension)
      .find(existsSync)
    assert.ok(found, `${relative} is missing (for the marker "${marker}")`)
    assert.ok(
      readFileSync(found, 'utf8').includes(marker),
      `${found} no longer contains "${marker}", so tests/verify-overlay.sh would look for the wrong string`
    )
  }
})

test('the file that exists is the one under the image layout', () => {
  // A guard against the test passing for the wrong reason: the settings file
  // must not have been found inside a build output directory.
  assert.ok(
    resolve(settingsPath).includes(join('services', 'web', 'config')),
    `unexpected location: ${settingsPath}`
  )
})
