import path from "node:path";

/**
 * Où une NOUVELLE application a le droit de naître, quand la création est pilotée par
 * une interface web (Studio) plutôt que par une ligne de commande.
 *
 * ## Le problème
 *
 * En CLI, la destination est le `cwd` de l'utilisateur : il est chez lui, il assume. Sur
 * le web, la destination arrive par le réseau — et un endpoint qui écrit au chemin qu'on
 * lui donne écrit aussi dans `/etc`, `~/.ssh` ou `node_modules`. Un champ « chemin
 * absolu » serait une porte ouverte, quel que soit le rôle exigé derrière.
 *
 * ## La règle
 *
 * Le client ne transmet JAMAIS un chemin. Il choisit :
 *  - une **racine autorisée**, par identifiant (le serveur seul connaît son chemin réel) ;
 *  - un **sous-dossier** relatif, dont chaque segment est validé ;
 *  - un **nom d'app**, validé par la même expression que le moteur.
 *
 * Le serveur RECOMPOSE la destination et vérifie qu'elle reste **sous la racine**. Tout
 * le reste est refusé — `..`, chemin absolu, segment vide, caractère exotique.
 *
 * Ces fonctions sont **pures** (aucun accès disque) : la protection contre les liens
 * symboliques se fait chez l'appelant, en résolvant les chemins réels AVANT de les passer
 * ici (cf {@link isInsideRoot}).
 */

/** Nom d'application — même expression que la spec du scaffold (`spec.ts`). */
export const APP_NAME_RE = /^[a-z][a-z0-9-]*$/u;

/**
 * Segment de sous-dossier acceptable dans un chemin de navigation.
 *
 * Volontairement étroit : lettres, chiffres, `.`, `_`, `-`. Un `..` ne peut donc pas
 * passer (il ne contient que des points, mais la vérification explicite ci-dessous le
 * rejette de toute façon), pas plus qu'un `/`, un `\` ou un octet nul.
 */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

/** Racine autorisée : un espace de travail où l'on a le droit de créer une app. */
export interface IScaffoldRoot {
  /** Identifiant opaque manipulé par le client (jamais un chemin). */
  id: string;
  /** Libellé affiché. */
  label: string;
  /** Chemin réel côté serveur — ne sort JAMAIS tel quel vers un client non admin. */
  path: string;
}

/**
 * Le sous-chemin proposé est-il navigable sans danger ?
 *
 * @param sub - chemin relatif (`""` = la racine elle-même), séparé par `/`.
 * @returns `true` si chaque segment est acceptable et qu'aucun ne remonte.
 */
export function isSafeSubPath(sub: string): boolean {
  if (sub === "") return true;
  if (sub.includes("\0")) return false;
  if (path.isAbsolute(sub)) return false;
  const segments = sub.split("/").filter((s) => s !== "");
  if (segments.length === 0) return false;
  return segments.every((s) => s !== ".." && s !== "." && SEGMENT_RE.test(s));
}

/**
 * `child` est-il À L'INTÉRIEUR de `root` ?
 *
 * Comparaison sur les chemins **normalisés**, avec le séparateur final : sans lui,
 * `/home/user/app-secrets` passerait pour un enfant de `/home/user/app`. La racine
 * elle-même n'est pas « à l'intérieur » (on ne crée pas une app SUR sa racine).
 *
 * ⚠️ Passer ici des chemins RÉELS (`realpathSync`) quand ils existent : sinon un lien
 * symbolique placé dans la racine ferait sortir l'écriture de l'espace autorisé sans que
 * cette comparaison n'y voie rien.
 */
export function isInsideRoot(root: string, child: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(child);
  if (c === r) return false;
  return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Erreur de destination — message sûr, affichable tel quel (jamais un chemin serveur). */
export class ScaffoldDestinationError extends Error {}

/**
 * Recompose la destination d'une nouvelle app, ou refuse.
 *
 * @param roots - racines autorisées (côté serveur).
 * @param rootId - identifiant de racine choisi par le client.
 * @param sub - sous-dossier relatif choisi (`""` = la racine).
 * @param name - nom de l'app.
 * @returns le chemin absolu où l'app doit naître.
 * @throws {ScaffoldDestinationError} racine inconnue, sous-chemin ou nom refusé, ou
 *   destination hors de la racine.
 */
export function resolveScaffoldDestination(
  roots: readonly IScaffoldRoot[],
  rootId: string,
  sub: string,
  name: string,
): string {
  const root = roots.find((r) => r.id === rootId);
  if (!root) {
    throw new ScaffoldDestinationError("emplacement d'installation inconnu");
  }
  if (!APP_NAME_RE.test(name)) {
    throw new ScaffoldDestinationError(
      "nom d'application invalide (minuscules, chiffres et tirets ; commence par une lettre)",
    );
  }
  if (!isSafeSubPath(sub)) {
    throw new ScaffoldDestinationError("sous-dossier invalide");
  }
  const dest = path.resolve(root.path, sub, name);
  // Ceinture ET bretelles : même avec des segments validés un à un, on vérifie que le
  // résultat est bien SOUS la racine. Une validation par motif qui laisserait passer un
  // cas non prévu ne suffirait pas à elle seule.
  if (!isInsideRoot(root.path, dest)) {
    throw new ScaffoldDestinationError(
      "destination hors de l'emplacement autorisé",
    );
  }
  return dest;
}
