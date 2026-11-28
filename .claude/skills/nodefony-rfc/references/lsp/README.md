# LSP (Language Server Protocol) — index hors ligne

Copies figées par page sur la branche `gh-pages` de `microsoft/language-server-protocol`
(`AMONT.json`, suivies par `check-amont.mjs`). Le **protocole de base 0.9** est la partie de LSP
détachée des services de langage : l'enveloppe, les codes d'erreur, l'annulation, la progression.
LSP s'appuie sur JSON-RPC 2.0 ; MCP se lit dans `../mcp-2026-07-28/`, A2A dans `../a2a/`.

| Ce qu'on veut savoir                                             | Fichier, section                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Requête, réponse, notification, objet d'erreur                   | `lsp-base-0.9.md` « Request Message » à « Notification Message » |
| Codes d'erreur et plages réservées (JSON-RPC, LSP)               | `lsp-base-0.9.md` « Response Message », `ErrorCodes`          |
| Méthodes `$/` : facultatives, ignorables                         | `lsp-base-0.9.md` « $ Notifications and Requests »            |
| Annulation (`$/cancelRequest`)                                   | `lsp-base-0.9.md` « Cancellation Support »                    |
| Progression (`$/progress`, jeton, *work done*)                   | `lsp-base-0.9.md` « Progress Support », « Work Done Progress » |
| Exécuter une commande par son nom (`workspace/executeCommand`)   | `lsp-3.17-executeCommand.md`                                  |

## Les faits qui décident pour Nodefony

1. **Une requête annulée reçoit QUAND MÊME une réponse** : « A request that got canceled still
   needs to return from the server and send a response back. It can not be left open / hanging »,
   code conseillé `RequestCancelled` (`-32800`). La charge de `$/cancelRequest` est `{ id }`.
2. **Le jeton de progression n'est pas l'`id`** : « The token is different than the request ID
   which allows to report progress out of band and also for notification ». La charge de
   `$/progress` est `{ token, value }`, `value` générique (`ProgressParams<T>`). Le jeton n'est
   valide que tant que la requête n'a pas reçu sa réponse.
3. **Une méthode `$/` est facultative** : « If a server or client receives notifications starting
   with '$/' it is free to ignore the notification. If a server or client receives a request
   starting with '$/' it must error the request with error code `MethodNotFound` ».
4. **Plages de codes** : `-32099` à `-32000` sont réservées par JSON-RPC (aucun code du protocole
   de base n'y est défini) ; `-32899` à `-32800` sont réservées par LSP, et les autres
   implémentations du protocole de base doivent rester hors de cette plage.
5. **`workspace/executeCommand`** : une méthode générique, `ExecuteCommandParams { command:
   string; arguments?: LSPAny[] }`, que le serveur annonce par `executeCommandProvider.commands`.
6. **Les pairs sont symétriques** : l'annulation et la progression vont dans les deux sens
   (`:arrow_right: :arrow_left:` dans les titres), contrairement à MCP, qui réserve l'annulation
   au client.

Consommateurs : le canal superviseur ⇄ serveur du terminal de développement et les ajouts de
`JsonRpcPeer` (ADR-0013 §6 et §7, « Normes et antériorités »).
