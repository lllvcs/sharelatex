'use strict'
// The settings file **webpack** reads while it rebuilds the frontend.
//
// This is not what a running container uses: `OVERLEAF_CONFIG` points at
// `settings.overlay.cjs` there. This file exists because the registry that
// decides which module user interfaces end up in the bundle is read by a Babel
// macro while webpack runs (`frontend/macros/import-overleaf-module.macro.js`,
// which does `require('@overleaf/settings')` once at start-up). A runtime
// setting cannot add a component to an already-built bundle, so the only way to
// get one in is to fill the registry here and rebuild.
//
// It is passed as `OVERLEAF_CONFIG` to `yarn run webpack:production` in the
// `Dockerfile`, which is the same thing Overleaf's own Server Pro build does
// with its `config/settings.webpack.js`.
//
// Only the keys this image changes belong here: `@overleaf/settings` merges
// this object into `services/web/config/settings.defaults.js`, and the macro
// throws for any key it cannot find, so the empty defaults of the base image
// have to keep coming from there.
//
// The consequence to keep in mind: the paths below are resolved while the image
// is BUILT, not when it runs.

const Path = require('node:path')

module.exports = {
  overleafModuleImports: {
    // Where the editor's symbol palette gets its component from
    // (`frontend/js/features/ide-react/components/editor/symbol-palette-pane.tsx`
    // renders whatever is registered under this key).
    sourceEditorSymbolPalette: [
      Path.resolve(
        __dirname,
        '../modules/symbol-palette/frontend/js/components/symbol-palette'
      ),
    ],
  },
}
