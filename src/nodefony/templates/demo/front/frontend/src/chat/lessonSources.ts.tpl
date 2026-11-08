import type { LessonFile } from "./lessonSteps";

/**
 * Le texte brut des fichiers cités, lu par Vite à la construction. Les motifs
 * sont des chemins EXACTS (aucun joker) : rien d'autre n'entre dans la page.
 */
const RAW = import.meta.glob<string>(
  [
    "../../../nodefony/controllers/ChatController.ts",
    "../../../nodefony/service/ChatService.ts",
    "../../../nodefony/config/security.ts",
    "./chatContract.ts",
    "./useChat.ts",
    "../../../nodefony/controllers/PartnerController.ts",
    "../../../nodefony/controllers/PartnerTokenController.ts",
    "../../../nodefony/service/PartnerTokenService.ts",
    "../../../nodefony/command/PartnerCallCommand.ts",
    "../partner/usePartnerLab.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Le texte d'un motif ci-dessus ; vide s'il manque (la page le signale). */
function read(key: string): string {
  return RAW[key] ?? "";
}

/**
 * Le texte des fichiers que les pages d'apprentissage citent : la page montre le
 * code qui tourne, pas une copie.
 *
 * Guide pour un agent : la clé est le chemin déclaré dans `lessonSteps.ts`.
 * `satisfies Record<LessonFile, string>` refuse la compilation si un fichier
 * cité n'a pas son texte ici ; le test du module vérifie chaque région citée
 * sur CE texte, celui que la page affiche.
 */
export const LESSON_SOURCES = {
  "nodefony/controllers/ChatController.ts": read(
    "../../../nodefony/controllers/ChatController.ts",
  ),
  "nodefony/service/ChatService.ts": read(
    "../../../nodefony/service/ChatService.ts",
  ),
  "nodefony/config/security.ts": read("../../../nodefony/config/security.ts"),
  "frontend/src/chat/chatContract.ts": read("./chatContract.ts"),
  "frontend/src/chat/useChat.ts": read("./useChat.ts"),
  "nodefony/controllers/PartnerController.ts": read(
    "../../../nodefony/controllers/PartnerController.ts",
  ),
  "nodefony/controllers/PartnerTokenController.ts": read(
    "../../../nodefony/controllers/PartnerTokenController.ts",
  ),
  "nodefony/service/PartnerTokenService.ts": read(
    "../../../nodefony/service/PartnerTokenService.ts",
  ),
  "nodefony/command/PartnerCallCommand.ts": read(
    "../../../nodefony/command/PartnerCallCommand.ts",
  ),
  "frontend/src/partner/usePartnerLab.ts": read("../partner/usePartnerLab.ts"),
} satisfies Record<LessonFile, string>;
