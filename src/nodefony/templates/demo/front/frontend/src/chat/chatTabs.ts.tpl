import type { ILesson, LessonFile } from "../lesson/lesson";

/**
 * Le chat, couche par couche — le code CITÉ des vrais fichiers du module
 * (modèle commun : `lesson/lesson.ts`). Les étapes du cookbook
 * (`@nodefony/realtime/docs/cookbook-chat.md`) sont rappelées sur chaque
 * extrait.
 */

const CONTROLLER: LessonFile = "nodefony/controllers/ChatController.ts";
const HOOK: LessonFile = "frontend/src/chat/useChat.ts";
const SERVICE: LessonFile = "nodefony/service/ChatService.ts";
const RULES: LessonFile = "frontend/src/chat/attachments.ts";
const PREVIEW: LessonFile = "frontend/src/kit/preview.ts";
const MARKDOWN: LessonFile = "frontend/src/kit/markdown.ts";
const ROOMS: LessonFile = "nodefony/service/RoomService.ts";
const ADMISSION: LessonFile = "nodefony/service/RoomAdmission.ts";
const ENTITIES: LessonFile = "nodefony/entity/rooms.ts";
const RULE: LessonFile = "frontend/src/chat/rooms.ts";
const ROSTER: LessonFile = "frontend/src/chat/roster.ts";

export const CHAT_LESSON = {
  tabs: [
    {
      layer: "config",
      blocks: [
        {
          text: "Le module de la démo apporte sa propre zone au firewall de l'application, sans toucher à sa configuration : la clé `module-security` est fusionnée dans celle de `@nodefony/security` au démarrage. Retirer la démo retire sa zone.",
          excerpt: {
            file: "nodefony/config/config.ts",
            region: "demo-module-security",
          },
        },
        {
          text: "Les salons vivent dans une base SQLite À LA DÉMO, jamais celle de l'application : la démo ajoute un connecteur `demo` à `@nodefony/drizzle` par la même mécanique (`module-drizzle`). Un ORM porte plusieurs connecteurs, et deux ORM cohabitent : une application MongoDB charge Drizzle pour la seule démo. Pourquoi une base à part : la première migration de l'application créerait sinon les tables d'un module de développement EN PRODUCTION.",
          excerpt: {
            file: "nodefony/config/config.ts",
            region: "demo-connector",
          },
        },
      ],
    },
    {
      layer: "security",
      blocks: [
        {
          text: "La règle d'abord : lire est libre, écrire exige une session. La zone `demo` du firewall couvre les pages, l'API et la socket de la démo ; la session identifie le visiteur connecté, l'anonyme passe en lecture. Sans zone, `this.user` vaudrait `null` sans un mot — le serveur ne saurait pas qui écrit.",
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
          text: "UN contrôleur sert HTTP et WebSocket. La classe se lie au contrat que la page compile aussi : un canal ou une route qui n'y figure pas ne compile pas, d'un côté comme de l'autre.",
          excerpt: { file: CONTROLLER, region: "chat-class", step: 1 },
        },
        {
          text: "Le contrat porte aussi les VALEURS des routes : le schéma même que chaque route valide. Une route du contrat sans action ne démarre pas.",
          excerpt: { file: CONTROLLER, region: "chat-routes", step: 5 },
        },
        {
          text: "Le contrôleur temps réel est recréé à chaque connexion : il ne garde rien. Ce qui doit durer — l'historique, le pouls de l'accueil — vit dans des services, fournis par leur nom.",
          excerpt: { file: CONTROLLER, region: "chat-inject", step: 4 },
        },
        {
          text: "La porte de la socket : une route `WEBSOCKET`. En ouvrant le pont, les actions HTTP de la classe deviennent joignables par la socket, sous la même sécurité.",
          excerpt: { file: CONTROLLER, region: "chat-door", step: 1 },
        },
        {
          text: "La garde de chaque route d'un salon : la MÊME règle que le canal, lue en base. Un salon inconnu répond 404, un salon où l'on n'entre pas répond 403.",
          excerpt: { file: CONTROLLER, region: "chat-admitted" },
        },
        {
          text: "La liste des salons que je vois : les publics, ceux dont je suis membre, ceux où un événement m'invite.",
          excerpt: { file: CONTROLLER, region: "chat-rooms" },
        },
        {
          text: "Lire l'historique d'un salon : une seule action pour `GET …/rooms/{room}/history` et `socket.get(…)`. Le salon du chemin et la requête sont validés AVANT l'action, qui reçoit des valeurs typées.",
          excerpt: { file: CONTROLLER, region: "chat-history", step: 2 },
        },
        {
          text: "Écrire : le visiteur anonyme est refusé avant l'action (403), une trame rejouée reçoit la réponse déjà calculée au lieu de publier deux fois, et l'auteur vient de la session — jamais du navigateur.",
          excerpt: { file: CONTROLLER, region: "chat-send", step: 5 },
        },
        {
          text: "Un message AVEC des pièces : la MÊME classe, mais en HTTP. Le fichier monte en `POST` multipart, en flux jusqu'au disque — des octets en volume n'ont rien à faire dans une trame de socket. Les règles de la page sont REJOUÉES ici, puis le message part sur le salon comme tout autre : HTTP entre, WebSocket sort.",
          excerpt: { file: CONTROLLER, region: "chat-attach", step: 6 },
        },
        {
          text: "Servir une pièce : le type vient des OCTETS, jamais du nom ni du type déclaré par le navigateur. Seuls les images reconnues et les PDF s'affichent ; le reste se télécharge, `nosniff` interdit de deviner et `sandbox` désarme un document ouvert dans un onglet. Le PDF en est exempté (Chrome refuse de l'afficher sous `sandbox`), mais seule une page de l'application peut l'encadrer.",
          excerpt: { file: CONTROLLER, region: "chat-file", step: 6 },
        },
        {
          text: "L'annuaire d'un salon : la présence ne porte qu'une identité opaque, le nom se demande ici — et seuls les présents de CE salon sont nommés, sans quoi la route deviendrait un annuaire de tous les comptes.",
          excerpt: { file: CONTROLLER, region: "chat-people-route" },
        },
        {
          text: "Tous les salons, déclarés UNE fois par un motif. Une classe d'admission tranche qui entre (lue en base, au `subscribe`) ; `presence` donne la liste des présents à qui est admis, et `grace` retient un départ cinq secondes — un rechargement de page ne fait pas « parti, revenu ». Un canal décoré n'est servi que sous son nom exact : la famille l'est par `createRealtimeChannel`.",
          excerpt: { file: CONTROLLER, region: "chat-room", step: 1 },
        },
        {
          text: "La frappe en cours : une action sans corps, réservée aux connectés ADMIS. Le signal part sur le canal du salon, en message éphémère : il suit les droits du salon et ne fuit jamais hors de lui — ce qu'un canal de frappe commun à tous ne garantirait pas.",
          excerpt: { file: CONTROLLER, region: "chat-typing", step: 3 },
        },
      ],
    },
    {
      layer: "service",
      blocks: [
        {
          text: "Qui entre : une classe, parce que la règle lit la base. Une seule instance sert tous les abonnés ; seul `true` admet, une exception vaut refus, et la réponse est RETENUE sur la connexion.",
          excerpt: { file: ADMISSION, region: "rooms-admission-class" },
        },
        {
          text: "Les faits que la règle demande, lus en base à chaque `subscribe` — jamais de cache : une admission doit voir la base du moment.",
          excerpt: { file: ROOMS, region: "rooms-admission" },
        },
        {
          text: "Changer d'appartenance, c'est écrire en base PUIS pousser : `publishToUser` prévient la personne (sa liste change, la page la relit), `evictUser` désabonne sur tous les serveurs qui la retire. Sans éjection, l'admission retenue la laisserait lire.",
          excerpt: { file: ROOMS, region: "rooms-membership" },
        },
        {
          text: "Nommer les présents : la présence du canal dit qui est là, les comptes de l'application disent son nom — une lecture `$in` par l'ORM de l'application, Drizzle ou Mongoose.",
          excerpt: { file: ROOMS, region: "chat-people" },
        },
        {
          text: "L'historique survit aux connexions parce qu'il vit dans un service, unique pour toute l'application. Ici un tampon BORNÉ en mémoire, salon par salon : au-delà de la limite, les plus anciens sortent.",
          excerpt: { file: SERVICE, region: "chat-store", step: 4 },
        },
        {
          text: "Les pièces : chaque fichier est DÉPLACÉ sous un nom tiré par le serveur, puis classé d'après ses premiers octets — image reconnue, texte UTF-8, ou simple fichier. Le stock est borné lui aussi : une pièce sortie laisse son message, marqué « retirée ».",
          excerpt: { file: SERVICE, region: "chat-attachments", step: 6 },
        },
        {
          text: "Ce que le salon montre d'une archive ou d'un document, le serveur l'a LU d'après les octets : un PDF, l'index d'un zip ou d'un tar (rien n'est extrait), les premiers paragraphes d'un Word ou d'un ODT, le coin d'un tableur. Sans dépendance : zip, tar et XML se lisent en quelques lignes.",
          excerpt: { file: PREVIEW, region: "chat-preview", step: 6 },
        },
        {
          text: "Le piège des archives : une « bombe » de quelques Ko qui se déplie en gigaoctets. La taille annoncée n'est jamais crue ; le flux est COUPÉ au premier mégaoctet décompressé.",
          excerpt: { file: PREVIEW, region: "chat-inflate-cap", step: 6 },
        },
      ],
    },
    {
      layer: "data",
      blocks: [
        {
          text: "Les tables sont décrites UNE fois, de façon portable (`defineTable`) : la table de chaque moteur s'en déduit. Un membre est unique par salon (index composite). Les comptes vivent dans une AUTRE base : un salon ne garde que leur identifiant stable, sans clé étrangère — l'intégrité passe par l'événement `onUserRevoked`.",
          excerpt: { file: ENTITIES, region: "rooms-tables" },
        },
      ],
    },
    {
      layer: "front",
      blocks: [
        {
          text: "La règle d'entrée, PURE et partagée : le serveur la tranche avec les faits de la base, la page s'en sert pour l'affichage. Membre, salon public non verrouillé, puis invité d'un événement en cours.",
          excerpt: { file: RULE, region: "rooms-rule" },
        },
        {
          text: "La liste des salons ne s'interroge pas : le serveur POUSSE sur le canal personnel quand elle change, et la page la relit.",
          excerpt: { file: HOOK, region: "chat-rooms-client" },
        },
        {
          text: "Qui est là : la vue de présence du salon, puis les noms demandés à l'annuaire.",
          excerpt: { file: HOOK, region: "chat-presence-client" },
        },
        {
          text: "« Vient d'arriver » et « vient de partir » se CALCULENT par différence entre deux vues : le serveur ne les envoie pas. Une vue partielle (bus perdu, reconnexion) ne marque personne.",
          excerpt: { file: ROSTER, region: "roster-observe" },
        },
        {
          text: "Le contrat, importé par le serveur ET par la page : les canaux, les routes et le type de chaque message. C'est lui qui rend la socket typée de bout en bout.",
          excerpt: {
            file: "frontend/src/chat/chatContract.ts",
            region: "chat-contract",
            step: 5,
          },
        },
        {
          text: "La page s'abonne au salon : chaque message publié arrive ici, déjà typé. La fonction rendue désabonne au démontage du composant.",
          excerpt: { file: HOOK, region: "chat-room-client", step: 1 },
        },
        {
          text: "À chaque connexion, la page relit l'historique par la socket déjà ouverte : les messages manqués pendant une coupure reviennent.",
          excerpt: { file: HOOK, region: "chat-history-client", step: 2 },
        },
        {
          text: "Le signal « j'écris » : vide, et au plus toutes les deux secondes.",
          excerpt: { file: HOOK, region: "chat-typing-client", step: 3 },
        },
        {
          text: "L'envoi : le texte seul. Un refus rejette la promesse, et la page l'affiche.",
          excerpt: { file: HOOK, region: "chat-send-client", step: 5 },
        },
        {
          text: "Le Markdown du salon : le message voyage en texte brut, et chaque page l'analyse avec les MÊMES fonctions pures — d'où un rendu identique pour tous. Le résultat devient des éléments React, jamais du HTML injecté, et un lien ne s'ouvre que vers `http:` ou `https:`.",
          excerpt: { file: MARKDOWN, region: "chat-markdown", step: 6 },
        },
        {
          text: "Les boutons G, I, </> et 🔗 (ou Ctrl/⌘ + B, I, E, K) n'écrivent que du texte : ils posent le marqueur autour de la sélection, ou l'ôtent s'il y est déjà.",
          excerpt: { file: MARKDOWN, region: "chat-format", step: 6 },
        },
        {
          text: "Un grand collage ne remplit pas le champ : au-delà d'un seuil, il devient une pièce, une boîte « Texte collé » — comme un fichier.",
          excerpt: { file: RULES, region: "chat-paste", step: 6 },
        },
        {
          text: "Les règles d'envoi, écrites UNE fois : la page s'en sert pour prévenir, le serveur pour décider.",
          excerpt: { file: RULES, region: "chat-attach-rules", step: 6 },
        },
        {
          text: "Avec des pièces, un `POST` multipart ordinaire, et une clé d'idempotence par intention d'envoi. L'écran ne bouge pas à la réponse : le message revient par le salon, chez l'expéditeur comme chez les autres.",
          excerpt: { file: HOOK, region: "chat-attach-client", step: 6 },
        },
      ],
    },
    {
      layer: "devops",
      blocks: [
        {
          text: "Le problème : chaque serveur a son propre hub. Un message publié sur le serveur A n'atteint pas les abonnés connectés au serveur B — et rien ne le signale. Côté code, on déclare UNE fois quels canaux doivent traverser : tout ce qui commence par `chat:`. Le reste (état d'un processus, métriques) reste local.",
          excerpt: { file: CONTROLLER, region: "chat-broadcast", step: 7 },
        },
        {
          text: "Le relais entre serveurs s'appelle le BACKPLANE, et il se choisit dans la config de l'application, jamais dans le code. Une application créée avec `--demo` démarre déjà avec le driver `cluster` : les workers d'UNE machine se relaient entre eux, sans rien installer.",
          snippet: {
            label: "nodefony.config.ts — déjà écrit dans l'application",
            lines: [
              'use("@nodefony/realtime", { backplane: { driver: "cluster" } }),',
            ],
          },
        },
        {
          text: "Pour l'essayer : deux workers sur ta machine, puis deux onglets. Un message envoyé depuis l'un arrive dans l'autre, même quand les deux sockets sont tenues par des workers différents.",
          snippet: { label: "Terminal", lines: ["npx nodefony cluster -w 2"] },
        },
        {
          text: "Plusieurs machines (des pods Kubernetes, par exemple) : le relais passe par Redis, en pub/sub. Aucun changement de code, tout passe par l'environnement. `NF_REDIS_URL` donne l'adresse de Redis, et sa seule présence charge `@nodefony/redis`, qui ouvre les connexions `publish` et `subscribe` du relais. `NF_REALTIME_DRIVER` choisit le driver : il l'emporte sur la valeur écrite dans `nodefony.config.ts`. `NF_REALTIME_BACKPLANE_NAMESPACE` est la cloison, obligatoire dès que deux déploiements partagent un Redis : le numéro de base ne cloisonne pas le pub/sub, et préproduction et production échangeraient leurs messages. `NF_REALTIME_BACKPLANE_SECRET`, facultatif, scelle chaque message.",
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
          text: "En développement, `docker compose up -d` lève le Redis de l'application ; son adresse est déjà écrite, en commentaire, dans `.env`. Décommente-la, pose `NF_REALTIME_DRIVER=redis`, puis relance en deux workers : le relais passe maintenant par Redis.",
          snippet: {
            label: "Terminal",
            lines: ["docker compose up -d", "npx nodefony cluster -w 2"],
          },
        },
        {
          text: "Au démarrage, une ligne du journal dit le relais retenu, avec le canal effectif (cloison comprise). Redis injoignable ? Le démarrage continue : chaque serveur garde son hub local, et un avertissement le dit. On perd la diffusion entre serveurs, pas l'application.",
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
      role: "une route : nom, chemin, méthodes (dont `WEBSOCKET`) et schéma qui valide l'entrée.",
      file: CONTROLLER,
      region: "chat-door",
    },
    {
      name: "IsGranted",
      from: "@nodefony/framework",
      role: "exige des rôles avant l'action : 401 sans identité, 403 quand l'identité ne les porte pas — l'anonyme d'une zone `anonymous` compris.",
      file: CONTROLLER,
      region: "chat-send",
    },
    {
      name: "Idempotent",
      from: "@nodefony/framework",
      role: "mémorise la réponse par clé d'idempotence : un envoi rejoué n'agit pas deux fois.",
      file: CONTROLLER,
      region: "chat-send",
    },
    {
      name: "Param",
      from: "@nodefony/framework",
      role: "lie un paramètre du chemin (`/files/{id}`) à un argument de l'action.",
      file: CONTROLLER,
      region: "chat-file",
    },
    {
      name: "RealtimeChannel",
      from: "@nodefony/realtime",
      role: "un canal — ou une famille par motif — auquel la page s'abonne : qui entre (`allow`), lecture anonyme, présence ; la méthode rend son nettoyage.",
      file: CONTROLLER,
      region: "chat-room",
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
