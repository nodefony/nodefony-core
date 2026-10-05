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
import {
  envVarPlacement,
  isSensitiveEnvVar,
  type NamedEnvVarMeta,
} from "./defineEnv";

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

/** Largeur d'une ligne de la notice, `# ` compris. */
const WIDTH = 78;

/**
 * Replie un paragraphe en lignes commentées de {@link WIDTH} colonnes au plus.
 * Une ligne qui commence par des espaces est un bloc LITTÉRAL (un chemin, une
 * commande) : rendue telle quelle, jamais coupée.
 */
function wrapParagraph(text: string): string[] {
  if (/^\s/u.test(text)) return [`# ${text}`];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && `# ${line} ${word}`.length > WIDTH) {
      out.push(`# ${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(`# ${line}`);
  return out;
}

/**
 * Bloc commenté d'UNE variable — la CONVENTION de la notice, la même pour toutes.
 *
 * Fait pour être LU par quelqu'un qui découvre le projet, et ANALYSÉ par une
 * machine : un bandeau de titre, l'explication en phrases simples, puis les
 * métadonnées au format des décorateurs de la spécification @env-spec
 * (varlock) — une par ligne, `@nom` ou `@nom=valeur`, lisibles d'une seule
 * expression régulière.
 *
 * ```
 * # ─── <Titre> ───────────────────────────────────────────
 * #
 * # <À quoi elle sert, ce qui se passe sans elle — replié à 78 colonnes>
 * #
 * # @required | @optional
 * # @required=forEnv(production)      ← si requiredIn
 * # @requiredWhen="<condition>"       ← si le CODE l'exige sous condition
 * # @sensitive                        ← si le nom désigne un secret
 * # @placement=platform|secrets|workstation  ← TOUJOURS (où la poser en prod)
 * # @type=enum(a, b)                  ← si les valeurs sont fermées
 * # @default=<valeur | "texte" | aucun>   ← TOUJOURS (extension Nodefony)
 * # @example=<valeur>                 ← si un exemple est déclaré
 * # NOM=<défaut déclaré, jamais pour un secret>
 * ```
 *
 * `@default` ne manque jamais : un lecteur qui ne le trouve pas suppose qu'il
 * n'y en a pas — et pose une valeur pour rien, ou n'en pose pas là où le code
 * n'en fournit aucune. Valeur : le défaut déclaré, sinon `defaultNote` (le
 * défaut que le CODE applique), sinon `aucun`.
 */
function renderVar(v: NamedEnvVarMeta): string[] {
  const secret = isSensitiveEnvVar(v);
  const title = v.title ?? v.name;
  const band = `# ─── ${title} `;
  const out: string[] = [
    band + "─".repeat(Math.max(3, WIDTH - band.length)),
    "#",
  ];
  if (v.description) {
    const paragraphs = v.description.split("\n");
    paragraphs.forEach((para, index) => {
      // Une ligne vide entre deux paragraphes, pour respirer — sauf devant un
      // bloc littéral, qui colle à la phrase qui l'annonce.
      if (index > 0 && !/^\s/u.test(para)) out.push("#");
      out.push(...wrapParagraph(para));
    });
    out.push("#");
  }
  out.push(
    v.default !== undefined || v.optional ? "# @optional" : "# @required",
  );
  for (const env of v.requiredIn ?? []) {
    out.push(`# @required=forEnv(${env})`);
  }
  if (v.requiredWhen) {
    out.push(`# @requiredWhen=${decoratorValue(v.requiredWhen)}`);
  }
  if (secret) out.push("# @sensitive");
  out.push(`# @placement=${envVarPlacement(v)}`);
  if (v.values?.length) out.push(`# @type=enum(${v.values.join(", ")})`);
  const fallback =
    v.default !== undefined
      ? stringifyDefault(v.default)
      : (v.defaultNote ?? "aucun");
  out.push(`# @default=${decoratorValue(fallback)}`);
  if (v.example !== undefined) {
    out.push(`# @example=${decoratorValue(v.example)}`);
  }
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
  const sections = groupBySection(catalog);
  // Un sommaire dès qu'il y a plus d'une section : il dit OÙ chercher, et sous
  // quel nom — on trouve une variable par son thème comme par Ctrl+F.
  if (sections.length > 1) lines.push(...renderSummary(sections), "", "");
  sections.forEach((section, index) => {
    if (sections.length > 1) {
      lines.push(...renderSectionHeader(index + 1, section.name), "", "");
    }
    // Deux lignes vides entre deux variables : la notice s'ouvre AÉRÉE, chaque
    // bloc se voit d'un coup d'œil.
    for (const v of section.vars) lines.push(...renderVar(v), "", "");
    if (index < sections.length - 1) lines.push("");
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  // Catalogue vide sans en-tête → fichier vide, pas une ligne vide.
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Section des variables qui n'en déclarent aucune. */
const NO_SECTION = "Autres réglages";

/** Une section de la notice : son nom et ses variables, dans l'ordre du catalogue. */
interface IEnvSection {
  readonly name: string;
  readonly vars: NamedEnvVarMeta[];
}

/**
 * Regroupe les variables par section, dans l'ordre de la PREMIÈRE variable de
 * chaque section ; les variables gardent l'ordre du catalogue. Celles sans
 * section ferment la marche, sous « Autres réglages ».
 */
function groupBySection(catalog: readonly NamedEnvVarMeta[]): IEnvSection[] {
  const byName = new Map<string, NamedEnvVarMeta[]>();
  for (const v of catalog) {
    const name = v.section ?? NO_SECTION;
    const vars = byName.get(name);
    if (vars) vars.push(v);
    else byName.set(name, [v]);
  }
  const ordered = [...byName.keys()].filter((n) => n !== NO_SECTION);
  if (byName.has(NO_SECTION)) ordered.push(NO_SECTION);
  return ordered.map((name) => ({ name, vars: byName.get(name) ?? [] }));
}

/** Le sommaire : chaque section numérotée, et les noms des variables qu'elle range. */
function renderSummary(sections: readonly IEnvSection[]): string[] {
  const indent = "#        ";
  const out = [
    "#  SOMMAIRE — cherche une variable par son nom (Ctrl+F) ou par son thème :",
    "#",
  ];
  sections.forEach((section, index) => {
    out.push(`#   ${index + 1}. ${section.name}`);
    let line = "";
    for (const name of section.vars.map((v) => v.name)) {
      const next = line ? `${line}, ${name}` : name;
      if (line && `${indent}${next}`.length > WIDTH) {
        out.push(`${indent}${line},`);
        line = name;
      } else {
        line = next;
      }
    }
    if (line) out.push(`${indent}${line}`);
  });
  return out;
}

/**
 * Le bandeau d'une section. Ses deux lignes commencent par `# ===` : c'est un
 * SÉPARATEUR au sens de la spécification @env-spec (`# ---` ou `# ===`), qui
 * n'a pas de décorateur de section — le bloc encadré est un commentaire
 * autonome, rattaché à aucune variable.
 */
function renderSectionHeader(index: number, name: string): string[] {
  const rule = `# ${"=".repeat(WIDTH - 2)}`;
  return [rule, `#  ${index}. ${name.toUpperCase()}`, rule];
}
