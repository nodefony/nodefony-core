---
title: "TypeScript 7, décorateurs et DI — audit de trajectoire"
module: "transverse"
status: "AUDIT — veille + POC vérifiés ; aucun code de migration écrit"
audience: "framework authors"
---

# TypeScript 7, décorateurs et DI — audit de trajectoire

> **Nature du document** : constat vérifié au code + POC reproductibles + trajectoire proposée.
> Aucune modification de `tsconfig.json` ni de `rollup.config.ts` n'a été faite (accord requis).
> Tout ce qui est affirmé ici a été soit exécuté localement, soit sourcé sur une publication officielle.

## 1. Résumé

TypeScript 7.0 (port Go, « Corsa ») est GA depuis le **8 juillet 2026**. Il ne publie **plus l'API
JavaScript** du compilateur. Cela casse tout outil qui appelle `ts.createProgram` / `ts.sys` — dont
`@rollup/plugin-typescript`, sur lequel repose la totalité de notre chaîne de build.

Deux idées reçues, toutes deux **fausses**, sont écartées par les POC ci-dessous :

1. « TS 7 ne supporte pas nos décorateurs. » → **Faux.** tsgo émet correctement `__decorate` et
   `__metadata("design:paramtypes", …)`.
2. « Il faut donc rester sur TS 6 et attendre. » → **Faux aussi.** Le build est réparable dès
   aujourd'hui en découplant transformation et génération de types, et le typecheck peut passer sur
   TS 7 **immédiatement** : mesuré ×6 à ×8, zéro erreur, sans toucher un seul `tsconfig` (§7 palier 1).

Le vrai sujet de fond n'est pas TS 7. C'est que notre DI repose sur `design:paramtypes`, une
émission de types propre aux **décorateurs legacy**, absente du standard TC39 et sans chemin de
remplacement. C'est une dette **stratégique** (pas de futur), pas encore **opérationnelle** (ça marche).

## 2. Ce que TS 7 change — faits vérifiés

`typescript@7.0.2` : `main: null`, `types: null`, pas de `lib/typescript.js`. L'export `"."` pointe
`lib/version.cjs`. Vérifié localement :

```
import ts from "typescript"   →   { version, versionMajorMinor }
ts.createProgram              →   undefined
```

La nouvelle API vit sous `typescript/unstable/{ast,fs,proto,sync,async}`, explicitement instable.
Microsoft (annonce GA) : _« it does not ship with an API. We expect TypeScript 7.1 to ship with a new
(and different) API »_ — **sans calendrier**. L'API historique (« Strada ») ne sera pas portée.

Doctrine officielle = **cohabitation** : le paquet `@typescript/typescript6` (binaire `tsc6`) est
publié exprès pour installer TS 6 et TS 7 côte à côte.

Breaking changes de config relevés (le seul qui nous frappe est le premier) :

| Option             | TS 7                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`          | Défaut `./` → **erreur `TS5011`** à l'émission si sources en sous-dossier. **13 tsconfig** concernés chez nous. N'affecte **pas** `--noEmit` (vérifié). |
| `types`            | Défaut `[]` (plus d'auto-découverte des `@types`)                                                                                                       |
| `strict`           | `true` par défaut                                                                                                                                       |
| `target`           | Défaut ≈ `es2025` ; `es5` supprimé                                                                                                                      |
| `module`           | Défaut `esnext` ; `amd`/`umd`/`system` supprimés                                                                                                        |
| `baseUrl`          | Supprimé                                                                                                                                                |
| `moduleResolution` | `node`/`node10` retirés                                                                                                                                 |

Gain annoncé et mesuré par Microsoft : **~10×** sur le typecheck (VS Code 125,7 s → 10,6 s).

## 3. État de l'écosystème — aucun ETA nulle part

| Outil                       | Statut TS 7          | Position officielle                                                           |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| `typescript-eslint`         | ❌ peer `<6.1.0`     | Issue fermée `not planned` : « nothing we can do until TS 7 provides an API » |
| `typedoc`                   | ❌ peer `\|\| 6.0.x` | Issue #3098 ouverte : « There is no timeline »                                |
| `@rollup/plugin-typescript` | ❌ cassé             | 9 mois sans release ; zéro mention de TS 7 au CHANGELOG                       |
| `ts-node`                   | ❌ cassé             | semi-abandonné                                                                |
| `tsx`, `vitest` (runtime)   | ✅ immunisés         | transforment via esbuild/oxc, ne touchent jamais l'API TS                     |

Règle générale : **qui transforme via esbuild/swc/oxc est immunisé ; qui appelle l'API compilateur est
bloqué** jusqu'à TS 7.1.

## 4. Ce qui NE casse pas — POC vérifiés localement

**POC 1 — tsgo compile nos décorateurs.** `tsc` de TS 7.0.2, `experimentalDecorators` +
`emitDecoratorMetadata` :

```js
AutoA = __decorate(
  [injectable(), __metadata("design:paramtypes", [Container])],
  AutoA,
);
```

**POC 2 — tsgo génère les `.d.ts`.** `tsc --emitDeclarationOnly --declaration` produit les
déclarations attendues.

**POC 3 — Rollup + oxc conserve `preserveModules` ET la metadata.** Avec `unplugin-oxc` configuré
`decorator: { legacy: true, emitDecoratorMetadata: true }`, sortie sur 3 modules distincts et :

```js
AutoA = _decorate(
  [injectable(), _decorateMetadata("design:paramtypes", [Container])],
  AutoA,
);
```

Coût : les helpers deviennent des imports `@oxc-project/runtime/helpers/*` — à déclarer en
`dependencies`, exactement comme la règle `tslib` existante.

**Contre-indication ferme : `esbuild` est hors jeu.** Il refuse `emitDecoratorMetadata` par doctrine
(issue #257 close depuis 2020) et **ignore l'option silencieusement**. Seuls **oxc** et **swc**
conviennent.

## 5. Le fond du sujet — les décorateurs legacy sont une branche morte

Deux systèmes portent la même syntaxe `@truc` :

- **Legacy** (`experimentalDecorators: true`, le nôtre) : autorise les **décorateurs de paramètres**
  et sait **émettre les types** (`design:paramtypes`).
- **Standard TC39** (stage 2.7) : signature `(value, context)`. **Pas de décorateurs de paramètres**
  (exclus par le proposal). **Pas d'émission de types** — `Symbol.metadata` ne contient que ce qu'un
  décorateur y écrit à la main.

Conséquences pour nous, ancrées au code :

- `inject()` est un `ParameterDecorator` (`src/nodefony/src/kernel/decorators/kernelDecorator.ts:96`),
  utilisé en constructeur (ex. `server-http.ts:41`). **Inexprimable** en décorateurs standard.
- `reflect-metadata` est importé dans **39 fichiers** source.
- L'injector lit `design:paramtypes` en **priorité 2**, après le token explicite `inject:services`
  (`src/nodefony/src/kernel/injector/injector.ts:173-175`).

Microsoft n'a **pas** déprécié `experimentalDecorators` (« foreseeable future », TS 5.0) et n'a rien
annoncé pour TS 7 (discussion `typescript-go#741` sans réponse). Mais **Angular** a migré vers
`inject()` en documentant explicitement le motif : _« Constructor parameter decorators … will be
unsupported once the `experimentalDecorators` option is removed. »_ NestJS, lui, reste sur le legacy
faute de plan.

Autre verrou, indépendant de TS : Node ne lit **aucune** syntaxe décorateur nativement (le
type-stripping natif via Amaro lève une erreur de parser). Tant que la DI dépend de
`design:paramtypes`, l'exécution TS sans build est hors d'atteinte.

**Bonne nouvelle : Nodefony est déjà à moitié sorti du piège.** Nos appels sont
`@inject("HttpKernel")` — un **token explicite**, le chemin de migration recommandé. `design:paramtypes`
n'est qu'un **fallback**. Et un `@Inject` `PropertyDecorator` existe déjà (`kernelDecorator.ts:125`) ;
les décorateurs de propriété, eux, **existent dans le standard**.

## 6. Trajectoire proposée — trois paliers indépendants

**Palier 1 — `tsgo` en typecheck, sans rien casser (faisable immédiatement, réversible).**
Installer TS 7 en alias à côté de TS 6, et faire pointer un script `typecheck` sur `tsgo --noEmit`.
Vérifié : `--noEmit` **n'exige pas** `rootDir`, donc aucun des 13 tsconfig n'est touché. Build, lint et
doc restent sur TS 6. Risque : nul (aucune émission).

**Mesuré sur notre code**, `tsc --noEmit` sur le tsconfig existant, sans aucune modification :

| Workspace             |  TS 6.0.3 | TS 7.0.2 (tsgo) |     Gain | Erreurs |
| --------------------- | --------: | --------------: | -------: | ------- |
| `nodefony` (core)     | 11 207 ms |        1 881 ms | **×6,0** | 0 → 0   |
| `@nodefony/http`      |  5 999 ms |          748 ms | **×8,0** | 0 → 0   |
| `@nodefony/framework` |  5 986 ms |          725 ms | **×8,2** | 0 → 0   |
| `@nodefony/security`  |  6 167 ms |        1 028 ms | **×6,0** | 0 → 0   |

Enseignement majeur : **zéro erreur de typage sous TS 7**, avec les tsconfig actuels. Le code source de
Nodefony est déjà TS 7-compatible ; seul l'**outillage** bloque.

**Palier 2 — découpler transformation et types (chantier build).**
Remplacer `@rollup/plugin-typescript` par **rolldown** (transformation TS native via oxc — cf §6 bis pour
l'arbitrage rolldown vs Rollup+`unplugin-oxc`) + `tsgo --emitDeclarationOnly` (déclarations). Supprime la
dépendance du **build** à l'API JS. Touche `rollup.config.ts` et `tsconfig.json` → **accord explicite
requis**. Reste bloqué sur TS 6 : `typescript-eslint` et `typedoc`.

**Vérifié sur le core** — `tsgo --declaration --emitDeclarationOnly --rootDir ./src` :

|                         | `@rollup/plugin-typescript` (actuel) | `tsgo --emitDeclarationOnly`             |
| ----------------------- | ------------------------------------ | ---------------------------------------- |
| Fichiers `.d.ts`        | 135                                  | 136 (+`client/medias/audioApi.d.ts`)     |
| Exports de `index.d.ts` | 131                                  | **131 — identiques**                     |
| Arborescence            | —                                    | **identique** (avec `rootDir` explicite) |
| Durée                   | (dans le build Rollup)               | **2 842 ms**                             |
| Annotations à ajouter   | 0                                    | **0**                                    |

Seule friction : `TS6059` sur `rollup.config.ts`, hors `rootDir` — à exclure via le
`tsconfig.declarations.json` qui existe déjà.

**`isolatedDeclarations` n'est PAS requis** par ce palier — c'est le point clé. `tsgo` dispose du
vérificateur de types complet et infère les déclarations. Chiffré pour mémoire, au cas où l'on
voudrait un jour générer les `.d.ts` _par le bundler_ : il faudrait **≈ 277 annotations explicites**
(security 149, core 88, realtime 21, drizzle 16, orm-core 3 — `http`, `framework` et `user` sont
déjà à 0).

**Palier 3 — sortir de `design:paramtypes` (chantier architecture, le vrai « framework du futur »).**
Rendre le token explicite **obligatoire** et retirer le fallback `design:paramtypes` de l'injector.
Migrer les `@inject(...)` de paramètre vers `@Inject(...)` de propriété (déjà présent) ou une fonction
`inject()` façon Angular. Alors, et seulement alors, on peut abandonner `emitDecoratorMetadata`,
`reflect-metadata`, et viser les décorateurs standard — ce qui rouvre esbuild, le strip natif Node, et
supprime une classe entière de bugs silencieux (un type effacé par `import type` dégrade
`design:paramtypes` en `Object`, **sans erreur**).

## 6 bis. Rollup ou rolldown pour le palier 2 ? — **rolldown**, et AVANT la release

> ⚠️ Cette section corrige une première rédaction qui recommandait « Rollup + `unplugin-oxc`, rolldown
> plus tard ». Les POC ci-dessous l'ont invalidée. Le raisonnement initial était incohérent : il
> proposait `unplugin-oxc` (**0.6.1**, pré-1.0) pour éviter rolldown (**1.1.5**, stable).

**Ce qu'est rolldown** : le bundler Rollup réécrit en **Rust** (binaire natif ~16 Mo via napi-rs),
bâti sur **oxc**, avec une API compatible Rollup. Développé par VoidZero (Evan You) ; **Vite 8 l'utilise
déjà par défaut**.

> 🚫 **Rollup n'est PAS déprécié.** `rollup@4.62.2` est sorti le 2026-06-19, aucun champ `deprecated`,
> cadence soutenue. **Ce qui est mort, c'est `@rollup/plugin-typescript`** (9 mois sans release, cassé
> par TS 7) — pas le bundler. On ne migre donc pas « par peur que Rollup meure », et surtout pas
> « quel qu'en soit le coût » : on migre pour **sortir du plugin**, qui est le seul lien à l'API JS de
> TypeScript.
>
> **Corollaire** : si le coût de rolldown explose sur un cas dur (bundle `bin`, client isomorphe),
> le repli est **Rollup + `unplugin-oxc`** — il atteint le même objectif (plus de plugin TS) en gardant
> le bundler. L'objectif est le plugin ; le bundler est un moyen.

**Il est plus simple que Rollup + oxc, pas plus risqué** :

|                    | Rollup + `unplugin-oxc`                                       | rolldown                       |
| ------------------ | ------------------------------------------------------------- | ------------------------------ |
| Version            | 4.x + plugin **0.6.1** (pré-1.0)                              | **1.1.5 stable**               |
| Transformation TS  | via plugin                                                    | **native** (oxc intégré)       |
| Décorateurs legacy | option `decorator` à passer                                   | **lus depuis `tsconfig.json`** |
| Helpers            | imports `@oxc-project/runtime/*` → **dep runtime à déclarer** | **bundlés** (`_virtual/`)      |

**POC sur un vrai module (`@nodefony/orm-core`, `preserveModules` + `external`)** :

|                                 |       Rollup (actuel) |                 rolldown |
| ------------------------------- | --------------------: | -----------------------: |
| Fichiers `.js`                  |                    26 |                       17 |
| Dont **chunks vides** (1 octet) |                 **9** |                        0 |
| Surface exportée de `index.js`  |            26 exports | **26 — noms identiques** |
| Durée                           | (dans le build turbo) |                **48 ms** |

Les 9 fichiers « manquants » sont exactement les modules **type-only** (`nodefony/interfaces/*`,
`serviceWiring`) — leur `.js` fait **1 octet** chez Rollup. Le `rollup.config.ts` d'orm-core les
documente d'ailleurs comme « EMPTY_BUNDLE … chunk JS vide (bénin) ». **rolldown ne les émet pas** :
sortie équivalente et plus propre.

**Pourquoi AVANT la release, et non après.** Le framework est en **développement**, sans consommateurs.
Une fois 10.0.0 publiée, le `dist` et les `.d.ts` deviennent un contrat opposable : changer de bundler
coûtera bien plus cher. Par ailleurs la release n'est pas imminente (P8 à 63 %, P11 à 44 %, S5 gelé), donc
il reste le temps de stabiliser. C'est l'application directe de la doctrine maison : _« reculer pour mieux
sauter, le framework est en dev pas en prod »_.

**Les cas durs du core sont désormais couverts** — les 4 bundles (dont le client isomorphe) ont été
rejoués sous rolldown avec une sortie équivalente : voir **§6 ter**. Restent à dérisquer les 18 autres
packages, le mode `watch`, les sourcemaps et `terser` en production.

## 6 ter. POC palier 2 sur le CORE — les 4 bundles, client isomorphe compris

Le core est le cas le plus dur du repo : quatre configurations Rollup, dont un **client isomorphe**
multi-entrées avec plugin `resolveId` maison. Tout a été rejoué sous rolldown, hors du repo, contre le
`dist` réel.

| Bundle                                     | Rollup (actuel) | rolldown          | Verdict                                                                                                                                           |
| ------------------------------------------ | --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **node** (`preserveModules`, 24 externals) | 96 `.js`        | 97 `.js`          | **137 exports identiques** (aucun manquant, aucun en trop) ; `Container` s'instancie ; `reflect-metadata` actif                                   |
| **bin** (shebang, `exports: "default"`)    | 3 089 o         | 2 222 o           | shebang correct, plus compact                                                                                                                     |
| **client isomorphe** (4 entrées)           | 31 `.js`        | 31 `.js`          | **arborescence identique** ; exports identiques par entrée (43/13/20/11) ; `react` externe ; **0 fuite de builtin node** ; s'importe et s'exécute |
| **debugbar standalone** (mono-fichier)     | 170 939 o       | 128 664 o (−25 %) | 0 import résiduel, 0 fuite                                                                                                                        |

**Temps** : Rollup **20 473 ms** pour les 4 bundles ; rolldown **~195 ms**. Avec `tsgo` pour les
déclarations (~3 s), le build complet du core passe d'environ 20 s à **~3 s** (≈ ×6-7).

**Déclarations `.d.ts`** — les deux surfaces sont couvertes :

|                                                        | Rollup |                        `tsgo --emitDeclarationOnly` |
| ------------------------------------------------------ | -----: | --------------------------------------------------: |
| `dist/types` (node)                                    |    135 | 136 · **131 exports identiques**, même arborescence |
| `dist/client/types` (isomorphe, `tsconfigClient.json`) |     52 |                     **52 · arborescence identique** |

**Cinq plugins Rollup deviennent inutiles** — rolldown fait tout nativement :
`@rollup/plugin-typescript`, `@rollup/plugin-node-resolve`, `@rollup/plugin-commonjs`,
`@rollup/plugin-json`, `rollup-plugin-polyfill-node`. Seul le `browserShim` maison est conservé, et il
fonctionne tel quel (API plugin compatible). Le `treeshake.moduleSideEffects` qui préserve le
side-effect de `reflect-metadata` — piège documenté dans le `rollup.config.ts` — est **honoré**.

**Quatre écarts, tous mineurs et identifiés** :

1. Le module JSON est nommé `package.js` au lieu de `package.json.js`. Interne, les imports sont
   cohérents (`from "./package.js"`).
2. rolldown émet en plus le barrel `syslog/transports/index.js` (537 o) que Rollup tree-shake. Bénin.
3. `declarationDir` du tsconfig **écrase** `--outDir` : pour `tsgo`, passer `--declarationDir`
   explicitement (sinon il écrit dans le vrai `dist`).
4. Les chunks vides (modules type-only) ne sont plus émis — c'est une amélioration (cf orm-core, §6 bis).

**Non couvert par ce POC** : les 18 autres packages, le mode `watch`/dev, les sourcemaps, et `terser` en
production. À dérisquer avant de toucher `rollup.config.ts`.

## 7. Décisions

- **Ne PAS migrer vers TS 7 pour le build maintenant.** Non par prudence : parce que `typescript-eslint`
  et `typedoc` n'ont **aucun ETA** et qu'il n'existe aucun substitut équivalent.
- **Ne PAS geler la question.** Le palier 1 est gratuit et le palier 2 est prouvé faisable.
- **Rejeté : `esbuild`** comme transformeur — refus doctrinal de `emitDecoratorMetadata`, échec
  silencieux.
- **Rejeté : attendre `Symbol.metadata`** pour remplacer `design:paramtypes` — il ne porte pas les types
  et aucun proposal ne prévoit qu'il le fasse.
- **Le palier 2 se fera sur `rolldown`, avant la release** (§6 bis) — stable (1.1.5) là où `unplugin-oxc`
  est pré-1.0, transformation TS native, décorateurs lus du `tsconfig`, helpers bundlés, sortie prouvée
  équivalente sur orm-core (26 exports identiques, 9 chunks vides en moins). Le framework est en dev :
  c'est maintenant que ça coûte le moins cher.
- **Fait** : palier 1 livré (`fbd1d6ae`) — `tsgo` en typecheck, `typescript` reste 6.0.3 pour
  Rollup/ESLint/typedoc. Paquet `@typescript/native-preview` (binaire `tsgo`), **jamais** un alias npm
  `tsgo@npm:typescript@7` : un alias ne renomme pas le binaire et écrase `.bin/tsc` silencieusement.
- **Surveiller** : la sortie de l'API TS 7.1 (débloque lint + doc), et la maturation de `preserveModules`
  dans rolldown.

## 8. Sources

- Annonce GA TypeScript 7.0 (2026-07-08) — <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- Progress on TypeScript 7 (2025-12) — <https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/>
- `typescript-eslint` #12518 (`not planned`) et #10940 (`blocked by external API`)
- `typedoc` #3098 — « no timeline »
- esbuild, refus de `emitDecoratorMetadata` — <https://esbuild.github.io/content-types/> + issue #257
- oxc, transformer TypeScript — <https://oxc.rs/docs/guide/usage/transformer/typescript>
- TC39 — <https://github.com/tc39/proposals> (Decorators + Decorator Metadata en stage 2.7),
  <https://github.com/tc39/proposal-decorators> (exclusion des décorateurs de paramètres)
- TypeScript #57533 — exposer les types design-time dans la metadata standard : ouvert, « needs proposal »
- Angular, migration `inject()` — <https://angular.dev/reference/migrations/inject-function>
