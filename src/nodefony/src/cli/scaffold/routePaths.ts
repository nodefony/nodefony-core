/**
 * Les chemins de route DÉCLARÉS dans une source, et leurs voisins de préfixe.
 *
 * Deux outils en ont besoin et n'ont pas la même question : le vérificateur
 * cherche un segment écrit à la mode d'un autre framework, le générateur
 * cherche les routes qu'une garde posée sur UN controller laisse ouvertes. Le
 * motif, lui, est le même — et il a été payé une fois : le lire librement
 * faisait accuser les routes react-router, où `:id` est la syntaxe juste.
 *
 * Le module vit côté scaffold parce que le vérificateur en dépend déjà
 * (`reservedEntities`), et jamais l'inverse.
 *
 * @module
 */

/**
 * Un chemin de route, écrit soit en ARGUMENT d'un décorateur de méthode, soit
 * sous la clé `path` d'un `@route`.
 *
 * Les deux formes existent et se valent ; n'en lire qu'une rendrait le lecteur
 * aveugle à l'autre, ce qui est pire que de ne rien lire — on croirait la
 * question posée.
 *
 * ⚠️ Le `path:` est BORNÉ au voisinage d'un `@route(`, et non lu partout : la
 * clé est aussi celle de react-router, où `:id` est la syntaxe JUSTE. Lu
 * librement, le contrôle accusait les cinq routes du frontend de Studio — et un
 * contrôle qui accuse du code correct est un contrôle qu'on désactive.
 */
export const ROUTE_PATH_RE =
  /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*["'`]([^"'`\n]*)["'`]|@route\s*\([\s\S]{0,300}?\bpath\s*:\s*["'`]([^"'`\n]*)["'`]/gu;

/**
 * Les chemins de route qu'une source déclare.
 *
 * @param source - le texte du fichier.
 * @returns les chemins, dans l'ordre d'apparition, doublons compris.
 */
export function declaredRoutePaths(source: string): string[] {
  const out: string[] = [];
  ROUTE_PATH_RE.lastIndex = 0;
  for (const m of source.matchAll(ROUTE_PATH_RE)) {
    // Deux alternatives : un seul des deux groupes participe.
    const found = m.at(1) ?? m.at(2) ?? "";
    if (found !== "") out.push(found);
  }
  return out;
}

/**
 * Le chemin découpé en segments, sans les vides.
 *
 * @param route - le chemin.
 * @returns ses segments.
 */
function segments(route: string): string[] {
  return route.split("/").filter((s) => s !== "");
}

/**
 * `candidate` est-il SOUS `prefix` — au sens des segments, pas des caractères ?
 *
 * La comparaison littérale ferait de `/api/accounts` un enfant de
 * `/api/account`, et le générateur signalerait une route qui n'a rien à voir.
 *
 * @param candidate - le chemin examiné.
 * @param prefix - le préfixe de référence.
 * @returns vrai si le candidat est sous le préfixe (lui-même compris).
 */
export function isUnderPrefix(candidate: string, prefix: string): boolean {
  const a = segments(candidate);
  const b = segments(prefix);
  if (b.length === 0 || a.length < b.length) return false;
  return b.every((seg, i) => a[i] === seg);
}

/**
 * Le PRÉFIXE d'un controller, tel que `@controller("…")` le déclare.
 *
 * C'est lui, et non les `@route`, qui dit sous quel espace le controller sert :
 * le `path:` d'une action est RELATIF à ce préfixe. Chercher les voisins dans
 * les `@route` ne trouve donc rien — vécu, et seul un test qui fait tourner le
 * générateur l'a montré ; l'essai sur des textes écrits à la main passait.
 *
 * @param source - le texte du fichier.
 * @returns le préfixe, ou `null` si le fichier n'en déclare pas.
 */
export function controllerPrefix(source: string): string | null {
  const m = /@controller\s*\(\s*["'`]([^"'`\n]*)["'`]/u.exec(source);
  const found = m?.[1];
  return found === undefined || found === "" ? null : found;
}

/** Une route voisine qu'une garde de controller ne couvre pas. */
export interface ISiblingRoute {
  /** Le fichier qui la déclare, tel qu'on veut l'afficher. */
  file: string;
  /** Le chemin déclaré. */
  route: string;
}

/**
 * Les routes d'AUTRES fichiers qui partagent le préfixe, et que la garde ne
 * couvre donc pas.
 *
 * Protéger un controller par un rôle a l'apparence de fermer un espace ; cela
 * ferme un FICHIER. Toute route servie sous le même préfixe par un autre
 * controller reste ouverte, et la suivante naîtra ouverte aussi — sans que rien
 * ne le signale. Ce relevé sert à le DIRE au moment du geste, pas à refuser :
 * un controller délibérément seul sous son préfixe est un cas normal, et une
 * commande qui avertit à tort apprend à passer outre.
 *
 * @param prefix - le préfixe que la garde couvre (la route du controller créé).
 * @param sources - les autres sources de la cible, déjà lues.
 * @returns les voisines, sans doublon, dans l'ordre des fichiers.
 */
export function openSiblingRoutes(
  prefix: string,
  sources: readonly { file: string; text: string }[],
): ISiblingRoute[] {
  const out: ISiblingRoute[] = [];
  const seen = new Set<string>();
  for (const { file, text } of sources) {
    // Le préfixe du VOISIN, pas ses actions : `@route({ path: … })` est relatif
    // à `@controller("…")`, donc lire les actions ne trouverait jamais rien.
    const voisin = controllerPrefix(text);
    if (voisin === null) continue;
    if (!isUnderPrefix(voisin, prefix)) continue;
    const key = `${file} -> ${voisin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, route: voisin });
  }
  return out;
}
