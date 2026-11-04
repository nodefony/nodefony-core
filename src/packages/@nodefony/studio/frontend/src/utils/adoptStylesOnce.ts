import { adoptStyles } from "nodefony/client";

/** Clés des feuilles déjà appliquées au document. */
const adopted = new Set<string>();

/**
 * Applique UNE fois une feuille de style globale au document, sans la soumettre
 * à `style-src` (ADR-0024 §C2) : `adoptStyles` passe par une feuille construite,
 * qu'aucun nonce n'a à signer — un `<style>` créé à l'exécution serait bloqué.
 *
 * @param key - nom stable de la feuille (déduplication).
 * @param css - texte de la feuille.
 */
export function adoptStylesOnce(key: string, css: string): void {
  if (adopted.has(key) || typeof document === "undefined") return;
  adopted.add(key);
  adoptStyles(css);
}
