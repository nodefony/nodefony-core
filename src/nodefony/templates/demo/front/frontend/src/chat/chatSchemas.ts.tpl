import { z } from "zod";
import { textProblem } from "./attachments";
import { CHAT_HISTORY_LIMIT, PEOPLE_MAX } from "./chatContract";

/**
 * Un texte de message, borné par la règle partagée avec la page
 * (`textProblem`, au plus `MESSAGE_MAX_BYTES` octets UTF-8).
 */
const messageText = z
  .string()
  .trim()
  .superRefine((text, ctx) => {
    const problem = textProblem(text);
    if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
  });

/**
 * Ce que le salon accepte — la SEULE définition du corps de l'envoi et de la
 * query de l'historique.
 *
 * Guide pour un agent : les routes de `ChatController` VALIDENT avec ces
 * schémas (`schema: { body: SendBody }`), avant d'entrer dans l'action, en
 * HTTP comme par la socket ; le contrat (`chatContract.ts`) en lit le `typeof`.
 * Le navigateur n'importe que des TYPES de ce fichier : zod n'entre pas dans
 * son paquet. Doc : `@nodefony/realtime/docs/cookbook-chat.md` (étape 5).
 */
export const SendBody = z.strictObject({
  text: messageText.min(1),
});

/**
 * Le champ texte d'un envoi AVEC pièces (multipart) : il peut être vide, les
 * pièces suffisent alors à faire un message.
 */
export const AttachBody = z.strictObject({
  text: messageText.default(""),
});

/**
 * Le salon visé par une route (`/demo/chat/rooms/{room}/…`) : un identifiant
 * court, sans `:` — il compose le nom du canal `chat:room:<id>`.
 */
export const RoomParams = z.strictObject({
  room: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u),
});

/**
 * Les identités à nommer, séparées par des virgules : `?ids=a1,b2`. Bornée
 * avant d'être découpée (au plus `PEOPLE_MAX` identités de 128 caractères).
 */
export const PeopleQuery = z.strictObject({
  ids: z
    .string()
    .min(1)
    .max(PEOPLE_MAX * 129)
    .transform((list) => list.split(","))
    .pipe(z.array(z.string().min(1).max(128)).max(PEOPLE_MAX)),
});

/** La query de l'historique — elle arrive en texte, `coerce` la convertit. */
export const HistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(CHAT_HISTORY_LIMIT).default(50),
  /** Rattrapage après une coupure : les messages postérieurs à cet instant. */
  since: z.coerce.number().optional(),
});
