# gRPC — servir et faire évoluer un service déclaré par un module

> **Maintenance** : vérité courante, éditée en place ; l'historique vit dans `git log`. Les
> décisions et leurs essais font foi dans `docs/adr/0026-service-grpc-declare-par-un-module.md`
> (D1 à D13) ; la page utilisateur est `src/packages/@nodefony/framework/docs/grpc.md`.
> Surface `@experimental` (TSDoc) : elle peut changer en mineure, jamais sans entrée au changelog.

## 1. Écrire un service — la recette

1. Contrat `proto/<paquet>/v1/<nom>.proto` (`edition = "2024"`, ou `proto3`), `buf.yaml`
   (lint `STANDARD`, breaking `FILE`), `buf.gen.yaml` (`protoc-gen-es`, `out: nodefony/gen`,
   `opt: target=ts`).
2. `npx buf generate` — le `*_pb.ts` est **commité**, jamais édité. Dans un workspace npm, `npx buf`
   peut viser le mauvais dossier : lancer `node_modules/.bin/buf` avec `node_modules/.bin` dans le
   `PATH` (sinon `protoc-gen-es` est introuvable).
3. `class X extends GrpcController`, marquée `@GrpcService(Contrat)` (import
   `@nodefony/framework/grpc`), une méthode par méthode du contrat, signature du code généré.
4. Déclarer la classe dans `@controllers([...])` du module. Logique métier dans un service injecté
   (`@Inject("nom")` au constructeur).
5. Paquets de l'application : `@connectrpc/connect`, `@connectrpc/connect-node`,
   `@bufbuild/protobuf` en `dependencies` ; `@bufbuild/buf`, `@bufbuild/protoc-gen-es` en dev.

Exemple de référence, exécuté par un test (le recopier, pas en inventer un autre) :
`framework/nodefony/tests/fixtures/grpc/controllers/GreetController.ts`, prouvé par
`grpcQuickstart.test.ts`, qui exige aussi qu'il soit identique au bloc de la page publique.
Exemple complet (unaire, GET, flux serveur, bidirectionnel, erreurs, gardes) :
`src/modules/test/nodefony/controller/GrpcEchoController.ts` et `GrpcGuardedController.ts`.

## 2. Où vit le code

| Brique         | Fichier                                     | Rôle                                                                                               |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| déclaration    | `framework/nodefony/grpc/GrpcService.ts`    | une route littérale par méthode (`POST`, + `GET` si `NO_SIDE_EFFECTS`)                             |
| point d'entrée | `framework/nodefony/grpc/GrpcController.ts` | `assertScope` (refus au démarrage, méta lue sur la méthode du contrat), `serveGrpc`                |
| transport      | `http/nodefony/grpc/GrpcEndpoint.ts`        | `connectNodeAdapter` + `contextValues` + `fallback` ; traduction des erreurs ; en-têtes            |
| fiche d'appel  | `http/nodefony/grpc/GrpcCall.ts`            | `IRpcCall` : échéance (`expire`), révocation, arrêt, code au `close`                               |
| refus          | `http/nodefony/src/grpc/refusal.ts`         | deux tables : `transportRefusalCode`, `applicationErrorCode` ; forme par protocole                 |
| CORS           | `http/nodefony/src/grpc/cors.ts`            | copie des listes de Connect (le principal de http ne charge jamais Connect)                        |
| config         | `http/nodefony/config/config.ts#grpcSchema` | `grpc`/`grpcWeb`/`connect`, `readMaxBytes`/`writeMaxBytes` (4 Mio), `requireConnectProtocolHeader` |

`@nodefony/http` principal et `@nodefony/framework` principal ne citent **ni Connect ni
protobuf, même en type** : tout passe par les sous-chemins `/grpc`. Un `import type` de Connect au
fond de http = TS2307 chez une application sans gRPC ; deux gardes de publication le refusent
(`scripts/release/dts-deps.mjs`, `scripts/release/peers.mjs`).

## 3. Règles qui ne se renégocient pas (ADR-0026)

- **Un seul écrivain par réponse.** Connect possède la réponse d'un appel : Nodefony n'y écrit ni
  408/504 (`_onTimeout` termine par la fiche), ni `context.close()` (la révocation passe par la
  fermeture fournie). Les refus AVANT l'adaptateur sont écrits par le noyau seul
  (`prepareGrpcRefusal`) — pas de `requestGate` qui refuse (il ne sert que d'observateur).
- **Code par identité** : refus sans identité → 16, identifié → 7. Jamais déduire du 401/403.
- **Deux tables, jamais fusionnées** : refus de transport (norme HTTP→gRPC, + 405 et 421 → 12/14)
  et erreurs d'application (`code.proto`). En Connect, le code est celui que le client DÉDUIT du
  statut HTTP.
- **Traduction des erreurs de flux : avant le premier message seulement** (`FirstMessageTranslator`).
  Une promesse par message = +45 ns/message pour un chemin d'erreur.
- **Rien par message** : ni trace, ni ligne, ni écouteur. Le seul coût par message est la relecture
  de l'interruption (≈ 34 ns).
- **`grpc-timeout` n'est jamais posé ni raboté** par le serveur : `ctx.timeoutMs()` = client seul
  (le poser = 1 717 rouges sur 4 932 de la conformité).
- **HTTP/2 : un refus finit sur la trame d'en-têtes** (`stream.respond(h, { endStream: true })`),
  jamais `writeHead` + `end` (grpc-go lit `INTERNAL`). Coupe d'un client qui émet encore : après
  un `PING` de grâce, un par session (`http2StreamGrace.ts#closeStreamAfterGrace`).
- **Un 404/405 ne lit pas le corps.**
- **À l'arrêt** : un registre unique des flux longs (`StreamLifecycle.ts#ShutdownRegistry`), pas
  de `shutdownSignal` de Connect (linéaire en appels ouverts).

## 4. Pièges payés

- **Le superviseur de dev recharge http et test à chaque édition** : un vert « avant correctif » peut
  porter sur le correctif. Vérifier le `dist` (`rg` dans `dist/`) avant de conclure.
- **En singleton, l'adaptateur lie TOUTES les méthodes à la construction** : une cible incomplète
  rend `UNIMPLEMENTED` pour tout. Tests de flux en `perCall` (`@Scope("request")`).
- **`tsc -p .` ne couvre pas les tests** : `npm run typecheck` du module avant de pousser.
- **Mutation par `if (false)`** : le build JS passe (code mort retiré), seuls les `.d.ts` refusent.
- **Trailers de `@grpc/grpc-js`** : à lire sur l'événement `status`, pas dans le callback.
- **Mesurer sur la vraie bibliothèque** avant tout signalement amont : une imitation du refus a
  déjà produit un chiffre faux.
- **Un `Any` en JSON** exige son type dans le graphe d'imports du contrat (`jsonOptions.registry`).

## 5. Prouver

| Quoi                                 | Commande                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| unitaires                            | `cd src/packages/@nodefony/framework && npx vitest run nodefony/tests/unit/grpc*` ; idem `http`                                                       |
| intégration (serveur de dev démarré) | `npx vitest run -c vitest.integration.config.ts nodefony/tests/integration/grpc` (framework)                                                          |
| conformité officielle Connect        | `npm run test:grpc-conformance` — ≈ 4 900 cas, échecs connus dans `src/modules/test/conformance/known-failing.txt` (vide)                             |
| dérive du code généré                | `node scripts/gates/check-generated-protobuf.mjs`                                                                                                     |
| stabilité au symbole                 | `node scripts/gates/check-symbol-stability.mjs` (après build) — tout symbole `@experimental` = une ligne du tableau de `docs/guides/compatibilite.md` |
| surcoût par appel                    | skill `nodefony-load-test`, `scripts/grpc-unary-overhead.mjs` (secteur, `pmset` vérifié)                                                              |

Tout changement de sémantique (codes, en-têtes, échéance, fin de flux) : rejouer la conformité.
Clients d'interopérabilité en CI : `@grpc/grpc-js` et `grpcurl` (version figée, `scripts/test/vitest/gates.ts`).
