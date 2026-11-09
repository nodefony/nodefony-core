<!-- @if app -->
<% if (it.complete) { %>
<!-- @end -->

## Le temps réel, de bout en bout

**Nodefony est un framework temps réel.** Une application vivante pose toujours les mêmes questions :
pousser au navigateur, dans un sens ou dans les deux ; ouvrir des salons et savoir qui s'y trouve ;
décider qui entre ; faire passer des octets ; tenir à plusieurs instances ; voir ce qui se passe
quand ça coince. Chacune a sa réponse dans le framework, écrite contre la norme qui la définit, et
éprouvée par des tests.

| Ce qu'il te faut                      | Ce que Nodefony fournit                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Échanger dans les deux sens**       | La **socket Nodefony** : des canaux à volonté sur une seule connexion — le serveur diffuse, le client appelle et attend la réponse, ou pousse sans attendre. JSON-RPC 2.0 sur WebSocket (RFC 6455), dans le pipeline HTTP |
| **Pousser dans un seul sens**         | Les **flux SSE** (`text/event-stream`) : une action répond par `this.renderSse()`, en HTTP/1.1 comme en HTTP/2. Le client isomorphe se reconnecte avec `Last-Event-ID`, et sait envoyer un `POST` et des en-têtes         |
| **Des salons et leurs membres**       | **Canaux à membres** : lister qui est là, abonner d'office, éjecter un compte, fermer le salon, sur toutes les instances. Un message privé atteint une personne par `publishToUser`                                       |
| **Décider qui entre**                 | Une **règle d'admission** par canal (`allow`, fonction ou service injecté), sous le même pare-feu que le HTTP. Origine vérifiée à la poignée de main ; un jeton expiré ferme la socket avec un code dédié                 |
| **Faire passer des octets**           | **CBOR** (RFC 8949), négocié connexion par connexion — détaillé ci-dessous                                                                                                                                                |
| **Tenir à plusieurs instances**       | Un bus de diffusion entre workers ou par Redis, messages scellés (HMAC-SHA256). Un seul producteur par canal et par processus, quel que soit le nombre d'abonnés                                                          |
| **Tenir la charge**                   | Contre-pression en sortie, débit borné en entrée, cadence de diffusion qui s'adapte à chaque client                                                                                                                       |
| **Des types de bout en bout**         | Un **contrat** écrit une fois type le contrôleur, la socket et les hooks React, Vue, Svelte et Angular. Les routes qu'il annonce sont vérifiées au démarrage                                                              |
| **Voir et tester**                    | Une sonde, la console d'administration, les onglets Socket et SSE de la barre de débogage, un traceur de trames ; une identité d'essai pour tester un canal protégé                                                       |
| **gRPC** — _à venir en 10.0.0-beta.7_ | Des services gRPC servis par le même pipeline HTTP/2, déclarés depuis un module, avec la réflexion et la santé standard                                                                                                   |

Chaque besoin a son exemple complet et testé : jeu (déplacements, recherche de partie), salon privé
sur invitation, sonde industrielle, tableau de bord partagé, notification privée, tâche d'agent.

### Le binaire, sans conversion

JSON reste le format par défaut. Dès que des octets circulent — image, son, mesures de capteur,
état d'une partie —, le serveur accepte **CBOR**, un JSON binaire. Nodefony embarque son propre
codec : isomorphe, sans dépendance, environ 5,5 Ko compressés, et téléchargé seulement par la page
qui l'importe. Il rend exactement ce que JSON rendrait, à une exception près : un `Uint8Array`
voyage en octets et revient en `Uint8Array`. Un message ordinaire pèse 30 à 45 % de moins, et 64 Ko
d'octets en occupent 65,6 au lieu des 87,4 du base64.

Le codec se **négocie connexion par connexion**. Le client qui l'offre parle CBOR ; celui qui ne
l'offre pas reste en texte et reçoit les mêmes données. Aucun client ne casse, et un canal suivi par
les deux sortes de connexions paie un encodage par codec, jamais un par abonné.

```ts
// nodefony.config.ts — le serveur accepte CBOR
use("@nodefony/realtime", { codec: "cbor" });
```

```ts
// navigateur — le client l'offre à l'ouverture
import { NodefonySocket } from "nodefony/client";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";

const socket = NodefonySocket.shared({
  url: "/chat/realtime",
  codec: CBOR_FRAME_CODEC,
});
```

→ [La socket Nodefony](https://nodefony.net/docs/modules/realtime/) ·
[Les cas d'usage](https://nodefony.net/docs/modules/realtime/cas-d-usage/) ·
[Les flux SSE](https://nodefony.net/docs/modules/http/sse/) ·
[Le codec CBOR](https://nodefony.net/docs/modules/core/cbor/)

<!-- @if app -->
<% } %>
<!-- @end -->
