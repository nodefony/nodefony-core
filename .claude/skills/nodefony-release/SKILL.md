---
name: nodefony-release
metadata:
  version: 1.0.0
description: >
  Préparer et éprouver une publication npm de Nodefony (modèle N-paquets verrouillés sur la même
  version). Porte la chaîne complète : empaquetage des workspaces publiables avec bascule des
  `exports.types` au pack, post-traitement des `.d.ts` pour la résolution ESM de Node, puis smoke
  test en conteneur — installation VIERGE des tarballs, compilation d'une application témoin et
  preuve de l'arrêt gracieux. À charger AVANT de publier ou de toucher à la surface publiée : ce
  qu'un dépôt voit de lui-même n'est pas ce qu'un installeur reçoit, et seul le décor jetable le
  montre. Le plan de version et l'état d'avancement vivent dans `docs/release/nodefony-10.md`.
  Déclencheurs : "publier sur npm", "faire une release", "préparer la publication", "packager les
  paquets", "smoke test release", "tester l'installation depuis les tarballs", "est-ce que le
  paquet publié marche ?", "surface npm", "types publiés", "tarball", "avant de publier".
---

# nodefony-release — prouver ce qu'un installeur recevra

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, l'avancement dans `MIGRATION_STATUS.md` et `docs/release/nodefony-10.md`.

Le dépôt ne voit pas sa propre surface publiée. Les paquets du cœur pointent leurs types vers la
**source** (`exports["."].types → ./index.ts`) pour éviter une course au build ; cette source est
absente du tarball. Tant qu'on ne dépaquette pas, tout va bien — et rien ne marche chez celui qui
installe. C'est pourquoi cette chaîne existe : elle fabrique le tarball, l'installe **à neuf**, et
compile une application témoin contre lui.

## 1. Quand m'utiliser / quand passer la main

| Besoin                                                   | Où                            |
| -------------------------------------------------------- | ----------------------------- |
| Empaqueter, éprouver l'installation, publier             | **ce skill**                  |
| Savoir QUOI publier et dans quel ordre (plan de version) | `docs/release/nodefony-10.md` |
| Dérive `external` du bundler ↔ `peerDependencies`        | `nodefony-check-externals`    |
| Créer ou restructurer un paquet                          | `nodefony-create-module`      |
| Mesurer la performance de ce qui est publié              | `nodefony-load-test`          |

## 2. La chaîne, dans l'ordre

```bash
# Tout d'un coup : pack → app témoin → conteneur → install vierge → tsc → arrêt gracieux
bash .claude/skills/nodefony-release/scripts/smoke-docker.sh

# Ou étape par étape
node .claude/skills/nodefony-release/scripts/pack-all.mjs            # les tarballs
node .claude/skills/nodefony-release/scripts/fix-dts-extensions.mjs <dir>   # appelé par le pack
```

`pack-all.mjs` empaquette chaque workspace non privé, **bascule temporairement** les
`exports["."].types` qui pointent la source vers le `.d.ts` généré, puis restaure le
`package.json`. `fix-dts-extensions.mjs` extensionne les specifiers relatifs des déclarations
(`node16`/`nodenext` l'exige) — il est appelé **depuis** le pack, pas à la main en temps normal.
`smoke-docker.sh` enchaîne le tout et prouve dans un conteneur ce qu'aucun test du dépôt ne peut
prouver : une installation qui n'a jamais vu le dépôt.

## 3. Pièges

- **Ce que le dépôt exerce n'est jamais ce qui casse.** Six paquets ont publié pendant des semaines
  un `exports.types` vers un fichier absent du tarball : invisible ici, cassé pour tout installeur.
  La vérification, c'est `npm pack` puis lire le manifeste **dépaqueté** — jamais le `package.json`
  du dépôt.
- **`publishConfig.exports` n'est pas appliqué par npm** (c'est pnpm/yarn). Testé avant d'être
  proposé : le manifeste dépaqueté gardait le chemin source.
- **Un import non déclaré ne casse rien ici et deux choses ailleurs** : le graphe de build perd son
  ordre, et l'installeur n'a pas la dépendance. Auditer les imports de **valeur**, pas seulement de
  types.
- **Un contournement documenté peut cacher une contrainte réelle** — vérifier avant de le retirer.
  Le `exports.types` vers la source ressemble à une paresse ; c'est l'anti-course de build.

## 4. Gate

Le smoke test **est** le gate : il échoue si l'installation vierge ne compile pas. Avant de le
lancer, `nodefony-check-externals` pour la dérive des dépendances déclarées.
