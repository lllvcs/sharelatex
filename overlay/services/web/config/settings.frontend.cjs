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

/** Resolve a module's frontend file against the image layout. */
const module_ = (...parts) => Path.resolve(__dirname, '../modules', ...parts)

module.exports = {
  overleafModuleImports: {
    // ---------------------------------------------------------------------
    // The editor's symbol palette
    // ---------------------------------------------------------------------
    // `frontend/js/features/ide-react/components/editor/symbol-palette-pane.tsx`
    // renders whatever is registered under this key.
    sourceEditorSymbolPalette: [
      module_('symbol-palette/frontend/js/components/symbol-palette'),
    ],

    // ---------------------------------------------------------------------
    // The reference picker: citing from the .bib file
    // ---------------------------------------------------------------------
    // The base image's core already ships the reference machinery - the BibTeX
    // parser, the editor's BibTeX language, the "root bib document" and
    // "reference format" settings, and a `basic-reference-index` - and it calls
    // `importOverleafModules('referenceIndices')` for a better one. Empty means
    // the basic index and no picker; these three entries are what the fork adds
    // on top, and they are why its BibTeX support is more than the base image's.
    referenceIndices: [
      module_('reference-picker/frontend/js/reference-index/advanced-reference-index'),
    ],
    mainEditorLayoutModals: [
      module_('reference-picker/frontend/js/components/reference-picker-controller'),
    ],
    autoCompleteExtensions: [
      module_('reference-picker/frontend/js/extensions/reference-picker-keybinding'),
    ],

    // ---------------------------------------------------------------------
    // The AI assistant (workbench) and the error assistant
    // ---------------------------------------------------------------------
    // `workbench` is the chat panel in the editor's rail; `error-assistant`
    // adds the "suggest a fix" button to the compile log and a panel that
    // proposes changes. Both are backend + frontend modules, and the frontend
    // half reaches the browser through these keys.
    //
    // The AI half needs a gateway to do anything: AI_ENABLED, AI_BASE_URL,
    // AI_API_KEY and AI_MODEL (see README.md).
    rootContextProviders: [
      module_('workbench/frontend/js/context/workbench-settings-context'),
    ],
    mainEditorLayoutPanels: [
      module_('workbench/frontend/js/components/workbench-dock'),
    ],
    railEntries: [module_('workbench/frontend/js/workbench-rail-entry')],
    sourceEditorExtensions: [
      module_('error-assistant/frontend/js/extensions/previous-fix'),
    ],
    pdfLogEntryHeaderActionComponents: [
      module_('error-assistant/frontend/js/components/suggest-fix-button'),
    ],
    pdfLogEntryComponents: [
      module_('error-assistant/frontend/js/components/error-assistant'),
    ],
    pdfLogEntriesComponents: [
      module_('error-assistant/frontend/js/components/previous-fix-entry'),
    ],
  },
}
