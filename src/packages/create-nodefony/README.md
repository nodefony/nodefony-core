# create-nodefony

Créer une application [Nodefony](https://github.com/nodefony/nodefony-core) sans rien installer
globalement.

```bash
npm create nodefony@latest mon-app
```

Puis :

```bash
cd mon-app
npm install
npm run dev
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

CeCILL-B — © Christophe CAMENSULI
