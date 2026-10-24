/**
 * Adresse d'une destination de journaux distante (Loki, OpenSearch) : UNE règle
 * pour les deux, et pour leur envoi comme pour leur relecture.
 *
 * L'adresse peut porter ses identifiants (`https://utilisateur:secret@hôte`),
 * comme `NF_DATABASE_URL` : une seule variable secrète suffit à joindre un Loki
 * de Grafana Cloud ou un OpenSearch protégé. Ils ne peuvent pas rester dans
 * l'URL — `fetch` refuse une requête dont l'adresse contient des identifiants —
 * et deviennent un en-tête `Authorization: Basic`. Node-only (`Buffer`).
 */
import { stripTrailingSlashes } from "../../Tools";

/**
 * Construit l'en-tête `Authorization: Basic …` si un utilisateur est fourni — sinon
 * objet vide (destination sans authentification).
 *
 * @param username - utilisateur (absent → pas d'authentification).
 * @param password - mot de passe.
 * @returns en-tête prêt à étaler, ou `{}`.
 */
export function basicAuthHeader(
  username?: string,
  password?: string,
): Record<string, string> {
  if (!username) return {};
  const token = Buffer.from(`${username}:${password ?? ""}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

/** Une destination prête à joindre : base sans identifiants ni `/` final. */
export interface IResolvedEndpoint {
  /** Base de l'URL, sans identifiants ni barre oblique finale. */
  base: string;
  /** En-tête d'authentification à étaler (vide sans identifiants). */
  auth: Record<string, string>;
}

/**
 * Sépare l'adresse de ses identifiants. Des identifiants EXPLICITES
 * (`username`/`password` de la config) l'emportent sur ceux de l'URL.
 *
 * @param url - adresse déclarée, identifiants éventuels compris.
 * @param username - utilisateur explicite.
 * @param password - mot de passe explicite.
 * @returns la base à joindre et l'en-tête d'authentification.
 */
export function resolveEndpoint(
  url: string,
  username?: string,
  password?: string,
): IResolvedEndpoint {
  let base = url;
  let user = username;
  let pass = password;
  if (URL.canParse(url)) {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") {
      user ??= decodeURIComponent(parsed.username);
      pass ??= decodeURIComponent(parsed.password);
      parsed.username = "";
      parsed.password = "";
      base = parsed.href;
    }
  }
  return {
    base: stripTrailingSlashes(base),
    auth: basicAuthHeader(user, pass),
  };
}
