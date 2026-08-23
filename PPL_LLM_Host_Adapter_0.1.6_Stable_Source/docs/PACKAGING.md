# Packaging

PPL Profiles packages are not assumed to exist in a public npm registry.

Therefore the Stable release has two supported forms:

1. **Source Kit** — `package.json` points to the four shipped `vendor/npm/*.tgz` files. Run `npm install --offline`.
2. **Bundled npm tarball** — build/release staging rewrites dependencies to `0.2.0` and uses `bundledDependencies`, embedding the four Profile packages under the npm artifact's `node_modules`.

Do not publish an npm tarball that still contains `file:vendor/npm/...` dependency specs. The Stable packaging gate explicitly tests an isolated install of the bundled artifact.
