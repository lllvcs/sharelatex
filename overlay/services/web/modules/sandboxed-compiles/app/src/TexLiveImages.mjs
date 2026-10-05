// TeX Live images for sandboxed compiles.
//
// Overleaf CE already knows how to run a project against a TeX Live image
// instead of its own installation: `ClsiManager` puts `project.imageName` into
// the compile request, `ProjectOptionsHandler.normalizeImageName()` validates a
// change against `Settings.allowedImageNames` and re-assembles the full
// reference from `Settings.imageRoot`, and `ProjectCreationHandler` stamps
// `Settings.currentImageName` on every new project. What CE does not do is fill
// those three settings - that is what this module is for.
//
// The three settings have to agree with each other, because `imageRoot` is
// prepended to a bare image name that came back from the browser:
//
//   Settings.imageRoot                  = 'ghcr.io/ayaka-notes'
//   Settings.allowedImageNames          = [{ imageName: 'texlive-full:2026.1', ... }]
//   Settings.currentImageName           = 'ghcr.io/ayaka-notes/texlive-full:2026.1'
//
// A mismatch does not fail loudly at compile time - `normalizeImageName()`
// throws `invalid imageName` when the browser sends back a name that is not in
// the list, and a project whose `imageName` points at an image that clsi cannot
// pull looks like a compile error. The values are therefore derived here, from
// one list, and validated before they are used.
//
// Nothing but Node built-ins is imported, so `tests/sandboxed-compiles-images
// .test.mjs` can exercise this without Overleaf.

/**
 * Split a comma or whitespace separated environment variable into its entries.
 *
 * Used for image references, which cannot contain either character themselves.
 *
 * @param {string | undefined | null} value
 * @returns {string[]}
 */
export function parseImageList(value) {
  if (value == null) return []
  return String(value)
    .split(/[\s,]+/)
    .map(entry => entry.trim())
    .filter(Boolean)
}

/**
 * Split a comma separated environment variable into its entries.
 *
 * The display names of the toolkit (`ALL_TEX_LIVE_DOCKER_IMAGE_NAMES`) are meant
 * to be human readable and may contain spaces ("Texlive 2026"), so unlike
 * `parseImageList()` this one only splits on commas.
 *
 * @param {string | undefined | null} value
 * @returns {string[]}
 */
export function parseNameList(value) {
  if (value == null) return []
  return String(value)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
}

/**
 * `ghcr.io/ayaka-notes/texlive-full:2026.1` -> `ghcr.io/ayaka-notes`
 *
 * @param {string} image
 * @returns {string} the empty string when the image carries no registry
 */
export function hostingUrl(image) {
  const reference = String(image).split('@')[0]
  const lastSlash = reference.lastIndexOf('/')
  return lastSlash === -1 ? '' : reference.slice(0, lastSlash)
}

/**
 * `ghcr.io/ayaka-notes/texlive-full:2026.1` -> `texlive-full:2026.1`
 *
 * @param {string} image
 * @returns {string}
 */
export function bareImageName(image) {
  const reference = String(image).split('@')[0]
  const lastSlash = reference.lastIndexOf('/')
  return lastSlash === -1 ? reference : reference.slice(lastSlash + 1)
}

/**
 * The `Settings.allowedImageNames` entry for one image. The bare name is
 * lower-cased because `ProjectOptionsHandler.normalizeImageName()` compares the
 * lower-cased value the browser sent against it.
 *
 * @param {string[]} images full image references, in the configured order
 * @param {string[]} descriptions display names, matched by position
 * @returns {{ imageName: string, imageDesc: string }[]}
 */
export function buildAllowedImageNames(images, descriptions = []) {
  return images.map((image, index) => {
    const bare = bareImageName(image)
    return {
      imageName: bare.toLowerCase(),
      imageDesc: descriptions[index] || bare,
    }
  })
}

/**
 * @typedef {object} TexLiveConfiguration
 * @property {string} imageRoot the prefix that is prepended to a bare image name
 * @property {{ imageName: string, imageDesc: string }[]} allowedImageNames
 * @property {string} currentImageName the image new projects are created with
 */

/**
 * Derive the three settings from the environment, or explain what is wrong.
 *
 * Throwing is deliberate: `SANDBOXED_COMPILES=true` is an explicit request, and
 * Overleaf's own `check-texlive-images.mjs` preflight also refuses to continue
 * on an incomplete configuration. The alternative - falling back to "no image"
 * - silently compiles every project in the container instead of in the
 * configured image, which is exactly the failure this module exists to avoid.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {TexLiveConfiguration}
 */
export function resolveTexLiveConfiguration(env = process.env) {
  const images = parseImageList(env.ALL_TEX_LIVE_DOCKER_IMAGES)
  if (images.length === 0) {
    throw new Error(
      'SANDBOXED_COMPILES is enabled but ALL_TEX_LIVE_DOCKER_IMAGES is not set: ' +
        'list the TeX Live images available for selection, separated by commas, ' +
        'for example "ghcr.io/ayaka-notes/texlive-full:2026.1, ghcr.io/ayaka-notes/texlive-full:2025.1"'
    )
  }

  // `ProjectOptionsHandler` composes the image as `${imageRoot}/${imageName}`,
  // so every configured image has to live under one and the same prefix.
  const imageRoot = (env.IMAGE_ROOT || '').trim() || hostingUrl(images[0])
  if (!imageRoot) {
    throw new Error(
      `ALL_TEX_LIVE_DOCKER_IMAGES contains "${images[0]}", which names no registry or ` +
        'namespace; set IMAGE_ROOT to the prefix the images share ' +
        '(for example "ghcr.io/ayaka-notes")'
    )
  }
  const elsewhere = images.filter(image => hostingUrl(image) !== imageRoot)
  if (elsewhere.length > 0) {
    const withoutRegistry = elsewhere.filter(image => !hostingUrl(image))
    throw new Error(
      `every image in ALL_TEX_LIVE_DOCKER_IMAGES has to live under ${imageRoot}, ` +
        `but ${elsewhere.join(', ')} does not: Overleaf stores the project's image ` +
        'as a bare name plus one shared prefix, and hands the configured name to ' +
        'docker unchanged, so a name without a registry cannot be completed by ' +
        'IMAGE_ROOT alone - list the full reference instead' +
        (withoutRegistry.length > 0
          ? ` (for example ${imageRoot}/${bareImageName(withoutRegistry[0])})`
          : '')
    )
  }
  const duplicates = images.filter(
    (image, index) => images.indexOf(image) !== index
  )
  if (duplicates.length > 0) {
    throw new Error(
      `ALL_TEX_LIVE_DOCKER_IMAGES lists ${duplicates.join(', ')} more than once`
    )
  }

  // `TEX_LIVE_DOCKER_IMAGE` is read by the clsi process as well, which never
  // loads this module, so it has to be set in the environment rather than
  // defaulted here - otherwise web and clsi would disagree about the image.
  const currentImageName = (env.TEX_LIVE_DOCKER_IMAGE || '').trim()
  if (!currentImageName) {
    throw new Error(
      'SANDBOXED_COMPILES is enabled but TEX_LIVE_DOCKER_IMAGE is not set: ' +
        `set it to the image new projects are created with, one of ${images.join(', ')}`
    )
  }
  if (!images.includes(currentImageName)) {
    throw new Error(
      `TEX_LIVE_DOCKER_IMAGE is "${currentImageName}", which is not part of ` +
        `ALL_TEX_LIVE_DOCKER_IMAGES (${images.join(', ')})`
    )
  }

  return {
    imageRoot,
    allowedImageNames: buildAllowedImageNames(
      images,
      parseNameList(env.ALL_TEX_LIVE_DOCKER_IMAGE_NAMES)
    ),
    currentImageName,
  }
}
