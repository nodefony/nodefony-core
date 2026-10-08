<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/repo/`

Hygiène de l'arbre de travail : verrous, rangement de tmp/, commit sans verrou orphelin.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`long-run-lock.mjs`](long-run-lock.mjs)

Verrou « un run long occupe l'arbre » — seule implémentation, trois lecteurs.

- **Usage** : `node scripts/repo/long-run-lock.mjs check`
- **Usage** : `node scripts/repo/long-run-lock.mjs clear`
- **Appelé par** : `.githooks/pre-commit` · `.claude/hooks/guard-edit.sh` · `repo/tmp-layout.mjs` · `test/test-all.ts`
- **Testé par** : `repo/long-run-lock.test.mjs`
- **Utilise** : `lib/repo-root.mjs`

## [`long-run-lock.test.mjs`](long-run-lock.test.mjs)

Verrou « un run long occupe l'arbre » — tenu, libéré, orphelin, et la CLI qu'appelle le pre-commit. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `repo/long-run-lock.mjs`

## [`safe-commit.sh`](safe-commit.sh)

safe-commit.sh — wrapper de `git commit` qui retire un .git/index.lock orphelin.

- **Usage** : `bash scripts/repo/safe-commit.sh -m "message"`
- **Usage** : `git ci -m "message"  (alias local : git config --local alias.ci "!bash scripts/repo/safe-commit.sh")`
- **Appelé par** : aucun automate

## [`tmp-layout.mjs`](tmp-layout.mjs)

Arborescence de `tmp/` — seule implémentation : la table, les dossiers, le `tmp/README.md`, la purge.

- **Usage** : `node scripts/repo/tmp-layout.mjs`
- **Usage** : `node scripts/repo/tmp-layout.mjs --prune [--dry-run]`
- **Usage** : `node scripts/repo/tmp-layout.mjs --check`
- **Appelé par** : `.claude/skills/nodefony-session/scripts/session-end.mjs`
- **Testé par** : `repo/tmp-layout.test.mjs`
- **Utilise** : `lib/repo-root.mjs` · `repo/long-run-lock.mjs`

## [`tmp-layout.test.mjs`](tmp-layout.test.mjs)

Arborescence de `tmp/` — catégories créées, README régénéré, égarés signalés, purge bornée à l'expiré et jamais au runtime. /

- **Lancé par** : `node.js.yml` · `npm run test:tooling`
- **Utilise** : `repo/tmp-layout.mjs`

## [`turbo.mjs`](turbo.mjs)

Lance turbo pour les scripts du dépôt — et, sous `CI`, lui reprend la main quand il a fini son travail mais ne se termine pas.

- **Usage** : `node scripts/repo/turbo.mjs run build [options turbo…]`
- **Appelé par** : `npm run build` · `npm run build:force` · `npm run build:packages` · `npm run clean` · `npm run test` · `npm run test:boot` · `npm run test:cluster` · `npm run test:integration` · `npm run test:load` · `npm run test:memory` · `npm run typecheck`
- **Testé par** : `repo/turbo.test.mjs`

## [`turbo.test.mjs`](turbo.test.mjs)

Le lanceur turbo rend la main quand turbo a affiché son bilan mais ne se termine pas (#479) — avec le code que le bilan annonce — et ne tue jamais un turbo qui n'a pas encore fini.

- **Variable** `GREEN`
- **Variable** `HANG`
- **Variable** `LOG`
- **Variable** `RED`
- **Lancé par** : `npm run test:tooling`
- **Utilise** : `repo/turbo.mjs`
