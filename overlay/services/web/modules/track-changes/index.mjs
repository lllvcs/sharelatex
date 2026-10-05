// Track changes and the review panel.
//
// The user interface and the whole backend of this feature are part of the
// Overleaf CE core; the only thing that is missing is a switch. Overleaf CE
// projects report `features.trackChangesVisible: false` because
// `ProjectEditorHandler.trackChangesAvailable` is `false`, and every core path
// that belongs to the feature - the review-panel frontend, the ranges in the
// document-updater, the comment threads in chat, `ProjectHelper
// .isTrackChangesEnabledForUser` and the `track-changes` case of
// `Features.hasFeature` - is present and only reads that flag or checks for this
// module directory.
//
// The module therefore flips the flag and registers its routes; see
// app/src/TrackChangesRouter.mjs.
//
// Ported from `ayaka-notes/ayakaleaf-pro`
// (`services/web/modules/track-changes`). The overlay switches it on with
// OVERLEAF_ENABLE_TRACK_CHANGES, see overlay/etc/overleaf/overlay-modules.cjs.

import TrackChangesRouter from './app/src/TrackChangesRouter.mjs'
import ProjectEditorHandler from '../../app/src/Features/Project/ProjectEditorHandler.mjs'

ProjectEditorHandler.trackChangesAvailable = true
const TrackChangesModule = { router: TrackChangesRouter }
export default TrackChangesModule
