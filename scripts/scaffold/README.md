<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/scaffold/`

Contrôles et mise en forme des gabarits d'application.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`check-scaffold-format.mjs`](check-scaffold-format.mjs)

Le code que `nodefony create` PRODUIT est-il accepté par le formateur que ce même code embarque ?

- **Usage** : `npm run format:scaffold`
- **Usage** : `node scripts/scaffold/check-scaffold-format.mjs --keep`
- **Appelé par** : `npm run format:scaffold` · `.githooks/pre-commit`
- **Utilise** : `lib/repo-root.mjs`

## [`check-scaffold-frontends.mjs`](check-scaffold-frontends.mjs)

Le front que `nodefony create app --frontend <fw>` PRODUIT passe-t-il les contrôles statiques que l'application générée exige d'elle-même ?

- **Usage** : `node scripts/scaffold/check-scaffold-frontends.mjs [react vue angular svelte] [--keep]`
- **Appelé par** : `scaffold.yml`
- **Utilise** : `lib/repo-root.mjs`

## [`format-templates.mjs`](format-templates.mjs)

Formate les gabarits de scaffold **sans casser leurs balises eta**.

- **Usage** : `npm run format:templates`
- **Usage** : `npm run format:templates -- --check`
- **Variable** `CHECK`
- **Appelé par** : `npm run format:templates`
- **Utilise** : `lib/repo-root.mjs`
