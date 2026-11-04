/**
 * Analyse une origine NUE — `schéma://hôte[:port]`, rien d'autre — dans l'un des
 * schémas permis.
 *
 * Un chemin, une requête, un fragment ou des identifiants écrits dans une
 * origine déplaceraient en silence ce qu'elle désigne, ou feraient voyager un
 * secret dans la configuration. Un joker (`*`) n'est pas un hôte : il est
 * refusé, quoique l'URL l'accepte.
 *
 * @param origin - texte à analyser, `wss://rt.example.com:8443` par exemple
 * @param protocols - schémas permis, deux-points compris (`["http:", "https:"]`)
 * @returns l'URL analysée, ou `null` si ce n'est pas une origine nue d'un schéma permis
 */
export function parseBareOrigin(
  origin: string,
  protocols: readonly string[],
): URL | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (!protocols.includes(url.protocol)) return null;
  // `new URL("http://h/")` et `new URL("http://h")` rendent tous deux `/` :
  // seul le texte dit si un chemin a été écrit.
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\/?$/i.test(origin.trim())) return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  // L'URL tolère `*` dans un nom d'hôte ; une origine désigne UN hôte.
  if (url.hostname.includes("*")) return null;
  return url;
}
