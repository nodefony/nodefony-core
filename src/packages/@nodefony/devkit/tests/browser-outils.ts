/**
 * Outillage des tests des sondes navigateur : charger un module `.mjs` publié
 * et le consommer sous un contrat de types EXPLICITE.
 *
 * Pourquoi ce détour : les sondes sont publiées en JavaScript (`.mjs`, hors
 * typecheck) et le dépôt interdit les `.d.ts` écrits à la main. Un import
 * statique depuis un test TypeScript strict échouerait donc à la compilation.
 * L'import DYNAMIQUE sur une URL calculée passe la frontière, et le typage se
 * rétablit ici, à l'entrée — avec une vérification d'EXÉCUTION : une fonction
 * absente lève, elle ne devient jamais un `undefined` qui se propage.
 */

/**
 * Charge un module `.mjs` par un chemin relatif à CE fichier.
 *
 * @param cheminRelatif - chemin du module, relatif à `tests/`.
 * @returns l'espace de noms du module, à narrower par {@link fonctionDe}.
 */
export async function chargerModule(
  cheminRelatif: string,
): Promise<Record<string, unknown>> {
  const url = new URL(cheminRelatif, import.meta.url).href;
  const mod: unknown = await import(url);
  if (typeof mod !== "object" || mod === null) {
    throw new Error(`module illisible : ${cheminRelatif}`);
  }
  return mod as Record<string, unknown>;
}

/**
 * Extrait une fonction d'un module chargé, sous le type que le test lui donne.
 *
 * @param mod - l'espace de noms rendu par {@link chargerModule}.
 * @param nom - le nom exporté attendu.
 * @returns la fonction, typée par l'appelant.
 * @throws si l'export n'existe pas ou n'est pas une fonction — le contrat des
 *   sondes a changé, et le test doit le dire plutôt que de mesurer du vide.
 */
export function fonctionDe<T>(mod: Record<string, unknown>, nom: string): T {
  const f = mod[nom];
  if (typeof f !== "function") {
    throw new Error(`fonction absente du module publié : ${nom}`);
  }
  return f as T;
}

/**
 * Narrowing d'une valeur JSON en objet — le refus est une ERREUR nommée.
 *
 * @param v - la valeur à vérifier.
 * @param contexte - ce qu'on croyait lire, pour le message d'échec.
 */
export function commeObjet(
  v: unknown,
  contexte: string,
): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`${contexte} : objet attendu, reçu ${typeof v}`);
  }
  return v as Record<string, unknown>;
}
