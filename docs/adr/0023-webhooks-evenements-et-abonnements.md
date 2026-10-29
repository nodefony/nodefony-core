---
adr: 23
title: Webhooks — la livraison hors connexion d'un événement générique
lang: fr
navTitle: Webhooks
date: 2026-10-28
status: proposed
deciders: [Christophe CAMENSULI]
tags: [security, webhooks, realtime, design, compatibility]
---

# ADR-0023 — Webhooks : la livraison hors connexion d'un événement générique

## Statut

Proposé (2026-10-28), brouillon soumis à l'auteur. Applique le socle
[ADR-0021](0021-temps-reel-evenement-et-livraisons.md) à la livraison qui ne tient aucune
connexion ouverte. Instruit par un relevé de la brique de `@nodefony/security`, et contrôlé face
aux notifications poussées d'A2A 1.0.1 (§4.3.3, §13.2).

## Contexte

Un webhook livre un événement à un serveur qui n'est pas connecté : un `POST` signé, réessayé
s'il échoue. C'est la quatrième livraison du socle, à côté de la socket, du flux SSE et de gRPC.

La brique existe et elle est solide sur le transport
(`src/packages/@nodefony/security/nodefony/src/webhook/WebhookDispatcher.ts#WebhookDispatcher`) :

| Ce qu'elle fait                                                                                                            | Où                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Signature Standard Webhooks : `webhook-id`, `webhook-timestamp`, `webhook-signature` (HMAC sur `{id}.{timestamp}.{corps}`) | `src/packages/@nodefony/security/nodefony/src/webhook/webhookSignature.ts#webhookSignatureHeaders`     |
| Réessais à délai exponentiel (5 s à 5 min, 5 réessais par défaut), 4xx non réessayé                                        | `WebhookDispatcher.ts#backoffMs`, `#classifyDelivery`                                                  |
| Délai de 10 s par tentative, 8 livraisons en parallèle, file de 1 000                                                      | défauts de `security.webhooks`                                                                         |
| Désactivation après 20 échecs consécutifs                                                                                  | `src/packages/@nodefony/security/nodefony/contracts/IWebhookEndpoint.ts#IWebhookEndpoint.failureCount` |
| Refus des adresses internes, à l'enregistrement et à chaque livraison (rebinding DNS compris)                              | `resolveTarget` du dispatcher                                                                          |
| Secret chiffré au repos                                                                                                    | `webhookCipher.ts`                                                                                     |

Trois limites, en revanche, viennent de son histoire. Elle est née pour l'**audit de sécurité** :

1. **Elle ne livre que l'audit.** Le dispatcher s'abonne au journal d'audit
   (`src/packages/@nodefony/security/nodefony/service/webhooks.ts#WebhookService`) ; une application
   ne peut pas y émettre son propre événement.
2. **Un administrateur crée chaque abonnement**, filtré par un motif de type (`*`, exact, `x.*` —
   `WebhookDispatcher.ts#matchesSubscription`). Un tiers ne peut pas s'abonner par API, ni à une
   seule ressource.
3. **Le secret est généré par le serveur**, qui signe. Un destinataire qui ne sait vérifier qu'un
   jeton porteur ne peut pas être servi.

Un quatrième défaut a été corrigé pendant l'instruction : chaque réessai changeait de
`webhook-id`, et le destinataire ne pouvait pas dédupliquer (39eb1f1ab).

## Décision

### W1. La charge d'un webhook est l'événement du socle, et sa forme est figée

**Décision proposée :** le corps reste `{ id, timestamp, type, data }`, en
`content-type: application/json`. `type` est le nom de l'événement (le canal du socle), et `data`
la charge du producteur, telle qu'il l'a émise. Pour l'audit, `data` est l'événement d'audit
entier, comme aujourd'hui.

**Précisions (table d'experts, 2026-10-29) :**

- **`timestamp` est l'heure de la tentative**, recalculée à chaque essai
  (`src/packages/@nodefony/security/nodefony/src/webhook/WebhookDispatcher.ts#WebhookDispatcher.#process`),
  comme l'en-tête `webhook-timestamp` de Standard Webhooks qu'il double. L'heure de l'**événement**
  vit dans `data` : l'audit la porte déjà (`ts`), et W3 l'impose à toute émission applicative.
  Après deux heures de réessais, dater l'événement par `timestamp` le décale de deux heures
  (S-rt-47) : c'est écrit dans la page des webhooks.
- **`id` est l'identifiant `webhook-id`**, stable d'un réessai à l'autre (W4) : la même valeur
  dans le corps, l'en-tête et les journaux d'émission et de livraison.
- Écarté : CloudEvents, ou un corps versionné. La table n'a trouvé aucun scénario qui le réclame,
  et la forme actuelle est déjà sur le fil ; changer de corps changerait aussi ce que vérifie la
  signature du destinataire.

- Usages : une commande créée, une alerte de capteur, la fin d'une compilation en intégration
  continue.
- **Rupture si différé : NON** tant que la forme ne bouge pas. C'est elle qui rend l'émission
  applicative additive (W3).

### W2. `*` veut dire « tout, mais seulement dans son périmètre »

**Décision (validée par l’auteur le 2026-10-28) :** un abonnement répond à deux questions
distinctes, réglées séparément.

| Question                        | Réglée par                                                          | Exemple                          |
| ------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| **Quoi** : quels événements ?   | le motif de `IWebhookEndpoint.events`                               | `*`, `login.*`, `commande.creee` |
| **Chez qui** : quel périmètre ? | le **même prédicat d'admission** que les canaux de la socket (#622) | « seulement l'entreprise A »     |

- `*` désigne **tous** les événements, audit compris, **y compris ceux qui viendront après 10.0**
  — mais seulement ceux que le périmètre de l'abonnement admet. Un abonnement ne reçoit **jamais**
  un événement hors de son périmètre.
- Un abonnement **sans périmètre** (le cas de tous aujourd'hui) a le périmètre de la
  **plateforme** : il reçoit tout, y compris les événements qu'une version ultérieure rattachera à
  un locataire. Seul un abonnement rattaché à un locataire (W6) est borné à ce locataire.
  _Amendé le 2026-10-29_ : la version précédente disait qu'un abonnement sans périmètre ne
  recevrait pas les événements rattachés plus tard à un locataire. Un centre de sécurité abonné à
  `*` aurait alors perdu `login.success` des utilisateurs d'un locataire à une mineure, sans
  erreur (S-rt-45) — la rupture même que W2 veut éviter, dans l'autre sens. Un locataire qui
  écrit `*` ne lit toujours que les siens (S-rt-27).
- Qui ne veut que l'audit liste ses motifs (`login.*`, `token.*`…).
- **La grammaire des motifs est celle des canaux de la socket**, codée une fois au cœur et appelée
  par les deux livraisons : `*` remplace toute suite de caractères, à toute position, trois au
  plus. _Amendé le 2026-10-29_ : la grammaire propre aux webhooks (`*`, nom exact, `préfixe.*`)
  laissait `commande:*` lu comme un nom littéral, sans erreur, quand les canaux l'acceptent
  (S-rt-46). La grammaire des canaux accepte tout ce que l'ancienne acceptait, avec le même sens :
  aucun abonnement existant n'en change. Elle est figée pour la série.
- **Une seule règle pour les deux livraisons** : « chez qui » se décide par le prédicat de #622,
  codé une fois, appliqué au canal de la socket comme à l'événement d'un webhook.

- **Rupture si différé : OUI.** Si `*` n'est défini qu'après coup, ouvrir l'émission applicative,
  ou les locataires, ferait recevoir des événements neufs à un abonné 10.0 qui avait écrit `*`.
  Écrit maintenant, ce sens fait partie du contrat dès 10.0.
- Constaté : `IWebhookEndpoint.tenantId` existe, se remplit à la création, et **n'est lu par
  personne** (`src/packages/@nodefony/security/nodefony/contracts/IWebhookEndpoint.ts#IWebhookEndpoint.tenantId`).
  Un champ qui a l'air de protéger sans protéger : traité à part.
- À faire avant 10.0 : l'écrire dans la page des webhooks et dans le TSDoc de `events`.

### W3. Une application pourra émettre ses propres événements

**Décision proposée :** une API d'émission (`emit(type, data)`, nom à fixer par le ticket) ouvre les
webhooks aux événements de l'application, en 10.1. Elle passe par le **même** dispatcher : même
signature, mêmes réessais, mêmes bornes, même garde contre les adresses internes. Les événements
`webhook.*` restent exclus, comme aujourd'hui, pour éviter qu'une livraison en échec n'en déclenche
une autre.

**Les noms de l'audit sont réservés dès 10.0 (table d'experts, 2026-10-29).** L'émission refuse
tout type qui appartient à l'audit (`login.*`, `token.*` et les familles de l'audit, liste tenue au
même endroit que l'audit lui-même). Sans cette réserve, un code applicatif — ou l'outil d'un agent
qui appelle l'émission — fabriquerait un `login.success` signé par le serveur, que le centre de
sécurité abonné ne distinguerait pas d'un vrai (S-rt-49). Écrite en 10.0, la réserve n'enlève rien
à personne ; posée après l'ouverture de l'émission, elle casserait qui s'en sert déjà.

- **Rupture si différé : NON**, grâce à W1 et W2.

### W4. Plusieurs tentatives, sans garantie, sous un identifiant stable, sans ordre

**Décision proposée :** la garantie écrite est celle de S5 : **plusieurs tentatives, sans
garantie de livraison** — pas « au moins une fois », que S5 écarte faute de file durable (une
livraison se perd quand la file est pleine, après le dernier réessai ou au redémarrage, et
`dropped` la compte). Tous les réessais d'un message portent le **même** `webhook-id` ; seul l'horodatage change, pour la
protection contre le rejeu. **Aucun ordre** n'est garanti entre deux messages. Le destinataire
déduplique par `webhook-id`, et ordonne par l'identifiant de la charge s'il en a besoin.

- **Rupture si différé : NON.** C'est déjà ce que promettait la page des webhooks ; le code s'y
  est aligné.

### W5. Un second mode d'authentification, fourni par l'abonné

**Décision proposée :** en plus de la signature HMAC, un abonnement pourra porter un identifiant
**fourni par l'abonné** et envoyé tel quel (`Authorization: <schéma> <identifiant>`). Il est stocké
chiffré, comme le secret. La signature reste le mode par défaut.

- Usages : une API interne derrière une passerelle qui exige un jeton porteur, un service tiers qui
  ne vérifie pas de signature, une notification poussée A2A.
- **Rupture si différé : NON** (champ optionnel de l'abonnement).

### W6. Des abonnements créés par API, rattachés à une ressource

**Décision proposée :** plus tard, un tiers authentifié pourra créer son abonnement par API, pour
une **ressource** (`commande:42`, `capteur:7`), et ne verra que les siens. L'admission ne se
réinvente pas : c'est le **même prédicat** que pour s'abonner à un canal de la socket (#622). Une
seule règle décide qui peut suivre quoi, quelle que soit la livraison.

- Usages : un client qui suit les commandes de **son** compte, un tableau de bord qui suit les
  alertes de **ses** capteurs, une notification poussée A2A pour une tâche.
- **Rupture si différé : NON** (route et champs neufs). Rien ici n'est à coder avant 10.0.

### W7. Plusieurs exemplaires de l'application

**Décision proposée :** les abonnements vivent dans un store partagé ; chaque exemplaire livre les
événements qu'il produit, une seule fois. La file des livraisons reste propre à l'exemplaire et
n'est pas persistée : un arrêt brutal perd ce qui était en attente, ce qui reste conforme à S5
(« sans garantie ») tant que la perte est écrite et comptée.

- À prouver : un abonnement créé sur un exemplaire est-il vu par les autres sans redémarrage ? On
  suppose aujourd'hui que non.

## Alternatives écartées

- **Laisser `*` sans définition** (W2) : rupture garantie au premier événement applicatif.
- **Une brique d'émission séparée du dispatcher** (W3) : deux implémentations des mêmes réessais,
  bornes et gardes.
- **Garantir l'ordre** : il faudrait sérialiser les livraisons par abonné, et donc qu'un
  destinataire lent bloque tous les autres. L'ordre se reconstruit chez le destinataire.
- **Une règle d'admission propre aux webhooks** (W6) : une seconde copie de la règle du socle.

## Contrôle de non-blocage

| Exigence d'A2A 1.0.1 pour une notification poussée                       | Ici                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Au moins une tentative, réessais à délai exponentiel, délai de 10 à 30 s | **couvert**                                          |
| Refuser les adresses internes                                            | **couvert**, au-delà du minimum demandé              |
| Le destinataire déduplique                                               | **couvert** depuis le correctif de `webhook-id` (W4) |
| Le même objet que le flux                                                | **possible** par W1 et W3                            |
| Identifiant fourni par le client                                         | **possible** par W5                                  |
| Configuration créée par API pour une tâche                               | **possible** par W6                                  |

Rien dans cette brique n'est taillé pour A2A. Une liaison A2A assemblerait W3, W5 et W6.

## Conséquences

- Avant 10.0 : écrire le sens de `*` (W2) et la garantie de livraison (W4) dans la page des webhooks
  et dans le TSDoc.
- En 10.1 : l'émission applicative (W3), qui demande un ticket.
- Après : le second mode d'authentification (W5) et les abonnements par API (W6). Ce dernier dépend
  du prédicat d'admission de #622.
- Preuve à apporter : la visibilité des abonnements d'un exemplaire à l'autre (W7).

## Références

- Standard Webhooks — <https://www.standardwebhooks.com/>
- A2A 1.0.1, notifications poussées — <https://a2a-protocol.org/v1.0.0/specification> (§4.3.3, §13.2)
- RFC 9110, sémantique HTTP (codes réessayables, `Authorization`) — <https://www.rfc-editor.org/rfc/rfc9110>
- [ADR-0021](0021-temps-reel-evenement-et-livraisons.md) · [Politique de compatibilité](../guides/compatibilite.md)
- Tickets : #622 (prédicat d'admission), #621
