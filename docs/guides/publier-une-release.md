---
title: Publier une release — la chaîne, ce qu'elle refuse, et pourquoi
lang: fr
module: global
topic: release
audience: [human]
tags: [release, npm, publication, changelog, oidc, smoke]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/publier-une-release.md"
navTitle: Publier une release
related: scripts/release/, .github/workflows/release.yml, docs/release/nodefony-10.md
---

# Publier une release

📍 [Documentation](../index.md) › [Guides](README.md) › **Publier une release**

> Ce que le dépôt exécute pour publier ses quinze paquets, dans quel ordre, ce que chaque garde
> refuse — et le geste qui reste humain. Le **plan de version** (quoi publier, décisions, état
> d'avancement) vit à part, dans [`docs/release/nodefony-10.md`](../release/nodefony-10.md).

## Le geste, en une page

```bash
# 1. RÉPÉTITION — ne touche aucun fichier, dit ce qui changerait
npm run release -- --version 10.0.0 --from v9.9.9

# 2. APPLIQUER — estampille les 15 manifestes, écrit un BROUILLON de changelog
npm run release -- --version 10.0.0 --from v9.9.9 --write

# 3. RELIRE ET RÉÉCRIRE CHANGELOG.md  ← le seul geste que rien n'automatise
# 4. Commiter, puis POSER LE TAG — c'est lui qui déclenche la publication
git commit -am "chore(release): 10.0.0"
git tag v10.0.0 && git push origin main --tags
```

Le reste — épreuve, publication, image, vitrine, annonce — est fait par la forge.

---

## Pourquoi cette chaîne est différente de tout le reste du dépôt

Elle est **irréversible**. `npm unpublish` n'est ouvert que **72 heures**, et seulement si personne
ne dépend de la version — politique adoptée après l'affaire `left-pad` en 2016. Une version publiée
par erreur est **brûlée** : ce numéro ne sera plus jamais réutilisable.

En **lockstep** (les quinze paquets portent la même version), c'est pire : ils partent en séquence,
et **npm ne connaît pas la transaction**. Un échec au huitième laisse sept paquets en ligne qui
référencent sept absents — sept versions brûlées, et la reprise se fait en `10.0.1` **pour tout le
lot**.

D'où la règle qui explique la forme de tout le reste : **tout ce qui peut être vérifié l'est avant
le premier `publish`, jamais entre deux.**

---

## Où vivent les choses

Publier est un geste **du dépôt**. Les outils lui appartiennent donc, et les commandes npm font
autorité :

| Commande                                        | Fichier                                 | Rôle                              |
| ----------------------------------------------- | --------------------------------------- | --------------------------------- |
| `npm run release -- --version <v> --from <ref>` | `scripts/release/release.mjs`           | prépare et **refuse**             |
| `npm run release:pack`                          | `scripts/release/pack-all.mjs`          | fabrique les tarballs             |
| `npm run release:smoke`                         | `scripts/release/smoke-docker.sh`       | prouve l'installation **vierge**  |
| `npm run test:release`                          | `scripts/release/release-core.test.mjs` | 107 tests sur le raisonnement pur |

Trois autres endroits, qu'il ne faut pas confondre :

- **`.github/workflows/release.yml`** — la forge. Déclenchée par un tag `v10.*`.
- **`docs/release/nodefony-10.md`** — le **plan** : quoi publier, les décisions et leur pourquoi,
  ce qui reste à faire. Pas un mode d'emploi.
- **`.claude/skills/nodefony-release/`** — la **méthode, pour un agent**. Chargée à la demande
  quand on demande à Claude de publier, pour qu'il ne réinvente pas la procédure. Elle n'exécute
  rien : la chaîne de publication ne peut pas dépendre de l'outillage d'agent, qui se réorganise
  pour d'autres raisons qu'elle.

---

## Ce que `release.mjs` refuse, et ce que chaque refus évite

Le mode par défaut est une **répétition** : il ne touche aucun fichier et dit ce qui changerait.

| Garde                                         | Ce qu'elle évite                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Version semver 2.0.0 valide                   | `01.2.3` passe une regex naïve, et se fait refuser par le registre au milieu du lot                                           |
| **Préversion sans `--npm-tag`**               | npm la publierait sous `latest` : tout `npm i` recevrait une bêta, et redéplacer le tag ne rattrape pas ce qui est déjà parti |
| Arbre propre                                  | du code en ligne qui n'existe dans **aucun** commit — plus personne ne peut auditer ce qui a été publié                       |
| Branche attendue (préparation seulement)      | estampiller depuis une branche de travail                                                                                     |
| npm ≥ 11.5.1, Node ≥ 22.14.0                  | `ENEEDAUTH` au trusted publishing — un message qui n'évoque nulle part une version trop ancienne                              |
| `src/nodefony/.ai/symbols.json` présent       | il est **généré et gitignoré** : absent de tout checkout frais, alors que `files` le déclare (`npm run generate-symbols`)     |
| Métadonnées `repository` / `access` / `files` | des défauts **invisibles dans le dépôt** : npm ne valide rien à l'enregistrement du publieur, l'erreur ne sort qu'au publish  |
| Version libre sur le registre                 | découvrir la collision au huitième paquet, donc brûler les sept précédents                                                    |
| Lot déjà estampillé (publication)             | publier des tarballs dont la version ne correspond pas au tag qui les a déclenchés                                            |
| Contenu des tarballs                          | un secret publié est public à la seconde où il est en ligne — bien avant la fenêtre de 72 h                                   |
| Répétition `--dry-run` sur le lot entier      | la seule parade au lot partiel, puisque npm n'a pas de transaction                                                            |

L'inventaire des publiables vient de `npm query .workspace` filtré sur `private` — jamais d'une
liste écrite à la main, dont l'oubli serait **silencieux**.

> **Préparer et publier sont deux gestes séparés.** `--publish` **n'écrit rien** : il exige au
> contraire que les quinze manifestes portent déjà la version du tag. C'est le commit de release,
> relu avant le tag, qui estampille.

---

## Le smoke test — la seule preuve qui vaille

### Le problème qu'il résout

**Le dépôt ne peut pas voir sa propre surface publiée.** Les paquets du cœur pointent leurs types
vers la **source** :

```json
"exports": { ".": { "types": "./index.ts" } }
```

C'est délibéré — cela évite une course au build entre modules qui se consomment en source. Mais
**cette source n'est pas dans le tarball**. Ici, tout compile ; chez celui qui installe, rien ne
marche. Six paquets ont publié des semaines dans cet état sans qu'aucun test du dépôt ne bronche.

Aucune suite locale ne peut voir ça, par construction : elle travaille sur les fichiers du dépôt,
et le problème est précisément dans ce qui **n'y est plus** une fois empaqueté.

### Ce qu'il fait

```bash
npm run release:smoke                       # les trois scénarios
npm run release:smoke -- --scenario base    # un seul (docker build se paie en minutes)
```

1. **Empaquette** les quinze paquets, en basculant au passage les `exports.types` vers les `.d.ts`
   générés et en extensionnant les specifiers des déclarations (`node16`/`nodenext` l'exige).
2. **Installe le scaffolder depuis son tarball**, dans un dossier jetable.
3. **Génère** une application avec ce binaire-là (`create app`, puis `create controller`).
4. **Construit une image**, l'installation étant **vierge** : le conteneur n'a jamais vu le dépôt.
5. **Démarre**, interroge les sondes, puis **coupe** — et vérifie l'arrêt gracieux.

Le décor est donc **généré, jamais copié**. Deux conséquences qu'aucun autre gate ne donne : les
**gabarits** sont éprouvés tels qu'ils seront publiés — un fichier oublié dans `files` ne se voit
d'aucune autre façon — et le banc suit le générateur au lieu de dériver d'un dossier figé.

### Les trois scénarios, et ce que chacun seul peut voir

| Scénario | Décor                 | Ce qu'il prouve                                                                                                                                                          |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`   | `minimal`, sans front | `/readyz` et `/livez`, **node en PID 1** constaté à l'exécution, requête en vol drainée pendant `docker stop`, sortie 0, `SHUTDOWN` journalisé                           |
| `front`  | `minimal` + React     | les tags `/_assets/…` du build dans la page · `public/dist` effacé **avec** vite → reconstruit au boot et annoncé · la même absence **dans l'image** → le backend survit |
| `studio` | `complete`, Studio    | l'UI **pré-buildée** du paquet est servie : `/nodefony` en 200, puis un asset **pris dans la page** en 200 — un 404 ici signifie `dist/frontend` absent du tarball       |

L'URL de l'asset n'est jamais écrite à la main : elle est extraite de la page servie. Une URL
littérale deviendrait fausse au premier changement de nommage, et le banc accuserait le tarball
pour un motif sans rapport.

---

## La forge — `release.yml`

```
tag v10.*  ─►  épreuve (3 scénarios)  ─►  publication npm
                                       ├─►  vitrine nodefony/nodefony
                                       ├─►  image docker
                                       ├─►  release GitHub
                                       └─►  bilan
```

### 🔒 Le cran d'armement

**Le workflow ne publie rien par défaut.** Tant que la variable de dépôt `NF_RELEASE_ARMED` ne vaut
pas `true`, tout s'exécute **sauf** les trois gestes irréversibles : `npm publish`, la release
GitHub et les pousses externes.

On peut donc pousser un tag d'essai et voir la chaîne **entière** se dérouler — build, tests, pack,
installation vierge en conteneur, toutes les gardes, la répétition sur le lot complet — sans qu'un
octet ne parte sur le registre.

> Un workflow de publication qu'on n'a jamais vu tourner est un workflow dont on découvre les
> défauts **le jour où ils coûtent le plus cher**.

| Variable de dépôt    | Effet                                                           |
| -------------------- | --------------------------------------------------------------- |
| `NF_RELEASE_ARMED`   | `true` → les gestes irréversibles s'exécutent. Absente → aucun. |
| `NF_RELEASE_VITRINE` | `true` → génère et pousse `nodefony/nodefony`                   |
| `NF_RELEASE_IMAGE`   | `true` → construit et pousse l'image docker                     |

Un job sauté ne signale rien de lui-même : le job **bilan** énonce ce qui a tourné et ce qui ne l'a
pas fait, pour qu'une release incomplète ne se lise pas comme une release réussie.

### L'authentification — aucun jeton n'existe

La publication passe par **trusted publishing (OIDC)** : GitHub prouve à npm que la publication
vient de ce dépôt et de ce workflow, npm délivre un jeton valable quelques minutes. Rien à stocker,
rien à faire tourner, rien à révoquer — et la provenance est signée **automatiquement** (ne pas
ajouter `--provenance`, elle est activée par l'OIDC).

Ce n'est pas du confort. Le vol de jeton de publication est le vecteur d'`eslint-scope` (2018),
d'`ua-parser-js` (2021) et du ver `Shai-Hulud` (2025), qui moissonnait les jetons npm sur les
exécuteurs d'intégration.

Trois contraintes, chacune payée d'un `ENEEDAUTH` qui n'en dit pas la cause :

- `permissions: id-token: write` dans le job — sans elle, aucune assertion n'est délivrée ;
- npm ≥ 11.5.1, Node ≥ 22.14.0, sur un runner **hébergé** (pas d'auto-hébergé) ;
- **le nom du fichier `release.yml` est un identifiant**, saisi tel quel sur npmjs.com, extension
  comprise et **sensible à la casse**. Le renommer casse la publication des quinze paquets d'un
  coup. Et **ne jamais appeler ce workflow depuis un autre** : npm valide le nom du workflow
  **appelant**.

> ⚠️ **La première publication ne peut pas passer par l'OIDC.** Le publieur de confiance se déclare
> dans les réglages d'un paquet **qui existe déjà**, et npm n'a pas de « publieur en attente ». Les
> treize `@nodefony/*` n'ont jamais été publiés : ils naissent à la main, depuis le poste du
> mainteneur, avec le code à deux facteurs — `npm run release -- --version <v> --publish`. Les
> publieurs se déclarent **ensuite**, sur chacun des quinze.

> ⚠️ **Un vert ne prouve pas que l'authentification fonctionne.** En `--dry-run`, npm n'émet qu'un
> **avertissement** quand les identifiants manquent ; `ENEEDAUTH` n'est levé que hors dry-run
> (`lib/commands/publish.js`). Seule une publication réelle le prouve.

---

## Le changelog

Le format est **[Common Changelog](https://common-changelog.org/)**, pas Keep a Changelog : le
premier pose des règles **normatives**, et ce sont elles qui rendent le fichier exploitable par une
machine autant que par un humain.

| Règle                       | Forme                                                                            |
| --------------------------- | -------------------------------------------------------------------------------- |
| Titre de version            | `## 10.0.0 - 2026-08-25` — ni crochets, ni tiret cadratin                        |
| Catégories                  | ensemble **fermé** `Changed · Added · Removed · Fixed`, dans cet ordre           |
| Entrée                      | **une** ligne, à l'impératif, compréhensible **hors** de sa catégorie            |
| Rupture                     | `- **Breaking:** …` ou `- **portée (breaking):** …`, en **tête** de sa catégorie |
| Référence                   | `(sha)` en fin de ligne                                                          |
| Pas de section `Unreleased` | ses références ne peuvent pas encore exister                                     |

Les titres de catégorie restent en **anglais** dans ce projet francophone : ils sont l'ensemble
fermé de la spécification. Les traduire romprait la conformité — aucun outil ne reconnaît
« Ajouté » — sans rien apporter à l'humain, qui lit les **entrées**, écrites en français.

**N'entrent pas dans le changelog** : `docs`, `ci`, `chore`, `test`, `build`, `style`. La spec
demande d'écarter ce qui ne change rien pour celui qui met à jour. Le script les **compte et les
annonce**, séparément des messages hors convention — confondre les deux enverrait chercher des
commits mal écrits qui n'existent pas.

### Ce que l'automate ne fait pas

Il rassemble la **matière** ; il n'écrit pas le texte. Le fichier généré porte le mot `BROUILLON`
et la raison :

> _« Don't take the easy way out with full automation. This results in poor changelogs, defeating
> their purpose. »_

Les sujets de commit de ce dépôt sont narratifs et longs — ils font une bonne matière première et
un mauvais changelog. La réécriture est le geste humain de la release, et le seul.

---

## Après la première publication

1. **Déclarer un publieur de confiance** sur chacun des quinze paquets (npmjs.com → Settings du
   paquet) : même dépôt, même **nom de fichier** de workflow. Tous les champs sont sensibles à la
   casse, et npm **ne valide rien** à l'enregistrement — une erreur ne se voit qu'à la publication
   suivante. Un seul publieur par paquet.
2. **Settings → Publishing access → Require two-factor authentication and disallow tokens.**
3. **Déprécier les paquets historiques** — `npm deprecate <paquet> "<message>"`, réversible et sans
   effet sur les installations existantes. **Dans cet ordre** : déprécier avant d'avoir publié
   renverrait les gens vers des paquets qui n'existent pas encore. La table de correspondance vit
   au §7.3ter du [plan](../release/nodefony-10.md).

---

## Dépannage

| Symptôme                                    | Cause                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ENEEDAUTH` en CI                           | `id-token: write` manquant · npm < 11.5.1 · nom de workflow qui ne correspond pas · runner auto-hébergé |
| Le pack refuse : `.ai/symbols.json` absent  | fichier **généré et gitignoré** → `npm run generate-symbols`                                            |
| `CHANGELOG.md porte déjà une section « X »` | normal : la préparation ne réécrit pas ce qui a été relu. Éditer à la main.                             |
| `N paquet(s) ne portent pas <version>`      | le tag a été posé avant le commit de release — refaire dans l'ordre                                     |
| Le smoke échoue sur `docker build`          | lire l'étape **nommée** qui a lâché : un scaffold muet envoie chercher la panne dans les tarballs       |
| `npm whoami` ne montre rien en CI           | attendu : il ne reflète **jamais** une authentification OIDC                                            |
| Podman : `HEALTHCHECK` disparu de l'image   | Podman construit en OCI, qui ne porte pas cette directive → `podman build --format docker`              |

## 📖 Lexique

| Terme                         | Ce que c'est                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Tarball**                   | L'archive que npm publie et qu'un utilisateur reçoit à l'installation. Elle ne contient pas forcément ce que le dépôt montre.            |
| **Smoke test**                | Une installation réelle depuis les archives, dans un environnement neuf. C'est la seule preuve qui porte sur l'artefact **reçu**.        |
| **OIDC**                      | L'authentification de la forge auprès de npm sans jeton stocké : la forge prouve son identité, npm lui répond. Rien à faire fuiter.      |
| **Verrouillage** (_lockstep_) | Les quinze paquets partent sur la même version, dans un ordre topologique — un paquet ne peut pas sortir avant ce dont il dépend.        |
| **Cran d'armement**           | Le geste explicite qui autorise la publication. Il existe parce qu'une version publiée est **brûlée** : npm ne connaît pas l'annulation. |

## ⚠️ Pièges

- **Une version publiée est définitive.** npm ne défait pas une publication ; on ne corrige qu'en
  publiant au-dessus. C'est ce qui justifie que chaque garde soit bloquante plutôt qu'avertissante.
- **Ce que le dépôt montre n'est pas ce que l'utilisateur reçoit.** Le champ `files`, le `exports`
  et le build décident du contenu réel de l'archive — d'où le smoke test sur les archives, jamais
  sur l'arbre de travail.
- **Il n'y a pas de transaction.** Si la publication s'arrête au huitième paquet sur quinze, les
  sept premiers sont en ligne. L'ordre topologique limite les dégâts, il ne les annule pas.
- **`npm whoami` ne montre rien en publication OIDC**, et c'est normal : aucun jeton n'existe. Le
  lire comme un échec envoie chercher une panne inexistante.
- **Ce qui est vérifié avant de publier vit dans le code, pas dans le script** :
  `checkPackageDeps()` (`packageDeps.ts:285`) refuse un import non déclaré, et
  `defineNodefonyRolldownConfig()` (`bundler/index.ts:135`) décide ce que chaque paquet embarque,
  en s'appuyant sur `nodefonyExternalMatcher()` (`bundler/index.ts:68`) pour trancher ce qui reste
  hors du bundle — une dépendance qui devait rester externe et se retrouve avalée casse à
  l'installation, pas ici.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée en comptant — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (chaîne) | `scripts/release/release-core.test.mjs` | l'ordre topologique, les métadonnées exigées, le figeage des références de version |
| Unitaires (bundle) | `scripts/check-externals.test.mjs` | la liste des dépendances laissées externes ne dérive pas des `peerDependencies` |
| Unitaires (surface) | `nodefony` `packageDeps.test.ts`, `clientSubpathSurface.types.test.ts` · `@nodefony/studio` `packageSurface.test.ts` | ce que chaque paquet déclare correspond à ce que son code importe |

> Ces contrôles s'exécutent **avant** la publication. La preuve d'après, celle qui porte sur
> l'artefact reçu, est le smoke test décrit plus haut — aucun test unitaire ne peut la remplacer.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🤝 **Ce que la publication promet à vos utilisateurs** :
  [compatibilité et dépréciation](./compatibilite.md)
- 🏭 **Ce que la forge lance par ailleurs** : [`integration-continue.md`](./integration-continue.md)
- 📦 **Comment le TypeScript devient un paquet** :
  [architecture — build & bundling](../architecture/build-bundling.md)
- 📖 [Lexique général](../lexique.md) du framework.
