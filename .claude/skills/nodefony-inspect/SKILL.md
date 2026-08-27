---
name: nodefony-inspect
metadata:
  version: 1.0.0
description: >
  Interroge le dépôt Nodefony par DEUX voies : le graphe symbolique pour les relations de CODE (qui
  étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), et la
  commande `nodefony inspect` pour l'état RÉEL d'une application qui démarre (routes montées,
  services enregistrés, config effective et provenance de chaque valeur) — mêmes valeurs que la
  console d'administration, sans ouvrir de port, ici comme dans une app. Donne aussi le diff propre.
  Ne crée rien (scaffolder → `nodefony-create-module`).
  Déclencheurs : "qui étend cette classe ?", "qui implémente cette interface ?", "qui utilise ce
  symbole ?", "où est défini X ?", "trouver les consommateurs", "analyse d'impact avant refactor",
  "quels paramètres prend cette méthode ?", "inspecter un module existant", "montre la config de ce
  module", "quelles routes expose ce module", "ce service est-il enregistré ?", "qu'est-ce que j'ai
  modifié ?", "diff rapide", "graphe symbolique", "symbols.json".
---

# nodefony-inspect — interroger le dépôt sans le lire

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`.

Quatre questions, une seule porte : **qu'est-ce que ce symbole**, **comment s'appelle cette
méthode**, **comment ce module est-il câblé**, **qu'ai-je changé**. Toutes se répondent par une
requête indexée ou un `git diff` ciblé — jamais en chargeant des fichiers entiers.

## 1. Quand m'utiliser / quand passer la main

<!-- prettier-ignore -->
| Besoin | Où aller |
| --- | --- |
| Impact d'un refactor, consommateurs d'un symbole, TSDoc, position | **ici** — §3 |
| Ordre des arguments, `static`/`private`, décorateurs d'une méthode | **ici** — §4 |
| Config, services injectés, routes d'un module **existant** | **ici** — §5 |
| Ce que j'ai modifié, modules impactés avant build/test | **ici** — §6 |
| Comprendre **ce que fait** une fonction | lire son corps — l'index ne porte pas le code |
| Créer un module / un service | `nodefony-create-module` |
| Comprendre une architecture ou une API du cœur | `nodefony-framework-dev` |
| État d'avancement d'une phase | `nodefony-migration-audit` |
| Revue de sécurité du diff | `nodefony-security-review` |

**Le gain** : `cat src/.../HttpContext.ts` coûte ~4 000 tokens ; la requête `jq` équivalente en coûte
~50. Lire un service complet pour savoir comment il est _enregistré_ coûte dix fois la lecture des
trente lignes de son `config.ts`. Et un `git diff` nu ramène le compilé, les verrous et le graphe
régénéré — des centaines de lignes qui n'apprennent rien.

## 2. Les deux graphes — ne pas se tromper de fichier

`npm run generate-symbols` (`scripts/generate-symbols.ts`, parse via **ts-morph**) écrit **deux**
fichiers de nature différente. Poser une question au mauvais conduit à conclure « absent » sur un
symbole qui existe :

| Fichier             | Suivi     | Contenu                                                                               |
| ------------------- | --------- | ------------------------------------------------------------------------------------- |
| `.ai/symbols.json`  | committé  | **Stable** — symboles exportés, map indexée + relations inversées. Réponses en O(1).  |
| `dist/symbols.json` | non suivi | **Verbose** — tout le reste : `methods`, `properties`, `signature`, imports détaillés |

> Les **relations** (§3) vivent dans le fichier stable ; les **signatures de méthodes** (§4) n'existent
> que dans le verbose. Le verbose n'est pas versionné : après un `git clone` frais il faut le
> régénérer.

**Générer** — le hook de pré-commit (`.githooks/pre-commit`) le fait dès qu'un `.ts` de la zone parsée
est indexé ; à la main quand on veut voir l'effet d'un refactor sans commiter :

```bash
npm run generate-symbols
```

La zone parsée est définie **uniquement** dans `scripts/generate-symbols.config.ts`. Les fichiers de
plus de 500 Ko sont ignorés, `dist/` aussi, et une erreur sur un fichier n'interrompt pas le reste.

**Format** (v2.0) — une map indexée par nom, plus quatre index inversés pré-calculés :

```jsonc
{
  "version": "2.0.0",
  "stats": { "files": 1040, "symbols": 2834, "classes": 330, "interfaces": 741, ... },
  "symbols": {
    "Container": {
      "kind": "class",            // class | interface | type | enum | function | const | decorator-fn
      "file": "src/nodefony/src/Container.ts",
      "exported": true,
      "module": "@nodefony/core",
      "extends": null,
      "implements": ["IContainer"],
      "decorators": [],
      "description": "…"         // première phrase de la TSDoc, si présente
      // verbose seulement : methods, properties, members, signature
    }
  },
  "relations": {
    "extendedBy":    { "Service":    ["Cli", "Kernel", "Module", …] },
    "implementedBy": { "IContainer": ["Container", "Scope"] },
    "decoratedBy":   { "injectable": ["Router", "HttpKernel", …] },
    "usedBy":        { "Container":  ["src/nodefony/src/Service.ts", …] }
  }
}
```

## 3. Interroger le graphe — recherche en O(1)

```bash
jq '.symbols.Container' .ai/symbols.json                       # définition (kind, file, module, TSDoc)
jq '.relations.extendedBy.Service' .ai/symbols.json            # qui étend cette classe
jq '.relations.implementedBy.IContainer' .ai/symbols.json      # qui implémente cette interface
jq '.relations.usedBy.Container' .ai/symbols.json              # analyse d'impact : qui l'importe
jq '.relations.decoratedBy.injectable' .ai/symbols.json        # qui porte ce décorateur
jq '.symbols.Container | {kind, description, implements, file}' .ai/symbols.json   # fiche courte
jq '.symbols | keys' .ai/symbols.json                          # tous les noms connus
```

Tous les symboles exportés par un module :

```bash
jq '.symbols | to_entries | map(select(.value.module == "@nodefony/http" and .value.exported))
    | map(.key) | sort' .ai/symbols.json
```

## 4. Signature d'une méthode (graphe **verbose**)

```bash
jq '.symbols.HttpContext.methods | map(.name)' dist/symbols.json                    # inventaire
jq '.symbols.HttpContext.methods[] | select(.name == "render")' dist/symbols.json   # une méthode
jq '.symbols.Container.properties[] | select(.visibility == "public")' dist/symbols.json
jq '.symbols.injectable.signature' dist/symbols.json                                # fonction / décorateur
```

Une méthode retourne `name`, `static`, `visibility`, `decorators`, et `description` **si** elle porte
une TSDoc. Les routes d'un controller se lisent par leurs décorateurs :

```bash
jq '.symbols.DefaultController.methods[] | select(.decorators | length > 0) | {name, decorators}' \
  dist/symbols.json
```

**Absente de l'index** (méthode privée, classe anonyme, `Object.assign(this, …)`) : ne pas ouvrir le
fichier entier — le localiser puis n'en extraire que la fenêtre utile.

```bash
grep -n "methodName" src/path/to/File.ts
sed -n '120,135p' src/path/to/File.ts
```

## 5. Comment un module est câblé (config, services, routes)

> ⚠️ **Deux voies répondent à cette question — et elles ne disent pas la même chose.** Ce qui suit
> lit les SOURCES ; la commande `nodefony inspect` (§5bis) lit l'application RÉELLE. Pour « quelles
> routes existent », « quelle config s'applique vraiment », « quels services sont enregistrés », la
> commande est plus fiable : une route dépend de décorateurs, d'un manifeste et d'un ordre de
> chargement, et la config effective est un empilement de défauts, de `use()` et de variables
> d'environnement. Les sources ci-dessous restent la bonne voie quand l'application **ne boote pas**,
> ou quand la question porte sur la structure d'un fichier plutôt que sur l'état obtenu.

Un module Nodefony expose sa structure dans `nodefony/config/` — les métadonnées, pas le métier.

```bash
ls src/packages/@nodefony/<name>/nodefony/config/   # package du framework
ls src/modules/<name>/nodefony/config/              # module applicatif
```

| Fichier                 | Ce qu'il porte                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `config.ts`             | le **QUOI** — schéma Zod, source unique des défauts du module        |
| `defineModuleConfig.ts` | le **COMMENT** — builder pur, sans effet de bord                     |
| `services.ts`           | déclarations pour le conteneur d'injection (quand le module en a un) |
| `routing.ts`            | routes déclarées (quand le module en expose)                         |

Tous les schémas de config du dépôt, d'un coup :

```bash
find src -type f -name "config.ts" -path "*/nodefony/config/*"
```

> **La config de l'APPLICATION ne vit pas là** : c'est `nodefony.config.ts` (descripteur
> `defineConfig`, manifeste `modules` via `use()`) et `env.ts` (catalogue `defineEnv`, seul lecteur
> de `process.env`), tous deux à la racine. Les défauts du framework vivent dans le cœur
> (`src/nodefony/src/config/defaults.ts`).
>
> ⚠️ Un `config.ts` de module ne doit **jamais** déréférencer le kernel à l'import (§ `CLAUDE.md`) —
> si l'inspection d'un module fait tomber quelque chose, c'est ce bug-là.

## 5bis. Demander à l'application — `nodefony inspect` (état RÉEL)

**Marche dans CE dépôt** : la racine est une application Nodefony (dualité self-hosted), donc tout
ce qui suit s'exécute ici comme dans une app d'utilisateur.

```bash
npx nodefony inspect routes --json     # toutes les routes montées (chemin, méthodes, controller, module)
npx nodefony inspect services --json   # services enregistrés + le module qui les porte
npx nodefony inspect config --json     # config EFFECTIVE par module (+ schéma, + provenance par champ)
npx nodefony inspect module http       # un module en détail (config, services, dépendances)
npx nodefony inspect stores --json     # où sont réellement écrites les données
npx nodefony inspect entities --json   # entités déclarées à l'ORM
npx nodefony inspect graph --json      # graphe des entités et de leurs relations
```

Ce que ça coûte et ce que ça garantit :

- **Un boot console, aucun port ouvert** — le profil console est respecté, donc la commande
  cohabite avec un serveur de développement déjà lancé.
- **Les MÊMES valeurs que la console d'administration** : la commande appelle les producteurs du
  plan d'administration, elle ne recalcule rien. Une divergence entre les deux portes est donc
  impossible par construction — y compris la redaction des secrets, qui vit dans les producteurs.
- **`--json` est un flux pur**, `| jq` fonctionne (le journal de boot est mis en sourdine, les
  erreurs partent sur la sortie d'erreur).

Quelques questions fréquentes, et la voie la plus courte :

| Question                                                         | Voie                                   |
| ---------------------------------------------------------------- | -------------------------------------- |
| « cette route existe-t-elle vraiment, et sur quel controller ? » | `inspect routes`                       |
| « ce service est-il enregistré, et par quel module ? »           | `inspect services`                     |
| « quelle valeur de config s'applique, et d'où vient-elle ? »     | `inspect config` (porte la provenance) |
| « qui étend / implémente / importe ce symbole ? »                | le graphe symbolique (§3)              |
| « quelle est la signature de cette méthode ? »                   | le graphe verbose (§4)                 |
| « l'app ne boote pas, je dois quand même comprendre »            | les sources (§5)                       |

> **Deux verbes, deux moments** : `nodefony check` est le diagnostic STATIQUE (il marche sur une
> application cassée), `nodefony inspect` interroge une application qui démarre. Si `inspect`
> échoue, la question suivante est pour `check`.

## 6. Diff propre — ce que j'ai changé

Un `git diff` nu ramène `dist/`, les verrous et `.ai/symbols.json` régénéré. Cibler :

```bash
git diff --stat src/                                   # vue synthétique
git diff -w src/                                       # sources, sans les blancs
git diff -w HEAD src/                                  # indexé + non indexé
git diff --stat src/ docs/ .claude/                    # quand la session touche aussi la doc
git diff -w -- src/ ':!**/dist/**' ':!**/node_modules/**'
```

Modules workspace impactés (utile avant un build ciblé ou un redémarrage) :

```bash
git diff --name-only HEAD src/ | awk -F'/' '{
  if ($2 == "packages" && $3 == "@nodefony") print "@nodefony/" $4;
  else if ($2 == "modules") print "modules/" $3;
  else if ($2 == "nodefony") print "@nodefony/core";
}' | sort -u
```

Un fichier précis → `git diff src/path/to/file.ts` · deux branches → `git diff main...HEAD -- src/` ·
un commit ancien → `git show <sha> -- src/`.

## 7. Limites — ce que l'index ne sait pas

- **Homonymes** : deux symboles du même nom dans deux modules → le premier garde le nom court, les
  suivants sont sous `"Module:Name"`. Lever l'ambiguïté en lisant `.module`. `usedBy` regroupe par
  nom simple : les usages des deux tombent dans le même seau.
- **Génériques strippés** : `extends BaseService<T>` est indexé sous `extendedBy.BaseService`.
  L'inférence est **syntaxique**, pas sémantique — un type résolu par le compilateur n'y est pas.
- **Pas de détection de cycles** : croiser `relations.usedBy` et les `imports` du verbose à la main.
- **Rien du runtime** : valeurs effectives, état des sessions, config après fusion des
  environnements. Pour ça, il faut le serveur (`nodefony-start-server`) ou le data plane admin.
- **Le verbose est absent d'un clone frais** — le générer avant de conclure qu'une méthode manque.

## 8. Pièges

- **Chercher une signature dans `.ai/symbols.json`** : le fichier stable ne porte pas `methods`. La
  requête renvoie `null`, ce qui ressemble à « la méthode n'existe pas ».
- **Vérifier une ancre au mauvais chemin conclut faux** : `dist/symbols.json` vit à la **racine** du
  dépôt, pas sous `src/nodefony/`.
- **`rg` ignore les dossiers cachés** : une recherche de renvois qui oublie `--hidden` ne voit rien
  sous `.claude/` et conclut « aucun consommateur » sur un fichier pourtant cité dix fois.
- **Un index périmé ment sans le dire** : après un gros refactor non commité, régénérer avant de
  raisonner sur `usedBy`.

## 9. Liens

- `scripts/generate-symbols.ts` + `scripts/generate-symbols.config.ts` — le générateur et sa zone.
- `CLAUDE.md` (racine) — la règle « interroger l'index avant de parcourir le dépôt ».
- `nodefony-framework-dev` — comprendre l'architecture derrière les symboles trouvés ici.
