/**
 * Générateur de `.env.example` depuis le catalogue introspectable `defineEnv`
 * (ADR-0006 — une seule source de vérité). Pur : prend les métadonnées
 * ({@link NamedEnvVarMeta} via `getEnvCatalog`) et rend le modèle d'onboarding —
 * toutes les variables COMMENTÉES (un `.example` ne pose rien, il documente).
 *
 * Anti-dérive : `env.ts` (le catalogue) devient la SEULE liste de variables ;
 * `.env.example` en est DÉRIVÉ. Un script (`scripts/gen-env-example.ts`) écrit le
 * fichier ; son mode `--check` échoue si le fichier diverge du catalogue.
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

/** Bloc commenté d'UNE variable : doc (`.describe()`) + drapeaux + ligne `# NAME=val`. */
function renderVar(v: NamedEnvVarMeta): string[] {
  const secret = SECRET_RE.test(v.name);
  const out: string[] = [];
  if (v.description) {
    for (const dl of v.description.split("\n")) out.push(`# ${dl}`);
  }
  const flags: string[] = [];
  if (v.values?.length) flags.push(`valeurs: ${v.values.join(" | ")}`);
  if (v.default !== undefined)
    flags.push(`défaut: ${stringifyDefault(v.default)}`);
  else if (v.optional) flags.push("optionnel");
  else flags.push("REQUIS");
  if (secret) flags.push("secret → .env.local, jamais committé");
  out.push(`#   (${flags.join(" · ")})`);
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
  if (opts.header) lines.push(opts.header.replace(/\s+$/, ""), "");
  for (const v of catalog) {
    lines.push(...renderVar(v), "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}
