import type { LessonFile } from "./lesson";

/**
 * Le texte brut des fichiers cités, lu par Vite à la construction. Les motifs
 * sont des chemins EXACTS (aucun joker) : rien d'autre n'entre dans la page.
 */
const RAW = import.meta.glob<string>(
  [
    "../../../nodefony/config/config.ts",
    "../../../nodefony/config/security.ts",
    "../../../nodefony/controllers/ChatController.ts",
    "../../../nodefony/controllers/FirstStepsController.ts",
    "../../../nodefony/controllers/PartnerController.ts",
    "../../../nodefony/controllers/PartnerTokenController.ts",
    "../../../nodefony/controllers/SseController.ts",
    "../../../nodefony/controllers/VideoController.ts",
    "../../../nodefony/service/ChatService.ts",
    "../../../nodefony/service/PartnerTokenService.ts",
    "../../../nodefony/command/PartnerCallCommand.ts",
    "../chat/chatContract.ts",
    "../chat/attachments.ts",
    "../chat/useChat.ts",
    "../first/firstSteps.ts",
    "../kit/markdown.ts",
    "../kit/preview.ts",
    "../kit/probe.ts",
    "../partner/partnerApi.ts",
    "../partner/usePartnerLab.ts",
    "../sse/sseDemo.ts",
    "../video/videoDemo.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Le texte d'un motif ci-dessus ; vide s'il manque (la page le signale). */
function read(key: string): string {
  return RAW[key] ?? "";
}

/**
 * Le texte des fichiers que les pages d'apprentissage citent : la page montre
 * le code qui tourne, pas une copie.
 *
 * Guide pour un agent : la clé est le chemin déclaré dans `lesson.ts`
 * (`LessonFile`). `satisfies Record<LessonFile, string>` refuse la compilation
 * si un fichier cité n'a pas son texte ici ; le test du module vérifie chaque
 * région citée sur CE texte, celui que la page affiche.
 */
export const LESSON_SOURCES = {
  "nodefony/config/config.ts": read("../../../nodefony/config/config.ts"),
  "nodefony/config/security.ts": read("../../../nodefony/config/security.ts"),
  "nodefony/controllers/ChatController.ts": read(
    "../../../nodefony/controllers/ChatController.ts",
  ),
  "nodefony/controllers/FirstStepsController.ts": read(
    "../../../nodefony/controllers/FirstStepsController.ts",
  ),
  "nodefony/controllers/PartnerController.ts": read(
    "../../../nodefony/controllers/PartnerController.ts",
  ),
  "nodefony/controllers/PartnerTokenController.ts": read(
    "../../../nodefony/controllers/PartnerTokenController.ts",
  ),
  "nodefony/controllers/SseController.ts": read(
    "../../../nodefony/controllers/SseController.ts",
  ),
  "nodefony/controllers/VideoController.ts": read(
    "../../../nodefony/controllers/VideoController.ts",
  ),
  "nodefony/service/ChatService.ts": read(
    "../../../nodefony/service/ChatService.ts",
  ),
  "nodefony/service/PartnerTokenService.ts": read(
    "../../../nodefony/service/PartnerTokenService.ts",
  ),
  "nodefony/command/PartnerCallCommand.ts": read(
    "../../../nodefony/command/PartnerCallCommand.ts",
  ),
  "frontend/src/chat/chatContract.ts": read("../chat/chatContract.ts"),
  "frontend/src/chat/attachments.ts": read("../chat/attachments.ts"),
  "frontend/src/chat/useChat.ts": read("../chat/useChat.ts"),
  "frontend/src/first/firstSteps.ts": read("../first/firstSteps.ts"),
  "frontend/src/kit/markdown.ts": read("../kit/markdown.ts"),
  "frontend/src/kit/preview.ts": read("../kit/preview.ts"),
  "frontend/src/kit/probe.ts": read("../kit/probe.ts"),
  "frontend/src/partner/partnerApi.ts": read("../partner/partnerApi.ts"),
  "frontend/src/partner/usePartnerLab.ts": read("../partner/usePartnerLab.ts"),
  "frontend/src/sse/sseDemo.ts": read("../sse/sseDemo.ts"),
  "frontend/src/video/videoDemo.ts": read("../video/videoDemo.ts"),
} satisfies Record<LessonFile, string>;
