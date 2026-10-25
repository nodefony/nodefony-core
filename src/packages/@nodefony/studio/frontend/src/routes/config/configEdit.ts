/**
 * Édition à chaud d'un réglage — partagée par l'onglet Config d'un module
 * (`ModuleDetail`) et l'onglet Noyau de la page Configuration : une seule façon
 * de lire un refus du serveur.
 */
import { ApiError } from "../../services/ApiClient";

/** Texte d'une propriété PROPRE d'un corps JSON inconnu, sans conversion de type. */
function text(o: unknown, k: string): string | undefined {
  if (typeof o !== "object" || o === null) return undefined;
  const v: unknown = Object.getOwnPropertyDescriptor(o, k)?.value;
  return typeof v === "string" ? v : undefined;
}

/**
 * Message lisible d'un refus d'édition de config : le détail du serveur d'abord,
 * puis la recette d'override quand il en propose une.
 *
 * @param e - erreur levée par le `PATCH …/config/{module}`.
 * @returns le message à afficher.
 */
export function configErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const base = text(e.body, "message") ?? text(e.body, "error") ?? e.message;
    const recipe = text(e.body, "recipe");
    return recipe ? `${base} — recette : ${recipe}` : base;
  }
  return e instanceof Error ? e.message : String(e);
}
