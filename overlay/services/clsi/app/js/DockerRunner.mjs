// The Docker runner under the other name a release may use.
//
// The runner itself is DockerRunner.js, which is the name Overleaf CE 6.3.0
// looks for: `services/clsi/app/js/CommandRunner.js` imports it and
// `services/clsi/config/settings.defaults.cjs` checks that it exists before it
// enables the runner at all. Some releases name it `DockerRunner.mjs` instead
// (ayaka-notes/ayakaleaf-pro renamed it, and the two files differ only in the
// extension), so this file exists to make the overlay independent of which name
// the base image uses:
//
//   CommandRunner.js:       import('./DockerRunner.js')  -> the real file
//                           import('./DockerRunner.mjs') -> this file
//   settings.defaults.cjs:  existsSync('DockerRunner.js')  -> found
//                           existsSync('DockerRunner.mjs') -> found
//
// Both files are ES modules: services/clsi/package.json sets "type": "module".

export { default } from './DockerRunner.js'
