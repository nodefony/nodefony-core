/**
 * Pot à cookies des bancs e2e — fusionne une réponse dans l'en-tête `Cookie`
 * déjà tenu, comme le fait un navigateur (RFC 6265 §5.3).
 *
 * Cinq bancs recopiaient `agent.cookie = setCookie.map(…).join("; ")`, qui
 * REMPLACE le pot par les seuls cookies de la dernière réponse. Le jour où une
 * route a posé un `csrf-token` sans renvoyer la session, le cookie de session
 * est tombé côté CLIENT : le banc TOTP a conclu à un défi MFA perdu par le
 * serveur, qui n'avait rien détruit.
 *
 * @usage import { mergeSetCookie } from "../../../../scripts/lib/cookie-jar.mjs"
 */

/**
 * Applique les `Set-Cookie` d'une réponse au pot tenu par le client.
 *
 * Un cookie se remplace par son NOM ; un `Max-Age` nul ou négatif, ou une
 * date `Expires` passée, le retire (RFC 6265 §5.3, étapes 3 et 11). Le domaine
 * et le chemin ne sont pas distingués : un banc parle à UNE origine.
 *
 * @param jar - l'en-tête `Cookie` courant (`"a=1; b=2"`), ou `null`.
 * @param setCookie - les en-têtes `Set-Cookie` de la réponse, ou `undefined`.
 * @param now - l'instant de référence en ms (injecté par les tests).
 * @returns le nouvel en-tête `Cookie`, ou `null` si le pot est vide.
 */
export function mergeSetCookie(jar, setCookie, now = Date.now()) {
  const cookies = new Map();
  if (jar) {
    for (const pair of jar.split(";")) {
      const eq = pair.indexOf("=");
      if (eq > 0)
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  for (const line of setCookie ?? []) {
    const [pair, ...attributes] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    let expired = false;
    for (const attribute of attributes) {
      const sep = attribute.indexOf("=");
      const key = (sep < 0 ? attribute : attribute.slice(0, sep))
        .trim()
        .toLowerCase();
      const value = sep < 0 ? "" : attribute.slice(sep + 1).trim();
      if (key === "max-age" && Number(value) <= 0) expired = true;
      if (key === "expires" && Date.parse(value) <= now) expired = true;
    }
    if (expired) cookies.delete(name);
    else cookies.set(name, pair.slice(eq + 1).trim());
  }
  if (cookies.size === 0) return null;
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}
