/**
 * Générateur de `.env.example` depuis le catalogue introspectable `defineEnv`
 * (ADR-0006 — une seule source de vérité). Pur : prend les métadonnées
 * ({@link NamedEnvVarMeta} via `getEnvCatalog`) et rend le modèle d'onboarding —
 * toutes les variables COMMENTÉES (un `.example` ne pose rien, il documente).
 *
 * Anti-dérive : `env.ts` (le catalogue) est la SEULE liste de variables,
 * `.env.example` en est DÉRIVÉ. La commande `nodefony env --example` écrit le
 * fichier (en-tête curé possible : `.env.example.head`) ; son `--check` échoue
 * si le fichier diverge du catalogue — pre-commit, CI.
 */
import type { NamedEnvVarMeta } from "./defineEnv";

/** Un nom de variable « sensible » (secret) → jamais de valeur d'exemple. */
const SECRET_RE = /secret|password|key|token|credential/i;

/** Rend une valeur par défaut en chaîne pour le modèle (objets/arrays en JSON). */
function stringifyDefault(v: unknown): string {
  if (v === undefined) return "";
  if (
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "string"
  ) {
    return String(v);
  }
  return JSON.stringify(v);
}

/**
 * Valeur d'un décorateur : nue si elle ne contient ni espace ni guillemet,
 * sinon entre guillemets doubles (échappés) — une ligne se lit alors d'une seule
 * expression régulière, `^# @(\w+)(?:=(.*))?$`.
 */
function decoratorValue(v: string): string {
  return /^[^\s"]+$/u.test(v) ? v : `"${v.replaceAll('"', '\\"')}"`;
}

/**
 * Bloc commenté d'UNE variable — la CONVENTION de la notice, la même pour toutes.
 *
 * Syntaxe des décorateurs de la spécification @env-spec (varlock) : une
 * métadonnée par ligne, `@nom` ou `@nom=valeur`. Lisible sans légende par un
 * humain, analysable par une seule expression régulière.
 *
 * ```
 * # <Rôle, en une ou plusieurs phrases>
 * # @required | @optional
 * # @required=forEnv(production)      ← si requiredIn
 * # @sensitive                        ← si le nom désigne un secret
 * # @type=enum(a, b)                  ← si les valeurs sont fermées
 * # @default=<valeur | "texte" | aucun>   ← TOUJOURS (extension Nodefony)
 * # NOM=<défaut déclaré, jamais pour un secret>
 * ```
 *
 * `@default` ne manque jamais : un lecteur qui ne le trouve pas suppose qu'il
 * n'y en a pas — et pose une valeur pour rien, ou n'en pose pas là où le code
 * n'en fournit aucune. Valeur : le défaut déclaré, sinon `defaultNote` (le
 * défaut que le CODE applique), sinon `aucun`.
 */
function renderVar(v: NamedEnvVarMeta): string[] {
  const secret = SECRET_RE.test(v.name);
  const out: string[] = [];
  if (v.description) {
    for (const dl of v.description.split("\n")) out.push(`# ${dl}`);
  }
  out.push(
    v.default !== undefined || v.optional ? "# @optional" : "# @required",
  );
  for (const env of v.requiredIn ?? []) {
    out.push(`# @required=forEnv(${env})`);
  }
  if (secret) out.push("# @sensitive");
  if (v.values?.length) out.push(`# @type=enum(${v.values.join(", ")})`);
  const fallback =
    v.default !== undefined
      ? stringifyDefault(v.default)
      : (v.defaultNote ?? "aucun");
  out.push(`# @default=${decoratorValue(fallback)}`);
  // Secret : aucune valeur d'exemple. Sinon le défaut sert d'exemple lisible.
  out.push(`# ${v.name}=${secret ? "" : stringifyDefault(v.default)}`);
  return out;
}

/**
 * Rend le contenu complet de `.env.example` depuis le catalogue.
 *
 * @param catalog - métadonnées des variables (via `getEnvCatalog(env)`).
 * @param opts.header - en-tête d'onboarding curé (préambule + précédence), placé en
 *   tête tel quel. Le corps (les variables) est, lui, entièrement dérivé.
 * @returns le texte du fichier (terminé par un seul saut de ligne).
 */
export function renderEnvExample(
  catalog: readonly NamedEnvVarMeta[],
  opts: { header?: string } = {},
): string {
  const lines: string[] = [];
  // `trimEnd` et le dépilage disent l'intention (« un seul saut de ligne final »)
  // là où `/\s+$/` et `/\n+$/` la faisaient deviner — et coûtaient un balayage
  // quadratique sur une queue de blancs, pour un rendu qui est une API publique.
  if (opts.header) lines.push(opts.header.trimEnd(), "", "");
  // Deux lignes vides entre deux variables : la notice s'ouvre AÉRÉE, chaque
  // bloc se voit d'un coup d'œil.
  for (const v of catalog) {
    lines.push(...renderVar(v), "", "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  // Catalogue vide sans en-tête → fichier vide, pas une ligne vide.
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
