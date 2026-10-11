import { loginPagePath, safeRedirectPath } from "nodefony";

/** Ce que la décision lit d'une requête refusée — rien de plus. */
export interface IEntryPointRequest {
  /** Méthode HTTP (`GET`, `POST`…). */
  readonly method: string | undefined;
  /** En-tête `Accept`. */
  readonly accept: string | undefined;
  /** En-tête `Sec-Fetch-Mode` (Fetch Metadata), absent d'un client ancien. */
  readonly fetchMode: string | undefined;
  /** Chemin et requête demandés (`/compte?onglet=2`), jamais l'hôte. */
  readonly path: string;
}

/**
 * Dit si une requête refusée est la NAVIGATION d'un navigateur — le seul cas
 * où conduire à la page de connexion aide, au lieu de casser un client.
 *
 * `GET` ou `HEAD`, `Accept` qui demande du HTML, et `Sec-Fetch-Mode: navigate`
 * quand l'en-tête est présent : un `fetch()` d'une page porte `cors` ou
 * `same-origin` même s'il accepte du HTML, et recevrait une page de connexion
 * à la place de ses données.
 *
 * @param request - la requête refusée
 * @returns `true` pour une navigation
 */
export function isBrowserNavigation(request: IEntryPointRequest): boolean {
  const method = request.method?.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (request.accept?.toLowerCase().includes("text/html") !== true) {
    return false;
  }
  return (
    request.fetchMode === undefined ||
    request.fetchMode.toLowerCase() === "navigate"
  );
}

/**
 * L'adresse de la page de connexion pour un visiteur refusé :
 * `<entryPoint>?from=<chemin demandé>`, composée par `loginPagePath` (cœur).
 * Le chemin demandé repasse par `safeRedirectPath` — la seule garde
 * anti-redirection ouverte du framework, que la page de connexion appliquera
 * de nouveau au retour.
 *
 * @param entryPoint - chemin de la page de connexion (vérifié au boot)
 * @param request - la requête refusée
 * @returns l'adresse du `Location`, ou `null` quand ce n'est pas une
 *   navigation, ou quand la page demandée EST la page de connexion
 */
export function entryPointLocation(
  entryPoint: string,
  request: IEntryPointRequest,
): string | null {
  if (!isBrowserNavigation(request)) return null;
  // La page de connexion sous sa PROPRE zone se redirigerait vers elle-même,
  // sans fin : ce cas garde son 401.
  const requested = request.path.split("?", 1)[0];
  if (requested === entryPoint.split("?", 1)[0]) return null;
  return loginPagePath(safeRedirectPath(request.path), entryPoint);
}
