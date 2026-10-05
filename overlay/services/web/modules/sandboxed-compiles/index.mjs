// Sandboxed compiles: run each project in its own TeX Live container.
//
// The clsi service does the actual work (`services/clsi/app/js/DockerRunner.mjs`,
// enabled by `SANDBOXED_COMPILES=true`). This module fills the three web-side
// settings that tell Overleaf which images exist and which one a new project
// starts on; see `./app/src/TexLiveImages.mjs` for why they have to agree.
//
// Ported from `ayaka-notes/ayakaleaf-pro` (`services/web/modules/sandboxed-compiles`),
// which supports the `ghcr.io/ayaka-notes/texlive-full` images. Differences to
// that version: the image prefix is derived from the configured images instead
// of defaulting to one vendor, an incomplete configuration is reported instead
// of failing later, and the parsing lives in a module that can be tested
// without Overleaf.

import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { resolveTexLiveConfiguration } from './app/src/TexLiveImages.mjs'

/** @import { WebModule } from "../../types/web-module" */

if (process.env.SANDBOXED_COMPILES === 'true') {
  const { imageRoot, allowedImageNames, currentImageName } =
    resolveTexLiveConfiguration(process.env)

  Settings.imageRoot = imageRoot
  Settings.allowedImageNames = allowedImageNames
  Settings.currentImageName = currentImageName

  logger.info(
    { imageRoot, currentImageName, allowedImageNames },
    'Sandboxed compiles are enabled'
  )
}

/** @type {WebModule} */
const sandboxedCompilesModule = {}
export default sandboxedCompilesModule
