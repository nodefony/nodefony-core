/**
 * Lecture des paramètres d’une action temps réel. Ils arrivent du réseau : le
 * type `in` du contrat ne décrit qu’un client conforme, ces fonctions lisent ce
 * qui est réellement arrivé, sans conversion de type.
 */
import type { TScaffoldAnswers } from "nodefony";

/**
 * Lit un champ d'une charge RPC venue du réseau, sans présumer de sa forme : une
 * charge absente, scalaire ou sans ce champ rend `undefined`. Propriété PROPRE
 * seulement — `constructor` ou `toString` hérités ne sont pas des paramètres.
 */
export function rpcParam(params: unknown, key: string): unknown {
  return typeof params === "object" && params !== null
    ? Object.getOwnPropertyDescriptor(params, key)?.value
    : undefined;
}

/**
 * Réponses de formulaire lues depuis le réseau : ne garde que les valeurs qu'un
 * formulaire produit (texte, case, liste de textes). Le moteur les valide
 * ensuite contre SA spec ; ce tri ne fait qu'interdire toute autre forme.
 */
export function readAnswers(value: unknown): TScaffoldAnswers {
  const answers: TScaffoldAnswers = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return answers;
  }
  for (const key of Object.keys(value)) {
    const v = rpcParam(value, key);
    if (typeof v === "string" || typeof v === "boolean") answers[key] = v;
    else if (Array.isArray(v) && v.every(isString)) answers[key] = v;
  }
  return answers;
}

/** Garde de type d'un texte. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}
