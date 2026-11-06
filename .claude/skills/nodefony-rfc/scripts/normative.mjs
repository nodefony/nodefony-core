#!/usr/bin/env node
/**
 * Rend TOUTES les phrases normatives d'une norme, section par section.
 *
 * Le problème qu'il ferme : lire une norme au `grep` ciblé ne trouve que ce
 * qu'on soupçonne déjà. C'est par cette lecture que `If-Range` (RFC 9110
 * §13.1.5) et `Content-Disposition` (RFC 6266) étaient passés inaperçus. Ici,
 * chaque paragraphe qui porte un mot d'obligation sort, avec sa section — on
 * tranche ensuite chacun (applicable ou non, conforme ou non), sans trou.
 *
 * Deux grammaires :
 * - `ietf` : le `.txt` officiel d'une RFC ou d'un brouillon. Titres `N.N.  Titre`
 *   en colonne 0 et `Appendix A.`, sauts de page retirés, mots BCP 14 en
 *   MAJUSCULES seulement (RFC 8174 : la minuscule n'oblige pas).
 * - `markdown` : WHATWG, W3C (source Bikeshed `.bs`), Linux Foundation / AAIF.
 *   Titres `#` ou `<hN>`, blocs de code écartés, mots d'obligation en
 *   minuscules aussi — ces specs écrivent « must » en minuscules. Les sections
 *   déclarées « non-normative » et les notes ou exemples sont écartés, et
 *   COMPTÉS dans le bilan : rien ne disparaît sans le dire.
 *
 * @usage node .claude/skills/nodefony-rfc/scripts/normative.mjs <norme> [--section 15.4] [--section 9.3.7]
 * @usage node .claude/skills/nodefony-rfc/scripts/normative.mjs references/csp/w3c-csp3.bs --section "directive-object-src"
 * @option --section restreint à une section et ses sous-sections : numéro (`15.4`, `A.2`), id ou fragment de titre ; répétable
 * @option --format force la grammaire (`ietf` ou `markdown`) ; défaut : déduite du texte
 * @option --case `upper` (BCP 14 strict) ou `any` (minuscules comprises) ; défaut : `upper` en ietf, `any` en markdown
 * @option --all garde aussi les sections non normatives, notes et exemples
 * @option --json rend un tableau JSON `{ n, section, title, text }` au lieu des lignes
 * @output une ligne `[n] §section — paragraphe` par paragraphe normatif ; le bilan sur stderr. Code 1 si une `--section` ne désigne rien, 2 sur un usage faux.
 * @module
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Mots BCP 14 (RFC 2119 / 8174) — en majuscules, seuls à obliger dans une RFC.
 * Bornés au trait d'union et au `#` : `should-directive-execute` est un nom
 * d'algorithme, pas une obligation.
 */
const UPPER_KEYWORDS =
  /(?<![-#\w])(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL)(?![-\w])/;
/** Mêmes mots, toutes casses — WHATWG et W3C les écrivent en minuscules. */
const ANY_KEYWORDS =
  /(?<![-#\w])(must|required|shall|should|recommended|may|optional)(?![-\w])/i;

const IETF_HEADING = /^((?:\d+|[A-Z])(?:\.\d+)*)\.\s{2,}(\S.*)$/;
const IETF_APPENDIX = /^Appendix ([A-Z])\.\s+(\S.*)$/;
/**
 * Pied de page, saut de page et en-tête courant d'une RFC ancienne, en un bloc.
 * Le paragraphe coupé par la page se recolle ; un titre qui suit reste un titre.
 */
const IETF_PAGE_BREAK =
  /\n(?:[ \t]*\n)*[^\n]*\[Page \d+\][ \t]*\n\f[ \t]*\n?RFC [^\n]*\n(?:[ \t]*\n)*/g;

const SECTION_NUMBER = /^(?:\d+|[A-Z])(?:\.\d+)*$/;
const MD_HEADING = /^(#{1,6})\s+(.*)$/;
const HTML_HEADING = /^<h([1-6])\b([^>]*)>(.*)$/i;
const PARAGRAPH_START = /^(?:[-*+]\s|\d+\.\s|<(?:li|p|dt|dd|div)\b)/i;
/**
 * Élément de liste — IETF `*  `, `o  `, `1.  `, `(a)` ; markdown `- `, `1. `.
 * Une obligation qui finit par « : » (« MUST send either: ») porte sa liste, que
 * les éléments soient ou non porteurs d'un mot-clé : sans eux, elle ne dit rien.
 */
const LIST_ITEM = /^(?:[*o+-]\s|\d+\.\s|\([a-z0-9]+\)\s)/;
const NON_NORMATIVE = /this section is non-normative/i;
const NOTE_OR_EXAMPLE =
  /^(?:<(?:p|div|aside)\b[^>]*class="[^"]*\b(?:note|example)\b|(?:\*\*|<em>|_)?(?:Note|Example)\b)/i;

/**
 * Devine la grammaire d'une norme à partir de son texte.
 *
 * @param text - contenu complet du fichier
 * @returns `ietf` si le texte porte des pieds de page RFC ou des titres numérotés en colonne 0, sinon `markdown`
 */
export function detectFormat(text) {
  if (/\[Page \d+\]/.test(text)) return "ietf";
  if (/^(?:#{1,6}\s|<h[1-6]\b)/m.test(text)) return "markdown";
  return /^\d+\.\s{2,}\S/m.test(text) ? "ietf" : "markdown";
}

/** Retire balises, cibles de liens et blancs superflus d'une ligne lue. */
function clean(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lit un titre IETF, ou rend `null`. */
function ietfHeading(line) {
  const m = IETF_HEADING.exec(line) ?? IETF_APPENDIX.exec(line);
  if (m === null) return null;
  const num = m[1];
  return { num, level: num.split(".").length, title: m[2].trim(), id: "" };
}

/** Lit un titre markdown ou HTML (Bikeshed), ou rend `null`. */
function markdownHeading(line) {
  const md = MD_HEADING.exec(line);
  const html = md === null ? HTML_HEADING.exec(line) : null;
  if (md === null && html === null) return null;
  const level = md !== null ? md[1].length : Number(html[1]);
  const raw = md !== null ? md[2] : html[3];
  const id = html !== null ? (/\bid="([^"]+)"/.exec(html[2])?.[1] ?? "") : "";
  const title = clean(raw.replace(/\s*\{#[^}]*\}\s*$/, ""));
  const num = /^(\d+(?:\.\d+)*)\.?\s/.exec(title)?.[1] ?? "";
  return { num, level, title: title || id, id };
}

/** Une section est retenue si un titre de sa lignée correspond au sélecteur. */
function headingMatches(h, selector) {
  if (h.num !== "" && (h.num === selector || h.num.startsWith(`${selector}.`)))
    return true;
  if (h.id !== "" && h.id === selector) return true;
  // Un sélecteur en forme de numéro (`13.1`, `A`, `A.2`) ne vise QUE les numéros :
  // sinon `A` désignerait tout titre qui contient la lettre.
  if (SECTION_NUMBER.test(selector)) return false;
  return h.title.toLowerCase().includes(selector.toLowerCase());
}

/**
 * Extrait les paragraphes porteurs d'un mot d'obligation.
 *
 * @param text - contenu complet de la norme
 * @param options - `format`, `case`, `sections` (sélecteurs), `all`
 * @returns les paragraphes retenus, les sélecteurs restés sans correspondance et le compte des écartés
 */
export function extractNormative(text, options = {}) {
  const format = options.format ?? detectFormat(text);
  const keyCase = options.case ?? (format === "ietf" ? "upper" : "any");
  const keywords = keyCase === "upper" ? UPPER_KEYWORDS : ANY_KEYWORDS;
  const sections = options.sections ?? [];
  const keepAll = options.all === true;
  const source =
    format === "ietf"
      ? text.replace(/\r\n/g, "\n").replace(IETF_PAGE_BREAK, "\n")
      : text.replace(/\r\n/g, "\n");

  const stack = [];
  const matched = new Set();
  const paragraphs = [];
  let skipped = 0;
  let buffer = [];
  let fence = null;
  let listOwner = null;

  const selected = () =>
    sections.length === 0 ||
    sections.some((s) => stack.some((h) => headingMatches(h, s)));
  const flush = () => {
    if (buffer.length === 0) return;
    const raw = buffer.join(format === "ietf" ? "" : " ");
    buffer = [];
    const body = clean(raw);
    if (listOwner !== null) {
      if (LIST_ITEM.test(raw.trim())) {
        listOwner.text += ` ${body}`;
        return;
      }
      listOwner = null;
    }
    if (!keywords.test(body) || !selected()) return;
    const informative =
      stack.some((h) => h.informative) || NOTE_OR_EXAMPLE.test(raw.trim());
    if (informative && !keepAll && format !== "ietf") {
      skipped++;
      return;
    }
    const top = stack.at(-1);
    paragraphs.push({
      n: paragraphs.length + 1,
      section: top === undefined ? "" : top.num || top.id || top.title,
      title: top?.title ?? "",
      text: body,
    });
    if (body.endsWith(":")) listOwner = paragraphs.at(-1);
  };
  const push = (line) => {
    // IETF : un mot coupé en fin de ligne (« end-to-\nend ») se recolle sans blanc.
    if (format === "ietf" && buffer.length > 0 && !buffer.at(-1).endsWith("-"))
      buffer.push(" ");
    buffer.push(line);
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();
    if (format === "markdown") {
      const t = line.trim();
      if (fence !== null) {
        if (fence.test(t)) fence = null;
        continue;
      }
      if (/^(```|~~~)/.test(t)) {
        flush();
        fence = new RegExp(`^${t.slice(0, 3)}`);
        continue;
      }
      if (/^<(pre|xmp)\b/i.test(t) && !/<\/(pre|xmp)>/i.test(t)) {
        flush();
        fence = /<\/(pre|xmp)>/i;
        continue;
      }
    }
    const heading =
      format === "ietf" ? ietfHeading(line) : markdownHeading(line.trim());
    if (heading !== null) {
      flush();
      listOwner = null;
      while (stack.length > 0 && stack.at(-1).level >= heading.level)
        stack.pop();
      heading.informative = false;
      stack.push(heading);
      for (const s of sections) if (headingMatches(heading, s)) matched.add(s);
      continue;
    }
    const t = line.trim();
    if (t === "" || t === "\f") {
      flush();
      continue;
    }
    if (format === "markdown" && NON_NORMATIVE.test(t) && stack.length > 0) {
      stack.at(-1).informative = true;
      continue;
    }
    if (format === "markdown" && PARAGRAPH_START.test(t)) flush();
    push(t);
  }
  flush();

  return {
    format,
    case: keyCase,
    paragraphs,
    unmatched: sections.filter((s) => !matched.has(s)),
    skipped,
  };
}

/** Lit la ligne de commande ; rend `null` sur un usage faux. */
function parseArgs(argv) {
  const opts = { sections: [], json: false, all: false, file: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--section") opts.sections.push(argv[++i]);
    else if (a === "--format") opts.format = argv[++i];
    else if (a === "--case") opts.case = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--all") opts.all = true;
    else if (a.startsWith("--")) return null;
    else if (opts.file === undefined) opts.file = a;
    else return null;
  }
  if (opts.file === undefined || opts.sections.includes(undefined)) return null;
  if (opts.format !== undefined && !["ietf", "markdown"].includes(opts.format))
    return null;
  if (opts.case !== undefined && !["upper", "any"].includes(opts.case))
    return null;
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts === null) {
    console.error(
      "usage : normative.mjs <norme> [--section <num|id|titre>]… [--format ietf|markdown] [--case upper|any] [--all] [--json]",
    );
    process.exit(2);
  }
  const result = extractNormative(readFileSync(opts.file, "utf8"), opts);
  if (opts.json) console.log(JSON.stringify(result.paragraphs, null, 2));
  else
    for (const p of result.paragraphs)
      console.log(`[${p.n}] §${p.section} — ${p.text}`);
  const skippedNote =
    result.skipped > 0
      ? ` · ${result.skipped} écarté(s) comme non normatifs (--all pour les voir)`
      : "";
  console.error(
    `${result.paragraphs.length} paragraphe(s) normatif(s) · grammaire ${result.format} · casse ${result.case}${skippedNote}`,
  );
  if (result.unmatched.length > 0) {
    console.error(
      `✗ section(s) introuvable(s) : ${result.unmatched.join(", ")}`,
    );
    process.exit(1);
  }
}
