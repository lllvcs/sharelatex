// A ported feature has to be *reachable*, not just correct.
//
// Two features were shipped, compiled and verified, and still did not appear in a
// real deployment, because a name lookup failed:
//
//   * the editor only renders the symbol palette button when
//     `Features.hasFeature('symbol-palette')` is true, which is
//     `Settings.moduleImportSequence.includes('symbol-palette')`, and that module
//     was not in the sequence;
//   * the assistant asks for `GET /system/features` and falls back to all-disabled
//     on any error, and the module serving that route was not in the sequence.
//
// Neither was visible from the module itself - both needed the module *and* the
// list it is registered in to be looked at together. These tests do that, in the
// two directions where a name has to match: a module that something asks for by
// name has to be switchable on, and an import or a registry path has to point at
// something that exists.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  enabledModules,
  withOverlayModules,
  readModuleImportSequence,
} from '../overlay/etc/overleaf/overlay-modules.cjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const overlay = path.join(repo, 'overlay', 'services', 'web')
const modulesDir = path.join(overlay, 'modules')

const moduleNames = fs
  .readdirSync(modulesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

// Every switch the overlay understands, all on at once. If a module can be
// reached at all, it is in this list.
const everything = enabledModules({
  OVERLEAF_ENABLE_TRACK_CHANGES: 'true',
  SANDBOXED_COMPILES: 'true',
  OVERLEAF_ENABLE_ADMIN_TOOLS: 'true',
  OVERLEAF_ENABLE_SYMBOL_PALETTE: 'true',
  AI_ENABLED: 'true',
})

const readIfPresent = (...parts) => {
  const file = path.join(...parts)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

test('every module that carries a router can be switched on', () => {
  // A module whose index.mjs exports a router registers routes at load time, so
  // something has to be able to put it in the sequence - otherwise its routes
  // never exist and whatever fetches them gets a 404. That is exactly how
  // instance-features broke the assistant: the client hook turns any error into
  // "this instance has no AI" and the panel renders disabled.
  const reachable = new Set(everything)
  const unreachable = []
  for (const name of moduleNames) {
    const index = readIfPresent(modulesDir, name, 'index.mjs')
    if (/\brouter\b/.test(index) && !reachable.has(name)) {
      unreachable.push(name)
    }
  }
  assert.deepEqual(
    unreachable,
    [],
    `these modules register routes but no switch adds them to moduleImportSequence: ${unreachable.join(', ')}`
  )
})

test('every module the overlay ships is accounted for, one way or the other', () => {
  // Not a defect on its own - reference-picker is deliberately not in the
  // sequence, because nothing asks for a feature of that name and its index.mjs
  // registers nothing - but it has to be a decision, so the test names the
  // exceptions rather than letting a new module slip in unnoticed.
  const frontendOnly = new Set(['reference-picker'])
  const accounted = new Set([...everything, ...frontendOnly])
  const unaccounted = moduleNames.filter(name => !accounted.has(name))
  assert.deepEqual(
    unaccounted,
    [],
    `these modules are neither switchable nor listed as frontend-only: ${unaccounted.join(', ')}`
  )
})

test('a frontend-only module really does register nothing', () => {
  // The list above is only allowed to contain modules that would register
  // nothing if they were named in the sequence.
  for (const name of ['reference-picker']) {
    const index = readIfPresent(modulesDir, name, 'index.mjs')
    assert.ok(index.length > 0, `${name} has no index.mjs`)
    assert.ok(
      !/\brouter\b/.test(index),
      `${name} registers a router, so it needs a switch, not an exception`
    )
  }
})

test('every @modules import points at a module this overlay ships', () => {
  // The service imports the sequence with `await import()`, so one import of a
  // module that is not in the overlay stops the web service from starting - and
  // the same import in a frontend file fails the webpack build.
  const missing = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        for (const hit of text.matchAll(/@modules\/([a-z0-9-]+)/g)) {
          if (!moduleNames.includes(hit[1])) {
            missing.push(
              `${path.relative(repo, full)} imports @modules/${hit[1]}`
            )
          }
        }
      }
    }
  }
  walk(overlay)
  assert.deepEqual(missing, [], missing.join('\n'))
})

test('every registry path the overlay points at exists', () => {
  // webpack resolves these at build time, so a typo is a failed build rather than
  // a missing panel - but it fails the build of an *image*, minutes in, so it is
  // worth catching here. Extensions are the ones webpack tries.
  const config = readIfPresent(overlay, 'config', 'settings.frontend.cjs')
  const paths = [...config.matchAll(/module_\('([^']+)'\)/g)].map(m => m[1])
  assert.ok(paths.length >= 11, `expected the registry to point somewhere, got ${paths.length}`)
  const missing = []
  for (const relative of paths) {
    const base = path.join(modulesDir, relative)
    const candidates = [
      '',
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '/index.js',
      '/index.jsx',
      '/index.ts',
      '/index.tsx',
    ].map(suffix => base + suffix)
    if (!candidates.some(candidate => fs.existsSync(candidate))) {
      missing.push(relative)
    }
  }
  assert.deepEqual(missing, [], `registry paths that resolve to nothing: ${missing.join(', ')}`)
})

test('the sequence the settings file writes keeps everything it is given', () => {
  // The reachability above only holds if the settings file actually applies the
  // list; readModuleImportSequence is what the overlay reads out of the base
  // image, and withOverlayModules is what it writes back. This test supplies the
  // reader itself so it does not depend on where the base image keeps its file.
  const base = ['history-v1', 'launchpad', 'server-ce-scripts', 'user-activate']
  const sequence = readModuleImportSequence(
    () => ({ moduleImportSequence: base }),
    ['/somewhere/settings.defaults.js']
  )
  assert.deepEqual(sequence, base)

  const merged = withOverlayModules(sequence, {
    OVERLEAF_ENABLE_SYMBOL_PALETTE: 'true',
    AI_ENABLED: 'true',
  })
  for (const name of [...base, 'symbol-palette', 'instance-features', 'workbench', 'error-assistant']) {
    assert.ok(merged.includes(name), `${name} was lost from the sequence`)
  }
  // and the AI ones keep their dependency order
  assert.ok(
    merged.indexOf('instance-features') < merged.indexOf('workbench') &&
      merged.indexOf('workbench') < merged.indexOf('error-assistant'),
    `the AI modules are out of order: ${merged.join(', ')}`
  )
})
