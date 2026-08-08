---
name: nodefony-browser
metadata:
  version: 1.1.0
description: >
  Ouvre une page réelle dans un navigateur piloté — sur le poste ou en conteneur, au choix — pour
  la VOIR et surtout la MESURER : contrastes calculés, audit WCAG par axe-core, Web Vitals, réseau,
  console, débordements ; et pilote un socket applicatif de bout en bout (accueil, abonnement,
  action, latence, reconnexion) depuis la page elle-même, donc avec ses cookies et son origine.
  Sait demander le thème CLAIR ou SOMBRE — un défaut d'affichage n'existe souvent que dans l'un des
  deux. Porte le décor et les pièges qui font conclure FAUX : mesurer avant que l'écran soit
  peuplé, joindre l'hôte par le mauvais nom, observer un bundle qui n'est pas celui qu'on a bâti,
  croire une mesure de contraste écrite à la main. À charger AVANT de constater quoi que ce soit à
  l'écran. Déclencheurs : "regarde l'écran", "vérifie l'affichage",
  "est-ce que ça s'affiche ?", "lis la console", "y a-t-il des erreurs JS ?", "mesure le contraste",
  "cette couleur est-elle lisible ?", "capture d'écran", "vérifie l'accessibilité", "audit WCAG",
  "en mode clair", "en mode sombre", "le thème sombre casse quelque chose ?",
  "quelles requêtes fait la page ?", "le temps réel arrive-t-il à l'écran ?", "teste le websocket",
  "quelle latence sur le socket ?", "la page déborde-t-elle sur mobile ?".
---

# nodefony-browser — voir et MESURER une page

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Une leçon durable devient une règle d'une section, pas une entrée datée.

## 1. Quand m'utiliser / quand passer la main

**M'utiliser** dès qu'une question porte sur ce qu'un écran fait ou montre réellement :
constater qu'une page se monte, lire ses erreurs de console, mesurer un contraste ou une taille de
cible, vérifier qu'une application générée démarre, prendre une capture pour un rapport.

> 🔴 **Ne JAMAIS demander au développeur de jouer la sonde** (« recharge et dis-moi ce que dit la
> console »). Ce réflexe vient de la règle « pas de Chromium sur le poste », dont l'exception —
> un environnement isolé — **est précisément ce conteneur**. Le navigateur du développeur ne reste
> utile que pour juger le HMR, une animation ou un rendu fin.

| Besoin                                                 | Skill                   |
| ------------------------------------------------------ | ----------------------- |
| Coder le front (isomorphisme, socket, HMR, data plane) | `nodefony-frontend-dev` |
| Coder un écran de la console d'administration          | `nodefony-studio-dev`   |
| Démarrer le serveur Nodefony                           | `nodefony-start-server` |
| Diagnostiquer un symptôme runtime côté serveur         | `nodefony-debug`        |
| Restituer des mesures à un humain (rapport)            | `nodefony-html-report`  |

## 2. Le décor — deux voies, la locale d'abord

```bash
# Sur le poste — le plus court, et ce que fait l'utilisateur d'une application
node src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs /nodefony/login "Connexion"
```

Les sondes **constatent** où elles s'exécutent (`/.dockerenv`) et en déduisent l'origine à joindre
et le dossier de sortie : `https://127.0.0.1:5152` et `tmp/browser/` en local. Prérequis :
`npm i -D playwright` — pair **optionnel**, dont l'absence s'annonce avec la commande à taper,
jamais par un « module introuvable ».

**Le navigateur n'est pas forcément à télécharger.** L'ordre essayé est `chromium` (celui du
pilote), puis `chrome`, puis `msedge` — les deux derniers étant ceux DÉJÀ posés sur la machine
(Edge est préinstallé sur tout Windows). `npx playwright install chromium` n'est nécessaire que si
aucun ne répond, et il écrit dans un cache utilisateur partagé, pas dans `node_modules`. Le champ
**`navigateur`** de la sortie dit lequel a servi : deux mesures faites par des moteurs différents ne
se comparent pas. `NF_BROWSER_ENGINE` en impose un, sans repli.

> ⚠️ **`NF_BROWSER_ENGINE`, pas `NF_BROWSER_CHANNEL`.** Ce dernier existe déjà et désigne le CANAL
> d'un socket applicatif (`socket.mjs`). Le mot « canal » sert aux deux dans des mondes différents ;
> avoir réutilisé le nom a fait interpréter `nodefony:supervision` comme un navigateur, et le banc
> fonctionnel est tombé. Une collision de variable ne lève aucune erreur — elle change le sens.

```bash
# En conteneur — pour une mesure COMPARABLE (image épinglée par empreinte) ou de l'ISOLATION
docker compose -f docker/docker-compose.yml --profile browser up -d
docker ps --filter name=nodefony-browser --format '{{.Status}}'
```

Le conteneur `nodefony-browser` embarque Chromium et Playwright, est plafonné (2 CPU / 2 Go),
disparaît au `down`, et monte `tmp/browser/` du dépôt sur son `/output`.

**Laquelle prendre** — le conteneur n'est pas « la bonne façon », c'est un compromis :

| Ce qu'on fait                                              | Voie          | Pourquoi                                                                                                                                          |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corriger un écran, vérifier la correction, lire la console | **locale**    | la boucle est bien plus courte — aucune copie entre deux essais (cette session en a payé sept)                                                    |
| **Comparer** une mesure dans le temps ou entre machines    | **conteneur** | image épinglée par empreinte : même navigateur aujourd'hui et dans six mois. Un contraste ne bouge pas d'une version à l'autre — un Web Vital, si |
| **Intégration continue**                                   | **conteneur** | un exécuteur sans interface graphique a déjà tout, et c'est le même décor qu'en local                                                             |
| Session authentifiée avec des identifiants **sensibles**   | **conteneur** | le navigateur n'y voit ni le disque du poste ni son réseau local                                                                                  |
| Ne rien vouloir installer sur le poste                     | **conteneur** | l'image porte navigateur, pilote et bibliothèques système                                                                                         |

Le coût du conteneur, lui, se paie à CHAQUE tour de boucle : le démarrer, recopier les sondes après
chaque modification, joindre l'application par `host.docker.internal` (§4), publier les ports.

## 3. Voir ET mesurer — `inspect.mjs`

> 🔴 **Les sondes vivent dans le PAQUET**, pas ici :
> `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/`. Elles partent sur npm avec le
> devkit, et **un seul exemplaire** sert les deux publics — l'auteur du framework ici, l'utilisateur
> d'une application là-bas. C'est ce qui garantit qu'une sonde cassée se voit le jour même, chez
> quelqu'un qui peut la corriger. Ne pas en réintroduire une copie dans ce dossier.
>
> Corollaire : leurs défauts visent une application QUELCONQUE (page `/`, sondes `h1`/`body`, aucun
> chemin de connexion deviné). Pour Studio, ce sont les réglages ci-dessous qui rétablissent le
> décor — ils ne sont pas facultatifs.

Les scripts sont copiés dans le conteneur puis exécutés. Ils rendent un objet JSON sur la sortie
standard, et `inspect.mjs` écrit une capture horodatée dans `tmp/browser/`.

```bash
docker cp src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/. nodefony-browser:/app/see-screen

# une page publique
docker exec nodefony-browser node /app/see-screen/inspect.mjs /nodefony/login "Connexion"

# une page derrière authentification, avec des sondes de style
docker exec \
  -e NF_BROWSER_LOGIN=/nodefony/login \
  -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  -e "NF_BROWSER_PROBES=menu actif=[class*='NavLink-root'][data-active]" \
  nodefony-browser node /app/see-screen/inspect.mjs /nodefony/supervision "Santé du framework"
```

Le **`/.`** de la copie n'est pas décoratif : sans lui, une seconde copie imbrique un dossier de plus
au lieu de remplacer, et l'on relance une version périmée des sondes sans aucun message.

Ce qu'il rend, et qu'une capture d'écran ne dit pas :

```json
{
  "url": "https://host.docker.internal:5152/nodefony/supervision",
  "theme": "dark",
  "lang": "fr",
  "titre": "Nodefony Studio",
  "scripts": ["https://host.docker.internal:5173/@vite/client", "…/main.tsx"],
  "sondes": [
    {
      "label": "menu actif",
      "texte": "Supervision",
      "couleur": "rgb(255, 255, 255)",
      "fond": "rgb(0, 87, 156)",
      "contraste": 7.39,
      "police": "16px",
      "wcag": "AAA",
      "taille": "243×41"
    }
  ],
  "erreursConsole": [],
  "capture": "tmp/browser/nodefony-supervision-….png"
}
```

**Le contraste est calculé, pas estimé.** C'est ce qui permet de valider une correction de palette
sans attendre un audit complet — et de distinguer « ça me paraît lisible » de « 7,39:1, donc AAA ».
Le verdict `wcag` tient compte de la POLICE, car c'est elle qui décide du seuil : 3:1 pour un texte
large (≥ 24 px, ou ≥ 18,66 px en gras), 4,5:1 sinon. Un contraste rendu sans sa police ne conclut
rien.

`scripts` liste les fichiers réellement servis à la page — à comparer au `dist/frontend/index.html`
bâti quand on soupçonne d'observer une génération précédente (cf §5).

Options par variables d'environnement : `NF_BROWSER_BASE`, `NF_BROWSER_PAGE`, `NF_BROWSER_EXPECT`,
`NF_BROWSER_LOGIN`, `NF_BROWSER_USER`, `NF_BROWSER_PASSWORD`, `NF_BROWSER_PROBES`
(`libellé=sélecteur`, séparés par des virgules). Le détail vit dans l'en-tête du script.
**`NF_BROWSER_LOGIN` n'a pas de défaut** — la sonde ne devine aucun écran de connexion, elle
s'arrête (code 64) si on lui donne un identifiant sans chemin. Pour Studio : `/nodefony/login`.

### Les familles de sondes — `NF_BROWSER_FAMILIES`

Le socle ci-dessus sort toujours. Le reste s'active par famille, chacune rendant un **verdict**
(`OK`/`ALERTE`) et des données bornées — comptes et trois exemples, jamais l'inventaire :

```bash
docker exec -e "NF_BROWSER_FAMILIES=a11y,perf,reseau" \
  -e NF_BROWSER_LOGIN=/nodefony/login -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  nodefony-browser node /app/see-screen/inspect.mjs /nodefony/supervision "Santé du framework"
```

**`axe`** (audit WCAG complet par `axe-core` — une centaine de règles, dont le contraste de TOUT le
texte visible) · `a11y` (étiquettes, noms accessibles, hiérarchie des titres, cibles < 24 px, arbre
d'accessibilité) · `rendu` (débordement, hors-viewport, polices réellement chargées) · `reseau`
(échecs, ressources lourdes et lentes, octets transférés) · `perf` (TTFB, FCP, LCP, CLS, tâches
longues) · `stockage` (attributs des cookies, inventaire du Web Storage — **jamais les valeurs**) ·
`responsive` (le débordement rejoué à plusieurs largeurs). `toutes` active tout ; un nom inconnu est
**refusé** (code 64), jamais ignoré.

> 🔴 **Accessibilité : `axe`, et jamais un calcul maison.** Écrire soi-même une mesure de contraste
> paraît trivial et ne l'est pas — canaux en 0–1 des couleurs CSS modernes, fonds semi-transparents
> à composer, emoji peints par une police en couleurs. Mesuré dans ce dépôt : une sonde maison a
> rendu **41 faux positifs** qui masquaient **7 défauts réels**, dont celui qu'on cherchait.
> `axe-core` est le moteur qu'embarque Lighthouse pour ce volet. Il vient des dépendances du projet,
> donc en conteneur il faut le copier À PART :
> `docker cp node_modules/axe-core/axe.min.js nodefony-browser:/app/see-screen/axe.min.js` — sans
> quoi la famille s'annonce `INDISPONIBLE` plutôt que de rendre un verdict non mesuré.

### Choisir le THÈME — un défaut n'existe souvent que dans l'un des deux

```bash
NF_BROWSER_COLOR_SCHEME=light NF_BROWSER_STORAGE="mantine-color-scheme-value=light" \
  NF_BROWSER_FAMILIES=axe node .../scripts/inspect.mjs /nodefony/documentation "Documentation"
```

`NF_BROWSER_COLOR_SCHEME` émule `prefers-color-scheme` (standard) ; `NF_BROWSER_STORAGE` pose la
clé de stockage quand l'application MÉMORISE le choix — ce qui est le cas de la console
d'administration, dont le thème ne suit alors plus la média query. Toujours **relire le champ
`theme`** de la sortie : c'est lui qui dit quel écran a réellement été mesuré.

Vécu ici : le libellé actif du menu de documentation était à **1,62:1** en clair et parfait en
sombre — invisible tant qu'on ne demandait pas explicitement le thème clair.

**Avant de conclure sur un `ALERTE`, lis quand la famille se trompe** :
`src/packages/@nodefony/devkit/skills/nodefony-browser/references/sondes.md`. En mode développement,
`perf` et `reseau` mesurent Vite autant que l'application — un `ALERTE` y est attendu.

## 3 ter. Piloter le socket de bout en bout — `socket.mjs`

Le scénario s'exécute **dans la page**, donc avec les cookies et l'`Origin` réels : un client Node
« à côté » n'aurait ni l'un ni l'autre, et l'on croirait à un refus d'authentification là où il n'y
a qu'un décor faux. L'endpoint est **requis** — rien n'est deviné.

```bash
docker exec -e NF_BROWSER_PAGE=/nodefony/supervision \
  -e NF_BROWSER_LOGIN=/nodefony/login -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  -e NF_BROWSER_API=/nodefony/kernel/api/stats \
  nodefony-browser node /app/see-screen/socket.mjs /nodefony/studio/api/realtime
```

Il rend, étape par étape : l'accueil (canaux et méthodes annoncés, identité et rôles reçus),
l'abonnement et les poussées horodatées, une action RPC, la **latence médiane** aller-retour, le
pont `api.request`, et une reconnexion avec comparaison d'identité. Sur Studio, l'accueil annonce
six canaux (`nodefony:syslog`, `supervision`, `debugbar`, `orm:health`, `orm:flow`, `socket`).

Grammaire des frames, verdicts (dont `SILENCIEUX`, qui ne veut **pas** dire cassé) et pièges :
`src/packages/@nodefony/devkit/skills/nodefony-browser/references/socket.md`.

## 3 quinquies. L'audit complet — `audit.mjs` (Lighthouse par le port CDP)

Les cinq catégories de Lighthouse sur une page **authentifiée** — dont
**`agentic-browsing`**, qui note ce qu'un agent trouve en arrivant : arbre d'accessibilité,
stabilité visuelle, annotations **WebMCP** des formulaires, outils déclarés, `llms.txt`.

```bash
NF_BROWSER_LOGIN=/nodefony/login NF_BROWSER_USER=admin NF_BROWSER_PASSWORD=secret node src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/audit.mjs /nodefony/documentation
```

Mesuré sur ce dépôt (mode développement) : `accessibility` 93 · `best-practices` 100 · `seo` 91 ·
**`agentic-browsing` 96** · `performance` 30. Les trois audits WebMCP et `llms-txt` sortent **sans
score** — le dépôt ne les implémente pas ; c'est une indication, pas un échec.

- **Le `performance` d'un serveur de développement ne veut rien dire** (modules servis un par un,
  sources non minifiées, rechargement à chaud). Ne le mesurer que sur une version bâtie.
- **Le `decor` est rendu avec les scores** (`desktop`/`mobile`, méthode de bridage) : sans lui, un
  chiffre de performance n'est rattachable à rien.
- **Pourquoi la session survit** : profil PERSISTANT + port de débogage, et `disableStorageReset`
  posé — sans ce dernier, Lighthouse VIDE le stockage avant de mesurer et audite l'écran de
  connexion sans le dire. C'est le piège central d'un audit derrière authentification.
- Le rapport COMPLET est déposé dans `tmp/browser/` : ouvrable dans une visionneuse Lighthouse,
  comparable dans le temps. Le résumé sert à décider, l'original à vérifier.

## 3 quater. Observer ce qui se PASSE — `watch.mjs`

`inspect.mjs` photographie un instant ; celui-ci regarde le temps qui coule. Indispensable pour un
framework dont le temps réel est le cœur : une frame qui n'arrive pas, un canal qui pousse trop, une
reconnexion en boucle ne se voient sur **aucune** capture.

```bash
# la copie du §3 a déjà posé les deux sondes dans /app/see-screen

# observer 7 s de trafic sur une page authentifiée
docker exec -e NF_BROWSER_LOGIN=/nodefony/login \
  -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  nodefony-browser node /app/see-screen/watch.mjs /nodefony/supervision 7000

# s'arrêter sur une CONDITION applicative plutôt que sur une durée
docker exec -e NF_BROWSER_LOGIN=/nodefony/login \
  -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  -e 'NF_BROWSER_UNTIL=() => document.body.innerText.includes("Santé du framework")' \
  nodefony-browser node /app/see-screen/watch.mjs /nodefony/supervision 8000
```

Il rend les **sockets et leurs frames horodatées** (dans les deux sens), les réponses HTTP ≥ 400, les
erreurs de console, et le verdict de la condition. Sur la console d'administration, on y lit le
plan de données passer **par le WebSocket** en JSON-RPC (`api.request`) — ce que le réseau HTTP ne
montre pas.

**Le « point d'arrêt » est une CONDITION, pas une ligne de code.** `waitForFunction` réévalue
l'expression dans la page : on n'y suspend pas l'exécution, on attend un ÉTAT (« le compteur a
bougé », « le socket est connecté »). C'est ce qui remplace utilement un breakpoint dans un pilotage
automatisé.

> 🔴 **Une chaîne passée à `waitForFunction` est évaluée comme une EXPRESSION.** Donner `() => x`
> y **définit** une fonction sans jamais l'appeler : l'objet fonction est truthy, donc l'attente
> réussit **toujours**, même sur une condition impossible. Faux vert vécu, découvert uniquement en
> éprouvant le sens négatif — le script invoque désormais les formes fonction. Corollaire général :
> **toute condition d'arrêt se vérifie avec une condition IMPOSSIBLE**, sinon on ne sait pas si elle
> discrimine.

## 4. Les trois contraintes structurelles

Elles ne se contournent pas : chacune produit un symptôme qui ressemble à un bug applicatif.

| Contrainte                                    | Ce qui arrive sinon                                                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Joindre l'hôte par **`host.docker.internal`** | `localhost` désigne le CONTENEUR. Le nom doit aussi figurer dans `trustedHosts`, sinon la barrière Host répond **`421`** alors que le réseau passe. Posé sans condition dans ce dépôt.          |
| Passer par **HTTPS 5152**                     | Le cookie de session est `secure` : sur une origine `http://` non-`localhost` le navigateur le **jette**, et tout le plan de données revient en `401` — ce qui se lit à tort comme un login KO. |
| Rendre **Vite joignable**, ou servir statique | En mode Vite, la page annonce ses assets sur une origine dérivée du `Host` de la requête : arriver par `host.docker.internal` suffit. Servir l'interface pré-bâtie reste l'autre voie.          |

Pour la troisième, **il n'y a plus rien à poser**. L'origine des assets — et avec elle
`allowedHosts` et le WebSocket du HMR — suit le nom par lequel le client est arrivé : le poste et
le conteneur sont servis EN MÊME TEMPS par la même instance Vite.

> Il a existé une variable d'observation (`NF_FRONTEND_PUBLIC_ORIGIN`) pour figer cette origine sur
> `host.docker.internal`. Elle a **cassé le poste du développeur** le jour où on a oublié de la
> retirer — un navigateur local ne résout pas ce nom, et rien ne le signalait côté serveur. Elle
> n'existe plus : une variable dont l'oubli casse un environnement n'avait pas besoin d'un rappel,
> elle avait besoin de disparaître. Le réglage durable, lui, reste `frontend.publicOrigin` dans
> `nodefony.config.ts` — pour un tunnel ou un proxy frontal, pas pour observer un écran.
>
> Deux conditions à la dérivation, qui expliquent un éventuel retour à `127.0.0.1` : le nom doit
> franchir `trustedHosts` (il y est, sans condition, dans ce dépôt), et aucune `publicOrigin` ne
> doit être configurée — un réglage explicite gagne toujours sur une déduction.

## 5. Pièges — chacun a déjà fait conclure faux

- **🔴 Mesurer trop tôt.** `networkidle` ne suffit pas : une application se monte, PUIS demande ses
  données. On mesure alors des sondes « absentes » et des `401` encore en vol, et l'on décrit un
  écran qui n'existe déjà plus. **Attendre un texte DISCRIMINANT** de la page visée — pas un état du
  réseau, et pas un texte présent aussi bien sur l'écran de connexion (« Nodefony Studio » ne prouve
  rien).
- **🔴 Le bundle SERVI n'est pas toujours celui qu'on a bâti.** À contrôler AVANT toute conclusion,
  sinon on accuse son propre code d'un défaut appartenant à une génération précédente. Le champ
  **`scripts`** rendu par `inspect.mjs` donne les fichiers réellement servis à la page — c'est la
  voie courte, puisqu'on vient de la mesurer. Sinon, à la main :
  ```bash
  curl -sk https://127.0.0.1:5152/nodefony | grep -o 'index-[A-Za-z0-9_-]*\.js'
  grep -o 'index-[A-Za-z0-9_-]*\.js' <module>/dist/frontend/index.html
  ```
  Deux valeurs différentes ⇒ rebâtir, **redémarrer le serveur** (le service d'assets lit son
  `index.html` au démarrage), puis redémarrer le conteneur.
- **Les erreurs de console d'un parcours de connexion ne sont pas des défauts.** Se connecter
  produit des `401` sur la vérification d'identité — ils disparaissent dès que l'état
  d'authentification est réutilisé. Les rapporter comme des bugs est un faux signal classique.
- **Une capture ne s'écrase pas.** Réutiliser un nom laisse l'ancienne image en place pendant que
  l'appel répond « OK » : on lit un écran périmé. Le script horodate ; ne pas le contourner.
- **Un état d'authentification sauvegardé peut être périmé** (session expirée, serveur redémarré) :
  le script le constate et refait le parcours, plutôt que de mesurer l'écran de connexion.

## 6. Ce que le conteneur ne remplace pas

Le HMR, l'animation et le rendu fin (polices, sous-pixel) se jugent dans le navigateur du
développeur. Ce conteneur sert à constater qu'un écran **se monte, s'alimente et ne crie pas**, et à
en tirer des nombres — pas à valider une esthétique.

## 7. Références

- **Les sondes**, dans le paquet qui les publie :
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs` — photographie, mesure, familles de sondes ;
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/watch.mjs` — le temps réel observé ;
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs` — le socket applicatif piloté de bout en bout ;
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs` — lancement, connexion, ouverture garantie de la bonne page ;
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/wcag.mjs` — luminances, rapport de contraste, seuils ;
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/probes.mjs` — analyse des sondes, allowlist des familles, médiane.

  Leurs deux références détaillées — champ par champ, et **quand chaque mesure se trompe** :
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/references/sondes.md`
  - `src/packages/@nodefony/devkit/skills/nodefony-browser/references/socket.md`

  Le `SKILL.md` voisin est celui que reçoit l'utilisateur d'une application : les corriger corrige
  les deux publics d'un coup. Leur gate (`devkit/tests/skills.test.ts`) refuse tout retour du
  vocabulaire de ce dépôt dans ces fichiers, et `devkit/tests/browser-*.test.ts` éprouve la logique
  pure (seuils WCAG, allowlist) plus un banc fonctionnel paramétré par `NF_BROWSER_TEST_*`.

- `references/playwright/` — documentation Playwright hors ligne (guides `locators`, `auth`,
  `input`, `screenshots`, `docker` ; API `class-page`, `class-locator`). À consulter avant d'écrire
  un pilotage : elle a déjà corrigé quatre écarts dans `inspect.mjs`.
- `references/pilotage-mcp.md` — l'autre voie, par le serveur MCP du conteneur (exploration
  interactive), et **le piège du heartbeat** qui tue toute session en cinq secondes.
