#!/usr/bin/env node
/**
 * Éprouve le BANC lui-même — avant qu'il ne juge quoi que ce soit.
 *
 * Un juge non éprouvé rend des verdicts faux avec l'aplomb des verdicts justes.
 * Ce fichier existe parce que les deux lecteurs de `bench-schema.mjs` ont
 * commencé leur vie avec des défauts SILENCIEUX : celui de Ghost perdait toute
 * définition de colonne étalée sur plusieurs lignes (`visibility`, cinq lignes,
 * simplement absente), et le compte de colonnes qui en sortait — 130 — avait
 * exactement l'allure d'un compte juste.
 *
 * La méthode : compter la MÊME chose par un chemin INDÉPENDANT du lecteur, et
 * exiger l'égalité. Un lecteur qui se vérifie avec sa propre logique ne vérifie
 * rien.
 *
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs --prove
 *
 * `--prove` casse volontairement chaque lecteur pour montrer que le contrôle
 * MORD : un test qu'on n'a jamais vu échouer ne garde rien.
 *
 * Sortie : exit 0 si tous les contrôles passent, 1 sinon.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrisma, readKnex, SCHEMAS, subset } from "./bench-schema.mjs";

function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt introuvable");
}

const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(REPO, "tmp", "devkit-schema", ".sources");

let failures = 0;
const check = (name, actual, expected, detail = "") => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${name.padEnd(46)} ${String(actual).padStart(4)} / ${expected}` +
      (ok || !detail ? "" : `\n       ${detail}`),
  );
  return ok;
};

/**
 * Isole le corps d'une table dans une source, par comptage d'accolades.
 *
 * Indépendant des lecteurs : il ne partage avec eux ni regex, ni découpage.
 *
 * @param src - texte de la source.
 * @param open - la ligne qui ouvre la table (`model X {` ou `posts: {`).
 * @returns le texte du corps, accolades extérieures exclues.
 */
function sliceBlock(src, open) {
  // Ancré en DÉBUT DE LIGNE, indentation comprise : un `indexOf` nu sur
  // « posts: { » tombait sur « show_latest_posts: { », et le contrôle rendait
  // « 1 colonne attendue » avec le même aplomb qu'un compte juste.
  const anchor = new RegExp(
    `^\\s*${open.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
    "mu",
  );
  const found = anchor.exec(src);
  const start = found ? found.index : -1;
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i + 1;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i);
    }
  }
  return null;
}

/**
 * Compte INDÉPENDAMMENT les colonnes d'une table Prisma.
 *
 * Une colonne est une ligne `nom Type…` dont le type est scalaire ou une
 * énumération déclarée. Tout le reste est une navigation. On recompte les
 * énumérations ici, sans réutiliser celles du lecteur.
 */
function countPrismaColumns(src, model) {
  const body = sliceBlock(src, `model ${model} {`);
  if (body === null) return null;
  const enums = new Set(
    [...src.matchAll(/^enum\s+(\w+)\s*\{/gmu)].map((m) => m[1]),
  );
  const scalars = new Set([
    "String",
    "Int",
    "BigInt",
    "Float",
    "Decimal",
    "Boolean",
    "DateTime",
    "Json",
    "Bytes",
  ]);
  let n = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const m = /^(\w+)\s+(\w+)(\??)(\[\])?/u.exec(line);
    if (!m) continue;
    const [, , type, , list] = m;
    if (scalars.has(type) && !list) n += 1;
    else if (enums.has(type)) n += 1; // y compris un TABLEAU d'énumération
  }
  return n;
}

/**
 * Compte INDÉPENDAMMENT les colonnes d'une table knex.
 *
 * Chaque colonne porte exactement un `type: '…'` ; rien d'autre dans le fichier
 * n'en porte au premier niveau (`fieldtype` est un autre mot).
 */
function countKnexColumns(src, table) {
  const body = sliceBlock(src, `${table}: {`);
  if (body === null) return null;
  return (body.match(/\btype:\s*'/gu) ?? []).length;
}

/** Compte INDÉPENDAMMENT les index d'une table Prisma. */
function countPrismaIndexes(src, model) {
  const body = sliceBlock(src, `model ${model} {`);
  if (body === null) return null;
  return (body.match(/^\s*@@(index|unique)\(/gmu) ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────

function source(key) {
  const def = SCHEMAS[key];
  const file = path.join(
    CACHE,
    `${key}.${def.format === "knex" ? "js" : "prisma"}`,
  );
  if (!existsSync(file)) {
    console.log(
      `\n⚠️  source ${key} absente du cache — lancer d'abord :\n` +
        `   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --schema ${key} --dump-only\n`,
    );
    return null;
  }
  return { def, src: readFileSync(file, "utf8") };
}

/** Le lecteur voit-il EXACTEMENT ce que le comptage indépendant voit ? */
function verify(key, { breakReader = false } = {}) {
  const s = source(key);
  if (!s) return;
  const { def, src } = s;
  console.log(`\n━━ ${key} (${def.format})`);

  let parsed = def.format === "prisma" ? readPrisma(src) : readKnex(src);

  if (breakReader) {
    // Preuve NÉGATIVE : on ampute le lecteur d'une colonne par table. Si les
    // contrôles restent verts, ils ne contrôlent rien.
    parsed = {
      ...parsed,
      tables: parsed.tables.map((t) => ({ ...t, columns: t.columns.slice(1) })),
    };
  }

  // Le sous-ensemble RENOMME les tables ; le comptage indépendant travaille sur
  // les noms d'ORIGINE. On garde donc la correspondance avant renommage.
  const wanted = new Set(def.tables);
  const before = parsed.tables.filter((t) => wanted.has(t.model));
  const originalNames = before.map((t) => t.model);
  const { tables: after } = subset(parsed, def);

  for (let i = 0; i < after.length; i += 1) {
    const origin = originalNames[i];
    const read = after[i];
    const expectedCols =
      def.format === "prisma"
        ? countPrismaColumns(src, origin)
        : countKnexColumns(src, origin);
    if (expectedCols === null) {
      console.log(`  ❌ ${origin} — introuvable dans la source`);
      failures += 1;
      continue;
    }
    check(`${origin} — colonnes`, read.columns.length, expectedCols);

    if (def.format === "prisma") {
      const expectedIdx = countPrismaIndexes(src, origin);
      check(`${origin} — index`, read.indexes.length, expectedIdx);
    }
  }
}

/**
 * Contrôles de FORME que le comptage ne couvre pas — chacun ancré sur un défaut
 * réellement rencontré, pas sur une inquiétude théorique.
 */
function verifyShape() {
  console.log(`\n━━ forme`);

  const ghost = source("ghost");
  if (ghost) {
    const { tables } = readKnex(ghost.src);
    const nl = tables.find((t) => t.model === "newsletters");
    // Le défaut d'origine : une définition étalée sur plusieurs lignes était
    // purement et simplement absente, sans un mot.
    const hasMultiline = nl?.columns.some((c) => c.prop === "visibility");
    console.log(
      `  ${hasMultiline ? "✅" : "❌"} newsletters.visibility (défini sur 5 lignes) est lu`,
    );
    if (!hasMultiline) failures += 1;

    // Les attributs que la grammaire ne sait pas dire doivent être RELEVÉS.
    const flagged = tables
      .flatMap((t) => t.columns)
      .filter((c) => c.note?.includes("INEXPRIMABLE")).length;
    console.log(
      `  ${flagged > 0 ? "✅" : "❌"} attributs inexprimables relevés : ${flagged}`,
    );
    if (flagged === 0) failures += 1;
  }

  const calcom = source("calcom");
  if (calcom) {
    const { tables, enums } = readPrisma(calcom.src);
    const membership = tables.find((t) => t.model === "Membership");
    const role = membership?.columns.find((c) => c.prop === "role");
    const ok = role?.logical === "enum" && role.note?.includes("PARTAGÉE");
    console.log(
      `  ${ok ? "✅" : "❌"} Membership.role reconnu comme énumération partagée` +
        (role ? ` (${role.sourceType})` : " — colonne absente"),
    );
    if (!ok) failures += 1;

    const webhook = tables.find((t) => t.model === "Webhook");
    const trig = webhook?.columns.find((c) => c.prop === "eventTriggers");
    const okArr = trig?.note?.includes("tableau");
    console.log(
      `  ${okArr ? "✅" : "❌"} Webhook.eventTriggers reconnu comme TABLEAU d'énumération`,
    );
    if (!okArr) failures += 1;

    console.log(`  ℹ️  ${enums.size} énumérations déclarées dans la source`);
  }

  const umami = source("umami");
  if (umami) {
    const { tables } = readPrisma(umami.src);
    const user = tables.find((t) => t.model === "User");
    // Le trou principal d'umami : la colonne SQL diffère de la propriété.
    const id = user?.columns.find((c) => c.prop === "id");
    const ok = id?.column === "user_id";
    console.log(
      `  ${ok ? "✅" : "❌"} User.id porte bien la colonne « user_id » (lu : ${id?.column})`,
    );
    if (!ok) failures += 1;

    const session = tables.find((t) => t.model === "Session");
    // Les index se déclarent en PROPRIÉTÉS et doivent être traduits en COLONNES.
    const composite = session?.indexes.find((i) => i.props?.length === 3);
    const okIdx = composite?.columns?.includes("website_id");
    console.log(
      `  ${okIdx ? "✅" : "❌"} index composite traduit en noms de COLONNE` +
        (composite ? ` (${composite.columns.join(", ")})` : ""),
    );
    if (!okIdx) failures += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const prove = process.argv.includes("--prove");

console.log(
  prove
    ? "PREUVE NÉGATIVE — les lecteurs sont amputés d'une colonne par table.\n" +
        "Tout ce qui reste VERT ci-dessous ne contrôle rien."
    : "AUTO-CONTRÔLE DU BANC — chaque compte est refait par un chemin indépendant.",
);

for (const key of Object.keys(SCHEMAS)) verify(key, { breakReader: prove });
if (!prove) verifyShape();

console.log(
  `\n${failures === 0 ? "✅ tous les contrôles passent" : `❌ ${failures} contrôle(s) en échec`}`,
);
if (prove) {
  console.log(
    failures > 0
      ? "   → le contrôle MORD : un lecteur amputé est détecté."
      : "   → ⚠️ AUCUN échec alors que les lecteurs sont cassés : le contrôle est INUTILE.",
  );
  process.exit(failures > 0 ? 0 : 1);
}
process.exit(failures === 0 ? 0 : 1);
