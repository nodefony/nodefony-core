# A2A (Agent2Agent) 1.0.1 — index hors ligne

Copies figées par page au tag `v1.0.1` de `a2aproject/A2A` (`AMONT.json`, suivies par
`check-amont.mjs`). **La source normative est `a2a.proto`** (spec §1.4) : le JSON n'en est qu'un
dérivé. Le transport SSE se lit dans `nodefony-framework-dev/references/rfc/specs/whatwg-sse.md`,
gRPC dans `../grpc/`, MCP dans `../mcp-2026-07-28/`.

| Ce qu'on veut savoir                                                          | Fichier, section                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Les opérations (envoi, flux, tâche, annulation, abonnement, webhooks)         | `a2a-specification.md` §3.1                                         |
| Les trois modes de livraison : interrogation, flux, notification poussée      | `a2a-specification.md` §3.5, `a2a-streaming-and-async.md`           |
| Ordre des événements, plusieurs flux par tâche                                | `a2a-specification.md` §3.5.2                                       |
| Cycle de vie d'une tâche, états terminaux                                     | `a2a-life-of-a-task.md`, `a2a-specification.md` §4.1.3              |
| Équivalence entre liaisons, table des méthodes JSON-RPC / gRPC / REST         | `a2a-specification.md` §5.1, §5.3                                   |
| Liaison JSON-RPC (flux en SSE), gRPC (flux serveur), REST                     | `a2a-specification.md` §9, §10, §11                                 |
| Liaison PERSONNALISÉE (WebSocket, MQTT) : ce qu'elle doit documenter          | `a2a-specification.md` §5.8, §12, `a2a-custom-protocol-bindings.md` |
| Charge et sécurité d'un webhook (auth fournie par le client, SSRF, doublons)  | `a2a-specification.md` §4.3.3, §13.2                                |
| Isolement des données par appelant                                            | `a2a-specification.md` §13.1                                        |
| Plusieurs agents derrière un endpoint (champ `tenant`)                        | `a2a-multi-tenancy.md`                                              |
| Carte d'agent, découverte, signature                                          | `a2a-specification.md` §8, §14.3                                    |
| Relation avec MCP                                                             | `a2a-and-mcp.md`, `a2a-specification.md` annexe B                   |

## Les faits qui décident pour le temps réel de Nodefony

1. **Trois liaisons officielles, aucune en WebSocket** : JSON-RPC 2.0 sur HTTP avec flux en SSE,
   gRPC avec flux serveur, HTTP+JSON/REST avec SSE (§9 à §11). La WebSocket est une liaison
   PERSONNALISÉE, identifiée par une URI qui change à chaque rupture (§5.8). L'URI
   `a2a-protocol.org/bindings/websocket` de `a2a-custom-protocol-bindings.md` est un EXEMPLE,
   pas une liaison publiée.
2. **Une opération se comporte à l'identique sur toutes les liaisons** : résultats, erreurs,
   authentification (§5.1). Une règle, N portes.
3. **Le webhook porte le MÊME objet que le flux** (`StreamResponse`, `application/a2a+json`,
   §4.3.3) : la notification poussée est une livraison de plus du même événement.
4. **L'authentification du webhook est FOURNIE PAR LE CLIENT** (`Authorization: <schéma>
   <identifiant>`, tirée de `TaskPushNotificationConfig.authentication`), et la configuration se
   crée PAR API, pour UNE tâche (§3.1.7). Livraison au moins une fois : le destinataire déduplique.
5. **La reprise après coupure est un INSTANTANÉ, pas une relecture** : `SubscribeToTask` rend
   d'abord l'objet `Task` courant, puis les événements suivants (§3.1.6) ; le flux se termine à
   l'état terminal.
6. **Ordre garanti par flux** ; plusieurs flux d'une même tâche reçoivent les mêmes événements dans
   le même ordre, et fermer l'un ne touche pas les autres (§3.5.2).
7. **Une liaison personnalisée doit dire** : mécanisme de flux, ordre, reconnexion, fin de flux,
   encodage du binaire (base64 dans un protocole texte), transport des paramètres de service
   (`A2A-Version`, `A2A-Extensions`) quand il n'y a pas d'en-têtes (§12.2, §12.3, §12.5).
