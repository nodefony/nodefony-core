/**
 * Ce que l'accueil de la démo affiche dans sa barre : l'identité de
 * l'application et la version de Nodefony INSTALLÉE — lues au démarrage du
 * serveur, jamais écrites en dur dans la page.
 *
 * Type PARTAGÉ : le contrôleur `DemoController` (`/demo/api/about`) le
 * produit, la page le consomme. Une seule déclaration, donc une seule vérité.
 */
export interface IDemoAbout {
  app: { name: string; version: string };
  nodefony: { version: string };
}

/** Route servie par `DemoController.about`. */
export const DEMO_ABOUT_PATH = "/demo/api/about";

/**
 * Valide une réponse de `/demo/api/about` sans la croire sur parole.
 *
 * @param value - corps JSON reçu
 * @returns l'objet typé, ou `null` s'il n'a pas la forme attendue
 */
export function parseDemoAbout(value: unknown): IDemoAbout | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("app" in value) || !("nodefony" in value)) return null;
  const { app, nodefony } = value;
  if (typeof app !== "object" || app === null) return null;
  if (typeof nodefony !== "object" || nodefony === null) return null;
  if (!("name" in app) || !("version" in app) || !("version" in nodefony)) {
    return null;
  }
  const { name, version } = app;
  const nfVersion = nodefony.version;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof nfVersion !== "string"
  ) {
    return null;
  }
  return { app: { name, version }, nodefony: { version: nfVersion } };
}

/**
 * Lien vers une page de la documentation publique, À LA VERSION installée :
 * le site garde chaque publication dans son dossier.
 *
 * @param version - version de Nodefony installée (`IDemoAbout.nodefony.version`)
 * @param page - chemin de la page sous `docs/` (vide : l'accueil de la doc)
 */
export function docUrl(version: string, page = ""): string {
  const base = `https://nodefony.github.io/nodefony-core/${version}/docs/`;
  return page === "" ? base : `${base}${page}/`;
}
