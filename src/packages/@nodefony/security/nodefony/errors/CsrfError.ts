import { nodefonyError } from "nodefony";

/**
 * Mutation cross-site bloquée — `code = 403` (RFC 9110 §15.5.4 : le serveur a
 * compris la requête mais refuse de l'honorer).
 *
 * Levée par {@link Csrf} sur une méthode state-changing (POST/PUT/PATCH/DELETE)
 * dont la provenance est tierce : `Sec-Fetch-Site: cross-site` (défense primaire
 * Fetch Metadata, W3C — infalsifiable par un script attaquant) ou, à défaut de
 * Fetch Metadata, un `Origin`/`Referer` étranger aux origines de l'app (fallback).
 *
 * Le message reste GÉNÉRIQUE : la politique CSRF (en-têtes inspectés, whitelist)
 * ne fuite jamais au client. Distincte du 401 (qui es-tu ?) et de l'AccessDenied
 * (autorisé mais rôle insuffisant) : ici l'identité importe peu, c'est la
 * PROVENANCE de la requête qui est rejetée.
 */
export class CsrfError extends nodefonyError {
  constructor(message: string | Error = "Cross-site request blocked") {
    super(message, 403);
  }
}

export default CsrfError;
