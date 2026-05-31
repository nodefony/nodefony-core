import { nodefonyError } from "nodefony";

/**
 * Erreur typée du module `@nodefony/documentation`.
 *
 * Étend `nodefonyError` (le wrapper d'erreur du core, renommé pour ne pas
 * entrer en collision avec `globalThis.Error`). Porte un `code` machine stable
 * pour que le data plane distingue les cas sans parser le message (Zero Trust :
 * le message détaillé reste serveur, le client ne voit qu'un code + un message
 * générique).
 */
export class DocumentationError extends nodefonyError {
  /**
   * Code machine stable (ex. `DOC_NOT_FOUND`, `DOC_UNSAFE_SLUG`).
   *
   * Nommé `docCode` (pas `code`) : `nodefonyError` réserve déjà `code?: number`
   * (statut HTTP). On ne shadow pas un champ numérique du parent par un string.
   */
  readonly docCode: string;

  constructor(message: string, docCode = "DOC_ERROR") {
    super(message);
    this.name = "DocumentationError";
    this.docCode = docCode;
  }
}

/** Slug demandé absent de l'allowlist construite par le scan (404 logique). */
export class DocNotFoundError extends DocumentationError {
  constructor(slug: string) {
    super(`Document inconnu : "${slug}"`, "DOC_NOT_FOUND");
    this.name = "DocNotFoundError";
  }
}

/**
 * Slug rejeté car potentiellement dangereux (traversée de répertoire, segment
 * `..`, caractère hors charset). Sécurité : on ne touche JAMAIS au FS avec un
 * tel slug.
 */
export class DocUnsafeSlugError extends DocumentationError {
  constructor(slug: string) {
    super(`Slug rejeté (non sûr) : "${slug}"`, "DOC_UNSAFE_SLUG");
    this.name = "DocUnsafeSlugError";
  }
}
