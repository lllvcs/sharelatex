// Checks how the TeX Live images for sandboxed compiles are derived from the
// environment (see
// overlay/services/web/modules/sandboxed-compiles/app/src/TexLiveImages.mjs).
//
//   locally:            node --test tests/sandboxed-compiles-images.test.mjs
//   inside the image:   node --test /tests/sandboxed-compiles-images.test.mjs
//
// The module under test imports nothing but Node built-ins, so nothing else
// from the application is needed.
//
// The three settings it produces have to agree with each other, because
// `ProjectOptionsHandler.normalizeImageName()` re-assembles the image as
// `Settings.imageRoot + '/' + imageName` from the bare name a browser sent
// back. A mismatch shows up as "invalid imageName" when someone switches the
// TeX Live version of a project, or as a compile that silently uses the wrong
// image, so every combination is checked here.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_TEX_LIVE_IMAGES_MODULE,
  '/overleaf/services/web/modules/sandboxed-compiles/app/src/TexLiveImages.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/modules/sandboxed-compiles/app/src/TexLiveImages.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find TexLiveImages.mjs')
}

const {
  bareImageName,
  buildAllowedImageNames,
  hostingUrl,
  parseImageList,
  parseNameList,
  resolveTexLiveConfiguration,
} = await import(pathToFileURL(modulePath).href)

const IMAGE_2026 = 'ghcr.io/ayaka-notes/texlive-full:2026.1'
const IMAGE_2025 = 'ghcr.io/ayaka-notes/texlive-full:2025.1'

const validEnv = () => ({
  ALL_TEX_LIVE_DOCKER_IMAGES: `${IMAGE_2026}, ${IMAGE_2025}`,
  ALL_TEX_LIVE_DOCKER_IMAGE_NAMES: 'Texlive 2026, Texlive 2025',
  TEX_LIVE_DOCKER_IMAGE: IMAGE_2026,
})

// --- parseImageList ---------------------------------------------------------

test('an unset or empty image list is empty', () => {
  assert.deepEqual(parseImageList(undefined), [])
  assert.deepEqual(parseImageList(''), [])
  assert.deepEqual(parseImageList('  '), [])
  assert.deepEqual(parseImageList(',,'), [])
})

test('images are separated by commas, whitespace or newlines', () => {
  assert.deepEqual(parseImageList('a:1,b:2'), ['a:1', 'b:2'])
  assert.deepEqual(parseImageList('a:1, b:2'), ['a:1', 'b:2'])
  assert.deepEqual(parseImageList('a:1\n b:2\n'), ['a:1', 'b:2'])
})

// --- parseNameList ----------------------------------------------------------

test('display names keep the spaces inside them', () => {
  assert.deepEqual(parseNameList('Texlive 2026, Texlive 2025'), [
    'Texlive 2026',
    'Texlive 2025',
  ])
  assert.deepEqual(parseNameList('TeX Live 2026'), ['TeX Live 2026'])
  assert.deepEqual(parseNameList(undefined), [])
  assert.deepEqual(parseNameList(''), [])
})

// --- hostingUrl / bareImageName --------------------------------------------

test('a reference is split into its prefix and its bare name', () => {
  assert.equal(hostingUrl(IMAGE_2026), 'ghcr.io/ayaka-notes')
  assert.equal(bareImageName(IMAGE_2026), 'texlive-full:2026.1')
})

test('a reference with several path segments keeps all but the last', () => {
  assert.equal(hostingUrl('ghcr.io/a/b/c:tag'), 'ghcr.io/a/b')
  assert.equal(bareImageName('ghcr.io/a/b/c:tag'), 'c:tag')
})

test('a registry with a port is part of the prefix', () => {
  assert.equal(hostingUrl('localhost:5000/a/b:1'), 'localhost:5000/a')
  assert.equal(bareImageName('localhost:5000/a/b:1'), 'b:1')
})

test('a digest is not part of the bare name', () => {
  assert.equal(hostingUrl('ghcr.io/a/b@sha256:abc'), 'ghcr.io/a')
  assert.equal(bareImageName('ghcr.io/a/b@sha256:abc'), 'b')
})

test('a reference without a registry has no prefix', () => {
  assert.equal(hostingUrl('texlive-full:2026.1'), '')
  assert.equal(bareImageName('texlive-full:2026.1'), 'texlive-full:2026.1')
})

// --- buildAllowedImageNames -------------------------------------------------

test('the entries carry the bare, lower-cased name and the configured label', () => {
  assert.deepEqual(buildAllowedImageNames([IMAGE_2026, IMAGE_2025], ['A', 'B']), [
    { imageName: 'texlive-full:2026.1', imageDesc: 'A' },
    { imageName: 'texlive-full:2025.1', imageDesc: 'B' },
  ])
})

test('a name the administrator did not label falls back to the bare name', () => {
  assert.deepEqual(buildAllowedImageNames([IMAGE_2026, IMAGE_2025], ['A']), [
    { imageName: 'texlive-full:2026.1', imageDesc: 'A' },
    { imageName: 'texlive-full:2025.1', imageDesc: 'texlive-full:2025.1' },
  ])
})

test('an upper-case tag is lower-cased, because the browser sends it that way', () => {
  // ProjectOptionsHandler.normalizeImageName() lower-cases the value it
  // received before it compares it with allowedImageNames.
  const [entry] = buildAllowedImageNames(['ghcr.io/a/B:RC1'], [])
  assert.equal(entry.imageName, 'b:rc1')
})

// --- resolveTexLiveConfiguration -------------------------------------------

test('the three settings are derived from the configured images', () => {
  const { imageRoot, allowedImageNames, currentImageName } =
    resolveTexLiveConfiguration(validEnv())
  assert.equal(imageRoot, 'ghcr.io/ayaka-notes')
  assert.deepEqual(allowedImageNames, [
    { imageName: 'texlive-full:2026.1', imageDesc: 'Texlive 2026' },
    { imageName: 'texlive-full:2025.1', imageDesc: 'Texlive 2025' },
  ])
  assert.equal(currentImageName, IMAGE_2026)
})

test('the composed image equals the configured reference', () => {
  // this is what ProjectOptionsHandler.normalizeImageName() builds
  const { imageRoot, allowedImageNames } = resolveTexLiveConfiguration(validEnv())
  for (const { imageName } of allowedImageNames) {
    assert.equal(
      `${imageRoot}/${imageName}`,
      `${hostingUrl(IMAGE_2026)}/${imageName}`
    )
  }
  assert.equal(
    `${imageRoot}/${allowedImageNames[0].imageName}`,
    IMAGE_2026.toLowerCase()
  )
  // ... which is what Path.basename() of the stored project image has to be
  assert.equal(
    bareImageName(IMAGE_2026).toLowerCase(),
    allowedImageNames[0].imageName
  )
})

test('IMAGE_ROOT overrides the prefix derived from the first image', () => {
  const { imageRoot } = resolveTexLiveConfiguration({
    ...validEnv(),
    IMAGE_ROOT: 'ghcr.io/ayaka-notes',
  })
  assert.equal(imageRoot, 'ghcr.io/ayaka-notes')
})

test('an image with no registry at all is refused', () => {
  // `TEX_LIVE_DOCKER_IMAGE` is handed to docker as it is, while the image of a
  // project is composed from the bare name and IMAGE_ROOT - a name without a
  // registry cannot satisfy both.
  assert.throws(
    () =>
      resolveTexLiveConfiguration({
        ALL_TEX_LIVE_DOCKER_IMAGES: 'texlive-full:2026.1',
        TEX_LIVE_DOCKER_IMAGE: 'texlive-full:2026.1',
      }),
    /IMAGE_ROOT/
  )
  assert.throws(
    () =>
      resolveTexLiveConfiguration({
        ALL_TEX_LIVE_DOCKER_IMAGES: 'texlive-full:2026.1',
        TEX_LIVE_DOCKER_IMAGE: 'texlive-full:2026.1',
        IMAGE_ROOT: 'registry.example.com/mirror',
      }),
    /list the full reference instead/
  )
})

test('a mirror is used by listing the mirrored references', () => {
  const mirrored = 'registry.example.com/mirror/texlive-full:2026.1'
  assert.deepEqual(
    resolveTexLiveConfiguration({
      ALL_TEX_LIVE_DOCKER_IMAGES: mirrored,
      TEX_LIVE_DOCKER_IMAGE: mirrored,
    }),
    {
      imageRoot: 'registry.example.com/mirror',
      allowedImageNames: [
        { imageName: 'texlive-full:2026.1', imageDesc: 'texlive-full:2026.1' },
      ],
      currentImageName: mirrored,
    }
  )
})

test('a missing image list names the variable to set', () => {
  assert.throws(
    () => resolveTexLiveConfiguration({ TEX_LIVE_DOCKER_IMAGE: IMAGE_2026 }),
    /ALL_TEX_LIVE_DOCKER_IMAGES is not set/
  )
})

test('a missing current image names the variable to set', () => {
  const env = validEnv()
  delete env.TEX_LIVE_DOCKER_IMAGE
  assert.throws(() => resolveTexLiveConfiguration(env), /TEX_LIVE_DOCKER_IMAGE/)
})

test('a current image outside the list is refused', () => {
  assert.throws(
    () =>
      resolveTexLiveConfiguration({
        ...validEnv(),
        TEX_LIVE_DOCKER_IMAGE: 'ghcr.io/ayaka-notes/texlive-full:2024.1',
      }),
    /not part of ALL_TEX_LIVE_DOCKER_IMAGES/
  )
})

test('images from two registries are refused, because one prefix is stored', () => {
  assert.throws(
    () =>
      resolveTexLiveConfiguration({
        ALL_TEX_LIVE_DOCKER_IMAGES: `${IMAGE_2026}, docker.io/library/texlive:2025`,
        TEX_LIVE_DOCKER_IMAGE: IMAGE_2026,
      }),
    /docker\.io\/library\/texlive:2025/
  )
})

test('a duplicated image is refused instead of shadowing itself', () => {
  assert.throws(
    () =>
      resolveTexLiveConfiguration({
        ALL_TEX_LIVE_DOCKER_IMAGES: `${IMAGE_2026},${IMAGE_2026}`,
        TEX_LIVE_DOCKER_IMAGE: IMAGE_2026,
      }),
    /more than once/
  )
})

test('a single image is enough', () => {
  const { allowedImageNames, currentImageName } = resolveTexLiveConfiguration({
    ALL_TEX_LIVE_DOCKER_IMAGES: IMAGE_2026,
    TEX_LIVE_DOCKER_IMAGE: IMAGE_2026,
  })
  assert.equal(allowedImageNames.length, 1)
  assert.equal(currentImageName, IMAGE_2026)
})
