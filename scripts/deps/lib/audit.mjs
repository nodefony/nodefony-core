/**
 * Verdict de l'audit npm : quelles vulnérabilités de gravité haute ou critique
 * bloquent, et lesquelles sont tolérées faute de correctif publié.
 *
 * La parade normale d'une faille est un `overrides` à la racine. Elle suppose
 * qu'une version corrigée EXISTE. Vécu : l'avis picomatch GHSA-fc5q-39xc-vjpf,
 * élargi à `<= 4.0.7` alors que 4.0.7 était la dernière version publiée — rien
 * vers quoi forcer, et la forge rouge sur six plateformes pour un défaut que
 * personne ne pouvait corriger. Un rouge qui n'apprend rien apprend à ne plus
 * regarder ; il masquerait aussi la faille suivante.
 *
 * D'où des exceptions NOMMÉES par identifiant d'avis, qui expirent seules :
 * dès que la dernière version publiée du paquet sort de la plage vulnérable,
 * l'exception rougit (`CORRECTIF-PUBLIÉ`) — on pose alors l'`overrides`, puis
 * l'exception devenue sans objet rougit à son tour tant qu'on ne la retire pas.
 *
 * @usage import { auditVerdicts, advisoriesOf } from "./lib/audit.mjs"
 */

import semver from "semver";

/**
 * Avis tolérés tant qu'aucune version corrigée n'est publiée — clé : identifiant
 * GHSA, valeur : le motif. Tout autre avis de gravité haute ou critique bloque.
 */
export const ACCEPTED_ADVISORIES = {
  "GHSA-fc5q-39xc-vjpf":
    "picomatch : ReDoS sur extglob répété, aucune version corrigée publiée — " +
    "tiré par l'outillage de build et de test (vite, vitest, lint-staged, fdir)",
};

/** Gravités qui bloquent. */
const BLOCKING = new Set(["high", "critical"]);

/**
 * Avis SOURCES d'un rapport `npm audit --json`, dédoublonnés par identifiant.
 *
 * Un rapport liste chaque paquet touché ; seuls ceux dont `via` porte un objet
 * sont la source d'un avis — les autres en héritent (« Depends on vulnerable
 * versions of … ») et ne disent rien de plus.
 *
 * @param {{ vulnerabilities?: Record<string, { via?: Array<unknown> }> }} report
 * @returns {Array<{ id: string, name: string, title: string, severity: string, range: string }>}
 */
export function advisoriesOf(report) {
  const out = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {}))
    for (const via of vuln.via ?? []) {
      if (via === null || typeof via !== "object") continue;
      const id = advisoryId(via);
      if (id === null || out.has(id)) continue;
      out.set(id, {
        id,
        name: String(via.name),
        title: String(via.title ?? ""),
        severity: String(via.severity),
        range: String(via.range ?? "*"),
      });
    }
  return [...out.values()];
}

/**
 * Identifiant d'un avis : le dernier segment de son URL (`…/advisories/GHSA-…`),
 * à défaut sa source numérique.
 *
 * @param {{ url?: unknown, source?: unknown }} via
 * @returns {string | null}
 */
function advisoryId(via) {
  if (typeof via.url === "string") {
    const last = via.url.split("/").pop();
    if (last) return last;
  }
  return typeof via.source === "number" || typeof via.source === "string"
    ? String(via.source)
    : null;
}

/**
 * Juge chaque avis bloquant du rapport contre les exceptions inscrites.
 *
 * Verdicts : `VULNÉRABLE` (non inscrit : fatal), `toléré` (inscrit, et la
 * dernière version publiée est encore dans la plage vulnérable),
 * `CORRECTIF-PUBLIÉ` (inscrit, mais une version hors plage existe : poser
 * l'`overrides` — fatal), `CORRECTIF-INCONNU` (dernière version illisible :
 * jamais un verdict supposé — fatal), `EXCEPTION-SANS-OBJET` (inscrit, absent
 * du rapport : la retirer — fatal).
 *
 * @param {Array<{ id: string, name: string, title: string, severity: string, range: string }>} advisories
 * @param {(name: string) => string | null} latest - dernière version publiée d'un paquet
 * @param {Record<string, string>} [accepted] - exceptions motivées, clé = identifiant d'avis
 * @returns {Array<{ id: string, name?: string, title?: string, range?: string, latest?: string | null, verdict: string, reason?: string }>}
 */
export function auditVerdicts(
  advisories,
  latest,
  accepted = ACCEPTED_ADVISORIES,
) {
  const out = [];
  const seen = new Set();
  for (const adv of advisories) {
    if (!BLOCKING.has(adv.severity)) continue;
    const base = {
      id: adv.id,
      name: adv.name,
      title: adv.title,
      range: adv.range,
    };
    if (!Object.hasOwn(accepted, adv.id)) {
      out.push({ ...base, verdict: "VULNÉRABLE" });
      continue;
    }
    seen.add(adv.id);
    const reason = accepted[adv.id];
    const last = latest(adv.name);
    const verdict =
      last === null || semver.valid(last) === null
        ? "CORRECTIF-INCONNU"
        : semver.satisfies(last, adv.range, { includePrerelease: true })
          ? "toléré"
          : "CORRECTIF-PUBLIÉ";
    out.push({ ...base, latest: last, verdict, reason });
  }
  for (const [id, reason] of Object.entries(accepted))
    if (!seen.has(id))
      out.push({ id, verdict: "EXCEPTION-SANS-OBJET", reason });
  return out;
}
