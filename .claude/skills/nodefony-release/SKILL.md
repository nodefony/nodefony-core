---
name: nodefony-release
metadata:
  version: 2.0.0
description: >
  Conduire une publication npm de Nodefony (modèle N-paquets verrouillés sur la même version) :
  quelle commande du dépôt lancer, dans quel ordre, ce que chaque garde refuse et pourquoi,
  comment interpréter un échec. La chaîne elle-même appartient au PRODUIT (`npm run release`,
  `release:pack`, `release:smoke`) ; ce skill porte le raisonnement qui l'entoure — une version
  publiée est BRÛLÉE, npm ne connaît pas la transaction, et ce qu'un dépôt voit de lui-même n'est
  pas ce qu'un installeur reçoit. À charger AVANT de publier ou de toucher à la surface publiée
  (`exports`, `files`, `peerDependencies`, gabarits d'application). Le plan de version et l'état
  d'avancement vivent dans `docs/release/nodefony-10.md`. Déclencheurs : "publier sur npm", "faire
  une release", "préparer la publication", "puis-je publier ?", "estampiller la version",
  "changelog de la release", "ordre de publication", "packager les paquets", "smoke test release",
  "tester l'installation depuis les tarballs", "est-ce que le paquet publié marche ?", "surface
  npm", "types publiés", "tarball", "trusted publishing", "ENEEDAUTH", "avant de publier".
---

# nodefony-release — conduire une publication qui ne se rattrape pas

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`, l'avancement dans `MIGRATION_STATUS.md` et `docs/release/nodefony-10.md`.

Le dépôt ne voit pas sa propre surface publiée. Les paquets du cœur pointent leurs types vers la
**source** (`exports["."].types → ./index.ts`) pour éviter une course au build ; cette source est
absente du tarball. Tant qu'on ne dépaquette pas, tout va bien — et rien ne marche chez celui qui
installe. C'est pourquoi la chaîne existe : elle fabrique le tarball, l'installe **à neuf**, et
compile une application témoin contre lui.

## 1. La chaîne appartient au PRODUIT — ce skill n'exécute rien

Publier est un geste du dépôt, pas de l'agent. Les scripts vivent donc sous `scripts/release/`,
derrière les commandes npm qui font autorité :

<!-- prettier-ignore -->
| Commande | Ce qu'elle lance | Rôle |
| --- | --- | --- |
| `npm run release -- --version <v> --from <ref>` | `scripts/release/release.mjs` | PRÉPARE et REFUSE. Sans drapeau, ne touche aucun fichier |
| `npm run test:release` | `vitest run scripts/release/` | Le raisonnement pur, 99 tests |
| `npm run release:pack` | `scripts/release/pack-all.mjs` | Un tarball par publiable, `exports.types` basculés |
| `npm run release:smoke [-- --scenario X]` | `scripts/release/smoke-docker.sh` | Installation VIERGE en conteneur |

Ce skill donne la méthode : quoi lancer, ce que chaque refus signifie, où chercher quand ça casse.
**Ne jamais y remettre de script exécutable** — la chaîne de publication ne peut pas dépendre de
l'outillage d'agent, qui se réorganise pour d'autres raisons qu'elle. Le cycle a existé
(`release.mjs` appelait un script du skill, qui réimportait le cœur du produit) ; il est coupé.

| Besoin                                                   | Où                            |
| -------------------------------------------------------- | ----------------------------- |
| Conduire la publication, lire un échec                   | **ce skill**                  |
| Savoir QUOI publier et dans quel ordre (plan de version) | `docs/release/nodefony-10.md` |
| Dérive `external` du bundler ↔ `peerDependencies`        | `nodefony-check-externals`    |
| Créer ou restructurer un paquet                          | `nodefony-create-module`      |
| Mesurer la performance de ce qui est publié              | `nodefony-load-test`          |

## 2. Ce qui rend une release différente de tout autre geste

Elle est **irréversible**. `npm unpublish` n'est ouvert que **72 heures**, et seulement si personne
n'en dépend — politique adoptée après `left-pad` (2016). Une version publiée par erreur est brûlée.

En lockstep, c'est pire : les quinze paquets partent en séquence et **npm ne connaît pas la
transaction**. Un échec au huitième laisse sept paquets en ligne qui référencent sept absents, et
ces sept versions sont brûlées — la reprise se fait en `10.0.1` **pour tout le lot**. D'où la règle
qui structure toute la chaîne : _tout ce qui peut être vérifié l'est AVANT le premier `publish`,
jamais entre deux._

### Le tag est la CAUSE, pas la conséquence

`release.mjs` estampille, écrit un brouillon de changelog et empaquette. Il **ne pose pas le tag** :
c'est le tag `v10.*` poussé à la main qui déclenche la publication. Inverser les deux enlève à
l'auteur le seul point où il relit ce qui sortira sous son nom.

Le changelog est un **brouillon**, marqué comme tel dans le fichier. L'automate rassemble la
matière — sans lui on oublie des changements ; l'humain écrit — sans lui on publie un mur que
personne ne lit. _« Don't take the easy way out with full automation. This results in poor
changelogs, defeating their purpose. »_ (Common Changelog)

### Le format est [Common Changelog](https://common-changelog.org/), pas Keep a Changelog

Keep a Changelog donne des CONSEILS ; Common Changelog pose des règles **normatives**, et ce sont
elles qui rendent le fichier exploitable par une machine autant que par un humain :

<!-- prettier-ignore -->
| Règle (MUST) | Forme | Ce que ça évite |
| --- | --- | --- |
| Titre de version | `## 10.0.0 - 2026-08-25` | Ni crochets ni tiret cadratin : un lecteur automatique attend cette forme exacte |
| Catégories | ensemble **fermé** `Changed · Added · Removed · Fixed`, dans **cet ordre** | Des sections inventées que rien ne sait lire |
| Entrée | **une** ligne, à l'impératif, **auto-descriptive** hors de sa catégorie | Une entrée extraite seule et devenue incompréhensible |
| Rupture | `- **Breaking:** …` ou `- **portée (breaking):** …`, **en tête** de sa catégorie | La seule information qui casse une production, noyée au milieu |
| Référence | `(sha)` en fin de ligne, une seule paire de parenthèses | Une affirmation invérifiable : plus moyen de remonter au code |
| Pas de section `Unreleased` | — | Une section dont les références ne peuvent pas encore exister |

**Les titres restent en anglais dans ce projet francophone** : ils sont l'ensemble fermé de la
spécification. Les traduire romprait la conformité — aucun outil ne reconnaîtrait « Ajouté » — sans
rien apporter à l'humain, qui lit les ENTRÉES, écrites en français.

**Ce qui n'entre PAS dans le changelog** : `docs`, `ci`, `chore`, `test`, `build`, `style`. La spec
demande d'écarter ce qui ne change rien pour celui qui met à jour. Le script les **compte et les
annonce** séparément des messages hors convention — confondre les deux enverrait chercher des
commits mal écrits qui n'existent pas.

### Pourquoi un mode `--publish` manuel, alors que la cible est l'OIDC

Le publieur de confiance se déclare dans les réglages d'un paquet **qui existe déjà**, et npm n'a
pas de « publieur en attente ». Les treize `@nodefony/*` n'ont jamais été publiés : ils ne peuvent
pas naître par ce chemin. Ce mode sert cette première fois, depuis le poste du mainteneur, avec le
code à deux facteurs et **sans qu'aucun jeton n'existe** — le vol de jeton de publication est le
vecteur d'`eslint-scope` (2018), d'`ua-parser-js` (2021) et du ver `Shai-Hulud` (2025), qui
moissonnait les jetons npm sur les exécuteurs d'intégration. Ordre complet et réglages npmjs.com :
`docs/release/nodefony-10.md` §7.3bis.

## 3. PRÉPARER — ce que `release.mjs` refuse, et ce que chaque refus évite

```bash
npm run release -- --version 10.0.0 --from <ref>                  # RÉPÉTITION (défaut)
npm run release -- --version 10.0.0 --from <ref> --write          # estampille + changelog
npm run release -- --version 10.0.0 --from <ref> --write --pack   # + tarballs
npm run release -- --version 10.0.0 --from <ref> --publish        # publication MANUELLE
```

Options : `--branch <nom>` · `--repo <hôte/org/dépôt>` · `--npm-tag <tag>` · `--offline`.
`--help` rend le mode d'emploi complet. Le mode par défaut ne touche **aucun fichier**.

<!-- prettier-ignore -->
| Garde | Ce qu'elle évite |
| --- | --- |
| Version semver 2.0.0 valide | `01.2.3` accepté par une regex naïve, refusé par le registre au milieu du lot |
| **Préversion sans `--npm-tag`** | npm la publierait sous `latest` : tout `npm i` recevrait une bêta, et redéplacer le tag ne rattrape pas les installations parties |
| Arbre propre + branche attendue | du code en ligne qui n'existe dans AUCUN commit — plus personne ne peut auditer ce qui a été publié |
| npm ≥ 11.5.1, Node ≥ 22.14.0 | `ENEEDAUTH` au trusted publishing, dont le message n'évoque nulle part une version trop ancienne |
| `src/nodefony/.ai/symbols.json` présent | il est GÉNÉRÉ et **ignoré par git** : absent de tout checkout frais, alors que `files` le déclare. Trois passes hebdomadaires du banc de release sont restées rouges sur ce seul motif — `npm run generate-symbols` |
| Métadonnées (`repository`, `access`, `files`) | des défauts INVISIBLES dans le dépôt : npm ne valide rien à l'enregistrement du publieur de confiance, l'erreur ne sort qu'au `publish` |
| Version libre sur le registre | découvrir la collision au huitième paquet, donc brûler les sept précédents |
| Contenu des tarballs | un secret publié est public à la seconde où il est en ligne, bien avant la fenêtre de 72 h |
| Répétition `--dry-run` sur **le lot entier** | la seule parade au lot partiel, puisque npm n'a pas de transaction |

L'inventaire des publiables vient de `npm query .workspace` filtré sur `private` — jamais d'une
liste écrite à la main, dont l'oubli serait silencieux.

**Le raisonnement est PUR, et c'est ce qui le rend éprouvable.** Une release ne se répète pas : ce
qui DÉCIDE vit donc hors des entrées-sorties, dans `scripts/release/release-core.mjs` — validation
de version, analyse des messages de commit, ordre topologique, audit des métadonnées, rendu et
fusion du changelog, détection de contenu suspect. `release.mjs` n'est que l'accès au monde (git,
npm, le disque). Le verdict d'existence d'un chemin est **injecté**, si bien qu'on éprouve
« répertoire déclaré mais absent » sans le fabriquer.

`pack-all.mjs` **appelle** `auditerMetadonnees` du même cœur : une seule implémentation de la
règle, deux points d'entrée — le pack doit refuser tout seul, car il s'utilise sans `release.mjs`.

## 4. ÉPROUVER — l'installation vierge

```bash
npm run release:smoke                          # les trois scénarios
npm run release:smoke -- --scenario base       # un seul (docker build se paie en minutes)
npm run release:pack                           # les tarballs seuls
```

`pack-all.mjs` empaquette chaque workspace non privé, **bascule temporairement** les
`exports["."].types` qui pointent la source vers le `.d.ts` généré, puis restaure le
`package.json`. `fix-dts-extensions.mjs` extensionne les specifiers relatifs des déclarations
(`node16`/`nodenext` l'exige) — appelé **depuis** le pack, pas à la main.

**Le décor du smoke est GÉNÉRÉ, pas copié.** Le paquet `nodefony` est installé depuis son tarball
dans un dossier jetable, et c'est CE binaire qui produit l'application témoin (`create app`, puis
`create controller` pour la route lente du drain). Deux conséquences qu'aucun autre gate ne donne :
les **gabarits** sont éprouvés tels qu'ils sont publiés — un fichier oublié dans `files` ne se voit
d'aucune autre façon —, et le smoke suit le générateur au lieu de dériver d'un dossier figé.

**Les étapes sont nommées**, et l'échec dit laquelle a lâché. Ce n'est pas du confort : un
`docker build` en échec parce que le scaffold a produit une app muette envoie chercher la panne
dans les tarballs. Les gardes posées après `create app` (Dockerfile présent, `CMD` en forme exec,
manifeste réécrit) sont là pour attribuer la faute au bon maillon.

### Les trois scénarios, et ce que chacun seul peut voir

<!-- prettier-ignore -->
| Scénario | Décor | Ce qu'il prouve |
| --- | --- | --- |
| `base` | `minimal`, sans front | Sondes `/readyz` `/livez`, **node en PID 1** constaté à l'exécution, requête en vol drainée pendant `docker stop`, sortie 0, `SHUTDOWN` journalisé |
| `front` | `minimal` + React | (a) `GET /` porte les tags `/_assets/…` du build · (b1) `public/dist` effacé **avec** vite → reconstruit au boot et ANNONCÉ · (b2) même absence dans l'image → le backend survit (l'API répond) |
| `studio` | `complete`, Studio `mandatory` | L'UI **pré-buildée** du paquet est servie : `/nodefony` 200 puis un asset **pris dans la page** en 200 — un 404 ici = `dist/frontend` absent du tarball |

`front` est le seul à booter **hors conteneur** (poste de dev, devDependencies présentes) : la
différence entre (b1) et (b2) EST le scénario. Le dépôt self-hosted ne peut voir ni l'un ni
l'autre — il a toujours vite sous la main. Le trou d'origine était une **page blanche muette** en
production, sans une ligne de journal.

Sur `studio`, l'URL de l'asset n'est jamais écrite à la main : elle est extraite de la page servie.
Une URL littérale deviendrait fausse au premier changement de nommage, et le test accuserait le
tarball pour un motif sans rapport.

**Ce que `front` NE couvre PAS, et le script le dit à voix haute** : la seconde issue d'un front non
construit — « Vite absent → ERREUR nommée » — est **inatteignable**. Le plugin Vite est une
devDependency, il SATISFAIT la dépendance de pair optionnelle de `@nodefony/frontend`, donc
`npm prune --omit=dev` le garde et tire Vite avec lui ; refaire l'arbre n'y change rien, le
`package-lock.json` l'a figé (mesuré : 161 Mo dans les deux cas). Conséquence à porter au produit :
la garde de `setupProd` contre la page blanche muette ne peut pas servir tant que Vite voyage dans
l'image. Le remède est en amont, dans la façon dont `@nodefony/frontend` déclare Vite.

### Podman — compatible, sauf une perte SILENCIEUSE

Constaté (Podman 5.6, image générée telle quelle) : `podman build` sort en 0, `--mount=type=cache`
est accepté par Buildah, `/readyz` répond 200, `/api/hello` rend `pid: 1` (forme exec respectée), et
`podman stop -t 12` sort en 0 avec le drain journalisé.

⚠️ **`HEALTHCHECK` est retiré de l'image, sans erreur** — Podman construit en format **OCI**, or la
directive est une extension du format _Docker_ que la spec OCI ne porte pas :

```
warning: HEALTHCHECK is not supported for OCI image format and will be ignored
podman inspect <image> --format '{{.HealthCheck}}'   →  <nil>
```

Remède vérifié : `podman build --format docker`. Le gabarit généré porte l'avertissement — c'est là
qu'on le lit au moment utile.

⚠️ **`create controller` est IN-PROJECT** : il remonte au `nodefony.config.ts` le plus proche.
Lancé depuis la racine du dépôt, il écrirait DANS le dépôt — le script l'ancre dans l'app témoin
par un sous-shell.

## 5. Pièges

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
- **`npm whoami` ne reflète JAMAIS une authentification OIDC** — ne pas s'en servir comme preuve
  que la chaîne de publication fonctionne.

## 6. Gate

Le smoke test **est** le gate : il échoue si l'installation vierge ne compile pas. Avant de le
lancer, `nodefony-check-externals` pour la dérive des dépendances déclarées. La forge le rejoue
chaque lundi (`release-smoke.yml`) — une passe hebdomadaire non lue est restée rouge trois
semaines : la lire fait partie du gate.

**Surface exportée — comparer deux builds** : `node scripts/compare-exports.mjs` compare ce que deux
builds exportent réellement, par **import réel dans des process isolés** — la seule méthode qui vaille
(compter les fichiers émis ment : chunks vides, granularité de tree-shaking). Sentinelle héritée de la
migration de bundler, à relancer dès qu'on touche à la chaîne de build ou à un `index.ts` public.

> Deux builds du même paquet chargés dans un seul process explosent sur les registres globaux
> (« entity déjà enregistrée ») : d'où l'isolation.
