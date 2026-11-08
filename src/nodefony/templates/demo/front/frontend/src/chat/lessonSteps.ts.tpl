/**
 * Les étapes du cookbook du chat, et le code qui fait chacune — CITÉ des vrais
 * fichiers du module, jamais recopié : une copie dans la page divergerait du
 * code qui tourne sans que rien ne le signale.
 *
 * Guide pour un agent : un extrait est un bloc `// #region <nom>` …
 * `// #endregion` d'un fichier du module. Le test du module
 * (`tests/demo.test.ts`) exige que chaque région citée ici existe et ne soit
 * pas vide : renommer une région sans mettre à jour cette liste le fait
 * échouer. Le texte des fichiers est lu par Vite (`lessonSources.ts`,
 * `import.meta.glob`). Doc : `@nodefony/realtime/docs/cookbook-chat.md`.
 */

/** Un fichier cité, relatif à la racine du module, séparateur `/`. */
export type LessonFile =
  | "nodefony/controllers/ChatController.ts"
  | "nodefony/service/ChatService.ts"
  | "nodefony/config/security.ts"
  | "frontend/src/chat/chatContract.ts"
  | "frontend/src/chat/useChat.ts";

/** Un extrait : la région `region` du fichier `file`, et ce qu'il faut y lire. */
export interface ILessonExcerpt {
  file: LessonFile;
  region: string;
  /** Ce que l'extrait montre, en une phrase ; `code` entre accents graves. */
  note: string;
}

/** Une étape du cookbook ; `soon` : pas encore dans la démo. */
export interface ILessonStep {
  step: number;
  title: string;
  summary: string;
  status: "ready" | "soon";
  excerpts: readonly ILessonExcerpt[];
}

const CONTROLLER = "nodefony/controllers/ChatController.ts";
const HOOK = "frontend/src/chat/useChat.ts";

/** Les sept étapes du cookbook, dans l'ordre. */
export const CHAT_LESSON_STEPS = [
  {
    step: 1,
    title: "Le chat minimal",
    summary:
      "Une classe, une porte WebSocket, un canal. Le navigateur s'abonne au canal : un message publié côté serveur arrive dans tous les onglets ouverts.",
    status: "ready",
    excerpts: [
      {
        file: CONTROLLER,
        region: "chat-class",
        note: "`@controller` préfixe toutes les routes ; `ContractRealtimeController<ChatContract>` lie la classe au contrat que le navigateur compile aussi.",
      },
      {
        file: CONTROLLER,
        region: "chat-door",
        note: "La route `WEBSOCKET` est la porte de la socket ; `realtimeApiRequest()` rend les actions HTTP de la classe joignables par elle.",
      },
      {
        file: CONTROLLER,
        region: "chat-room",
        note: "`@RealtimeChannel` déclare le salon. La méthode rend son nettoyage : ici rien, le salon ne fait que relayer.",
      },
      {
        file: HOOK,
        region: "chat-room-client",
        note: "Côté page, `socket.on` reçoit chaque message du salon, typé par le contrat ; la fonction qu'il rend désabonne au démontage du composant.",
      },
    ],
  },
  {
    step: 2,
    title: "HTTP et WebSocket",
    summary:
      "La même action répond à `GET /demo/chat/history` et à `socket.get(…)` : un seul code, une seule validation, une seule sécurité.",
    status: "ready",
    excerpts: [
      {
        file: CONTROLLER,
        region: "chat-history",
        note: '`methods: ["GET", "WEBSOCKET"]` ouvre les deux transports ; `schema.query` valide les paramètres AVANT l\'action, qui reçoit des valeurs typées.',
      },
      {
        file: HOOK,
        region: "chat-history-client",
        note: "Relu par la socket à chaque connexion : les messages manqués pendant une coupure reviennent, et le type de la réponse vient du contrat.",
      },
    ],
  },
  {
    step: 3,
    title: "La frappe en cours",
    summary:
      "Un second canal sur la même connexion. Le signal ne porte aucun champ : le serveur sait qui écrit, le client ne peut pas se faire passer pour un autre.",
    status: "ready",
    excerpts: [
      {
        file: CONTROLLER,
        region: "chat-typing",
        note: "`@RealtimeInbound(…, { authenticated: true })` reçoit le signal des seuls connectés ; l'auteur vient de `this.user`.",
      },
      {
        file: HOOK,
        region: "chat-typing-client",
        note: "La page émet un signal vide, au plus toutes les deux secondes.",
      },
    ],
  },
  {
    step: 4,
    title: "Garder l'historique",
    summary:
      "Un service, parce que le contrôleur temps réel vit le temps d'une connexion. Ici en mémoire et borné ; le cookbook le passe en base.",
    status: "ready",
    excerpts: [
      {
        file: CONTROLLER,
        region: "chat-inject",
        note: '`@Inject("ChatService")` fournit le service par son nom : le même exemplaire pour toutes les connexions.',
      },
      {
        file: "nodefony/service/ChatService.ts",
        region: "chat-store",
        note: "Un tampon borné : au-delà de la limite, les plus anciens sortent ; `since` sert à rattraper une coupure.",
      },
    ],
  },
  {
    step: 5,
    title: "Protéger l'écriture",
    summary:
      "Une zone pour savoir qui visite, `@IsGranted` sur l'envoi, l'auteur tiré de la session, et un contrat que les deux côtés compilent.",
    status: "ready",
    excerpts: [
      {
        file: "nodefony/config/security.ts",
        region: "chat-area",
        note: "La zone `demo` : la session identifie, l'anonyme passe. Lire reste libre, mais `this.user` dit qui écrit.",
      },
      {
        file: "frontend/src/chat/chatContract.ts",
        region: "chat-contract",
        note: "Le contrat : canaux et routes, avec leurs types. Le serveur et la page l'importent tous les deux.",
      },
      {
        file: CONTROLLER,
        region: "chat-routes",
        note: "`satisfies ContractRouteSchemas<ChatContract>` : une route du contrat sans schéma ne compile pas, une route sans action ne démarre pas.",
      },
      {
        file: CONTROLLER,
        region: "chat-send",
        note: "`@IsGranted` refuse l'anonyme (401) avant l'action ; `@Idempotent` rend la même réponse à une trame rejouée au lieu de publier deux fois.",
      },
      {
        file: HOOK,
        region: "chat-send-client",
        note: "La page envoie le texte seul, par la socket ; un refus rejette la promesse, et la page l'affiche.",
      },
    ],
  },
  {
    step: 6,
    title: "La pièce jointe",
    summary:
      "Un envoi de fichier en HTTP, annoncé sur la socket, dans la même classe. Pas encore dans cette démo : le cookbook le montre.",
    status: "soon",
    excerpts: [],
  },
  {
    step: 7,
    title: "Plusieurs pods",
    summary:
      "Un décorateur, et le salon traverse les serveurs : rien d'autre ne change.",
    status: "ready",
    excerpts: [
      {
        file: CONTROLLER,
        region: "chat-class",
        note: '`@RealtimeBroadcast("chat:")` : toute publication sur un canal `chat:` passe par le bus, et chaque serveur la relaie à ses abonnés.',
      },
    ],
  },
] as const satisfies readonly ILessonStep[];

/** Un décorateur du contrôleur, et l'étape qui le montre. */
export interface ILessonDecorator {
  /** Nom, sans `@`. */
  name: string;
  /** Paquet qui l'exporte. */
  from: string;
  /** Ce qu'il fait, en une phrase. */
  role: string;
  /** Étape dont un extrait le montre. */
  step: number;
  /** Région du contrôleur où il apparaît. */
  region: string;
}

/**
 * TOUS les décorateurs du contrôleur du chat — le test du module exige que
 * la liste soit complète, et que chacun apparaisse dans la région nommée.
 */
export const CHAT_DECORATORS = [
  {
    name: "controller",
    from: "@nodefony/framework",
    role: "Déclare la classe comme contrôleur et préfixe toutes ses routes.",
    step: 1,
    region: "chat-class",
  },
  {
    name: "route",
    from: "@nodefony/framework",
    role: "Une route : son nom, son chemin, ses méthodes (dont `WEBSOCKET`) et le schéma qui valide l'entrée.",
    step: 1,
    region: "chat-door",
  },
  {
    name: "RealtimeChannel",
    from: "@nodefony/realtime",
    role: "Un canal auquel le navigateur s'abonne ; la méthode rend son nettoyage.",
    step: 1,
    region: "chat-room",
  },
  {
    name: "RealtimeInbound",
    from: "@nodefony/realtime",
    role: "Reçoit les messages que le navigateur envoie sur un canal, avec sa politique d'accès.",
    step: 3,
    region: "chat-typing",
  },
  {
    name: "Inject",
    from: "nodefony",
    role: "Fournit un service par son nom au constructeur.",
    step: 4,
    region: "chat-inject",
  },
  {
    name: "IsGranted",
    from: "@nodefony/framework",
    role: "Exige des rôles avant d'entrer dans l'action : 401 sans session, 403 sans le rôle.",
    step: 5,
    region: "chat-send",
  },
  {
    name: "Idempotent",
    from: "@nodefony/framework",
    role: "Mémorise la réponse par clé d'idempotence : un envoi rejoué n'agit pas deux fois.",
    step: 5,
    region: "chat-send",
  },
  {
    name: "RealtimeBroadcast",
    from: "@nodefony/realtime",
    role: "Fait traverser les canaux d'un préfixe d'un serveur à l'autre.",
    step: 7,
    region: "chat-class",
  },
] as const satisfies readonly ILessonDecorator[];

/** Ligne d'ouverture ou de fermeture d'une région. */
const REGION_OPEN = /^\s*\/\/ #region (\S+)\s*$/;
const REGION_CLOSE = /^\s*\/\/ #endregion\b/;

/**
 * Le texte d'une région d'un fichier, désindenté.
 *
 * @param source - le texte entier du fichier
 * @param name - le nom de la région (`// #region <name>`)
 * @returns le corps de la région, ou `null` si elle n'existe pas ou n'est
 *   pas refermée
 */
export function extractRegion(source: string, name: string): string | null {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => REGION_OPEN.exec(line)?.[1] === name);
  if (start === -1) return null;
  const length = lines
    .slice(start + 1)
    .findIndex((line) => REGION_CLOSE.test(line));
  if (length === -1) return null;
  const body = lines.slice(start + 1, start + 1 + length);
  const indent = Math.min(
    ...body
      .filter((line) => line.trim() !== "")
      .map((line) => line.length - line.trimStart().length),
  );
  return body
    .map((line) => line.slice(Number.isFinite(indent) ? indent : 0))
    .join("\n")
    .trim();
}
