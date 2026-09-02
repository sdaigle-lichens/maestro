# Plugin entries

`apps/maestro/src/core/plugin-entries/<name>.ts` is a thin re-export that names exactly what the
plugin's scripts need from `src/core`. Nine exist; each maps 1:1 to a `.cjs` in
`plugins/maestro/scripts/lib/`, and the list is hard-coded in `build-plugin-libs.mjs`.

The constraint an entry inherits: everything it pulls in must run under bare `node` with no
`node_modules` and no Electron. Node built-ins are kept external by the build (`node:fs`,
`node:path`, `node:os`, `node:sqlite`, and their bare aliases); anything else it imports gets
inlined into the bundle. Reaching into a module that touches Electron, the Agent SDK, or a
third-party dependency is how an entry stops being buildable — or worse, builds and fails at
hook time in a project that has no dependencies installed.

Adding an entry means adding it to the `entries` array in `build-plugin-libs.mjs` as well as
creating the file.
