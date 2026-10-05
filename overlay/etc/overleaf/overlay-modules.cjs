'use strict'
// Which of the modules shipped by this overlay are switched on, and how the
// settings file the image installs is assembled.
//
// Overleaf loads a module only when its name appears in
// `Settings.moduleImportSequence`, and that setting lives in the image's
// `services/web/config/settings.defaults.js`. This image does not replace that
// file (it is large and changes with every release); it points `OVERLEAF_CONFIG`
// at `settings.overlay.cjs` instead, which appends the names below to whatever
// the defaults contain.
//
// The CE image sets `OVERLEAF_CONFIG=/etc/overleaf/settings.js`. That file is
// read here rather than replaced, so the upstream settings keep being applied
// and this file only has to add what the overlay needs.
//
// Only Node built-ins are used, so `tests/overlay-settings.test.mjs` can
// exercise all of this without Overleaf.

const CE_SETTINGS = '/etc/overleaf/settings.js'

// The defaults of the base image, in the order `@overleaf/settings` looks for
// them (it prefers a `.cjs` file over a `.js` one).
const WEB_SETTINGS_DEFAULTS = [
  '/overleaf/services/web/config/settings.defaults.cjs',
  '/overleaf/services/web/config/settings.defaults.js',
]

// The sequence of the upstream release, as a last resort. The defaults of the
// base image are read first, so a module added by a later release keeps being
// loaded; this copy is only used when that file cannot be read at all, which is
// a sign that the base image is not the one the overlay was written for.
const FALLBACK_MODULE_IMPORT_SEQUENCE = [
  'history-v1',
  'launchpad',
  'server-ce-scripts',
  'user-activate',
]

/**
 * The modules of this overlay that the environment asks for, in load order.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function enabledModules(env) {
  const modules = []
  if (env.OVERLEAF_ENABLE_TRACK_CHANGES === 'true') {
    modules.push('track-changes')
  }
  if (env.SANDBOXED_COMPILES === 'true') {
    modules.push('sandboxed-compiles')
  }
  return modules
}

/**
 * Append the enabled modules to the sequence the image ships, without
 * duplicating a name that is already in it and without dropping an entry that a
 * future base image adds.
 *
 * @param {string[] | undefined} sequence the sequence from the base image
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function withOverlayModules(sequence, env) {
  const result = Array.isArray(sequence) ? [...sequence] : []
  for (const module of enabledModules(env)) {
    if (!result.includes(module)) {
      result.push(module)
    }
  }
  return result
}

/**
 * The settings of the base image that are read by its code but have no default
 * value in it, so that they can only be reached through a settings file.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {object}
 */
function additionalSettings(env) {
  const settings = {}

  // Overleaf Community Edition fixes the upload limit at 50 MB. The limit is
  // read in five places (FileWriter, DocumentConversionManager,
  // ProjectUploadController, ProjectDuplicator, ExpressLocals), so making it
  // configurable here is enough for all of them - including the size the
  // browser is told about.
  if (env.MAX_UPLOAD_SIZE != null && String(env.MAX_UPLOAD_SIZE).trim() !== '') {
    const megabytes = Number(String(env.MAX_UPLOAD_SIZE).trim())
    if (!Number.isInteger(megabytes) || megabytes <= 0) {
      throw new Error(
        `MAX_UPLOAD_SIZE is "${env.MAX_UPLOAD_SIZE}", which is not a positive ` +
          'whole number of megabytes'
      )
    }
    settings.maxUploadSize = megabytes * 1024 * 1024
  }

  // UrlHelper throws "no linked url proxy configured" without this value, even
  // though the CE image runs the linked-url-proxy service and sets
  // LINKED_URL_PROXY_HOST for it. It is only set when the administrator asked
  // for the corresponding linked-file type, so that nothing changes for a
  // deployment that did not: `Features.hasFeature('link-url')` also requires
  // `enabledLinkedFileTypes` to contain 'url'.
  const linkedFileTypes = String(env.ENABLED_LINKED_FILE_TYPES || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  if (linkedFileTypes.includes('url')) {
    const host = String(env.LINKED_URL_PROXY_HOST || '127.0.0.1').trim()
    settings.apis = { linkedUrlProxy: { url: `http://${host}:3066` } }
  }

  // Which user the compile container runs as. clsi defaults it to
  // `TEXLIVE_IMAGE_USER` or `tex` (uid 1000), but the directories it compiles
  // in belong to `www-data` - the uid clsi itself runs as and the one its init
  // script chowns them to - so a sibling container started as `tex` cannot
  // write into them and every sandboxed compile fails with a permission error.
  //
  // Later releases of the base image fix this in `/etc/overleaf/env.sh` by
  // exporting TEXLIVE_IMAGE_USER=www-data. This image does not replace that
  // file, and setting the value here has the same effect without depending on
  // it; an explicit TEXLIVE_IMAGE_USER still wins, for a compile image that has
  // no www-data user.
  if (env.SANDBOXED_COMPILES === 'true' && !env.TEXLIVE_IMAGE_USER) {
    settings.clsi = { docker: { user: 'www-data' } }
  }

  return settings
}

/**
 * Copy `source` into `target`, descending into plain objects. Arrays are
 * replaced, like the settings library does when it merges `OVERLEAF_CONFIG`
 * into the defaults.
 *
 * @param {object} target
 * @param {object} source
 * @returns {object} target
 */
function assignDeep(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      if (target[key] == null || typeof target[key] !== 'object') {
        target[key] = {}
      }
      assignDeep(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

/**
 * The module sequence of the base image, read from its settings defaults.
 *
 * Every candidate is tried (the settings library prefers a `.cjs` file), and a
 * file that loads but carries no sequence is reported rather than accepted, so
 * that falling back to the copy below is visible in the log instead of silently
 * dropping a module a later release added.
 *
 * @param {(path: string) => any} load
 * @param {string[]} paths
 * @returns {string[]}
 */
function readModuleImportSequence(load, paths) {
  const problems = []
  for (const path of paths) {
    let defaults
    try {
      defaults = load(path)
    } catch (err) {
      // A path that is simply not there is expected: the settings library
      // prefers a `.cjs` file while the CE image ships only a `.js` one, so
      // reporting every miss would make a healthy image look broken. Only a file
      // that is present and does not load is worth a message of its own.
      problems.push(`${path}: ${err.message}`)
      continue
    }
    if (!Array.isArray(defaults?.moduleImportSequence)) {
      problems.push(`${path} has no moduleImportSequence`)
      continue
    }
    return defaults.moduleImportSequence
  }
  console.error(
    'settings.overlay: using the built-in module sequence of Overleaf ' +
      `(${FALLBACK_MODULE_IMPORT_SEQUENCE.join(', ')}); no default settings file ` +
      'could be read: ' +
      problems.join('; ')
  )
  return FALLBACK_MODULE_IMPORT_SEQUENCE
}

/**
 * Assemble the object that `OVERLEAF_CONFIG` names.
 *
 * @param {object} options
 * @param {Record<string, string | undefined>} options.env
 * @param {(path: string) => any} [options.load] used to read the two files
 * @param {string} [options.baseSettingsPath] the CE settings, `OVERLEAF_CONFIG` of the base image
 * @param {string | string[]} [options.webDefaultsPath] the settings defaults of the base image
 * @returns {object} the settings to export
 */
function buildOverlaySettings({
  env,
  load = path => require(path),
  baseSettingsPath = CE_SETTINGS,
  webDefaultsPath = WEB_SETTINGS_DEFAULTS,
}) {
  let settings
  try {
    settings = load(baseSettingsPath)
    if (settings == null || typeof settings !== 'object') {
      throw new Error('did not export an object')
    }
  } catch (err) {
    // OIDC login and the rest of Overleaf keep working; only the settings of
    // the base image are missing.
    console.error(
      `settings.overlay: could not read ${baseSettingsPath}: ${err.message}`
    )
    settings = {}
  }

  assignDeep(settings, additionalSettings(env))

  const modules = enabledModules(env)
  if (modules.length === 0) {
    return settings
  }

  const sequence = readModuleImportSequence(
    load,
    Array.isArray(webDefaultsPath) ? webDefaultsPath : [webDefaultsPath]
  )
  settings.moduleImportSequence = withOverlayModules(sequence, env)
  console.log(
    `settings.overlay: loading the modules ${modules.join(', ')} ` +
      `(moduleImportSequence: ${settings.moduleImportSequence.join(', ')})`
  )
  return settings
}

module.exports = {
  FALLBACK_MODULE_IMPORT_SEQUENCE,
  WEB_SETTINGS_DEFAULTS,
  additionalSettings,
  assignDeep,
  buildOverlaySettings,
  enabledModules,
  readModuleImportSequence,
  withOverlayModules,
}
