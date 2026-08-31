---
title: "Barre de débogage — nodefony/debugbar"
lang: fr
module: "@nodefony/core"
topic: debugbar
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "client/debugbar/DebugBar.ts,client/debugbar/model.ts,client/debugbar/index.ts"
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
updated: 2026-08-31
---

# Barre de débogage

Une bande fine en bas de page, en développement, qui montre ce que le serveur est
en train de faire : le débit temps réel, la charge, la mémoire, les requêtes
réseau et les journaux — sans quitter l'écran qu'on est en train de construire.

Elle est livrée avec le cœur et ne dépend d'aucun cadre front : elle s'installe
dans une page rendue par un serveur comme dans une application React, Vue,
Angular ou Svelte.

## Démarrage rapide

```ts
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

La barre s'abonne au canal temps réel de l'application. Elle n'ouvre **aucune**
seconde connexion : elle partage la socket déjà présente si la page en a une.

## Ce qu'on voit, et ce qu'on peut faire

Le **bandeau** porte l'essentiel en une ligne : l'état de la connexion,
l'environnement, la branche git, puis le débit temps réel, la charge processeur
et la mémoire, enfin les compteurs réseau, journaux et erreurs.

Chaque élément du bandeau porte une aide qui s'ouvre au survol **et au focus
clavier**, et chaque indicateur est un raccourci : cliquer « cpu » ouvre l'onglet
qui le détaille. Le bandeau lui-même ne se replie pas au clic — seul le chevron
de droite le fait, et lui seul.

| Contrôle          | Ce qu'il fait                                                                         |
| ----------------- | ------------------------------------------------------------------------------------- |
| `flux OFF` / `ON` | Abonne aux mesures et aux journaux en direct. **Coupé par défaut** (voir ci-dessous). |
| `⇄`               | Change la barre de côté.                                                              |
| `—`               | Réduit la barre en pastille flottante.                                                |
| `▴`               | Déplie ou replie le panneau.                                                          |

> **Pourquoi le flux est coupé par défaut** : l'abonnement fait tourner des
> compteurs et un émetteur de journaux côté serveur. En développement on ouvre
> beaucoup d'onglets ; les laisser tous branchés en permanence ferait payer à
> l'application un travail que personne ne regarde. C'est un choix d'adhésion,
> pas une option cachée.

## Les cinq onglets

**Realtime** — débit, transport, protocole, état de la socket, frames reçues,
pic. C'est la vue de la socket elle-même.

**Network** — les requêtes de la page (`fetch` et `XHR`), leur durée décomposée
et leur statut. Désactivable (`network: false`) : c'est le seul onglet qui
instrumente des fonctions globales du navigateur.

**Perf** — processeur, mémoire, boucle d'événements du serveur.

**Logs** — les journaux du serveur, en direct. Voir la section suivante.

**Runtime** — l'identité du processus servi (version, environnement, `pid`,
disponibilité, cœurs, mémoire), et **ce que la barre garde sur ce navigateur**.

## L'onglet Logs

Chaque entrée affiche son heure, sa sévérité, son module, son message et — quand
elle est connue — sa **requête** (`requestId`). C'est ce dernier champ qui fait la
différence : la même valeur relie ce journal à sa route, à ses requêtes de base de
données et à sa réponse. Une entrée s'ouvre au clic (ou à `Entrée` au clavier)
et montre son horodatage complet, sa catégorie, son worker et sa requête —
de quoi coller une trace dans un ticket.

La barre d'outils permet de :

- **filtrer par sévérité** — les puces `err` et `warn` sont des bascules ;
  recliquer celle qui est active la retire ;
- **chercher** dans le texte, le module, la catégorie ou la requête ;
- **suspendre** l'affichage. Les entrées continuent d'arriver : à la reprise, la
  liste se recompose complète — une pause ne fait rien perdre ;
- **copier** ce qui est affiché, **vider** la liste (sans rien effacer côté
  serveur).

La liste est mise à jour **en insérant** les nouvelles entrées, jamais en la
reconstruisant : une sélection de texte survit à l'arrivée d'une ligne, et la
position de défilement ne saute pas.

## Ce que la barre garde sur votre navigateur

Six valeurs, uniquement d'apparence, dans le stockage local — visibles dans
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
  network: true, // onglet Network (instrumente fetch/XHR)
});
```

`mountDebugBar()` est idempotent : une seule barre par page.

## Accessibilité

Tous les contrôles sont des boutons : ils s'atteignent au clavier, portent un nom
et annoncent leur état (le replieur expose `aria-expanded`, le flux
`aria-pressed`). L'aide de chaque indicateur s'ouvre aussi bien au focus qu'au
survol. La barre se déclare comme un contenu d'appoint (`complementary`), ce qui
évite que tout ce qu'elle affiche soit compté hors de tout point de repère par un
audit de la page hôte.

## Coût

La barre est une entrée séparée du paquet (`nodefony/debugbar`) : elle ne pèse
**rien** sur une application qui ne l'importe pas. Son budget est vérifié à chaque
publication (`npm run size:check`).
