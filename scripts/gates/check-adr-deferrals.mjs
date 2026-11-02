#!/usr/bin/env node
/**
 * check-adr-deferrals — une promesse d'ADR a un ticket qui la porte.
 *
 * Les ADR de décision closent chaque décision par « Rupture si différé : OUI/NON ».
 * Un OUI donne un ticket (à livrer avant la majeure). Un NON écrit « possible plus
 * tard, sans casser » — et la promesse ne vit plus que dans la prose, que ni le
 * tableau de bord ni la reprise de session ne lisent. Vécu : la reprise d'un
 * abonnement par curseur, conçue deux fois (ADR-0021 S3, ADR-0022 §7) avec une
 * version cible, sans aucun ticket.
 *
 * Deux contrôles, sur les seuls ADR qui portent la formule « Rupture si différé » :
 *
 *  1. **Promesse sans porteur.** Dans une section dont une ligne « Rupture si
 *     différé » vaut NON, tout PARAGRAPHE (ou élément de liste) qui annonce un
 *     travail futur — une version postérieure à 10.0, « pourra », « demain »,
 *     « ajoutée en », « possible plus tard » — doit citer un ticket `#N` ou écrire
 *     « aucun travail prévu ». Le paragraphe, pas la section : une section cite
 *     presque toujours un ticket pour AUTRE chose, et le contrôle serait vert sans
 *     rien prouver (vécu : ADR-0022 §7 cite #622 et #629, pas la reprise).
 *  2. **Geste confié, inconnu du ticket.** Un « #N : <geste> » en tête d'élément
 *     de liste ou de cellule (ou « dans #N : ») confie un geste au ticket N ; le corps de N doit citer l'ADR et la section d'où il vient
 *     (vécu : #618 ne renvoyait qu'aux §2 et §3, le geste du §4 a été posé à
 *     l'envers). Les corps se lisent sur GitHub en UNE requête ; injoignable, le
 *     contrôle rend « non vérifié » et sort 2 — jamais vert.
 *
 * @usage node scripts/gates/check-adr-deferrals.mjs
 * @usage node scripts/gates/check-adr-deferrals.mjs --offline
 * @option --offline ne joint pas GitHub : seul le contrôle 1 tourne, sortie 2 s'il passe
 * @produces chaque section fautive, `ADR §section`, et la ligne de la promesse ; sortie 1 si une seule l'est
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ADR_DIR = path.join(ROOT, "docs", "adr");

/** La formule qui fait entrer un ADR dans le périmètre. */
const DEFERRAL = "Rupture si différé";
/** Une ligne « Rupture si différé … : NON » (gras et casse indifférents). */
const DEFERRAL_NO = /Rupture si différé[^:]*:\s*\**\s*non\b/i;
/**
 * Ce qui annonce un travail futur. `10.0` n'en est pas : c'est la version qu'on
 * fige (« avant 10.0 », « un serveur 10.0 »).
 */
const FUTURE =
  /\b10\.(?:x|[1-9]\d*)\b|\b1[1-9]\.(?:x|\d+)\b|\bpourr(?:a|ait|ont|aient)\b|\bdemain\b|\bajoutée?s? en\b|\bpossibles? plus tard\b/i;
/** Ce qui solde une promesse : un ticket, ou le renoncement écrit. */
const CARRIED = /#\d+|aucun travail prévu/i;
/**
 * « #N : geste » quand le ticket OUVRE l'élément de liste ou la cellule de
 * tableau, ou suit « dans » (« à prouver dans #618 : … »). Ailleurs, « #N : »
 * cite une ORIGINE (« Repris de #630 : … », « demandé par #624 : … ») ou un état
 * (« fermé (#630) : … ») — rien n'y est confié.
 */
const DELEGATION =
  /(?:^\s*[-*]\s+(?:\*\*)?|\|\s*(?:\*\*)?|\bdans\s)#(\d+)\s?[  ]?:\s/g;

/**
 * Découpe un ADR en sections (titres `##` à `####`), hors blocs de code.
 *
 * @param markdown - le texte de l'ADR
 * @returns les sections, chacune avec son identifiant (`7`, `S10 bis`, `W3`, ou
 *   le titre), sa ligne de titre et ses lignes `{ n, text }`
 */
export function splitSections(markdown) {
  const sections = [];
  let current = { id: "(préambule)", line: 1, lines: [] };
  let fenced = false;
  markdown.split("\n").forEach((text, i) => {
    const n = i + 1;
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const heading = /^#{2,4}\s+(.*)$/.exec(text);
    if (heading) {
      sections.push(current);
      current = { id: headingId(heading[1]), line: n, lines: [] };
      return;
    }
    current.lines.push({ n, text });
  });
  sections.push(current);
  return sections;
}

/** `7. La reprise` → `7` ; `S10 bis. Le contrat` → `S10 bis` ; sinon le titre. */
function headingId(title) {
  const m = /^((?:[SW]\d+|\d+)(?: (?:bis|ter))?)\./.exec(title.trim());
  return m ? m[1] : title.trim();
}

/** Libellé d'une section : `§7` pour un numéro, `S3` / `W3` tels quels. */
export function sectionLabel(id) {
  return /^\d/.test(id) ? `§${id}` : id;
}

/**
 * Regroupe les lignes d'une section en paragraphes : une ligne vide ferme le
 * paragraphe, un élément de liste ou une ligne de tableau en ouvre un.
 */
function paragraphs(lines) {
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line.text.trim() === "") {
      cur = null;
      continue;
    }
    const opens =
      /^\s*([-*]|\d+\.)\s/.test(line.text) || /^\s*\|/.test(line.text);
    if (!cur || opens) {
      cur = { start: line.n, text: "" };
      out.push(cur);
    }
    cur.text += `${line.text}\n`;
  }
  return out;
}

/**
 * Contrôle 1 : promesses de travail futur sans ticket ni renoncement écrit.
 *
 * @param adr - le nom court de l'ADR (`0022`)
 * @param markdown - son texte
 * @returns une entrée par paragraphe fautif : `{ adr, section, line, excerpt }`
 */
export function findUncarriedPromises(adr, markdown) {
  if (!markdown.includes(DEFERRAL)) return [];
  const offenses = [];
  for (const section of splitSections(markdown)) {
    if (!section.lines.some((l) => DEFERRAL_NO.test(l.text))) continue;
    for (const p of paragraphs(section.lines)) {
      const flat = p.text.replace(/\s+/g, " ");
      const promise = FUTURE.exec(flat);
      if (!promise || CARRIED.test(flat)) continue;
      offenses.push({
        adr,
        section: sectionLabel(section.id),
        line: p.start,
        excerpt: excerptAround(flat, promise.index),
      });
    }
  }
  return offenses;
}

function excerptAround(text, index) {
  const from = Math.max(0, index - 50);
  return `${from > 0 ? "…" : ""}${text.slice(from, index + 70).trim()}…`;
}

/**
 * Relève les gestes confiés à un ticket (« #N : … ») dans un ADR du périmètre.
 *
 * @param adr - le nom court de l'ADR (`0022`)
 * @param markdown - son texte
 * @returns `{ adr, section, sectionId, line, issue }` par occurrence
 */
export function findDelegations(adr, markdown) {
  if (!markdown.includes(DEFERRAL)) return [];
  const found = [];
  for (const section of splitSections(markdown)) {
    for (const line of section.lines) {
      for (const m of line.text.matchAll(DELEGATION)) {
        found.push({
          adr,
          section: sectionLabel(section.id),
          sectionId: section.id,
          line: line.n,
          issue: Number(m[1]),
        });
      }
    }
  }
  return found;
}

/**
 * Dit si le corps d'un ticket cite l'ADR ET la section d'où vient le geste,
 * sur la même ligne (« ADR-0022 §4 », « [ADR-0022](…) §4 », « ADR-0021 S3 »).
 *
 * @param body - le corps de l'issue
 * @param adr - le nom court de l'ADR (`0022`)
 * @param sectionId - l'identifiant de section (`4`, `S3`, `W2`)
 */
export function bodyCites(body, adr, sectionId) {
  const sec = /^\d/.test(sectionId)
    ? `§\\s?${escape(sectionId)}\\b`
    : `(?:§\\s?)?${escape(sectionId)}\\b`;
  return new RegExp(`ADR-?${adr}[^\\n]{0,80}?${sec}`, "i").test(body ?? "");
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Contrôle 2 : chaque geste confié doit être connu du ticket qui le porte.
 *
 * @param delegations - sortie de {@link findDelegations}
 * @param bodies - corps par numéro d'issue (`Map<number, string>`) ; une issue
 *   absente compte comme ne citant rien
 * @returns les gestes que le ticket ignore
 */
export function findUnknownDelegations(delegations, bodies) {
  return delegations.filter(
    (d) => !bodyCites(bodies.get(d.issue), d.adr, d.sectionId),
  );
}

/** Corps des issues en UNE requête GraphQL ; `null` si GitHub ne répond pas. */
function fetchBodies(numbers) {
  if (numbers.length === 0) return new Map();
  const fields = numbers
    .map((n) => `i${n}: issue(number: ${n}) { number body }`)
    .join(" ");
  const query = `{ repository(owner: "nodefony", name: "nodefony-core") { ${fields} } }`;
  try {
    const out = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    const repo = JSON.parse(out).data.repository;
    return new Map(
      Object.values(repo)
        .filter(Boolean)
        .map((i) => [i.number, i.body]),
    );
  } catch {
    return null;
  }
}

function main() {
  const offline = process.argv.includes("--offline");
  const files = fs
    .readdirSync(ADR_DIR)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort();
  const promises = [];
  const delegations = [];
  let inScope = 0;
  for (const file of files) {
    const markdown = fs.readFileSync(path.join(ADR_DIR, file), "utf8");
    if (!markdown.includes(DEFERRAL)) continue;
    inScope++;
    const adr = file.slice(0, 4);
    promises.push(...findUncarriedPromises(adr, markdown));
    delegations.push(...findDelegations(adr, markdown));
  }

  let failed = false;
  if (promises.length > 0) {
    failed = true;
    console.error(
      `✗ ${promises.length} promesse(s) de travail futur sans ticket — citer le ticket (#N) ` +
        "dans le paragraphe, ou écrire « aucun travail prévu » :\n",
    );
    for (const p of promises) {
      console.error(`  ADR-${p.adr} ${p.section}  (docs/adr, ligne ${p.line})`);
      console.error(`      ${p.excerpt}`);
    }
  } else {
    console.log(
      `✓ ${inScope} ADR à décisions différables : chaque promesse a son porteur.`,
    );
  }

  if (offline) {
    console.error(
      `⚠️  ${delegations.length} geste(s) confié(s) à un ticket NON vérifié(s) (--offline) — pas un verdict vert.`,
    );
    process.exit(failed ? 1 : 2);
  }
  const numbers = [...new Set(delegations.map((d) => d.issue))].sort(
    (a, b) => a - b,
  );
  const bodies = fetchBodies(numbers);
  if (bodies === null) {
    console.error(
      `⚠️  GitHub injoignable — ${delegations.length} geste(s) confié(s) NON vérifié(s) : pas un verdict vert.`,
    );
    process.exit(failed ? 1 : 2);
  }
  const unknown = findUnknownDelegations(delegations, bodies);
  if (unknown.length > 0) {
    failed = true;
    console.error(
      `\n✗ ${unknown.length} geste(s) confié(s) que le ticket ne cite pas — ajouter au corps ` +
        "du ticket « ADR-<n> <section> » :\n",
    );
    for (const d of unknown) {
      console.error(`  ${d.adr} ${d.section} → #${d.issue}  (ligne ${d.line})`);
    }
  } else {
    console.log(
      `✓ ${delegations.length} geste(s) confié(s) à ${numbers.length} ticket(s) : chacun le cite.`,
    );
  }
  process.exit(failed ? 1 : 0);
}

// Importé (test) : on n'exécute rien — les fonctions ci-dessus restent pures.
if (process.argv[1]?.endsWith("check-adr-deferrals.mjs")) main();
