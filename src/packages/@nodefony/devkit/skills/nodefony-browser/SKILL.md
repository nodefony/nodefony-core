---
name: nodefony-browser
description: >
  Ouvre un écran de ton application dans un navigateur piloté pour le VOIR et surtout le MESURER —
  contrastes et tailles réellement calculés par le moteur de rendu, audit d'accessibilité par
  axe-core, erreurs de console, requêtes HTTP, frames WebSocket. Fonctionne sur ta machine
  (Playwright) ou dans un conteneur jetable, au choix. Porte les sondes prêtes à l'emploi, le choix
  du thème clair ou sombre — un défaut d'affichage n'existe souvent que dans l'un des deux —, les
  contraintes de réseau qui font répondre `421` ou `401` à une application pourtant saine, et les
  pièges qui font conclure FAUX : mesurer avant que l'écran soit peuplé, observer un bundle qui
  n'est plus celui du code, prendre une condition d'arrêt qui réussit toujours. Sait aussi piloter
  un socket temps réel de bout en bout : accueil, abonnement à un canal, action, latence médiane,
  pont API, reconnexion. À charger AVANT de conclure quoi que ce soit sur un écran.
  Déclencheurs : "regarde l'écran", "vérifie l'affichage", "est-ce que ça s'affiche ?",
  "montre-moi la page", "lis la console", "y a-t-il des erreurs JS ?", "mesure le contraste",
  "cette couleur est-elle lisible ?", "capture d'écran", "vérifie l'accessibilité",
  "audit accessibilité", "audit WCAG", "en mode clair", "en mode sombre", "le thème sombre",
  "la page est-elle rapide ?", "temps de chargement", "responsive ?",
  "quelles requêtes fait la page ?", "le temps réel arrive-t-il jusqu'à l'écran ?",
  "teste le socket", "mesure la latence du websocket", "le canal pousse-t-il ?",
  "l'application démarre-t-elle vraiment ?".
---

# see-screen — voir et MESURER un écran

> ⚖️ **La confiance n'exclut pas le contrôle.** Un `curl` prouve qu'une route répond ; il ne dit
> pas si l'écran se monte, s'alimente et ne crie pas dans la console.

## Le geste — sur ta machine

```bash
npm i -D playwright && npx playwright install chromium
node node_modules/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs /
```

C'est tout. Les sondes **constatent** où elles s'exécutent : sur ta machine elles visent
`https://127.0.0.1:5152` et déposent leurs captures dans `tmp/browser/`. Rien à configurer tant que
tu ne changes pas de port — et `NF_BROWSER_BASE` est là si tu le changes.

Playwright est un **pair optionnel** : il porte un navigateur de plus de cent mégaoctets, qu'il
serait déraisonnable d'imposer à qui n'a pas besoin de regarder un écran. Tant qu'il manque, les
sondes s'arrêtent en le disant, avec la commande exacte à taper — jamais sur un « module
introuvable » nu.

## L'autre voie — en conteneur, et QUAND s'en servir

Le conteneur n'est pas « la bonne façon » : c'est un compromis, et il se choisit sur ce que tu es en
train de faire.

| Ce que tu fais                                                         | La voie       | Pourquoi                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corriger un écran et vérifier ta correction                            | **locale**    | la boucle est bien plus courte — pas de copie vers un conteneur entre deux essais                                                                                                             |
| Regarder une page vite fait, lire la console                           | **locale**    | une commande, rien à démarrer                                                                                                                                                                 |
| **Comparer une mesure** dans le temps ou entre machines                | **conteneur** | l'image est épinglée par empreinte : le même navigateur aujourd'hui et dans six mois. Un contraste ne bouge pas d'une version de navigateur à l'autre — un temps de rendu ou un Web Vital, si |
| **Intégration continue**                                               | **conteneur** | un exécuteur sans interface graphique a déjà tout ; même décor qu'en local                                                                                                                    |
| Piloter une session authentifiée avec des identifiants **sensibles**   | **conteneur** | le navigateur n'y voit ni ton disque ni ton réseau local                                                                                                                                      |
| Tu ne veux **rien** installer, ou ta machine n'a pas les bibliothèques | **conteneur** | l'image porte navigateur, pilote et dépendances système                                                                                                                                       |

Ce que le conteneur coûte, en revanche : le démarrer, recopier les sondes à chaque modification,
joindre ton application par un nom particulier (ci-dessous), et publier les ports. Sur une boucle de
correction, cela se paie à chaque tour.

```bash
docker compose --profile browser up -d
docker cp node_modules/@nodefony/devkit/skills/nodefony-browser/scripts/. mon-app-browser:/app/see-screen
docker cp node_modules/axe-core/axe.min.js mon-app-browser:/app/see-screen/axe.min.js
docker exec mon-app-browser node /app/see-screen/inspect.mjs /
```

Le conteneur s'appelle **`<nom-de-ton-app>-browser`** — fixé par le `compose.yaml`, rien à chercher.

> Le **`/.`** de la copie n'est pas décoratif : il copie le CONTENU du dossier. Sans lui, une
> seconde copie **imbrique** un dossier de plus au lieu de remplacer, et tu relances alors une
> version périmée des sondes en croyant les avoir mises à jour — sans le moindre message.

La troisième ligne emporte `axe-core`, qui vit dans les dépendances de ton projet et n'est donc pas
dans le dossier des sondes. Sans elle, la famille `axe` s'annonce **indisponible** et te donne cette
commande — elle ne rend jamais un verdict qu'elle n'a pas mesuré.

Ces commandes tiennent chacune sur **une ligne** et n'emploient ni substitution, ni tube, ni
continuation : elles passent telles quelles dans un terminal Linux, macOS, PowerShell ou `cmd.exe`.

> **Ne demande jamais à l'utilisateur de jouer la sonde** (« recharge et dis-moi ce que dit la
> console »). C'est le travail de cet outil, quelle que soit la voie choisie.

## Ce que la sonde rend, et qu'une capture ne dit pas

```bash
docker exec -e NF_BROWSER_LOGIN=/login -e NF_BROWSER_USER=admin -e NF_BROWSER_PASSWORD=secret -e "NF_BROWSER_PROBES=bouton principal=button[type=submit],titre=h1" mon-app-browser node /app/see-screen/inspect.mjs /tableau-de-bord "Chiffre d affaires"
```

Le troisième argument est un **texte discriminant** attendu avant toute mesure (voir les pièges).

```json
{
  "url": "https://host.docker.internal:5152/tableau-de-bord",
  "theme": "light",
  "lang": "fr",
  "titre": "Mon application",
  "scripts": ["/static/index-B7fK2p.js"],
  "sondes": [
    {
      "label": "bouton principal",
      "texte": "Enregistrer",
      "couleur": "rgb(255, 255, 255)",
      "fond": "rgb(0, 87, 156)",
      "contraste": 7.39,
      "police": "16px",
      "wcag": "AAA",
      "taille": "243×41"
    }
  ],
  "erreursConsole": [],
  "capture": "tmp/browser/tableau-de-bord-….png"
}
```

**Le contraste est CALCULÉ, pas estimé** — luminances WCAG sur les couleurs que le moteur de rendu
applique vraiment, fond effectif obtenu en EMPILANT toutes les couches translucides jusqu'au premier
ancêtre opaque, puis en les composant. C'est ce qui sépare
« ça me paraît lisible » de « 7,39:1, donc AAA », et ce qui permet de valider une correction de
palette sans attendre un audit complet.

Le champ `wcag` tranche pour toi, parce que le seuil dépend de la **police** et non de la taille du
bloc : WCAG appelle « large » un texte d'au moins 24 px (ou 18,66 px en gras) et lui applique 3:1 au
lieu de 4,5:1. Un contraste rendu sans sa police laisse le lecteur choisir son seuil au hasard —
c'est-à-dire ne rien conclure.

**Un sélecteur par élément qui t'intéresse** : un contraste n'existe pas « pour une page », il existe
pour un élément contre son fond. La sonde ne connaît donc aucun sélecteur — les tiens viennent de
`NF_BROWSER_PROBES`, et c'est ce qui la garde utilisable quelle que soit ta bibliothèque de
composants.

Réglages par variables d'environnement : `NF_BROWSER_BASE`, `NF_BROWSER_PAGE`, `NF_BROWSER_EXPECT`,
`NF_BROWSER_LOGIN`, `NF_BROWSER_USER`, `NF_BROWSER_PASSWORD`, `NF_BROWSER_PROBES`
(`libellé=sélecteur`, séparés par des virgules), `NF_BROWSER_FAMILIES`, `NF_BROWSER_WIDTHS`,
`NF_BROWSER_SEUIL_LOURD`, `NF_BROWSER_SEUIL_LENT`. Le détail vit dans l'en-tête de chaque script.

**`NF_BROWSER_LOGIN` n'a pas de défaut** : c'est le chemin du formulaire de connexion de **ton**
application. Il n'en existe pas d'universel, et deviner enverrait la sonde sur une page inexistante,
où elle mesurerait un écran d'erreur en croyant s'être authentifiée. Sans lui, un identifiant posé
fait s'arrêter la sonde avec un message — jamais une mesure fausse.

Les sondes de couleur cherchent tes sélecteurs, pas ceux d'une bibliothèque : le thème est lu sur le
`color-scheme` **calculé** (ce que le moteur applique) et sur `data-theme`. Si ton application marque
son thème autrement, sonde-le comme n'importe quel autre élément.

### Mesurer dans le thème que tu veux — pas seulement celui par défaut

**Un défaut d'affichage n'existe souvent que dans UN des deux thèmes.** Vécu : un libellé de menu
actif à **1,62:1** en clair — illisible — et impeccable en sombre, où la même variable de couleur
rend une nuance opposée. Tant qu'on ne regarde qu'un seul thème, la palette paraît saine.

```bash
NF_BROWSER_COLOR_SCHEME=light NF_BROWSER_FAMILIES=axe node .../scripts/inspect.mjs /tableau-de-bord "Chiffre d affaires"
```

`NF_BROWSER_COLOR_SCHEME` émule `prefers-color-scheme` — la média query standard, comprise quelle
que soit ta trousse d'interface. Valeurs : `light`, `dark`, `no-preference` ; toute autre est
**refusée** (code 64), car l'accepter ferait mesurer le thème par défaut en croyant tenir l'autre.

Si ton application **mémorise** le choix de l'utilisateur, elle n'obéit plus à cette média query :
donne alors la clé de stockage, qui t'appartient — le code ne la devine pas.

```bash
NF_BROWSER_STORAGE="ma-cle-de-theme=light" node .../scripts/inspect.mjs /
```

Le champ `theme` de la sortie dit ce qui a été RÉELLEMENT appliqué. Vérifie-le : c'est ainsi qu'on
sait qu'on a mesuré le bon écran.

## Les familles de sondes — activables, jamais un mur de JSON

Le socle ci-dessus sort toujours. Le reste s'active par famille, chacune rendant un **verdict**
(`OK`/`ALERTE`) et des données bornées — comptes et 3 exemples, jamais l'inventaire :

```bash
NF_BROWSER_FAMILIES=axe,perf,reseau node .../scripts/inspect.mjs /tableau-de-bord "Chiffre d affaires"
```

| Famille      | Question à laquelle elle répond                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------- |
| **`axe`**    | **Audit WCAG complet par `axe-core` — une centaine de règles, dont le contraste de TOUT le texte** |
| `a11y`       | Étiquettes, noms accessibles, hiérarchie des titres, cibles < 24 px, arbre d'accessibilité         |
| `rendu`      | Débordement horizontal, éléments hors viewport, polices RÉELLEMENT chargées                        |
| `reseau`     | Requêtes, échecs, ressources lourdes et lentes, octets réellement transférés                       |
| `perf`       | TTFB, FCP, LCP, CLS, tâches longues — verdict sur les seuils Web Vitals                            |
| `stockage`   | Attributs des cookies et inventaire du Web Storage — **jamais les valeurs**                        |
| `responsive` | Le débordement horizontal rejoué à plusieurs largeurs (`NF_BROWSER_WIDTHS`)                        |

`NF_BROWSER_FAMILIES=toutes` active tout ; un nom inconnu est **refusé** (code 64), jamais ignoré.
Ce que chaque champ veut dire, comment lire un verdict, et **quand chaque famille se trompe** :
[`references/sondes.md`](references/sondes.md) — à lire avant de conclure sur un `ALERTE`.

> 🔴 **Pour l'accessibilité, prends `axe` — pas `a11y` seule, et n'écris JAMAIS ton propre calcul.**
> Les règles WCAG sont pleines de cas particuliers qu'on ne devine pas : canaux en 0–1 des
> couleurs CSS modernes, fonds semi-transparents à composer sur ce qu'il y a dessous, texte peint
> par une police en couleurs, éléments masqués aux seules techniques d'assistance. Une sonde écrite
> à la main les rate et produit des échecs inventés **qui noient les vrais** — mesuré : quarante et
> un faux positifs contre sept défauts réels, dont celui qu'on cherchait, invisible au milieu.
> `axe-core` est le moteur qu'embarque Lighthouse pour ce volet ; `a11y` reste utile pour ce qu'il
> ne fait pas — l'arbre d'accessibilité brut et les cibles trop petites.
>
> `axe` distingue trois choses, et la nuance compte : les **manquements** (avérés, ils font
> l'alerte), les cas **à vérifier** (le moteur refuse de trancher — un fond en image, par exemple —
> et ce n'est PAS un défaut), et les règles **conformes**. Chaque manquement rend jusqu'à cinq
> cibles distinctes plus le compte des autres : une même règle couvre des défauts à des endroits
> différents, qui ne se corrigent pas d'un seul geste.

## Auditer la page comme un moteur de recherche et un agent la voient — `audit.mjs`

Lighthouse complet, y compris **derrière une authentification** — ce que l'extension du navigateur
ne sait pas faire sur une application protégée.

```bash
npm i -D lighthouse
NF_BROWSER_LOGIN=/login NF_BROWSER_USER=admin NF_BROWSER_PASSWORD=secret node .../scripts/audit.mjs /tableau-de-bord
```

Il rend les scores des cinq catégories — dont **`agentic-browsing`**, qui note ce qu'un agent
d'intelligence artificielle trouve en arrivant sur ta page : arbre d'accessibilité bien formé,
stabilité visuelle, annotations **WebMCP** de tes formulaires, outils déclarés, et présence d'un
`llms.txt`. Puis les audits ratés, **classés par poids** — ce qui coûte le plus à ta note, en
premier.

```json
{
  "verdict": "ALERTE",
  "decor": { "appareil": "desktop", "bridage": "simulate" },
  "scores": {
    "performance": 30,
    "accessibility": 93,
    "best-practices": 100,
    "seo": 91,
    "agentic-browsing": 96
  },
  "auditsRates": { "total": 22, "exemples": [] },
  "rapportComplet": "tmp/browser/lighthouse-….json"
}
```

Le rapport COMPLET est déposé à côté : le résumé sert à décider, l'original à vérifier et à
comparer dans le temps. Tu peux l'ouvrir tel quel dans une visionneuse Lighthouse.

**Trois choses à savoir, sans quoi les chiffres trompent :**

- **Le `decor` fait partie de la mesure.** Un score de performance sans son appareil ne veut rien
  dire. Le défaut est `desktop` ; `NF_BROWSER_FORMFACTOR=mobile` simule un téléphone bridé, et les
  chiffres n'ont alors plus rien à voir.
- **Ne juge pas la performance d'un serveur de DÉVELOPPEMENT.** Modules servis un par un, sources
  non minifiées, rechargement à chaud : la note s'effondre pour des raisons qui n'existent pas en
  production. Cette catégorie ne se mesure que sur une version bâtie.
- **Un audit sans score n'a pas échoué** — il ne s'applique pas. Les audits WebMCP et `llms.txt`
  sortent ainsi tant que tu ne les as pas mis en place ; c'est une indication, pas un reproche.

> **Comment l'authentification survit** alors que Lighthouse ouvre son propre onglet : le navigateur
> est lancé avec un profil PERSISTANT et un port de débogage ; on s'y connecte, puis Lighthouse s'y
> branche et hérite du profil. Et `disableStorageReset` est posé — sans lui, Lighthouse **vide le
> stockage** avant de mesurer, donc les témoins de session, et audite l'écran de connexion sans le
> dire.

## Observer ce qui se PASSE — `watch.mjs`

`inspect.mjs` photographie un instant ; celui-ci regarde le temps qui coule. C'est la seule façon de
voir une frame qui n'arrive pas, un canal qui pousse trop, une reconnexion en boucle — rien de tout
cela n'apparaît sur une capture.

```bash
docker exec mon-app-browser node /app/see-screen/watch.mjs /tableau-de-bord 7000
docker exec -e "NF_BROWSER_UNTIL=() => document.querySelectorAll('tbody tr').length >= 3" mon-app-browser node /app/see-screen/watch.mjs /articles 8000
```

La seconde s'arrête sur une **condition applicative** plutôt que sur une durée. Note les guillemets :
doubles à l'extérieur, simples à l'intérieur de l'expression — l'inverse ne survit pas à `cmd.exe`.

Il rend les **sockets et leurs frames horodatées dans les deux sens**, les réponses HTTP ≥ 400, les
erreurs de console et le verdict de la condition. Un controller temps réel se vérifie ainsi de bout
en bout : le message part-il, revient-il, et l'écran le reçoit-il ?

> 🔴 **Une condition d'arrêt se vérifie avec une condition IMPOSSIBLE.** Une chaîne passée à
> `waitForFunction` est évaluée comme une **expression** : `() => x` y **définit** une fonction sans
> jamais l'appeler, l'objet fonction est truthy, et l'attente réussit **toujours** — même sur une
> condition qui ne peut pas être vraie. La sonde invoque désormais les formes fonction ; le principe,
> lui, vaut pour toute attente que tu écriras : tant qu'elle n'a pas échoué une fois, elle ne
> discrimine rien.

## Piloter le socket de bout en bout — `socket.mjs`

`watch.mjs` regarde le trafic d'une page ; celui-ci **conduit** : il ouvre un socket temps réel
depuis la page (cookies et `Origin` réels), attend l'accueil, s'abonne à un canal, appelle une
action, mesure la latence médiane, rejoue une route par le pont API, ferme et se reconnecte — un
verdict par étape.

```bash
docker exec -e NF_BROWSER_API=/api/sante mon-app-browser node /app/see-screen/socket.mjs /chat/realtime
```

Le chemin du endpoint est **requis** (1er argument ou `NF_BROWSER_SOCKET`) : c'est une route de ton
application, rien n'est deviné. `NF_BROWSER_CHANNEL` choisit le canal (défaut : le premier annoncé
par l'accueil) ; `NF_BROWSER_ACTION` une action RPC ; sans méthode corrélée la latence est
`NON MESURÉE` — jamais un zéro inventé, car la notification `ping` n'a pas de pong.

Le protocole du fil (les quatre formes de frame), la lecture de chaque verdict — dont
`SILENCIEUX`, qui n'est **pas** « cassé » — et les pièges :
[`references/socket.md`](references/socket.md).

## Trois contraintes de réseau — chacune imite un bug applicatif

| Contrainte                                   | Ce qui arrive sinon                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Joindre l'app par **`host.docker.internal`** | `localhost` désigne le CONTENEUR, pas ta machine. Et si tu as activé `domainCheck`, ajoute ce nom aux `trustedHosts` en développement : sinon la barrière répond **`421`** alors que le réseau passe.                                      |
| Passer par **HTTPS**                         | Le cookie de session est `secure` : sur une origine `http://` non-`localhost`, le navigateur le **jette**, et tout revient en **`401`** — ce qui se lit à tort comme un login qui rate.                                                    |
| **Rien à poser** pour rendre Vite joignable  | L'origine des assets se dérive du `Host` de ta requête : arriver par `host.docker.internal` suffit — l'allowlist Vite et le WebSocket du rechargement à chaud suivent le même nom, et ton poste reste servi sur `127.0.0.1` en même temps. |

Si la page annonce quand même `127.0.0.1` depuis le conteneur, c'est que le nom ne franchit pas
`trustedHosts`, ou qu'une `publicOrigin` explicite est configurée dans `nodefony.config.ts` — un
réglage durable gagne toujours sur une déduction.

## Pièges — chacun a déjà fait conclure faux

- **🔴 Mesurer trop tôt.** Une application se monte, PUIS demande ses données. Attendre un « réseau
  calme » te fait mesurer un écran vide, avec des sondes absentes et des `401` encore en vol.
  Attends un **texte discriminant de la page visée** — pas un texte présent aussi sur l'écran de
  connexion (le nom de l'application aboutit dans les deux cas : il ne prouve rien).
- **🔴 Le bundle servi n'est pas toujours celui que tu as bâti.** À contrôler AVANT d'accuser ton
  code, sinon tu débogues une génération précédente. Le champ **`scripts`** rendu par `inspect.mjs`
  donne les fichiers réellement servis à la page : compare-les à ceux que désigne l'`index.html`
  produit dans `dist/frontend/` de ton module. Deux valeurs différentes ⇒ rebâtis, **redémarre le
  serveur** (le service d'assets lit son `index.html` au démarrage), puis redémarre le conteneur —
  son cache HTTP survit à un simple rechargement.
- **Les erreurs de console d'un parcours de connexion ne sont pas des défauts.** Se connecter
  produit des `401` sur la vérification d'identité ; ils disparaissent dès que l'état
  d'authentification est réutilisé.
- **Une capture ne s'écrase pas.** Réutiliser un nom laisse l'ancienne image en place pendant que
  l'appel répond « OK » : tu lis un écran périmé. Les sondes horodatent — ne le contourne pas.
- **Un état d'authentification sauvegardé peut être périmé** (session expirée, serveur redémarré).
  Les sondes le constatent et refont le parcours plutôt que de mesurer l'écran de connexion.

## L'autre voie : le serveur MCP du conteneur

La même image expose un serveur MCP (`http://127.0.0.1:3001/mcp`) auquel un agent se branche pour
**explorer** une page interactivement. Prends-le pour cela — et le pilotage direct ci-dessus pour
tout le reste : une commande, un JSON, un code de retour, quelques secondes. Le protocole
intermédiaire coûte plusieurs fois ce temps, ne rend pas de valeur exploitable par un script, et
sa session peut tomber sous toi.

## Ce que ce navigateur ne remplace pas

Le rechargement à chaud, l'animation et le rendu fin (polices, sous-pixel) se jugent dans un vrai
navigateur, sur ton poste. Celui-ci répond à « l'écran se monte-t-il, s'alimente-t-il, crie-t-il ? »
— et en tire des nombres.
