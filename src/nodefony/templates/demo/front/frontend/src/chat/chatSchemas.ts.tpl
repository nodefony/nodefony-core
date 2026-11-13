import { z } from "zod";
import { PEOPLE_MAX } from "./chatContract";

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
  text: z.string().trim().min(1).max(2000),
});

/**
 * Le champ texte d'un envoi AVEC pièces (multipart) : il peut être vide, les
 * pièces suffisent alors à faire un message.
 */
export const AttachBody = z.strictObject({
  text: z.string().trim().max(2000).default(""),
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
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Rattrapage après une coupure : les messages postérieurs à cet instant. */
  since: z.coerce.number().optional(),
});
