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

/** Un extrait : la région `region` du fichier `file`. */
export interface ILessonExcerpt {
  file: LessonFile;
  region: string;
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
      "Un canal côté serveur, un abonnement côté page : un message publié traverse tous les onglets ouverts.",
    status: "ready",
    excerpts: [
      { file: CONTROLLER, region: "chat-room" },
      { file: HOOK, region: "chat-room-client" },
    ],
  },
  {
    step: 2,
    title: "HTTP et WebSocket",
    summary:
      "La même action répond à `GET /demo/chat/history` et à `socket.get(…)` : un seul code, une seule validation.",
    status: "ready",
    excerpts: [
      { file: CONTROLLER, region: "chat-history" },
      { file: HOOK, region: "chat-history-client" },
    ],
  },
  {
    step: 3,
    title: "La frappe en cours",
    summary:
      "Un second canal sur la même connexion. Le signal ne porte aucun champ : le serveur sait qui écrit.",
    status: "ready",
    excerpts: [
      { file: CONTROLLER, region: "chat-typing" },
      { file: HOOK, region: "chat-typing-client" },
    ],
  },
  {
    step: 4,
    title: "Garder l'historique",
    summary:
      "Un service, parce que le contrôleur temps réel vit le temps d'une connexion. Ici en mémoire et borné ; le cookbook le passe en base.",
    status: "ready",
    excerpts: [
      { file: "nodefony/service/ChatService.ts", region: "chat-store" },
    ],
  },
  {
    step: 5,
    title: "Protéger l'écriture",
    summary:
      "Une zone pour savoir qui visite, `@IsGranted` sur l'envoi, l'auteur tiré de la session, et un contrat que les deux côtés compilent.",
    status: "ready",
    excerpts: [
      { file: "nodefony/config/security.ts", region: "chat-area" },
      { file: CONTROLLER, region: "chat-send" },
      { file: "frontend/src/chat/chatContract.ts", region: "chat-contract" },
      { file: HOOK, region: "chat-send-client" },
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
    excerpts: [{ file: CONTROLLER, region: "chat-broadcast" }],
  },
] as const satisfies readonly ILessonStep[];

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
