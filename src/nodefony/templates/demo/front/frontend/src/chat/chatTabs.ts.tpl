import type { ILesson, LessonFile } from "../lesson/lesson";

/**
 * Le chat, couche par couche — le code CITÉ des vrais fichiers du module
 * (modèle commun : `lesson/lesson.ts`). Les étapes du cookbook
 * (`@nodefony/realtime/docs/cookbook-chat.md`) sont rappelées sur chaque
 * extrait.
 */

const CONTROLLER: LessonFile = "nodefony/controllers/ChatController.ts";
const HOOK: LessonFile = "frontend/src/chat/useChat.ts";

export const CHAT_LESSON = {
  tabs: [
    {
      layer: "config",
      blocks: [
        {
          text: "Le module de la démo apporte sa propre zone au firewall de l'application, sans toucher à sa configuration : la clé `module-security` est fusionnée dans celle de `@nodefony/security` au démarrage. Retirer la démo retire sa zone.",
          excerpt: {
            file: "nodefony/config/config.ts",
            region: "demo-module-security",
          },
        },
      ],
    },
    {
      layer: "security",
      blocks: [
        {
          text: "La règle d'abord : lire est libre, écrire exige une session. La zone `demo` du firewall couvre les pages, l'API et la socket de la démo ; la session identifie le visiteur connecté, l'anonyme passe en lecture. Sans zone, `this.user` vaudrait `null` sans un mot — le serveur ne saurait pas qui écrit.",
          excerpt: {
            file: "nodefony/config/security.ts",
            region: "chat-area",
            step: 5,
          },
        },
      ],
    },
    {
      layer: "controller",
      blocks: [
        {
          text: "UN contrôleur sert HTTP et WebSocket. La classe se lie au contrat que la page compile aussi : un canal ou une route qui n'y figure pas ne compile pas, d'un côté comme de l'autre.",
          excerpt: { file: CONTROLLER, region: "chat-class", step: 1 },
        },
        {
          text: "Le contrat porte aussi les VALEURS des routes : le schéma même que chaque route valide. Une route du contrat sans action ne démarre pas.",
          excerpt: { file: CONTROLLER, region: "chat-routes", step: 5 },
        },
        {
          text: "Le contrôleur temps réel est recréé à chaque connexion : il ne garde rien. Ce qui doit durer — l'historique, le pouls de l'accueil — vit dans des services, fournis par leur nom.",
          excerpt: { file: CONTROLLER, region: "chat-inject", step: 4 },
        },
        {
          text: "La porte de la socket : une route `WEBSOCKET`. En ouvrant le pont, les actions HTTP de la classe deviennent joignables par la socket, sous la même sécurité.",
          excerpt: { file: CONTROLLER, region: "chat-door", step: 1 },
        },
        {
          text: "Lire l'historique : une seule action pour `GET /demo/chat/history` et `socket.get(…)`. La requête est validée AVANT l'action, qui reçoit des valeurs typées.",
          excerpt: { file: CONTROLLER, region: "chat-history", step: 2 },
        },
        {
          text: "Écrire : le visiteur anonyme est refusé avant l'action (403), une trame rejouée reçoit la réponse déjà calculée au lieu de publier deux fois, et l'auteur vient de la session — jamais du navigateur.",
          excerpt: { file: CONTROLLER, region: "chat-send", step: 5 },
        },
        {
          text: "Le salon : un canal auquel la page s'abonne. Il relaie ce que l'envoi publie, il n'émet rien de lui-même.",
          excerpt: { file: CONTROLLER, region: "chat-room", step: 1 },
        },
        {
          text: "La frappe en cours : un second canal sur la même connexion. Le signal « j'écris » ne porte aucun champ, et seuls les connectés peuvent l'envoyer : le serveur sait qui écrit.",
          excerpt: { file: CONTROLLER, region: "chat-typing", step: 3 },
        },
      ],
    },
    {
      layer: "service",
      blocks: [
        {
          text: "L'historique survit aux connexions parce qu'il vit dans un service, unique pour toute l'application. Ici un tampon BORNÉ en mémoire : au-delà de la limite, les plus anciens sortent. Le passer en base (cookbook, étape 4) ne change rien au contrôleur.",
          excerpt: {
            file: "nodefony/service/ChatService.ts",
            region: "chat-store",
            step: 4,
          },
        },
      ],
    },
    {
      layer: "front",
      blocks: [
        {
          text: "Le contrat, importé par le serveur ET par la page : les canaux, les routes et le type de chaque message. C'est lui qui rend la socket typée de bout en bout.",
          excerpt: {
            file: "frontend/src/chat/chatContract.ts",
            region: "chat-contract",
            step: 5,
          },
        },
        {
          text: "La page s'abonne au salon : chaque message publié arrive ici, déjà typé. La fonction rendue désabonne au démontage du composant.",
          excerpt: { file: HOOK, region: "chat-room-client", step: 1 },
        },
        {
          text: "À chaque connexion, la page relit l'historique par la socket déjà ouverte : les messages manqués pendant une coupure reviennent.",
          excerpt: { file: HOOK, region: "chat-history-client", step: 2 },
        },
        {
          text: "Le signal « j'écris » : vide, et au plus toutes les deux secondes.",
          excerpt: { file: HOOK, region: "chat-typing-client", step: 3 },
        },
        {
          text: "L'envoi : le texte seul. Un refus rejette la promesse, et la page l'affiche.",
          excerpt: { file: HOOK, region: "chat-send-client", step: 5 },
        },
      ],
    },
    {
      layer: "devops",
      blocks: [
        {
          text: "Le problème : chaque serveur a son propre hub. Un message publié sur le serveur A n'atteint pas les abonnés connectés au serveur B — et rien ne le signale. Côté code, on déclare UNE fois quels canaux doivent traverser : tout ce qui commence par `chat:`. Le reste (état d'un processus, métriques) reste local.",
          excerpt: { file: CONTROLLER, region: "chat-broadcast", step: 7 },
        },
        {
          text: "Le relais entre serveurs s'appelle le BACKPLANE, et il se choisit dans la config de l'application, jamais dans le code. Une application créée avec `--demo` démarre déjà avec le driver `cluster` : les workers d'UNE machine se relaient entre eux, sans rien installer.",
          snippet: {
            label: "nodefony.config.ts — déjà écrit dans l'application",
            lines: [
              'use("@nodefony/realtime", { backplane: { driver: "cluster" } }),',
            ],
          },
        },
        {
          text: "Pour l'essayer : deux workers sur ta machine, puis deux onglets. Un message envoyé depuis l'un arrive dans l'autre, même quand les deux sockets sont tenues par des workers différents.",
          snippet: { label: "Terminal", lines: ["npx nodefony cluster -w 2"] },
        },
        {
          text: "Plusieurs machines (des pods Kubernetes, par exemple) : le relais passe par Redis, en pub/sub. Aucun changement de code, tout passe par l'environnement. `NF_REDIS_URL` donne l'adresse de Redis, et sa seule présence charge `@nodefony/redis`, qui ouvre les connexions `publish` et `subscribe` du relais. `NF_REALTIME_DRIVER` choisit le driver : il l'emporte sur la valeur écrite dans `nodefony.config.ts`. `NF_REALTIME_BACKPLANE_NAMESPACE` est la cloison, obligatoire dès que deux déploiements partagent un Redis : le numéro de base ne cloisonne pas le pub/sub, et préproduction et production échangeraient leurs messages. `NF_REALTIME_BACKPLANE_SECRET`, facultatif, scelle chaque message.",
          snippet: {
            label: ".env, ou variables d'environnement du pod",
            lines: [
              "NF_REDIS_URL=redis://:motdepasse@redis:6379",
              "NF_REALTIME_DRIVER=redis",
              "NF_REALTIME_BACKPLANE_NAMESPACE=mon-app.prod",
              "NF_REALTIME_BACKPLANE_SECRET=un-secret-par-deploiement",
            ],
          },
        },
        {
          text: "En développement, `docker compose up -d` lève le Redis de l'application ; son adresse est déjà écrite, en commentaire, dans `.env`. Décommente-la, pose `NF_REALTIME_DRIVER=redis`, puis relance en deux workers : le relais passe maintenant par Redis.",
          snippet: {
            label: "Terminal",
            lines: ["docker compose up -d", "npx nodefony cluster -w 2"],
          },
        },
        {
          text: "Au démarrage, une ligne du journal dit le relais retenu, avec le canal effectif (cloison comprise). Redis injoignable ? Le démarrage continue : chaque serveur garde son hub local, et un avertissement le dit. On perd la diffusion entre serveurs, pas l'application.",
          snippet: {
            label: "Journal de démarrage",
            lines: [
              "realtime backplane driver=redis kind=redis-pubsub … cross-pod=yes channel=nodefony:realtime:mon-app.prod",
            ],
          },
        },
      ],
    },
  ],
  decorators: [
    {
      name: "controller",
      from: "@nodefony/framework",
      role: "déclare le contrôleur et préfixe toutes ses routes.",
      file: CONTROLLER,
      region: "chat-class",
    },
    {
      name: "Inject",
      from: "nodefony",
      role: "fournit un service par son nom au constructeur.",
      file: CONTROLLER,
      region: "chat-inject",
    },
    {
      name: "route",
      from: "@nodefony/framework",
      role: "une route : nom, chemin, méthodes (dont `WEBSOCKET`) et schéma qui valide l'entrée.",
      file: CONTROLLER,
      region: "chat-door",
    },
    {
      name: "IsGranted",
      from: "@nodefony/framework",
      role: "exige des rôles avant l'action : 401 sans identité, 403 quand l'identité ne les porte pas — l'anonyme d'une zone `anonymous` compris.",
      file: CONTROLLER,
      region: "chat-send",
    },
    {
      name: "Idempotent",
      from: "@nodefony/framework",
      role: "mémorise la réponse par clé d'idempotence : un envoi rejoué n'agit pas deux fois.",
      file: CONTROLLER,
      region: "chat-send",
    },
    {
      name: "RealtimeChannel",
      from: "@nodefony/realtime",
      role: "un canal auquel la page s'abonne ; la méthode rend son nettoyage.",
      file: CONTROLLER,
      region: "chat-room",
    },
    {
      name: "RealtimeInbound",
      from: "@nodefony/realtime",
      role: "reçoit ce que la page envoie sur un canal, avec sa politique d'accès.",
      file: CONTROLLER,
      region: "chat-typing",
    },
    {
      name: "RealtimeBroadcast",
      from: "@nodefony/realtime",
      role: "fait traverser les canaux d'un préfixe d'un serveur à l'autre, par le backplane.",
      file: CONTROLLER,
      region: "chat-broadcast",
    },
  ],
  decoratedFiles: [CONTROLLER],
} as const satisfies ILesson;
