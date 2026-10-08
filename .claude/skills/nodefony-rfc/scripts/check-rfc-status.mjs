#!/usr/bin/env node
/**
 * Dit si une RFC (ou un brouillon IETF) du corpus hors ligne est DÉPASSÉE.
 *
 * Le problème qu'il ferme : une RFC ne change jamais, mais elle peut être
 * RENDUE OBSOLÈTE par une autre (7807 → 9457, 2818 → 9110). La copie figée
 * reste lisible, on continue de la citer, et l'écart ne se voit nulle part.
 * Le complément de `check-amont.mjs`, qui suit les specs VIVANTES par SHA.
 *
 * Source : les métadonnées de l'éditeur des RFC (`rfc-editor.org/rfc/rfcN.json`,
 * champs `obsoleted_by` / `updated_by`) et, pour un brouillon, la dernière
 * révision publiée au datatracker. Ce script ne télécharge rien dans le
 * corpus : il NOMME ce qui est à relire.
 *
 * Corpus lu : `nodefony-framework-dev/references/rfc/ietf/rfc<N>.txt` et
 * `…/rfc/specs/draft-*-<NN>.txt` — la copie UNIQUE du dépôt.
 *
 * Codes de sortie : `0` rien d'obsolète · `3` au moins une RFC obsolète ou un
 * brouillon dépassé · `78` impossible de savoir (réseau).
 *
 * @module
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(
  HERE,
  "..",
  "..",
  "nodefony-framework-dev",
  "references",
  "rfc",
);

/** Lit une URL en JSON, ou rend `null` si elle n'a pas répondu. */
async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const rfcs = readdirSync(path.join(CORPUS, "ietf"))
  .map((f) => /^rfc(\d+)\.txt$/.exec(f)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
// Le NOM du brouillon se lit dans son texte : le fichier peut porter un nom
// abrégé (`draft-idempotency-key-header-06.txt` pour
// `draft-ietf-httpapi-idempotency-key-header-06`).
const drafts = readdirSync(path.join(CORPUS, "specs"))
  .filter((f) => /^draft-.+-\d{2}\.txt$/.test(f))
  .map((f) =>
    /(draft-[a-z0-9-]+)-(\d{2})/.exec(
      readFileSync(path.join(CORPUS, "specs", f), "utf8"),
    ),
  )
  .filter(Boolean);

let unknown = 0;
let outdated = 0;
const updated = [];
const kept = [];
const draftRevs = new Set(drafts.map(([, name, rev]) => `${name}-${rev}`));

const results = await Promise.all(
  rfcs.map(async (n) => ({
    n,
    meta: await fetchJson(`https://www.rfc-editor.org/rfc/rfc${n}.json`),
  })),
);
for (const { n, meta } of results) {
  if (meta === null) {
    unknown++;
    console.log(`?  RFC ${n} — métadonnées injoignables`);
    continue;
  }
  const by = (meta.obsoleted_by ?? []).map((s) => s.trim()).filter(Boolean);
  if (by.length > 0) {
    // Remplaçante déjà au corpus : l'ancienne se garde tant que du code la
    // cite, ce n'est plus un trou — seulement une citation à repointer.
    const present = by.every((r) =>
      rfcs.includes(Number(r.replace(/\D/g, ""))),
    );
    if (present) {
      kept.push(`RFC ${n} → ${by.join(", ")}`);
    } else {
      outdated++;
      console.log(`✗  RFC ${n} — OBSOLÈTE, remplacée par ${by.join(", ")}`);
    }
  }
  const up = (meta.updated_by ?? []).map((s) => s.trim()).filter(Boolean);
  if (up.length > 0) updated.push(`RFC ${n} ← ${up.join(", ")}`);
}

for (const [, name, rev] of drafts) {
  const doc = await fetchJson(
    `https://datatracker.ietf.org/api/v1/doc/document/${name}/?format=json`,
  );
  if (doc === null) {
    unknown++;
    console.log(`?  ${name}-${rev} — datatracker injoignable`);
    continue;
  }
  if (doc.rfc) {
    outdated++;
    console.log(`✗  ${name}-${rev} — publié en RFC ${doc.rfc}`);
  } else if (doc.rev !== rev) {
    if (draftRevs.has(`${name}-${doc.rev}`)) {
      kept.push(`${name}-${rev} → -${doc.rev}`);
    } else {
      outdated++;
      console.log(`✗  ${name}-${rev} — révision courante ${doc.rev}`);
    }
  }
}

console.log(
  `\n${rfcs.length} RFC + ${drafts.length} brouillon(s) · ${outdated} dépassé(s) · ${unknown} non vérifié(s)`,
);
if (kept.length > 0) {
  console.log(
    "\nObsolètes CONSERVÉES, remplaçante au corpus (citations à repointer, puis retirer) :",
  );
  for (const line of kept) console.log(`   ${line}`);
}
if (updated.length > 0) {
  console.log(
    "\nMises à jour (le texte reste en vigueur, mais une autre RFC le complète ou le corrige) :",
  );
  for (const line of updated) console.log(`   ${line}`);
}
process.exit(unknown > 0 ? 78 : outdated > 0 ? 3 : 0);
