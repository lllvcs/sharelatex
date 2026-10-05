// Checks which modules this image switches on and how the settings file it
// installs is assembled
// (see overlay/etc/overleaf/overlay-modules.cjs and settings.overlay.cjs).
//
//   locally:            node --test tests/overlay-settings.test.mjs
//   inside the image:   node --test /tests/overlay-settings.test.mjs
//
// The module under test imports nothing but Node built-ins, and the two files it
// reads in the image are injected here, so this runs without Overleaf. What is
// checked is the part that is easy to get wrong and impossible to see at
// runtime: an appended module has to keep the rest of the sequence, and a
// setting that is derived from the environment has to be validated before it is
// handed to the application.

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)

const modulePath = [
  process.env.OVERLEAF_OVERLAY_MODULES,
  '/etc/overleaf/overlay-modules.cjs',
  fileURLToPath(
    new URL('../overlay/etc/overleaf/overlay-modules.cjs', import.meta.url)
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find overlay-modules.cjs')
}

const {
  FALLBACK_MODULE_IMPORT_SEQUENCE,
  WEB_SETTINGS_DEFAULTS,
  additionalSettings,
  assignDeep,
  buildOverlaySettings,
  enabledModules,
  readModuleImportSequence,
  withOverlayModules,
} = require(modulePath)

const CE_MODULE_SEQUENCE = [
  'history-v1',
  'launchpad',
  'server-ce-scripts',
  'user-activate',
]

// --- enabledModules ---------------------------------------------------------

test('without the variables nothing is switched on', () => {
  assert.deepEqual(enabledModules({}), [])
})

test('each feature has its own switch', () => {
  assert.deepEqual(enabledModules({ OVERLEAF_ENABLE_TRACK_CHANGES: 'true' }), [
    'track-changes',
  ])
  assert.deepEqual(enabledModules({ SANDBOXED_COMPILES: 'true' }), [
    'sandboxed-compiles',
  ])
  assert.deepEqual(
    enabledModules({
      OVERLEAF_ENABLE_TRACK_CHANGES: 'true',
      SANDBOXED_COMPILES: 'true',
    }),
    ['track-changes', 'sandboxed-compiles']
  )
})

test('only the exact value true switches a feature on', () => {
  for (const value of ['True', 'TRUE', '1', 'yes', 'on', 'false', '']) {
    assert.deepEqual(enabledModules({ OVERLEAF_ENABLE_TRACK_CHANGES: value }), [])
    assert.deepEqual(enabledModules({ SANDBOXED_COMPILES: value }), [])
  }
})

// --- withOverlayModules -----------------------------------------------------

test('the sequence of the base image is kept, in order', () => {
  assert.deepEqual(withOverlayModules(CE_MODULE_SEQUENCE, {}), CE_MODULE_SEQUENCE)
})

test('an enabled module is appended, not put in front', () => {
  // Order matters: Modules.mjs imports the entries one after another, and
  // `track-changes` flips a flag that the core reads later.
  assert.deepEqual(
    withOverlayModules(CE_MODULE_SEQUENCE, {
      OVERLEAF_ENABLE_TRACK_CHANGES: 'true',
    }),
    [...CE_MODULE_SEQUENCE, 'track-changes']
  )
})

test('a module the base image already loads is not added twice', () => {
  assert.deepEqual(
    withOverlayModules([...CE_MODULE_SEQUENCE, 'track-changes'], {
      OVERLEAF_ENABLE_TRACK_CHANGES: 'true',
    }),
    [...CE_MODULE_SEQUENCE, 'track-changes']
  )
})

test('a missing sequence does not lose the modules of the overlay', () => {
  assert.deepEqual(
    withOverlayModules(undefined, { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' }),
    ['track-changes']
  )
})

test('the caller\'s array is not modified', () => {
  const sequence = [...CE_MODULE_SEQUENCE]
  withOverlayModules(sequence, { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' })
  assert.deepEqual(sequence, CE_MODULE_SEQUENCE)
})

test('a module added by a later base image survives', () => {
  // The sequence is read from the base image rather than hard-coded, so a
  // module that a newer release adds keeps being loaded.
  const sequence = [...CE_MODULE_SEQUENCE, 'a-module-of-a-later-release']
  assert.deepEqual(
    withOverlayModules(sequence, { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' }),
    [...sequence, 'track-changes']
  )
})

// --- additionalSettings -----------------------------------------------------

test('nothing is set without the variables', () => {
  assert.deepEqual(additionalSettings({}), {})
})

test('MAX_UPLOAD_SIZE is megabytes and becomes bytes', () => {
  assert.deepEqual(additionalSettings({ MAX_UPLOAD_SIZE: '100' }), {
    maxUploadSize: 100 * 1024 * 1024,
  })
  assert.deepEqual(additionalSettings({ MAX_UPLOAD_SIZE: ' 100 ' }), {
    maxUploadSize: 100 * 1024 * 1024,
  })
  assert.deepEqual(additionalSettings({ MAX_UPLOAD_SIZE: '' }), {})
})

test('an unusable MAX_UPLOAD_SIZE is reported instead of ignored', () => {
  // Silently keeping 50 MB would look like the setting worked.
  for (const value of ['abc', '0', '-5', '12.5', '100MB', 'NaN']) {
    assert.throws(
      () => additionalSettings({ MAX_UPLOAD_SIZE: value }),
      /MAX_UPLOAD_SIZE/,
      `MAX_UPLOAD_SIZE=${JSON.stringify(value)} should be refused`
    )
  }
})

test('the linked-url proxy is configured only for the url file type', () => {
  // UrlHelper throws "no linked url proxy configured" when the setting is
  // missing, and Features.hasFeature('link-url') needs both this setting and
  // the file type - so it is set exactly when it can be used.
  assert.deepEqual(additionalSettings({ ENABLED_LINKED_FILE_TYPES: 'url' }), {
    apis: { linkedUrlProxy: { url: 'http://127.0.0.1:3066' } },
  })
  assert.deepEqual(
    additionalSettings({
      ENABLED_LINKED_FILE_TYPES: 'url,project_file',
      LINKED_URL_PROXY_HOST: 'linked-url-proxy',
    }),
    { apis: { linkedUrlProxy: { url: 'http://linked-url-proxy:3066' } } }
  )
  assert.deepEqual(
    additionalSettings({ ENABLED_LINKED_FILE_TYPES: 'project_file' }),
    {}
  )
  assert.deepEqual(
    additionalSettings({
      ENABLED_LINKED_FILE_TYPES: 'project_output_file',
      LINKED_URL_PROXY_HOST: 'elsewhere',
    }),
    {}
  )
})

// --- assignDeep -------------------------------------------------------------

test('nested settings are merged, not replaced', () => {
  const target = { apis: { web: { url: 'http://127.0.0.1:3000' } }, a: 1 }
  assignDeep(target, { apis: { linkedUrlProxy: { url: 'http://x:3066' } }, b: 2 })
  assert.deepEqual(target, {
    apis: {
      web: { url: 'http://127.0.0.1:3000' },
      linkedUrlProxy: { url: 'http://x:3066' },
    },
    a: 1,
    b: 2,
  })
})

test('arrays and primitives are replaced, like the settings library does', () => {
  const target = { list: [1, 2, 3], value: 'old', gone: { a: 1 } }
  assignDeep(target, { list: [4], value: 'new', gone: null })
  assert.deepEqual(target, { list: [4], value: 'new', gone: null })
})

// --- buildOverlaySettings ---------------------------------------------------

const baseSettings = () => ({
  mongo: { url: 'mongodb://dockerhost/sharelatex' },
  apis: { web: { url: 'http://127.0.0.1:3000' } },
  clsi: { optimiseInDocker: false },
})

const loaderFor = files => path => {
  if (path in files) return files[path]
  throw new Error(`ENOENT: ${path}`)
}

test('the settings of the base image are kept as they are', () => {
  const settings = buildOverlaySettings({
    env: {},
    load: loaderFor({ '/base': baseSettings() }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.deepEqual(settings, baseSettings())
})

test('the modules of the overlay are added to the sequence of the base image', () => {
  const settings = buildOverlaySettings({
    env: { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' },
    load: loaderFor({
      '/base': baseSettings(),
      '/defaults': { moduleImportSequence: CE_MODULE_SEQUENCE },
    }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.deepEqual(settings.moduleImportSequence, [
    ...CE_MODULE_SEQUENCE,
    'track-changes',
  ])
  // ... without losing anything else
  assert.deepEqual(settings.mongo, { url: 'mongodb://dockerhost/sharelatex' })
})

test('the sequence is only touched when a module is switched on', () => {
  const settings = buildOverlaySettings({
    env: {},
    load: loaderFor({
      '/base': baseSettings(),
      '/defaults': { moduleImportSequence: CE_MODULE_SEQUENCE },
    }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.equal(settings.moduleImportSequence, undefined)
})

test('the fallback sequence is used when the defaults cannot be read', () => {
  const settings = buildOverlaySettings({
    env: { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' },
    load: loaderFor({ '/base': baseSettings() }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.deepEqual(settings.moduleImportSequence, [
    ...FALLBACK_MODULE_IMPORT_SEQUENCE,
    'track-changes',
  ])
})

test('the fallback sequence matches the one the base image ships', () => {
  // If this fails, the copy in overlay-modules.cjs is out of date and a base
  // image that cannot be read would silently drop a module.
  assert.deepEqual(FALLBACK_MODULE_IMPORT_SEQUENCE, CE_MODULE_SEQUENCE)
})

test('both names of the settings defaults are tried, cjs first', () => {
  // @overleaf/settings itself prefers a .cjs file, so a future base image may
  // rename the file; whichever exists has to be found.
  assert.deepEqual(WEB_SETTINGS_DEFAULTS, [
    '/overleaf/services/web/config/settings.defaults.cjs',
    '/overleaf/services/web/config/settings.defaults.js',
  ])
})

test('the sequence comes from the first candidate that has one', () => {
  const sequence = readModuleImportSequence(loaderFor({ '/b': { moduleImportSequence: ['x'] } }), [
    '/a',
    '/b',
    '/c',
  ])
  assert.deepEqual(sequence, ['x'])
})

test('a candidate without a sequence is reported and skipped', () => {
  // Silently accepting "no sequence" would drop every module the base image
  // loads, including the ones the core needs.
  const sequence = readModuleImportSequence(
    loaderFor({ '/a': {}, '/b': { moduleImportSequence: ['x'] } }),
    ['/a', '/b']
  )
  assert.deepEqual(sequence, ['x'])
})

test('no candidate at all falls back to the built-in sequence', () => {
  const sequence = readModuleImportSequence(loaderFor({}), ['/a', '/b'])
  assert.deepEqual(sequence, FALLBACK_MODULE_IMPORT_SEQUENCE)
})

test('a base settings file that cannot be read does not stop the overlay', () => {
  const settings = buildOverlaySettings({
    env: { OVERLEAF_ENABLE_TRACK_CHANGES: 'true' },
    load: loaderFor({ '/defaults': { moduleImportSequence: [] } }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.deepEqual(settings.moduleImportSequence, ['track-changes'])
})

test('a base settings file that is not an object is refused', () => {
  const settings = buildOverlaySettings({
    env: {},
    load: loaderFor({ '/base': 'nonsense' }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.deepEqual(settings, {})
})

test('the settings derived from the environment are applied on top', () => {
  const settings = buildOverlaySettings({
    env: {
      MAX_UPLOAD_SIZE: '200',
      ENABLED_LINKED_FILE_TYPES: 'url',
    },
    load: loaderFor({ '/base': baseSettings() }),
    baseSettingsPath: '/base',
    webDefaultsPath: '/defaults',
  })
  assert.equal(settings.maxUploadSize, 200 * 1024 * 1024)
  assert.equal(settings.apis.linkedUrlProxy.url, 'http://127.0.0.1:3066')
  // the api urls of the base image are still there
  assert.equal(settings.apis.web.url, 'http://127.0.0.1:3000')
})

test('an unusable setting is reported while the instance starts', () => {
  assert.throws(
    () =>
      buildOverlaySettings({
        env: { MAX_UPLOAD_SIZE: 'lots' },
        load: loaderFor({ '/base': baseSettings() }),
        baseSettingsPath: '/base',
        webDefaultsPath: '/defaults',
      }),
    /MAX_UPLOAD_SIZE/
  )
})
