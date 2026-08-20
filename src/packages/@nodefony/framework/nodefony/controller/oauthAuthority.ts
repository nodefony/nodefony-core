/**
 * Une seule règle : un document bien connu ne se sert QUE sur l'autorité dont
 * il se réclame.
 *
 * Elle vaut pour les deux rôles OAuth que cette application peut tenir, et pour
 * la même raison. Côté **émetteur** (RFC 8414 §3.3), le client DOIT rejeter un
 * document dont l'`issuer` ne correspond pas à l'endroit où il l'a demandé.
 * Côté **serveur de ressource** (RFC 9728 §3.3), il DOIT rejeter un document
 * dont la `resource` ne correspond pas à l'URI de la ressource. Dans les deux
 * cas, servir le document sur une autre autorité ne rend pas service au
 * client : il le lit, le rejette, et **s'arrête là** — alors qu'un `404`
 * l'aurait laissé continuer.
 *
 * 🔴 C'est exactement la faille qu'un vrai client MCP a trouvée en août : le
 * document d'émetteur était servi sur TOUTE autorité, si bien qu'une sonde sur
 * `http://localhost:5151` recevait le document de `https://localhost:5152` et
 * déclarait la connexion en échec. Le banc de la veille testait le symptôme, pas
 * la règle. Cette fonction est la règle, écrite une fois — la recopier dans
 * chaque controller la ferait diverger au premier correctif.
 *
 * @see references/rfc/ietf/rfc8414.txt — métadonnées du serveur d'autorisation
 * @see references/rfc/ietf/rfc9728.txt — métadonnées de la ressource protégée
 */

/**
 * La requête entre-t-elle par l'autorité dont ce document se réclame ?
 *
 * La comparaison porte sur l'**autorité demandée** (hôte + port, tels que le
 * client les a écrits), jamais sur le schéma : derrière un relais qui termine
 * TLS, le processus voit `http` pour une requête que le client a faite en
 * `https`, et refuser là-dessus fermerait le document en production. Le port
 * par défaut est normalisé par `URL` — `app.example:443` et `app.example`
 * désignent le même serveur et doivent se valoir.
 *
 * Fonction **pure** : elle reçoit l'autorité demandée plutôt que d'aller la
 * chercher dans un contexte, ce qui la rend éprouvable sans serveur — et permet
 * au contexte WebSocket, dont la requête n'est qu'un `IncomingMessage`, de
 * l'appeler avec la même valeur.
 *
 * @param asked - autorité demandée (`:authority` en HTTP/2, `Host` en HTTP/1.1)
 * @param declared - URL absolue dont le document se réclame (émetteur ou ressource)
 * @returns `true` si les deux désignent le même serveur
 */
export function onDeclaredAuthority(
  asked: string | undefined,
  declared: string,
): boolean {
  if (typeof asked !== "string" || asked.length === 0) return false;
  let wanted: URL;
  try {
    wanted = new URL(declared);
  } catch {
    return false;
  }
  try {
    return new URL(`${wanted.protocol}//${asked}`).host === wanted.host;
  } catch {
    // `Host` illisible : rien à publier pour une autorité qu'on ne sait même
    // pas nommer.
    return false;
  }
}

/**
 * Extrait l'autorité demandée des en-têtes bruts d'une requête.
 *
 * Lue ici plutôt que par un accesseur de `Request` : le type varie selon le
 * transport (le contexte WebSocket n'expose qu'un `IncomingMessage`), et un
 * document bien connu doit rester lisible par les deux.
 *
 * @param headers - en-têtes de la requête entrante
 * @returns l'autorité telle que le client l'a écrite, ou `undefined`
 */
export function askedAuthority(
  headers: Record<string, string | string[] | undefined> | null | undefined,
): string | undefined {
  // HTTP/2 porte l'autorité dans un pseudo-en-tête, HTTP/1.1 dans `Host`.
  const raw = headers?.[":authority"] ?? headers?.host;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  return typeof asked === "string" && asked.length > 0 ? asked : undefined;
}
