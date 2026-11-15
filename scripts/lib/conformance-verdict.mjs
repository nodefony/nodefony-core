/**
 * Verdict d'une suite de conformité BOÎTE NOIRE confrontée à sa liste d'échecs
 * CONNUS. Pur : ni processus, ni fichier — le banc lit, cette règle juge.
 *
 * Trois façons d'échouer, et aucune n'est négociable :
 *   - un échec qui n'est pas déclaré (régression, ou défaut neuf) ;
 *   - un échec déclaré qui PASSE désormais : la liste mentirait, il faut l'en retirer ;
 *   - un échec déclaré absent d'une passe complète : son identifiant ne désigne
 *     plus rien (suite renumérotée), la liste ne garde plus rien.
 *
 * Un cas INDÉTERMINÉ (`~` en tête) est un cas dont les DEUX issues sont
 * conformes à la norme — l'outil n'en reconnaît qu'une, et laquelle il voit
 * dépend d'une course. Son échec est toléré, son succès n'est pas une
 * réparation : le déclarer « connu » ferait basculer la passe au hasard.
 *
 * @usage import { judge, parseJUnit, parseKnownFailing } from "../lib/conformance-verdict.mjs"
 */

/** Entités XML nommées que produit un sérialiseur conforme. */
const NAMED_ENTITIES = Object.assign(Object.create(null), {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
});

/**
 * Décode les entités d'un texte XML (nommées et numériques).
 *
 * @param {string} text - texte tel qu'il figure dans le XML
 * @returns {string} texte décodé
 */
function decodeXml(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (match, entity) => {
      if (entity[0] !== "#") return NAMED_ENTITIES[entity] ?? match;
      const hex = entity[1] === "x" || entity[1] === "X";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    },
  );
}

/**
 * Attributs d'une balise ouvrante, décodés.
 *
 * @param {string} source - texte entre le nom de balise et `>`
 * @returns {Map<string, string>} attributs par nom
 */
function readAttributes(source) {
  const attributes = new Map();
  for (const [, name, value] of source.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attributes.set(name, decodeXml(value));
  }
  return attributes;
}

/**
 * @typedef {"passed" | "failed" | "skipped"} CaseStatus
 * @typedef {{ name: string, status: CaseStatus, detail: string }} JUnitCase
 * @typedef {{ name: string, package: string, cases: JUnitCase[] }} JUnitSuite
 */

/**
 * Lit un rapport JUnit XML en suites ORDONNÉES de cas, dans l'ordre du fichier.
 *
 * `<failure>` et `<error>` comptent comme échecs (une erreur est un cas qui
 * n'a pas pu conclure : ce n'est pas un succès) ; `<skipped>` comme sauté.
 *
 * @param {string} xml - contenu du rapport
 * @returns {JUnitSuite[]} suites, chacune avec ses cas dans l'ordre
 * @throws {Error} un cas hors de toute suite, ou aucune suite du tout
 */
export function parseJUnit(xml) {
  /** @type {JUnitSuite[]} */
  const suites = [];
  /** @type {JUnitSuite | null} */
  let current = null;
  const tokens =
    /<testsuite\b([^>]*?)(\/?)>|<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const [, suiteAttrs, selfClosed, caseAttrs, body] of xml.matchAll(
    tokens,
  )) {
    if (suiteAttrs !== undefined) {
      const attributes = readAttributes(suiteAttrs);
      current = {
        name: attributes.get("name") ?? "",
        package: attributes.get("package") ?? "",
        cases: [],
      };
      suites.push(current);
      if (selfClosed === "/") current = null;
      continue;
    }
    if (current === null) {
      throw new Error("rapport JUnit illisible : un cas hors de toute suite");
    }
    const attributes = readAttributes(caseAttrs ?? "");
    const inner = body ?? "";
    const failure = /<(failure|error)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/.exec(
      inner,
    );
    /** @type {CaseStatus} */
    let status = "passed";
    let detail = "";
    if (failure !== null) {
      status = "failed";
      detail = decodeXml(failure[2] ?? "").trim();
    } else if (/<skipped\b/.test(inner)) {
      status = "skipped";
    }
    current.cases.push({
      name: attributes.get("classname") ?? attributes.get("name") ?? "",
      status,
      detail,
    });
  }
  if (suites.length === 0) {
    throw new Error("rapport JUnit illisible : aucune suite");
  }
  return suites;
}

/**
 * @typedef {{ reason: string, indeterminate: boolean }} KnownCase
 */

/**
 * Lit une liste d'échecs connus : un identifiant par ligne, suivi de son
 * motif après `#` ; `~` devant l'identifiant le déclare INDÉTERMINÉ. Lignes
 * vides et lignes de commentaire (`#` en tête) ignorées.
 *
 * @param {string} text - contenu du fichier
 * @returns {Map<string, KnownCase>} motif et nature par identifiant
 * @throws {Error} un identifiant sans motif, ou déclaré deux fois
 */
export function parseKnownFailing(text) {
  /** @type {Map<string, KnownCase>} */
  const known = new Map();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    const declared = (hash === -1 ? line : line.slice(0, hash)).trim();
    const indeterminate = declared.startsWith("~");
    const id = indeterminate ? declared.slice(1).trim() : declared;
    const reason = hash === -1 ? "" : line.slice(hash + 1).trim();
    if (reason === "") {
      throw new Error(
        `ligne ${index + 1} : « ${id} » sans motif — un échec connu se déclare avec sa raison (« id # motif »)`,
      );
    }
    if (known.has(id)) {
      throw new Error(`ligne ${index + 1} : « ${id} » déclaré deux fois`);
    }
    known.set(id, { reason, indeterminate });
  }
  return known;
}

/**
 * @typedef {{ id: string, name: string, status: CaseStatus, detail: string }} CaseResult
 * @typedef {{
 *   total: number, passed: number, failed: number, skipped: number,
 *   expected: CaseResult[], tolerated: CaseResult[], unexpected: CaseResult[],
 *   fixed: { id: string, name: string, reason: string }[],
 *   missing: { id: string, reason: string }[],
 *   ok: boolean,
 * }} Verdict
 */

/**
 * Confronte les résultats d'une passe à la liste d'échecs connus.
 *
 * @param {readonly CaseResult[]} results - un résultat par cas joué
 * @param {ReadonlyMap<string, KnownCase>} known - cas déclarés, par identifiant
 * @param {{ partial?: boolean }} [options] - `partial` : passe filtrée, un connu
 *   absent n'y est pas une faute
 * @returns {Verdict} comptes, écarts nommés et verdict global
 */
export function judge(results, known, { partial = false } = {}) {
  /** @type {Verdict} */
  const verdict = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    expected: [],
    tolerated: [],
    unexpected: [],
    fixed: [],
    missing: [],
    ok: false,
  };
  const seen = new Set();
  for (const result of results) {
    seen.add(result.id);
    const declared = known.get(result.id);
    if (result.status === "failed") {
      verdict.failed++;
      if (declared === undefined) verdict.unexpected.push(result);
      else if (declared.indeterminate) verdict.tolerated.push(result);
      else verdict.expected.push(result);
      continue;
    }
    if (result.status === "skipped") verdict.skipped++;
    else verdict.passed++;
    if (
      result.status === "passed" &&
      declared !== undefined &&
      !declared.indeterminate
    ) {
      verdict.fixed.push({
        id: result.id,
        name: result.name,
        reason: declared.reason,
      });
    }
  }
  if (!partial) {
    for (const [id, declared] of known) {
      if (!seen.has(id)) verdict.missing.push({ id, reason: declared.reason });
    }
  }
  verdict.ok =
    verdict.total > 0 &&
    verdict.unexpected.length === 0 &&
    verdict.fixed.length === 0 &&
    verdict.missing.length === 0;
  return verdict;
}
