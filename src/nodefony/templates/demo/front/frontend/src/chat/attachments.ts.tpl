import { countLines, formatSize } from "../kit/preview";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT } from "./chatContract";

/**
 * Les règles des pièces jointes du salon — pures, lues par la page ET par le
 * serveur : une seule définition de « trop gros », « trop de pièces » et
 * « grand collage ».
 *
 * Guide pour un agent : la page s'en sert pour PRÉVENIR (chip refusée avant
 * l'envoi), le serveur pour DÉCIDER (`ChatController.attach` les rejoue) — le
 * navigateur n'est jamais cru. Aucune dépendance : le fichier entre tel quel
 * dans le paquet du navigateur.
 */

// #region chat-paste
/** Au-delà de ce nombre de caractères, un collage devient une pièce… */
export const LARGE_PASTE_CHARS = 1500;

/** …ou au-delà de ce nombre de lignes. */
export const LARGE_PASTE_LINES = 20;

/**
 * Un collage trop long pour le champ : il part en pièce jointe (une boîte
 * « Texte collé »), comme un fichier — le champ reste lisible, et le salon
 * montre ses premières lignes au lieu d'un mur de texte.
 */
export function isLargePaste(text: string): boolean {
  return (
    text.length > LARGE_PASTE_CHARS || countLines(text) > LARGE_PASTE_LINES
  );
}
// #endregion

/** Le nom du fichier né d'un collage. */
export function pastedFileName(index: number): string {
  return `texte-collé-${index}.txt`;
}

// #region chat-attach-rules
/**
 * Ce qui empêche un envoi : rien à envoyer, trop de pièces, une pièce trop
 * grosse ou vide. `null` quand l'envoi passe.
 *
 * @param text - le texte du message, déjà rogné
 * @param files - les pièces (nom et taille suffisent)
 */
export function attachmentProblem(
  text: string,
  files: readonly { name: string; size: number }[],
): string | null {
  if (text === "" && files.length === 0) return "message vide";
  if (files.length > ATTACHMENT_MAX_COUNT)
    return `au plus ${ATTACHMENT_MAX_COUNT} pièces par message`;
  for (const file of files) {
    if (file.size === 0) return `« ${file.name} » est vide`;
    if (file.size > ATTACHMENT_MAX_BYTES)
      return `« ${file.name} » dépasse ${formatSize(ATTACHMENT_MAX_BYTES)}`;
  }
  return null;
}
// #endregion

/** Les émoticônes du sélecteur : de l'Unicode, aucune bibliothèque. */
export const EMOJIS: readonly { char: string; label: string }[] = [
  { char: "😀", label: "sourire" },
  { char: "😂", label: "rire aux larmes" },
  { char: "😉", label: "clin d'œil" },
  { char: "😍", label: "yeux en cœur" },
  { char: "🤔", label: "pensif" },
  { char: "😮", label: "surpris" },
  { char: "😢", label: "triste" },
  { char: "😡", label: "en colère" },
  { char: "👍", label: "pouce levé" },
  { char: "👎", label: "pouce baissé" },
  { char: "👏", label: "applaudissements" },
  { char: "🙏", label: "merci" },
  { char: "🎉", label: "fête" },
  { char: "🔥", label: "feu" },
  { char: "✅", label: "validé" },
  { char: "❌", label: "refusé" },
  { char: "⚠️", label: "attention" },
  { char: "🚀", label: "fusée" },
  { char: "🐛", label: "bogue" },
  { char: "💡", label: "idée" },
  { char: "❤️", label: "cœur" },
  { char: "👀", label: "regard" },
  { char: "☕", label: "café" },
  { char: "🙂", label: "sourire léger" },
];

/**
 * Insère un texte à la place de la sélection, et rend où poser le curseur.
 *
 * @param value - le texte du champ
 * @param start - début de la sélection
 * @param end - fin de la sélection
 * @param insert - ce qu'on insère
 */
export function insertAt(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    caret: start + insert.length,
  };
}
