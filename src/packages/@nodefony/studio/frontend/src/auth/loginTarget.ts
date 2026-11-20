import { loginPagePath, safeRedirectPath } from "nodefony";

/**
 * Ce que la garde de la console fait d'un visiteur, selon sa session et la
 * page de connexion de l'application.
 *
 * - `wait` : rien n'est encore su (session en cours de lecture, ou page de
 *   connexion pas encore annoncée par le serveur) — on patiente ;
 * - `pass` : connecté, la console s'affiche ;
 * - `app` : anonyme, et l'application sert sa page de connexion — on y va par
 *   une navigation COMPLÈTE (`href`), qui ramènera ici une fois connecté ;
 * - `console` : anonyme, et l'application n'en sert pas — la page de secours
 *   de la console (`/nodefony/login`), qui marche toujours.
 */
export type ConsoleAccess =
  | { readonly kind: "wait" }
  | { readonly kind: "pass" }
  | { readonly kind: "app"; readonly href: string }
  | { readonly kind: "console" };

const WAIT: ConsoleAccess = { kind: "wait" };
const PASS: ConsoleAccess = { kind: "pass" };
const CONSOLE: ConsoleAccess = { kind: "console" };

/**
 * Décide où mène l'ouverture d'une page de la console : une seule page de
 * connexion vue au quotidien, celle de l'application, et celle de la console
 * en secours seulement.
 *
 * @param authenticated - `null` tant que la session n'est pas lue, sinon
 *   l'état connecté
 * @param loginPage - chemin de la page de connexion servie par le framework
 *   (`/studio/api/info`), `null` quand il n'en sert pas, `undefined` tant que
 *   le serveur ne l'a pas dit
 * @param from - page de la console demandée (chemin et requête), où revenir
 *   après la connexion
 * @returns la conduite à tenir
 */
export function consoleAccess(
  authenticated: boolean | null,
  loginPage: string | null | undefined,
  from: string,
): ConsoleAccess {
  if (authenticated === null) return WAIT;
  if (authenticated) return PASS;
  if (loginPage === undefined) return WAIT;
  if (loginPage === null) return CONSOLE;
  return { kind: "app", href: loginPagePath(from, loginPage) };
}

/**
 * Lit le chemin annoncé par `/studio/api/info` : un chemin LOCAL ou rien.
 * Le serveur le valide déjà (`security.loginPage.path`) ; relu ici parce que
 * la valeur sert d'adresse de navigation — par la garde du cœur
 * (`safeRedirectPath`), seule à trancher ce qu'est un chemin local.
 *
 * @param value - champ `loginPage` reçu, de type inconnu
 * @returns le chemin, ou `null` (page de secours de la console)
 */
export function readLoginPage(value: unknown): string | null {
  const path = safeRedirectPath(value, "");
  return path === "" ? null : path;
}
