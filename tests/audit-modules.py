#!/usr/bin/env python3
"""Audit the overlay against what the image asks of it.

The two defects that reached a deployment were both "something asks for a module
by name and nobody told the module list": one through `Features.hasFeature()`,
one through a route that 404'd. Reading a module's `index.mjs` was not enough to
see either, so this asks four questions instead, all of them mechanically:

  1. which modules does anything ask for by name, and are they in the sequence?
  2. do two modules register the same route? (the admin panel nearly lost
     `/admin/user` to the base image's `user-activate` that way)
  3. does a module's frontend read a `getMeta('ol-...')` the server never sends?
  4. is every registry key the rebuild fills actually consumed by the core, and
     every key the core consumes that a ported module needs actually filled?

Two more directions belong to the same audit and are not here - whether a module
reads a setting nothing defines, and whether a frontend fetches a URL no router
serves. `DEVELOP_EXPERIMENT.MD` section 3.4 has all six, with their results.

Run it inside the built image with both trees mounted:

    docker run --rm -v "$PWD/overlay:/overlay:ro" --entrypoint=/bin/bash \\
      lvcs/sharelatex -c 'python3 /overlay/../../tests/audit-modules.py'

Findings are reported, not judged. The two it prints today are metas the workbench
frontend reads with an explicit fallback, which section 3.4 confirms are operator
overrides the fork never provided a source for.

Everything it reports has to be checked by hand before it is believed: the first
pass of the metadata check here called twelve live metas dead, because it matched
`key:` and `key,` but not the late-assignment form
(`res.locals.ExposedSettings.aiAvailable = ...`) and did not read the `.pug`
views, where most metadata is actually set.
"""
import os
import re
import sys

IMAGE = "/overleaf/services/web"
OVERLAY = "/overlay/services/web"
FORBIDDEN = (".git", "node_modules", "public")


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def walk(root, suffixes=(".mjs", ".js", ".cjs", ".ts", ".tsx", ".pug")):
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in FORBIDDEN]
        for name in names:
            if name.endswith(suffixes):
                yield os.path.join(dirpath, name)


def rel(path):
    return os.path.relpath(path, IMAGE)


# --- 1. what asks for a module by name --------------------------------------

ASK = re.compile(
    r"""hasFeature\(\s*['"]([^'"]+)['"]"""
    r"""|moduleImportSequence[^\n]{0,60}?includes\(\s*['"]([^'"]+)['"]"""
)

asked = {}
for path in walk(f"{IMAGE}/app/src"):
    for match in ASK.finditer(read(path)):
        name = match.group(1) or match.group(2)
        if name:
            asked.setdefault(name, set()).add(rel(path))
for path in walk(f"{IMAGE}/frontend/js"):
    for match in ASK.finditer(read(path)):
        name = match.group(1) or match.group(2)
        if name:
            asked.setdefault(name, set()).add(rel(path))

# what the deployed settings turn on, read from the overlay itself
SEQUENCE_SWITCH = {
    "track-changes": "OVERLEAF_ENABLE_TRACK_CHANGES",
    "sandboxed-compiles": "SANDBOXED_COMPILES",
    "admin-tools": "OVERLEAF_ENABLE_ADMIN_TOOLS",
    "symbol-palette": "OVERLEAF_ENABLE_SYMBOL_PALETTE",
    "instance-features": "AI_ENABLED",
    "workbench": "AI_ENABLED",
    "error-assistant": "AI_ENABLED",
}

MODULES = sorted(
    d for d in os.listdir(f"{OVERLAY}/modules")
    if os.path.isdir(f"{OVERLAY}/modules/{d}")
)

# --- 2. routes, and who else registers them ---------------------------------

ROUTE = re.compile(r"""\.(get|post|put|delete|patch|all)\(\s*['"](/[^'"]*)['"]""")

routes = {}
for path in walk(f"{IMAGE}/app/src"):
    for method, route in ROUTE.findall(read(path)):
        routes.setdefault(route, []).append(rel(path))
for module in MODULES:
    for path in walk(f"{OVERLAY}/modules/{module}"):
        for method, route in ROUTE.findall(read(path)):
            routes.setdefault(route, []).append(f"modules/{module}")

# --- 3. metas the frontends read --------------------------------------------

def meta_keys(root):
    found = {}
    for path in walk(root):
        for key in re.findall(r"""getMeta\(\s*['"](ol-[\w]+)['"]""", read(path)):
            found.setdefault(key, set()).add(rel(path))
    return found


# `getMeta('ol-foo')` is sent as `foo` in a meta object (the view adds `ol-`).
# Three spellings have to count, and each one was a false negative in an earlier
# version of this check: `foo: value`, the shorthand `foo,` (which is what the
# project controller uses for the AI metas), and a late assignment such as
# `res.locals.ExposedSettings.aiAvailable = ...` (which is how the workbench
# module adds its own field to a meta the core sends).
META_SENT = re.compile(r"""\b([a-zA-Z][\w]*)\s*[,:}\)\n]""")
ASSIGNED = re.compile(r"""\.([a-zA-Z][\w]*)\s*=[^=]""")
sent_meta_names = set()
for path in walk(f"{IMAGE}/app/src"):
    text = read(path)
    sent_meta_names.update(META_SENT.findall(text))
    sent_meta_names.update(ASSIGNED.findall(text))
for module in MODULES:
    for path in walk(f"{OVERLAY}/modules/{module}"):
        text = read(path)
        sent_meta_names.update(META_SENT.findall(text))
        sent_meta_names.update(ASSIGNED.findall(text))
# the views are what actually turn a meta into <meta name="ol-...">
for path in walk(f"{IMAGE}/app/views"):
    for name in re.findall(r"""ol-([\w]+)""", read(path)):
        sent_meta_names.add(name.lower())

# --- 4. the registry --------------------------------------------------------

CONSUMED = re.compile(r"""importOverleafModules\(\s*['"]([\w]+)['"]""")
consumed = {}
for path in walk(f"{IMAGE}/frontend/js"):
    for key in CONSUMED.findall(read(path)):
        consumed.setdefault(key, set()).add(rel(path))

filled = set(
    re.findall(r"""^\s{4}([A-Za-z][\w]*)\s*:\s*\[""", read(f"{OVERLAY}/config/settings.frontend.cjs"), re.M)
)

# --- report -----------------------------------------------------------------

problems = []

print("=" * 78)
print("1. modules, who asks for them, and where they are switched on")
print("=" * 78)
for module in MODULES:
    askers = sorted(asked.get(module, []))
    switch = SEQUENCE_SWITCH.get(module, "(not in the sequence)")
    print(f"\n  {module}")
    if askers:
        print(f"    asked by name by: {', '.join(a.split('/')[-1] for a in askers[:3])}")
    else:
        print("    nothing asks for it by name")
    print(f"    switched on by  : {switch}")
    index = f"{OVERLAY}/modules/{module}/index.mjs"
    if os.path.exists(index):
        text = read(index)
        has_router = bool(re.search(r"""\brouter\b""", text))
        sets_settings = "Settings." in text
        print(f"    index.mjs       : router={has_router} sets Settings={sets_settings}")
        if askers and switch == "(not in the sequence)":
            problems.append(
                f"{module} is asked for by name but no variable puts it in moduleImportSequence"
            )
        if has_router and switch == "(not in the sequence)":
            problems.append(f"{module} registers routes but is never loaded, so they 404")

print()
print("=" * 78)
print("2. routes registered more than once (first registration wins)")
print("=" * 78)
collisions = 0
for route, owners in sorted(routes.items()):
    unique = sorted(set(owners))
    ported = [o for o in unique if o.startswith("modules/")]
    if ported and len(unique) > 1:
        collisions += 1
        print(f"\n  {route}")
        for owner in unique:
            mark = "  <- ported" if owner.startswith("modules/") else ""
            print(f"      {owner}{mark}")
if collisions:
    print("\n  A ported module sharing a route with the base image needs an insertion")
    print("  (MODULE_PLACEMENT), not an append - Express gives the path to whoever")
    print("  registers it first.")
else:
    print("\n  no ported module shares a route with anything else")

print()
print("=" * 78)
print("3. metas the ported frontends read")
print("=" * 78)
for module in MODULES:
    frontend = f"{OVERLAY}/modules/{module}/frontend"
    if not os.path.isdir(frontend):
        continue
    for key, where in sorted(meta_keys(frontend).items()):
        server_key = key[3:]
        ok = server_key in sent_meta_names or key.lower() in sent_meta_names
        # a couple of names are sent with a different spelling; report, do not fail
        print(f"  {key:36} {'sent' if ok else 'NOT FOUND'}   ({sorted(where)[0].split('/')[-1]})")
        if not ok:
            problems.append(f"{key} is read by {module} but no server file sends it")

print()
print("=" * 78)
print("4. the registry, both directions")
print("=" * 78)
empty_but_consumed = sorted(k for k in consumed if k not in filled)
filled_but_unused = sorted(k for k in filled if k not in consumed)
print(f"  keys the core consumes : {len(consumed)}")
print(f"  keys the rebuild fills : {len(filled)}")
if filled_but_unused:
    print(f"  filled but nothing consumes: {filled_but_unused}")
    problems.append(f"registry keys nothing consumes: {filled_but_unused}")
else:
    print("  every key the rebuild fills is consumed by the core")
print(f"  consumed but left empty by the rebuild: {len(empty_but_consumed)} (the base image's own defaults)")

print()
print("=" * 78)
print(f"RESULT: {len(problems)} problem(s)")
print("=" * 78)
for problem in problems:
    print(f"  - {problem}")
