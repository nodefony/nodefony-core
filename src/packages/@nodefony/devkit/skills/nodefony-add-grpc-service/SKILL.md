---
name: nodefony-add-grpc-service
metadata:
  version: 1.0.0
description: >
  Sert un service gRPC dans une application Nodefony — contrat `.proto`, code généré par `buf`,
  contrôleur `GrpcController` marqué `@GrpcService`, déclaré par `@controllers` — à charger AVANT
  d'écrire le contrat ou le contrôleur. Porte les paquets à installer, les pièges de génération,
  ce que le framework décide à ta place (ports, refus 16/7, erreurs, arrêt, tailles) et un
  script qui appelle la méthode depuis n'importe quel système pour prouver qu'elle répond.
  Déclencheurs : "service gRPC", "exposer un contrat protobuf", "un client Go doit appeler
  l'application", "gRPC-Web", "Connect", "buf generate", "@GrpcService", "GrpcController",
  "appeler une méthode gRPC", "UNAUTHENTICATED", "UNIMPLEMENTED", "flux gRPC".
---

# add-grpc-service — un contrat typé, servi par le pipeline

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait). Cette page-ci ne couvre QUE gRPC.
>
> La référence complète est INSTALLÉE : `node_modules/@nodefony/framework/docs/grpc.md` (le
> pourquoi de chaque choix, les tables de codes, les limites). Une commande la retrouve, ligne
> comprise :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs grpc`.

> ⚖️ **La confiance n'exclut pas le contrôle.** Un contrôleur qui compile n'est pas un service
> qui répond. Le juge est l'appel réel (§ Prouver).

## Ce qu'il faut savoir avant d'écrire

- **Une méthode gRPC est une route.** Le pare-feu, `@IsGranted`, l'identité (`this.user`) et le
  journal valent comme sur toute route. N'ouvre JAMAIS un second serveur (`@grpc/grpc-js` et son
  `bindAsync`) : il contournerait le pare-feu et les droits.
- **Trois protocoles, servis d'office** : gRPC (HTTP/2 seulement : port 5152 en TLS), gRPC-Web et
  Connect (aussi en HTTP/1.1 : port 5151). Un navigateur et `curl` passent par Connect.
- **Surface expérimentale** : sa forme peut changer en version mineure, toujours annoncée.

## Le geste

### 1. Les paquets

```bash
npm i @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf
npm i -D @bufbuild/buf @bufbuild/protoc-gen-es
```

Le runtime en `dependencies` (une installation de production doit l'avoir), le générateur en
développement. Si npm annonce que le script d'installation de `@bufbuild/buf` est bloqué
(`allowScripts`), ce n'est pas un échec : `buf` fonctionne sans.

### 2. Le contrat — `proto/<paquet>/v1/<nom>.proto`

```proto
edition = "2024";

package greet.v1;

service GreetService {
  rpc Greet(GreetRequest) returns (GreetResponse);
}

message GreetRequest {
  string name = 1;
}

message GreetResponse {
  string greeting = 1;
}
```

Le dossier suit le paquet (`greet/v1/` pour `greet.v1`) : c'est ce que vérifie `buf lint`.

### 3. La génération — deux fichiers à la racine, à côté de `proto/`

```yaml
# buf.yaml
version: v2
modules:
  - path: proto
lint:
  use: [STANDARD]
breaking:
  use: [FILE]
```

```yaml
# buf.gen.yaml
version: v2
inputs:
  - directory: proto
plugins:
  - local: protoc-gen-es
    out: nodefony/gen
    opt: target=ts
```

```bash
npx buf lint
npx buf generate
```

`nodefony/gen/greet/v1/greet_pb.ts` est **commité** et jamais édité : régénérer après chaque
changement du contrat. Nodefony ne génère rien au build ni au démarrage.

### 4. Le contrôleur — `nodefony/controllers/GreetController.ts`

```ts
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import { GreetService } from "../gen/greet/v1/greet_pb";
import type { GreetRequest } from "../gen/greet/v1/greet_pb";

@GrpcService(GreetService)
export class GreetController extends GrpcController {
  constructor(context: ContextType) {
    super("GreetController", context);
  }

  greet(request: GreetRequest) {
    return { greeting: `Bonjour, ${request.name} !` };
  }
}
```

Une méthode par méthode du contrat, nom en minuscule initiale (`Greet` → `greet`). Une méthode
manquante ou mal typée ne compile pas. La logique métier va dans un service injecté
(`@Inject("nom")` au constructeur — skill `nodefony-add-service`).

### 5. La déclaration — `index.ts` de l'application

Ajouter la classe à la liste existante : `@controllers([HomeController, GreetController])`.
Sans cela, la classe compile et aucune route n'existe.

## Ce que le framework décide pour toi

| Sujet            | Ce qui se passe                                                                                             | Ton geste                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Droits           | `@IsGranted` sur la méthode ; refus sans identité → 16 `UNAUTHENTICATED`, identifié → 7 `PERMISSION_DENIED` | rien : ne traduis pas toi-même                     |
| Erreurs          | `ConnectError` part telle quelle ; `HttpError` traduite ; toute autre exception → 13 `INTERNAL`             | lever `new ConnectError(msg, Code.X)` pour choisir |
| Flux             | traduction des erreurs avant le premier message seulement ; arrêt du serveur → 14 ; identité révoquée → 16  | passer `ctx.signal` à tes sources                  |
| Tailles          | 4 Mio par message, reçu ou émis                                                                             | section `grpc` de la config http pour changer      |
| Échéance         | unaire : la plus courte du client et du serveur → 4 ; flux : aucune                                         | rien                                               |
| Décorateurs HTTP | `@Body`, `@UseSession`, `@Csp`, `@Idempotent`… sur une méthode du contrat ARRÊTENT le démarrage             | les retirer : le message EST le paramètre          |

## Prouver

Application démarrée (`npx nodefony development`) :

```bash
npx nodefony inspect routes --json
node node_modules/@nodefony/devkit/skills/nodefony-add-grpc-service/scripts/call.mjs greet.v1.GreetService/Greet --field name=Ada
```

- `inspect routes` doit montrer `POST /greet.v1.GreetService/Greet`. Absente : la classe n'est
  pas dans `@controllers`, ou le `dist` est périmé.
- `call.mjs` rend `HTTP 200` et le message — ou le code gRPC d'un refus (`unauthenticated`…).
  Il passe sous Windows, sans `curl` ni guillemets imbriqués. Message riche : `--file message.json`.
  Jeton : `--header authorization=Bearer <jeton>`. Codes de sortie : 0 réponse, 1 refus,
  64 mauvais usage, 69 application injoignable.
- `npm run typecheck` ne prouve que la forme ; seul l'appel prouve le service.

## Pièges

| Symptôme                                                      | Cause                                                                | Geste                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Cannot find package '@connectrpc/connect-node'` au démarrage | paquet non installé                                                  | `npm i @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf`          |
| `buf generate` : `protoc-gen-es` introuvable                  | lancé hors de l'application, ou générateur non installé              | le lancer à la racine de l'application, après `npm i -D @bufbuild/protoc-gen-es` |
| Un client gRPC natif échoue tout de suite en `INTERNAL`       | il vise 5151, qui est en HTTP/1.1                                    | viser 5152 (TLS)                                                                 |
| `unimplemented` sur un chemin qui semble juste                | casse ou paquet faux dans le chemin (`/greet.v1.GreetService/Greet`) | recopier le chemin depuis `inspect routes`                                       |
| La méthode tourne encore après l'arrêt                        | elle n'écoute pas `ctx.signal`                                       | le passer à la base, à l'abonnement, à `fetch`                                   |

## Voisins

| Besoin                                | Skill                           |
| ------------------------------------- | ------------------------------- |
| La logique métier du service          | `nodefony-add-service`          |
| Réserver une méthode à un rôle        | `nodefony-protect-route`        |
| Un flux temps réel vers le navigateur | `nodefony-add-realtime-channel` |
| Le service ne démarre pas             | `nodefony-troubleshoot`         |
