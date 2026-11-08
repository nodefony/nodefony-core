/**
 * Index des démos — SOURCE UNIQUE : l'accueil `/demo` en tire son catalogue
 * et ses onglets de métier, et un agent y trouve, pour chaque démo, les
 * fichiers à lire, les types à utiliser, la doc, la commande et le skill.
 *
 * Guide pour un agent : une démo se déclare ICI, et nulle part ailleurs —
 * pas de JSON parallèle. `as const satisfies` garde les littéraux (les `id`
 * deviennent le type `DemoId`, que les onglets de métier référencent) tout en
 * vérifiant chaque entrée contre `IDemoEntry`. Les chemins de `files` sont
 * relatifs au module ; ceux de `doc`, à `node_modules`.
 */

/** Niveau d'une démo, affiché en étiquette sur sa carte. */
export type DemoLevel = "beginner" | "intermediate" | "advanced";

/** Rubrique du catalogue. */
export type DemoRubric = "realtime" | "transports" | "programs";

/** Une entrée de l'index. */
export interface IDemoEntry {
  /** Identifiant stable, ancre de la carte (`#demo-<id>`). */
  id: string;
  title: string;
  rubric: DemoRubric;
  level: DemoLevel;
  /** Ce que la démo montre, en une ou deux phrases ; `code` entre accents graves. */
  teaches: string;
  /** `soon` : carte grisée « Démo à venir » — la fonctionnalité existe, la démo pas encore. */
  status: "ready" | "soon";
  /** Étiquette courte affichée en haut de la carte. */
  tag?: string;
  /** Page de la démo, quand elle en a une. */
  path?: string;
  /** Fichiers du module à lire, dans l'ordre. */
  files: readonly string[];
  /** Types publics que la démo emploie, avec leur paquet. */
  types: readonly string[];
  /** Page de doc, chemin sous `node_modules`. */
  doc?: string;
  /** Commande qui la montre ou qui génère son équivalent. */
  command?: string;
  /** Skill qui porte le savoir-faire. */
  skill?: string;
}

/** Les rubriques, dans l'ordre d'affichage. */
export const DEMO_RUBRICS = [
  {
    id: "realtime",
    title: "Temps réel",
    summary: "la socket, les canaux, le binaire",
  },
  {
    id: "transports",
    title: "Flux et transports",
    summary: "HTTP, HTTP/2, flux serveur",
  },
  {
    id: "programs",
    title: "Sécurité, programmes et agents",
    summary: "jetons, outils, fichiers",
  },
] as const satisfies readonly {
  id: DemoRubric;
  title: string;
  summary: string;
}[];

export const DEMOS = [
  {
    id: "chat",
    title: "Chat",
    rubric: "realtime",
    level: "intermediate",
    teaches:
      "Présence, « en train d'écrire », historique, salon protégé. Lecture libre, écriture sous session.",
    status: "ready",
    tag: "cookbook, 7 étapes",
    path: "/demo/chat",
    files: [
      "frontend/src/chat/chatSchemas.ts",
      "frontend/src/chat/chatContract.ts",
      "nodefony/controllers/ChatController.ts",
      "nodefony/service/ChatService.ts",
      "frontend/src/chat/ChatLesson.tsx",
      "frontend/src/chat/attachments.ts",
      "frontend/src/chat/ChatComposer.tsx",
      "frontend/src/chat/ChatAttachments.tsx",
      "frontend/src/kit/preview.ts",
      "frontend/src/kit/FilePreview.tsx",
      "frontend/src/kit/markdown.ts",
      "frontend/src/kit/MarkdownText.tsx",
      "frontend/src/kit/MarkdownEditor.tsx",
    ],
    types: [
      "ContractRealtimeController (@nodefony/realtime)",
      "IRealtimeContract (nodefony/client)",
      "NodefonySocket (nodefony/client)",
    ],
    doc: "@nodefony/realtime/docs/cookbook-chat.md",
    command: "npx nodefony create controller chat --kind realtime",
    skill: "nodefony-add-realtime-channel",
  },
  {
    id: "binary",
    title: "Temps réel binaire",
    rubric: "realtime",
    level: "advanced",
    teaches:
      "Les mêmes messages en trames binaires CBOR : plus petits, typés des deux côtés.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "sensor",
    title: "Sonde industrielle",
    rubric: "realtime",
    level: "intermediate",
    teaches:
      "Une machine pousse ses mesures ; le tableau se met à jour seul. Part du cas `sensors`.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "game",
    title: "Jeu",
    rubric: "realtime",
    level: "advanced",
    teaches:
      "Coups joués en direct et appariement des joueurs. Part des cas `gameMoves` et `matchmaking`.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "first-steps",
    title: "Premiers pas",
    rubric: "transports",
    level: "beginner",
    teaches:
      "Un contrôleur en dix gestes : rendre une valeur, du HTML, un corps validé, une erreur, une redirection, une `Response` Web, un flux, un fichier, l'appelant — et la même action par WebSocket.",
    status: "ready",
    tag: "10 étapes à essayer",
    path: "/demo/first-steps",
    files: [
      "frontend/src/first/firstSteps.ts",
      "nodefony/controllers/FirstStepsController.ts",
      "frontend/src/first/FirstStepsLesson.tsx",
      "frontend/src/kit/probe.ts",
      "frontend/src/kit/ProbeResult.tsx",
    ],
    types: ["Controller (@nodefony/framework)", "HttpError (@nodefony/http)"],
    doc: "@nodefony/framework/docs/controller.md",
    command: "npx nodefony create controller",
    skill: "nodefony-dev",
  },
  {
    id: "sse",
    title: "Flux SSE",
    rubric: "transports",
    level: "beginner",
    teaches:
      "Pousser des événements serveur (`text/event-stream`) que le navigateur lit avec `EventSource` : nommés et typés, repris après une coupure, gardés vivants, négociés, et en réponse à un `POST`.",
    status: "ready",
    tag: "7 gestes à essayer",
    path: "/demo/sse",
    files: [
      "frontend/src/sse/sseDemo.ts",
      "nodefony/controllers/SseController.ts",
      "frontend/src/sse/SseLesson.tsx",
      "frontend/src/kit/probe.ts",
      "frontend/src/kit/StepsLesson.tsx",
    ],
    types: ["SseStream (@nodefony/http)", "NodefonySse (nodefony/client)"],
    doc: "@nodefony/http/docs/sse.md",
    command: "npx nodefony create controller",
    skill: "nodefony-dev",
  },
  {
    id: "video-range",
    title: "Vidéo par plages",
    rubric: "transports",
    level: "intermediate",
    teaches: "Servir une vidéo de `media/` par requêtes `Range`.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "grpc",
    title: "gRPC",
    rubric: "transports",
    level: "advanced",
    teaches:
      "Un service gRPC servi dans le même pipeline HTTP/2 que le reste de l'application.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "partner",
    title: "API entre programmes",
    rubric: "programs",
    level: "advanced",
    teaches:
      "Un programme appelle `/demo/api/partner` avec un jeton : sans jeton 401, avec 200, altéré 401 — à essayer dans la page.",
    status: "ready",
    tag: "jeton machine",
    path: "/demo/partner",
    files: [
      "nodefony/config/security.ts",
      "nodefony/controllers/PartnerController.ts",
      "nodefony/service/PartnerTokenService.ts",
      "nodefony/controllers/PartnerTokenController.ts",
      "frontend/src/partner/usePartnerLab.ts",
      "nodefony/command/PartnerCallCommand.ts",
    ],
    types: [
      "ISecurityConfigInput (@nodefony/security)",
      "TokenService (@nodefony/security)",
      "Firewall (@nodefony/security)",
    ],
    doc: "@nodefony/security/docs/obtenir-un-jeton.md",
    command: "npx nodefony demo:partner:call",
  },
  {
    id: "mcp",
    title: "MCP",
    rubric: "programs",
    level: "advanced",
    teaches: "Exposer des outils à un agent, avec leur scope réservé.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "upload",
    title: "Envoi de fichiers",
    rubric: "programs",
    level: "beginner",
    teaches: "Téléverser un fichier, suivre sa progression, le relire.",
    status: "soon",
    files: [],
    types: [],
  },
  {
    id: "quick-doc",
    title: "Doc rapide",
    rubric: "programs",
    level: "beginner",
    teaches: "Trouver la page de doc d'un module depuis l'application.",
    status: "soon",
    files: [],
    types: [],
  },
] as const satisfies readonly IDemoEntry[];

/** Identifiant d'une démo de l'index — une faute de frappe ne compile pas. */
export type DemoId = (typeof DEMOS)[number]["id"];
