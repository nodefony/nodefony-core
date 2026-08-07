---
name: nodefony-browser
metadata:
  version: 1.0.0
description: >
  Ouvre une page réelle dans un navigateur en conteneur pour la VOIR et surtout la MESURER —
  contrastes et tailles calculés, arbre d'accessibilité, erreurs de console, requêtes réseau — sans
  installer de navigateur sur le poste. Vaut pour toute page servie par Nodefony : console
  d'administration, module à frontend, application produite par le scaffold. Porte le décor, le
  pilotage de Playwright et les pièges qui font conclure FAUX : mesurer avant que l'écran soit
  peuplé, joindre l'hôte par le mauvais nom, observer un bundle qui n'est pas celui qu'on a bâti.
  À charger AVANT de constater quoi que ce soit à l'écran. Déclencheurs : "regarde l'écran",
  "vérifie l'affichage", "est-ce que ça s'affiche ?", "montre-moi la page", "lis la console",
  "y a-t-il des erreurs JS ?", "mesure le contraste", "cette couleur est-elle lisible ?",
  "capture d'écran", "l'application générée fonctionne-t-elle ?", "vérifie l'accessibilité",
  "audit lighthouse", "quelles requêtes fait la page ?".
---

# nodefony-browser — voir et MESURER une page, sans navigateur sur le poste

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

## 2. Le décor — un service, déjà déclaré

```bash
docker compose -f docker/docker-compose.yml --profile browser up -d
docker ps --filter name=nodefony-browser --format '{{.Status}}'
```

Le conteneur `nodefony-browser` embarque Chromium et Playwright, est plafonné (2 CPU / 2 Go),
disparaît au `down`, et monte `tmp/browser/` du dépôt sur son `/output` — **les captures et les
mesures sortent du conteneur**, c'est tout l'intérêt du service déclaré.

## 3. Voir ET mesurer — `scripts/inspect.mjs`

Le script est copié dans le conteneur puis exécuté. Il rend un objet JSON sur la sortie standard
et écrit une capture horodatée dans `tmp/browser/`.

```bash
docker cp .claude/skills/nodefony-browser/scripts/inspect.mjs nodefony-browser:/app/inspect.mjs

# une page publique
docker exec nodefony-browser node /app/inspect.mjs /nodefony/login

# une page derrière authentification, avec des sondes de style
docker exec \
  -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  -e "NF_BROWSER_PROBES=menu actif=[class*='NavLink-root'][data-active]" \
  nodefony-browser node /app/inspect.mjs /nodefony/supervision "Santé du framework"
```

Ce qu'il rend, et qu'une capture d'écran ne dit pas :

```json
{
  "url": "https://host.docker.internal:5152/nodefony/supervision",
  "schema": "dark",
  "lang": "fr",
  "titre": "Nodefony Studio",
  "sondes": [
    {
      "label": "menu actif",
      "texte": "Supervision",
      "couleur": "rgb(255, 255, 255)",
      "fond": "rgb(0, 87, 156)",
      "contraste": 7.39,
      "taille": "243×41"
    }
  ],
  "erreursConsole": [],
  "capture": "tmp/browser/nodefony-supervision-….png"
}
```

**Le contraste est calculé, pas estimé.** C'est ce qui permet de valider une correction de palette
sans attendre un audit complet — et de distinguer « ça me paraît lisible » de « 7,39:1, donc AAA ».

Options par variables d'environnement : `NF_BROWSER_BASE`, `NF_BROWSER_PAGE`, `NF_BROWSER_EXPECT`,
`NF_BROWSER_USER`, `NF_BROWSER_PASSWORD`, `NF_BROWSER_PROBES` (`libellé=sélecteur`, séparés par des
virgules). Le détail vit dans l'en-tête du script.

## 3 bis. Observer ce qui se PASSE — `scripts/watch.mjs`

`inspect.mjs` photographie un instant ; celui-ci regarde le temps qui coule. Indispensable pour un
framework dont le temps réel est le cœur : une frame qui n'arrive pas, un canal qui pousse trop, une
reconnexion en boucle ne se voient sur **aucune** capture.

```bash
docker cp .claude/skills/nodefony-browser/scripts/watch.mjs nodefony-browser:/app/watch.mjs

# observer 7 s de trafic sur une page authentifiée
docker exec -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  nodefony-browser node /app/watch.mjs /nodefony/supervision 7000

# s'arrêter sur une CONDITION applicative plutôt que sur une durée
docker exec -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret \
  -e 'NF_BROWSER_UNTIL=() => document.body.innerText.includes("Santé du framework")' \
  nodefony-browser node /app/watch.mjs /nodefony/supervision 8000
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
  sinon on accuse son propre code d'un défaut appartenant à une génération précédente :
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

- `references/playwright/` — documentation Playwright hors ligne (guides `locators`, `auth`,
  `input`, `screenshots`, `docker` ; API `class-page`, `class-locator`). À consulter avant d'écrire
  un pilotage : elle a déjà corrigé quatre écarts dans `inspect.mjs`.
- `references/pilotage-mcp.md` — l'autre voie, par le serveur MCP du conteneur (exploration
  interactive), et **le piège du heartbeat** qui tue toute session en cinq secondes.
