# create-nodefony

<!-- nf-en:begin — GÉNÉRÉ par scripts/generate/readmes.mjs depuis la description du package.json — ne pas éditer ici. -->

> **create-nodefony** — Create a Nodefony application with one command: `npm create nodefony my-app`. Full scaffold, database of your choice, optional frontend. Part of [Nodefony](https://nodefony.net/), the fullstack Node.js framework with HTTP and WebSocket in one context, binary CBOR realtime, gRPC and MCP for AI agents. [Documentation](https://nodefony.net/docs/demarrer/).

<!-- nf-en:end -->

Créer une application [Nodefony](https://github.com/nodefony/nodefony-core) sans rien installer
globalement.

```bash
npm create nodefony mon-app
```

Puis :

```bash
cd mon-app
npm install
npm run dev
```

Pour créer l'application dans le dossier où l'on se trouve, `.` remplace le nom : l'application
prend le nom du dossier, qui doit être vide, et il n'y a pas de `cd` à faire.

```bash
npm create nodefony .
```

## Ce que fait ce paquet

Rien, ou presque — et c'est voulu. Il **délègue** à `nodefony create app`, le générateur du cœur, en
lui passant vos arguments tels quels. Il n'existe donc qu'UN générateur : celui du framework.

```bash
npm create nodefony mon-app -- --preset minimal --frontend react --database postgres
```

Toutes les options de `nodefony create app` sont acceptées (`--preset`, `--frontend`, `--database`,
`--agents`, `--no-install`, `--no-git`, `--dry-run`…). La liste complète :

```bash
npm create nodefony -- --help
```

## Pourquoi passer par là plutôt que `npm i -g nodefony`

Une installation globale demande une décision — parfois des droits — **avant** d'avoir vu ce que le
framework produit, et elle épingle une version pour toute la machine : deux projets sur deux
versions majeures deviennent incompatibles. `npm create` télécharge ce shim dans un cache jetable,
l'exécute et n'installe rien.

Le paquet `nodefony` dont il dépend est **verrouillé sur la même version** que lui :
`create-nodefony@10.0.0` scaffolde toujours avec le cœur `10.0.0`. Ce téléchargement n'est pas
perdu — l'application générée a besoin de ce même paquet.

## Licence

Apache 2.0 — © Christophe CAMENSULI
