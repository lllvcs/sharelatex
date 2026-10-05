'use strict'
// The settings this image adds on top of the Overleaf CE image.
//
// The image sets `OVERLEAF_CONFIG` to this file. Overleaf's `@overleaf/settings`
// reads the defaults of the service and then this file, whose values win, so
// `/etc/overleaf/settings.js` of the base image is loaded here (rather than
// replaced) and only extended.
//
// Overriding `OVERLEAF_CONFIG` (in `config/variables.env` of the toolkit, for
// example) replaces this file and with it the module registration below; the
// features it switches on would then be missing without an error. See
// README.md, "Environment variables".

const { buildOverlaySettings } = require('./overlay-modules.cjs')

module.exports = buildOverlaySettings({ env: process.env })
