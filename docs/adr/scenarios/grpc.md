---
title: gRPC — catalogue de scénarios
lang: fr
publish: false
tags: [grpc, connect, http2, design, scenarios]
---

# gRPC — catalogue de scénarios

Les cas contre lesquels se juge **toute** décision de l'Epic gRPC (#694) :
[ADR-0026](../0026-service-grpc-declare-par-un-module.md). Méthode : skill
`nodefony-decision-making`, `references/methode-scenarios.md`.

**Règle d'usage.** Une décision passe TOUS les scénarios : tient / casse / sans objet, avec la
raison. Un cas que la décision révèle et qui manque ici s'AJOUTE ici, puis la matrice se repasse.
Le champ « A fait changer » garde la trace des cas qui ont coûté : il ne se vide jamais.

## Usages hétérogènes

### S-grpc-1 — Un rôle exigé par méthode

- **Situation** : un service métier dont la méthode `Delete` exige `ROLE_ADMIN`, les autres non.
- **Tient si** : la garde s'écrit avec le décorateur des routes HTTP (`@IsGranted`) et passe par le
  même code (`Resolver.ts#Resolver._enforceSecurity`) ; un refus part en statut gRPC.
- **A fait changer** : D1 — la forme « service hors du Router » (seconde autorisation dans http).

### S-grpc-2 — Santé et réflexion fournies par le framework

- **Situation** : `grpc.health.v1.Health` et la réflexion (v1 et v1alpha) servies sans jeton, pour
  la sonde gRPC de Kubernetes (#697).
- **Tient si** : elles se déclarent comme un service d'application, hors zone protégée.
- **A fait changer** : aucune.

### S-grpc-3 — Le pont vers le hub temps réel

- **Situation** : un flux serveur gRPC qui relaie un canal du hub (#745, `@nodefony/realtime`) ;
  voir aussi S-rt-6 et S-rt-73 du catalogue temps réel.
- **Tient si** : le pont se bâtit dans `realtime` sans que http connaisse le hub.
- **A fait changer** : aucune.

### S-grpc-4 — A2A à la racine derrière une passerelle d'agents

- **Situation** : `/lf.a2a.v1.A2AService/<Méthode>`, interface gRPC = `hôte:port` sans chemin,
  derrière une passerelle (backend h2c, `appProtocol: kubernetes.io/h2c`).
- **Tient si** : les chemins se servent à la racine, sans préfixe imposé par le module.
- **A fait changer** : aucune.

### S-grpc-15 — La même logique appelée hors gRPC

- **Situation** : la logique d'un service gRPC est aussi appelée par un contrôleur REST, un outil
  MCP ou un test sans HTTP.
- **Tient si** : elle vit dans un service injectable, que le point d'entrée gRPC appelle.
- **A fait changer** : D1 — le contrôleur seul (B) ; ajouté par le contradicteur.

## Charge

### S-grpc-5 — 10 000 appels unaires par seconde

- **Situation** : petits messages, un seul exemplaire.
- **Tient si** : surcoût du pipeline mesuré contre l'adaptateur nu sur `http2.createServer`,
  serveur en production, médiane de N passes, petite charge comprise ; aucune instance de
  contrôleur par appel (singleton par défaut).
- **A fait changer** : D1 — un argument de perf FAUX (« un contrôleur = une instance par appel »)
  retiré au recontrôle : le défaut est `singleton`.

## Panne et réseau

### S-grpc-6 — Client qui coupe, échéance, arrêt gracieux

- **Situation** : `grpc-timeout` dépassé, client parti en plein flux, arrêt du pod pendant un flux
  serveur long.
- **Tient si** : annulation propagée (`HandlerContext.signal`), `UNAVAILABLE` avant le drain
  (`shutdownSignal`), GOAWAY en deux temps (`http2Goaway.ts#announceSessionClose`).
- **A fait changer** : #763 (session HTTP/2 inactive jamais fermée).

## Plusieurs instances

### S-grpc-7 — Deux pods derrière un répartiteur

- **Situation** : appels unaires répartis, flux longs attachés à un pod.
- **Tient si** : aucun état partagé par le transport ; l'état métier relève de l'application.
- **A fait changer** : aucune.

## Versions qui cohabitent

### S-grpc-8 — La forme expérimentale change en 10.x

- **Situation** : la déclaration est `@experimental` (politique de compatibilité) ; une
  application 10.0 la suit en 10.x.
- **Tient si** : le marquage est posé au grain du SYMBOLE et gardé par `stability.test.ts`.
- **A fait changer** : aucune.

### S-grpc-16 — Les types Connect dans la surface publique

- **Situation** : `@connectrpc/connect` ou `@bufbuild/protobuf` change de majeure ;
  `HandlerContext` et `GenService` apparaissent dans le code de l'application.
- **Tient si** : la plage des pairs facultatifs est déclarée et la dépendance assumée (D11, D12).
- **A fait changer** : aucune encore ; ajouté par le contradicteur.

### S-grpc-17 — v1 et v2 d'un service, ou service activé par interrupteur

- **Situation** : deux versions du contrat servies ensemble ; un service présent seulement sous
  une variable.
- **Tient si** : deux points d'entrée ; liste conditionnelle `...(FLAG ? [X] : [])` comme dans
  `src/modules/test/index.ts`.
- **A fait changer** : aucune ; ajouté par le contradicteur (son « impossible » était faux).

## Attaquant

### S-grpc-9 — Casse du chemin, corps énorme, refus formaté

- **Situation** : `/echo.v1.echoservice/say` ; message de 4 Gio ; appel sans le rôle exigé.
- **Tient si** : le Router (insensible à la casse) laisse passer mais l'adaptateur (sensible)
  rend `UNIMPLEMENTED` sans appeler la méthode ; `readMaxBytes` borné par défaut ; le refus part
  en statut gRPC (16 ou 7), jamais en 403 JSON sur un client gRPC.
- **A fait changer** : aucune.

### S-grpc-18 — Un décorateur posé là où personne ne le lit

- **Situation** : `@UseSession`, `@Csp`, `@Idempotent` ou un schéma de route posé sur une méthode
  gRPC ; `@IsGranted` posé sur une classe qui n'est pas un point d'entrée.
- **Tient si** : refus au démarrage qui nomme la méthode et le décorateur — jamais ignoré.
- **A fait changer** : D1 — garde au boot exigée ; ajouté par le contradicteur.

### S-grpc-22 — Une page hostile vise un service ouvert aux navigateurs

- **Situation** : Connect et gRPC-Web ouverts par défaut ; une page d'une autre origine envoie un
  formulaire, un `text/plain`, un POST JSON, ou un `GET` vers une méthode, avec les cookies de la
  victime.
- **Tient si** : 415 sur un `content-type` hors `application/json` / `application/proto` ; POST JSON
  bloqué par le contrôle préalable CORS (D9) ; `GET` réservé à `NO_SIDE_EFFECTS` ; réponse illisible
  d'une autre origine.
- **A fait changer** : D3 — vérifié avant d'ouvrir les trois protocoles par défaut.

### S-grpc-23 — Un client gRPC natif vise le port HTTP/1.1

- **Situation** : `grpcurl -plaintext` ou un agent configuré sur 5151.
- **Tient si** : la connexion échoue franchement et vite (préface HTTP/2 incomprise), jamais une
  connexion qui pend.
- **A fait changer** : D3 — l'annonce d'un « refus gRPC » sur 5151 était fausse.

### S-grpc-24 — Une bombe de décompression

- **Situation** : un message gzip de quelques Ko qui se décompresse en plusieurs Gio ; ou un corps
  de 200 Mio envoyé à une route gRPC, que `http.maxBodySize` ne borne plus (`bodyStream`).
- **Tient si** : `readMaxBytes` (4 Mio) borne la décompression elle-même (`envelope.js`) ; refus
  `RESOURCE_EXHAUSTED`, méthode non appelée (témoin), mémoire du processus plate.
- **A fait changer** : D4 — le défaut de l'adaptateur (`0xffffffff`) n'est aucune borne.

### S-grpc-25 — Un client qui ne lit plus son flux

- **Situation** : flux serveur ouvert, le client cesse de lire (fenêtre HTTP/2 pleine), ou ouvre
  100 flux et n'en lit aucun.
- **Tient si** : coupure après le délai de blocage (`StreamLifecycle.armStall`), place rendue au
  budget par IP ; un abonnement MUET (rien à écrire) n'est jamais coupé.
- **A fait changer** : D4 — le blocage est observé par balayage (`writableNeedDrain`), l'adaptateur
  gardant ses écritures.

## Panne et réseau (suite)

### S-grpc-26 — Un gestionnaire qui ne rend jamais la main

- **Situation** : appel unaire sans `grpc-timeout`, gestionnaire bloqué sur une base qui ne répond
  pas.
- **Tient si** : échéance posée à `responseTimeout` → `DEADLINE_EXCEEDED`, `ctx.signal` interrompt
  le travail ; un client qui demande plus long est raboté, jamais refusé.
- **A fait changer** : D4 — sans échéance du client, l'adaptateur n'en pose aucune.

### S-grpc-27 — Deux écrivains sur la même réponse

- **Situation** : le délai de réponse de Nodefony expire pendant qu'un appel gRPC est en cours.
- **Tient si** : le délai de Nodefony est désarmé sur une route gRPC ; seul l'adaptateur écrit
  (statut 4), jamais un 504/408 HTML ou JSON par-dessus.
- **A fait changer** : D4 — `HttpContext._onTimeout` écrit lui-même la réponse.

## Plateformes

### S-grpc-10 — Linux, macOS, Windows

- **Situation** : génération `buf`, chemins des `.proto`, tests d'intégration.
- **Tient si** : aucun chemin littéral ; tests en Node pur.
- **A fait changer** : aucune.

## Extension tierce

### S-grpc-11 — Un paquet tiers publie son service

- **Situation** : un module npm tiers apporte son contrat et son point d'entrée.
- **Tient si** : même déclaration que dans une application, sans toucher au cœur.
- **A fait changer** : aucune.

### S-grpc-19 — Hôtes virtuels et route attrape-tout

- **Situation** : routes liées à un hôte (`Route.ts`, `hostRegexp`), page unique avec une route
  attrape-tout.
- **Tient si** : les chemins gRPC sont des routes du Router, qui porte déjà la priorité et l'hôte.
- **A fait changer** : D1 — la table privée de l'option « service hors du Router » ; ajouté par le
  contradicteur.

## Agent IA consommateur

### S-grpc-12 — Un agent copie l'exemple le plus proche

- **Situation** : un agent ajoute une méthode protégée à un service existant.
- **Tient si** : il trouve le point d'entrée là où il cherche (`nodefony/controller/`,
  `@controllers`) et la garde qu'il connaît (`@IsGranted`) ; un décorateur sans effet est refusé
  au boot (S-grpc-18).
- **A fait changer** : D1 — la forme « service » (point d'entrée invisible).

## Exploitation

### S-grpc-13 — Ce qu'un exploitant voit

- **Situation** : liste des routes, profileur, journal d'accès, métriques.
- **Tient si** : chaque méthode apparaît comme une route ; la ligne d'accès porte `grpc-status`.
- **A fait changer** : aucune.

## Mainteneur solo

### S-grpc-14 — Code neuf, tests, doublons

- **Situation** : ce qu'il faudra maintenir.
- **Tient si** : aucune seconde implémentation d'une règle existante (routage, autorisation,
  portée d'injection).
- **A fait changer** : D1.

### S-grpc-20 — Le code généré dérive de son contrat

- **Situation** : un contrat modifié sans régénération, ou un générateur mis à jour (le POC est
  généré par protoc-gen-es 2.16.0, la 2.17.0 est installée).
- **Tient si** : la CI régénère et échoue sur toute différence, en lisant `buf.gen.yaml`.
- **A fait changer** : D2 — code généré versionné ET gardé.

### S-grpc-21 — Une application et un module, plusieurs dossiers de contrats

- **Situation** : contrats propres dans `proto/`, contrat tiers copié dans `vendor/`, dans
  l'application comme dans un module publié.
- **Tient si** : même disposition partout ; `buf.yaml` réunit plusieurs dossiers (essayé).
- **A fait changer** : D2 — la question « nouveau module ou nouvelle app ? » : ni l'un ni l'autre.

## Antériorités consultées pour D1

Formes connues de déclaration d'un service gRPC dans les frameworks serveur (relevé de mémoire,
**non relu aux sources** — à confirmer avant d'accepter l'ADR) : une classe de service enregistrée
par une ligne explicite de l'application ; une annotation de nom figé sur une classe de service ;
un contrôleur dont les méthodes portent un décorateur de méthode gRPC. Dans les trois familles,
l'autorisation déclarative par méthode s'applique à un appel gRPC.
