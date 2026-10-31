<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/deps/shims/deepmerge/`

Remplaçant interne de `deepmerge` (aucune version amont saine, GHSA-gcqx-w48m-w2h4), branché par les `overrides` de la racine. À retirer quand `npm run deps:gate` signale une version amont au-dessus de sa base.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../../README.md).

## [`index.d.ts`](index.d.ts)

Types de deepmerge 4.3.1, inchangés — le shim ne modifie que le comportement (garde contre la pollution de prototype, voir `index.js`).

- **Usage** : `import deepmerge from "deepmerge"  // résolu vers ce shim par les overrides de la racine`
- **Appelé par** : `release/fix-dts-extensions.mjs` · `.claude/skills/nodefony-release/scripts/compare-dts-exports.mjs`
- **Testé par** : `release/dts-deps.test.mjs` · `release/release-core.test.mjs` · `release/tarball-types.test.mjs` · `site/api-reference.test.mjs` · `.claude/skills/nodefony-identifiers/scripts/check-identifier-language.test.mjs`

## [`index.js`](index.js)

deepmerge 4.3.1 (MIT, Josh Duff — `license.txt`), à l'identique, plus UNE garde : les clés `__proto__`, `constructor` et `prototype` ne sont jamais écrites dans l'objet rendu.

- **Usage** : `"overrides": { "deepmerge": "$deepmerge" }  // package.json racine, avec devDependencies.deepmerge = "file:scripts/deps/shims/deepmerge"`
- **Appelé par** : `pages.yml` · `scaffold.yml` · `generate/generate-man.mjs` · `release/dts-deps.mjs` · `release/fix-dts-extensions.mjs` · `release/image-gate.mjs` · `release/release.mjs` · `site/build-docs-site.mjs` · `.claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.selftest.mjs` · `.claude/skills/nodefony-devkit-bench/scripts/lib/gate-porte-client.selftest.mjs` · `.claude/skills/nodefony-devkit-bench/scripts/lib/identites.selftest.mjs` · `.claude/skills/nodefony-load-test/scripts/micro/micro-cbor-codec.mjs` · `.claude/skills/nodefony-load-test/scripts/micro/micro-frame-authorizer.mjs` · `.claude/skills/nodefony-load-test/scripts/micro/micro-orm-hot-path-ab.mjs` · `.claude/skills/nodefony-load-test/scripts/micro/micro-realtime-frame-ab.mjs` · `.claude/skills/nodefony-session/scripts/session-resume.mjs`
- **Testé par** : `deps/shims/deepmerge/index.test.mjs` · `gates/check-externals.test.mjs` · `release/dts-deps.test.mjs` · `release/image-gate.test.mjs` · `release/readme-gate.test.mjs` · `release/release-core.test.mjs` · `site/api-reference.test.mjs`

## [`index.test.mjs`](index.test.mjs)

Le shim de deepmerge (overrides de la racine) : la pollution de prototype de GHSA-gcqx-w48m-w2h4 est refusée — vue ROUGE sur deepmerge 4.3.1 (cibles `Object.create(null)` et primitive : `polluted === true`) — et le comportement d'origine est conservé, celui dont dépend le plugin Svelte. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `deps/shims/deepmerge/index.js`
