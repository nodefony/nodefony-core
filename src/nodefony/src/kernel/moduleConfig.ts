import type { ZodType } from "zod";
import { BootConfigurationError } from "./BootConfigurationError";

/**
 * Forme d'une anomalie Zod telle que ce module la lit — volontairement
 * structurelle plutôt que `z.core.$ZodIssue` : le schéma peut venir d'une AUTRE
 * copie de zod (un module qui résout la sienne), et un `instanceof ZodError`
 * raterait alors l'erreur. On ne lit que ce dont le message a besoin.
 */
interface IConfigIssue {
  code?: string;
  path?: (string | number)[];
  message?: string;
  keys?: string[];
}

/**
 * Rend une anomalie Zod lisible par celui qui a écrit la configuration.
 *
 * Le cas `unrecognized_keys` est traité à part : le message natif de zod
 * (`Unrecognized key: "x"`) ne dit ni où se trouve la clé dans l'arbre, ni ce
 * qu'il faut en faire, et il est en anglais alors que tout ce que Nodefony
 * affiche est en français. Une faute de frappe se corrige d'autant plus vite
 * qu'on lit le chemin COMPLET de la clé refusée.
 *
 * @param issue - anomalie brute remontée par zod.
 * @returns une ligne de message, chemin compris.
 */
function formatConfigIssue(issue: IConfigIssue): string {
  const path = (issue.path ?? []).join(".");
  if (issue.code === "unrecognized_keys" && issue.keys?.length) {
    const keys = issue.keys
      .map((k) => (path ? `${path}.${k}` : k))
      .map((k) => `\`${k}\``)
      .join(", ");
    const plural = issue.keys.length > 1 ? "s" : "";
    return (
      `clé${plural} inconnue${plural} : ${keys} — ` +
      `retire-la${plural} ou corrige l'orthographe`
    );
  }
  return `${path || "(racine)"} : ${issue.message ?? "invalide"}`;
}

/**
 * Extrait les anomalies d'une erreur Zod, quelle que soit la copie de zod qui
 * l'a levée (`issues` est une propriété de données, pas une méthode de classe).
 *
 * @param error - erreur levée par `schema.parse()`.
 * @returns le message agrégé, une ligne par anomalie.
 */
function formatConfigIssues(error: unknown): string {
  if (
    error instanceof Error &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return (error.issues as IConfigIssue[]).map(formatConfigIssue).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Valide la configuration d'un module contre son schéma Zod, et transforme un
 * refus en {@link BootConfigurationError} nommant le module et la clé fautive.
 *
 * ⭐ TL;DR : c'est LA porte par laquelle toute config de module est validée.
 * Chaque module l'appelle depuis son `define<X>Config()` ; aucun ne réécrit le
 * bloc `try`/`catch`.
 *
 * **Pourquoi une fonction du cœur, et pas un bloc recopié par module.** Les dix
 * modules du framework portaient le même `catch` à l'identique, et il avait
 * divergé sur les deux points qui comptent : le TYPE de l'erreur levée et la
 * LANGUE du message. Une règle écrite à dix endroits diverge au premier ajout.
 *
 * **Pourquoi `BootConfigurationError` et pas une `Error` ordinaire.** Le kernel
 * distingue les deux ({@link BootConfigurationError}) : un hook de cycle de vie
 * qui lève une erreur QUELCONQUE est absorbé en développement — c'est le
 * fail-soft, il protège la DX d'un module optionnel cassé — tandis qu'une
 * erreur de CONFIGURATION interrompt le boot dans TOUS les environnements. Une
 * `Error` nue rendait donc le refus INVISIBLE là où il est le plus utile :
 * sur le poste de celui qui vient d'écrire la faute de frappe.
 *
 * ⚠️ Ne gèle rien — le gel est la décision du module appelant. `@nodefony/http`
 * ne peut PAS geler sa config (ses services la mutent au boot : `uploadDir`,
 * `serialNumber`), quand les autres le font.
 *
 * @param schema - schéma Zod du module (source unique des défauts).
 * @param input - configuration brute venue de `use("<paquet>", { … })`.
 * @param packageName - nom du paquet, préfixe du message (`@nodefony/http`).
 * @returns la configuration validée, défauts appliqués.
 * @throws BootConfigurationError si un champ est invalide ou une clé inconnue —
 *   toutes les anomalies agrégées, chacune avec son chemin.
 */
export function parseModuleConfig<T>(
  schema: ZodType<T>,
  input: unknown,
  packageName: string,
): T {
  try {
    return schema.parse(input);
  } catch (e) {
    // `cause` garde l'erreur Zod d'origine : sans elle, le détail par champ
    // s'arrête à ce message et la trace de la valeur fautive est perdue.
    throw new BootConfigurationError(
      `[${packageName}] configuration invalide — ${formatConfigIssues(e)}`,
      { cause: e },
    );
  }
}

export default parseModuleConfig;
