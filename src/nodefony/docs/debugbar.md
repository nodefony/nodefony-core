---
title: "Barre de débogage — nodefony/debugbar"
lang: fr
module: "@nodefony/core"
topic: debugbar
source: "src/nodefony/docs/debugbar.md"
updated: 2026-10-24
navTitle: Barre de débogage
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "client/debugbar/DebugBar.ts,client/debugbar/model.ts,client/debugbar/requests.ts,client/debugbar/feedView.ts,client/debugbar/index.ts"
section: "Cœur runtime"
audience: [developer]
tags:
  [
    debugbar,
    developpement,
    observabilite,
    journaux,
    temps-reel,
    requestId,
    accessibilite,
    stockage-local,
  ]
version: "doc"
status: stable
---

# Barre de débogage

Une bande fine en bas de page, en développement, qui montre ce que le serveur est
en train de faire : le débit temps réel, la charge, la mémoire, les requêtes
réseau et les journaux — sans quitter l'écran qu'on est en train de construire.

Elle est livrée avec le cœur et ne dépend d'aucun cadre front : elle s'installe
dans une page rendue par un serveur comme dans une application React, Vue,
Angular ou Svelte.

📍 [Documentation](../../../docs/index.md) › [`nodefony` — le cœur](index.md) › **Barre de débogage**

## Démarrage rapide

```ts
/// <reference types="vite/client" />
// Dans un front servi par Vite : `import.meta.env.DEV` vaut true en développement.
import { mountDebugBar } from "nodefony/debugbar";

// En développement uniquement — la barre n'a rien à faire en production.
if (import.meta.env.DEV) mountDebugBar();
```

Sur une page rendue par le serveur, sans étape de construction :

```html
<script
  type="module"
  src="/node_modules/nodefony/dist/client/debugbar.standalone.js"
></script>
```

La barre lit le canal temps réel de l'application. Elle n'ouvre **aucune**
seconde connexion : elle partage la socket déjà présente si la page en a une.
Et elle ne l'ouvre **pas au montage** : la socket appartient à l'application, qui
décide quand l'ouvrir (la console d'administration attend le login). La barre ne
se connecte que quand on lui demande des données — panneau ouvert, ou temps réel
démarré.

## Ce qu'on voit, et ce qu'on peut faire

Le **bandeau** porte l'essentiel en une ligne : le logo, l'environnement du
serveur (connu dès le rendu de la page), la branche git (une fois connue), le
contrôle « Temps réel », puis le débit, la charge processeur et la mémoire, enfin
les compteurs réseau, rechargements à chaud (`hmr`, avec un front Vite), journaux
et erreurs. Ce qui n'est pas encore connu ne s'affiche pas : un badge vide se
lirait comme une valeur.

Chaque élément du bandeau porte une aide qui s'ouvre au survol **et au focus
clavier**, et chaque indicateur est un raccourci : cliquer « cpu » ouvre l'onglet
qui le détaille. Le bandeau lui-même ne se replie pas au clic : seuls le logo et
le bouton « Ouvrir / Fermer » basculent le panneau.

| Contrôle                     | Ce qu'il fait                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| logo `◆ nodefony`            | Ouvre ou ferme le panneau.                                                                    |
| `Temps réel · <état>`        | Démarre ou arrête les mesures et journaux en direct. **Arrêté par défaut** (voir ci-dessous). |
| `Réduire`                    | Réduit la barre en pastille, dans un coin de l'écran ; la pastille la rouvre.                 |
| `Ouvrir` / `Fermer`          | Ouvre ou ferme le panneau.                                                                    |
| réglages : `À gauche/droite` | Coin où se pose la pastille réduite (onglet Runtime, carte « Stockage local »).               |

Le contrôle « Temps réel » dit son état en toutes lettres : `arrêté`, `connexion…`,
`en direct`, `en pause` (la socket est ouverte par l'application, mais la barre ne
reçoit rien), ou `accès refusé` — la barre lit les données d'administration, et
sans session administrateur le serveur refuse le handshake (401/403, avant toute ouverture). Le
refus se lit, il ne se confond pas avec une panne.

> **Pourquoi le temps réel est arrêté par défaut** : l'abonnement fait tourner des
> compteurs et un émetteur de journaux côté serveur. En développement on ouvre
> beaucoup d'onglets ; les laisser tous branchés en permanence ferait payer à
> l'application un travail que personne ne regarde. C'est un choix d'adhésion,
> pas une option cachée.

## Les cinq onglets

**Realtime** — débit, transport, protocole, état de la socket, frames reçues,
pic. C'est la vue de la socket elle-même.

**Requêtes** — les requêtes de la page (`fetch` et `XHR`), chacune avec les
lignes que le serveur a écrites pour elle, et les autres journaux du serveur en
direct. Voir la section suivante.

**Perf** — processeur, mémoire, boucle d'événements du serveur.

**Nodefony client** — ce que Nodefony fait dans le navigateur, quand la page
compose un noyau client (`NodefonyKernel`). Quatre cartes, chacune répond à une
question :

- **État de l'application** — tourne-t-elle, depuis quand ? Nom, état (`créé`,
  `démarrage`, `prêt`, `terminé`), heure de démarrage, délai jusqu'à « prêt »,
  annonce console, services composés. Les heures sont datées par le noyau
  lui-même : justes même si la barre est montée après.
- **Compte déclaré** — pour quel compte partent mes requêtes ? La clé déclarée
  par `setIdentity` (la charge appartient à l'application et n'est pas
  affichée), depuis quand, combien de changements.
- **Connexion au serveur** — ma socket est-elle ouverte, vers où, et sinon
  pourquoi ? L'état se dit en clair, anomalies comprises : « fermée —
  volontairement : s'ouvrira à la déclaration du compte » n'est pas une panne,
  « fermée alors qu'un compte est déclaré » en est une.
- **Événements** — le journal horodaté, le plus récent en haut, amorcé avec ce
  que le noyau a daté avant l'arrivée de la barre. Les noms se lisent en clair
  (`démarrage`, `prêt`, `compte`, `à l'écran`, `réseau`), le nom d'API en infobulle.

Chaque libellé porte une explication courte, au survol comme au clavier. Une
puce « client · prêt » apparaît dans la bande dès qu'un noyau est détecté —
qu'il soit né avant ou après la barre. Sans noyau, l'onglet dit comment en créer
un. Le noyau publie cette sonde **en développement seulement** : en production,
rien n'est posé sur la page.

**Runtime** — l'identité du processus servi (version, environnement, `pid`,
disponibilité, cœurs, mémoire), et **ce que la barre garde sur ce navigateur**.

## L'onglet Requêtes

Trois vues, au choix en haut de l'onglet :

- **Page** (par défaut) — ce que _cette page_ est en train de faire : le
  document lui-même, puis chaque `fetch` et `XHR`, le plus récent en haut.
  Une ligne par requête (méthode, chemin, statut, durée vue par le
  navigateur) qui se **déplie** (chevron, ou `→` / `←` au clavier) sur les
  lignes que le serveur a écrites pour elle. Ces lignes sont relues au
  serveur au moment du dépliage, par la même lecture que le Suivi de requête
  de la console : rien n'est recalculé en tâche de fond. Le `requestId` du
  document vient du serveur qui a rendu la page, ou à défaut de sa ligne
  d'accès dans les journaux.
- **Direct** — les lignes du serveur en temps réel (temps réel démarré).
- **Journaux** — la recherche des Journaux de la console, une ligne par
  requête, tous clients confondus, avec les mêmes filtres.

### WebSocket et flux d'événements

La vue Page montre aussi les **connexions longues** que la page ouvre : une
`WebSocket` (`WS`), un `EventSource` ou un `fetch` qui reçoit
`text/event-stream` (`SSE`, ce que fait le client `NodefonySse`). La socket
que la page partage avec la barre y figure comme les autres.

Ce que la ligne montre, c'est ce que **seul le navigateur sait** : la
connexion en cours, l'ouverture (`101`, `200`), la fermeture et son code
(`1000` normale, `1006` coupée, en rouge), un refus avant l'ouverture, les
reconnexions d'un `EventSource`. La colonne durée dit « ouvert » tant que la
connexion vit, puis sa durée de vie. Aucune trame n'est lue ni comptée,
binaire compris : ce que la socket transporte reste à l'application.

Choisie, une socket retrouve son `requestId` par sa ligne d'accès dans les
journaux, car le navigateur ne lit pas ses en-têtes. Elle se déplie alors
sur ses lignes serveur. Le volet liste les **appels passés par la socket**,
c'est-à-dire chaque `api.request`. Une connexion n'a pas de profil à elle,
puisqu'elle ne se termine qu'à sa fermeture, mais chacun de ses appels en a
un. Un clic sur un appel affiche ses phases et ses requêtes SQL, comme pour
une requête HTTP. Sur une page de la console, choisir la socket ouvre aussi
son Suivi de requête, qui reconstitue tout son cycle.

Un flux SSE n'écrit sa ligne d'accès qu'à sa fermeture : son `requestId` ne
se lit qu'alors, sauf s'il passe par `fetch`, qui lit ses en-têtes dès
l'ouverture. Un flux reçu par `fetch` se sait fermé par son **signal
d'abandon** : sans signal, la ligne reste « ouvert ».

Un clic ouvre le détail dans **un seul volet, à côté** : pour une requête,
ce qui en a été vu, puis son **profil serveur** (route, contrôleur,
utilisateur, chronologie des phases, requêtes SQL) ; pour une ligne, son
horodatage complet, sa catégorie, son worker et sa requête — de quoi coller
une trace dans un ticket. Le volet s'ouvre à côté plutôt que dans la liste,
qui ne bouge donc pas.

**La plus récente est en haut**, visible sans défiler. Tant que la liste est
tout en haut, elle suit le flux. Dès qu'on descend lire, elle **se fige** :
ni les nouvelles qui arrivent au-dessus, ni les anciennes qui partent en
dessous, ni une requête qu'on déplie ne déplacent la ligne qu'on lit, et un
bouton « ↑ N nouvelles » ramène au flux (`Début` au clavier fait de même).

La barre d'outils permet de :

- **filtrer les lignes serveur par sévérité** — chaque niveau est une bascule ;
- **masquer la console et Vite** (Direct et Journaux) — le trafic de la
  console d'administration et le bavardage de Vite disparaissent. Les
  requêtes de la page, elles, ne sont **jamais** masquées ;
- **masquer le framework** — ce que Nodefony écrit pour lui-même ;
- **chercher** dans la méthode, le chemin, le statut, le texte, le module, la
  catégorie ou la requête. Une ligne serveur trouvée déplie la requête qui la
  porte ;
- **suspendre** l'affichage. Requêtes et lignes continuent d'arriver : à la
  reprise, la liste se recompose complète — une pause ne fait rien perdre ;
- **copier** tout le jeu affiché (filtré), pas seulement l'écran ; **vider** la
  liste (sans rien effacer côté serveur).

Sans interception réseau (`network: false`), l'onglet ne montre que les lignes
du serveur : c'est la seule partie de la barre qui instrumente des fonctions
globales du navigateur.

### Ce que l'onglet coûte à l'application

- **Mémoire** : 2 000 entrées au plus (`FEED_MAX`), taillées par lots — quelques
  centaines de Ko. Au-delà, les plus anciennes partent.
- **DOM** : une trentaine de lignes **quel que soit le nombre de requêtes et d'entrées**. Seules
  les lignes visibles et une petite marge existent, et elles sont recyclées : à
  l'arrivée d'une entrée on change leur texte, on ne reconstruit aucun HTML.
  Mesuré sur la console d'administration en direct : 25 lignes dans le DOM.
- **Rendu** : au plus une fois par image, positionné par `transform` (aucune
  mise en page relancée). Panneau fermé ou onglet caché, rien n'est peint : le
  flux ne fait qu'entrer dans le tampon. Et sans temps réel démarré, rien
  n'arrive du tout.

## Ce que la barre garde sur votre navigateur

Sept valeurs, uniquement d'apparence, dans le stockage local — visibles dans
l'onglet Runtime, avec un bouton pour les effacer :

| Clé                   | Ce qu'elle retient           |
| --------------------- | ---------------------------- |
| `nf.debugbar.v`       | version du format ci-dessous |
| `nf.debugbar.visible` | barre affichée ou masquée    |
| `nf.debugbar.min`     | réduite en pastille          |
| `nf.debugbar.side`    | côté du dock                 |
| `nf.debugbar.tab`     | dernier onglet ouvert        |
| `nf.debugbar.h`       | hauteur du panneau           |
| `nf.debugbar.live`    | flux en direct activé        |

Rien d'autre n'est stocké : aucun journal, aucune donnée d'application, aucune
identité. L'état est **versionné** — si le format change, l'ancien est effacé au
chargement plutôt que réinterprété, ce qui éviterait un état incohérent qu'on ne
saurait pas défaire.

## Options

```ts
mountDebugBar({
  url: "/nodefony/studio/api/realtime", // adresse du canal temps réel
  client: maSocket, // socket déjà ouverte à partager
  position: "bottom", // ou "top"
  open: false, // panneau déplié au montage
  network: true, // requêtes de la page dans l'onglet Requêtes (instrumente fetch/XHR)
  env: "development", // environnement affiché avant toute mesure (posé par le serveur)
  page: { requestId }, // la requête qui a rendu la page (posé par le serveur)
});
```

`mountDebugBar()` est idempotent : une seule barre par page.

## Accessibilité

Tous les contrôles sont des boutons : ils s'atteignent au clavier, portent un nom
et annoncent leur état (le replieur et le logo exposent `aria-expanded`, le
temps réel `aria-pressed`). Leur nom est leur texte visible (WCAG 2.5.3), et leur
cible fait 28 px de haut. La pastille réduite est un bouton, atteignable au
clavier. Vérifié par axe-core sur la barre repliée et dépliée : aucun défaut. L'aide de chaque indicateur s'ouvre aussi bien au focus qu'au
survol. La barre se déclare comme un contenu d'appoint (`complementary`), ce qui
évite que tout ce qu'elle affiche soit compté hors de tout point de repère par un
audit de la page hôte.

## Coût

La barre est une entrée séparée du paquet (`nodefony/debugbar`) : elle ne pèse
**rien** sur une application qui ne l'importe pas. Son budget est vérifié à chaque
publication (`npm run size:check`).

## 📖 Lexique

| Terme                  | Ce que c'est                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entrée séparée**     | Un sous-chemin du paquet (`nodefony/debugbar`) importé à part. Ce qui n'est pas importé n'entre pas dans votre bundle.                                                                                                     |
| **`mountDebugBar`**    | La seule fonction à appeler (`index.ts#mountDebugBar`). Elle installe la barre et rend une poignée pour la piloter ou la retirer.                                                                                          |
| **Poignée** (_handle_) | Ce que le montage rend en retour (`DebugBarHandle`, `DebugBar.ts#DebugBarHandle`) : de quoi fermer, rouvrir ou démonter proprement.                                                                                        |
| **Options**            | Ce qu'on passe au montage (`DebugBarOptions`, `DebugBar.ts#DebugBarOptions`) — l'adresse du socket, la position (`bottom` ou `top`), le panneau ouvert d'emblée, et l'interception réseau, qu'on peut refuser entièrement. |
| **Charge utile**       | Ce que le serveur pousse : statistiques (`StatsPayload`, `model.ts#StatsPayload`) et journaux (`LogEntry`, `model.ts#LogEntry`).                                                                                           |
| **`requestId`**        | L'identifiant qu'une requête porte de bout en bout. C'est lui qui relie une ligne de journal à l'appel réseau qui l'a produite.                                                                                            |

## ⚠️ Pièges

- **Elle n'a rien à faire en production.** C'est un outil de développement : ce qu'elle affiche
  décrit votre application à qui regarde l'écran. Ne l'importez que dans le bundle de
  développement.
- **Ce qu'elle garde vit dans le navigateur de chacun**, pas sur le serveur : un onglet ouvert,
  un filtre, une position. Une fenêtre privée ou un autre navigateur repart donc de zéro — ce
  n'est pas une panne.
- **Une barre montée deux fois n'affiche pas deux barres**, mais laisse un montage orphelin :
  gardez la poignée rendue par `mountDebugBar()` et démontez avant de remonter.
- **Elle ne remplace pas les journaux du serveur.** Ce qu'elle montre est ce que le serveur a bien
  voulu pousser vers le navigateur ; un incident au boot, avant qu'elle existe, ne s'y verra
  jamais.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée en comptant — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires | `nodefony` `DebugBar.test.ts` | le montage, les options, ce que la poignée rend, le rendu des onglets |
| Unitaires (interaction) | `nodefony` `debugbarInteraction.test.ts` | l'ouverture et la fermeture, le filtrage des journaux, ce qui est gardé d'une visite à l'autre |
| Unitaires (onglet Requêtes) | `nodefony` `debugbarRequestsTab.test.ts`, `debugbarRequests.test.ts`, `debugbarFeedView.test.ts` | les trois vues sur le back des Journaux, le dépliage relu à la demande, le volet unique, les requêtes de la page jamais masquées, une liste fenêtrée qui ne bouge pas sous l'œil |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [`nodefony` — le cœur](index.md) ·
  [Toute la documentation](../../../docs/index.md)
- 📜 **Ce qu'elle affiche vient de là** : [journalisation](syslog.md)
- 🔗 **L'identifiant qui relie une ligne à sa requête** :
  [contexte de requête](request-context.md)
- 🛠️ **La même observation, mais côté serveur** :
  [`@nodefony/studio`](../../packages/@nodefony/studio/docs/index.md)
