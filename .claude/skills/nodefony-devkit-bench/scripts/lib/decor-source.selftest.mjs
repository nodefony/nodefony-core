/**
 * Auto-contrôle de la SOURCE et du CANAL du décor.
 *
 * Ces deux réglages décident de ce qu'une campagne MESURE : le code du dépôt, ou
 * ce qu'un utilisateur reçoit du registre — et, dans ce cas, quelle version. Une
 * erreur ici ne produit pas un plantage : elle produit une mesure juste sur le
 * mauvais objet, et rien dans le rapport ne le dit.
 *
 * `--prove` mute le vrai module et exige que ce contrôle TOMBE.
 *
 * Usage : `node lib/decor-source.selftest.mjs [--prove]`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./decor-source.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  SOURCES,
  ETIQUETTES,
  sourceDe,
  canalDe,
  registreLocalRequis,
  specifieur,
  libelleDecor,
} = await import(MODULE);

const PROVE =
  process.argv.includes("--prove") && MODULE === "./decor-source.mjs";
let verts = 0;
const rouges = [];

/**
 * @param {string} nom - ce qu'on affirme.
 * @param {boolean} condition - le fait.
 */
function cas(nom, condition) {
  if (condition) verts += 1;
  else rouges.push(nom);
}

/**
 * @param {string} nom - la règle.
 * @param {() => unknown} fn - l'appel qui doit lever.
 */
function leve(nom, fn) {
  try {
    fn();
    rouges.push(`${nom} : n'a PAS levé`);
  } catch {
    verts += 1;
  }
}

// ── La SOURCE — ce qu'on éprouve ─────────────────────────────────────────────
cas("source par défaut = depot", sourceDe({}) === "depot");
for (const s of SOURCES) {
  cas(
    `source « ${s} » acceptée`,
    sourceDe({ NF_DEVKIT_BENCH_SOURCE: s }) === s,
  );
}
// Replier en silence ferait croire qu'on mesure le registre alors qu'on mesure
// le checkout — et rien dans le rapport ne le dirait.
leve("une source inconnue LÈVE", () =>
  sourceDe({ NF_DEVKIT_BENCH_SOURCE: "registry" }),
);

// ── Le CANAL — quelle version publiée ────────────────────────────────────────
cas("canal par défaut = alpha", canalDe({}) === "alpha");
for (const e of ETIQUETTES) {
  cas(
    `étiquette « ${e} » acceptée`,
    canalDe({ NF_DEVKIT_BENCH_CANAL: e }) === e,
  );
}
// La version EXACTE est la seule forme REJOUABLE : `latest` d'aujourd'hui n'est
// pas celui du mois prochain.
for (const v of ["10.0.0", "10.0.0-alpha.5", "10.1.0-beta.2", "9.9.9-rc.1"]) {
  cas(
    `version exacte « ${v} » acceptée`,
    canalDe({ NF_DEVKIT_BENCH_CANAL: v }) === v,
  );
}
leve("un canal mal orthographié LÈVE (sinon npm sert la version 7)", () =>
  canalDe({ NF_DEVKIT_BENCH_CANAL: "aplha" }),
);
leve("une version tronquée LÈVE", () =>
  canalDe({ NF_DEVKIT_BENCH_CANAL: "10.0" }),
);

// ── Le régime local ──────────────────────────────────────────────────────────
cas(
  "seul « local » exige un registre interposé",
  registreLocalRequis("local") === true &&
    registreLocalRequis("alpha") === false &&
    registreLocalRequis("10.0.0") === false,
);

// ── Le spécificateur npm ─────────────────────────────────────────────────────
cas(
  "le spécificateur porte l'étiquette",
  specifieur("nodefony", "beta") === "nodefony@beta",
);
cas(
  "le spécificateur porte la version exacte",
  specifieur("nodefony", "10.0.0-alpha.5") === "nodefony@10.0.0-alpha.5",
);
cas(
  "« local » se sert sous l'étiquette alpha — c'est le REGISTRE qui change",
  specifieur("nodefony", "local") === "nodefony@alpha",
);

// ── Le libellé du décor — ce qui entre dans l'empreinte ──────────────────────
// 🔴 La rétrocompatibilité est la règle la plus importante ici : les références
// déjà payées ont été mesurées en `depot` et ne portent pas ce mot. Les faire
// diverger d'un coup ferait refuser la comparaison sur TOUT le catalogue.
cas(
  "depot rend le libellé HISTORIQUE, mot pour mot",
  libelleDecor({
    source: "depot",
    canal: "alpha",
    lie: false,
    mcp: " · MCP eteint",
  }) === "isolé (tarballs, hors dépôt) · MCP eteint",
);
cas(
  "le canal n'apparaît PAS en source depot (il n'y veut rien dire)",
  !libelleDecor({
    source: "depot",
    canal: "10.0.0-alpha.5",
    lie: false,
    mcp: "",
  }).includes("10.0.0-alpha.5"),
);
cas(
  "registre NOMME sa version — sinon deux versions se compareraient",
  libelleDecor({
    source: "registre",
    canal: "beta",
    lie: false,
    mcp: " · MCP eteint",
  }) === "registre npm (beta) · MCP eteint",
);
cas(
  "deux canaux donnent deux décors DIFFÉRENTS",
  libelleDecor({ source: "registre", canal: "alpha", lie: false, mcp: "" }) !==
    libelleDecor({ source: "registre", canal: "beta", lie: false, mcp: "" }),
);
cas(
  "--link l'emporte sur la source (le décor est alors le checkout)",
  libelleDecor({ source: "registre", canal: "beta", lie: true, mcp: "" }) ===
    "lié au checkout (--link)",
);

// ── --prove : muter le vrai module, exiger que ce contrôle TOMBE ─────────────
if (PROVE) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "decor-source.mjs"), "utf8");
  const mutations = [
    {
      regle: "validation de la source",
      de: "  if (!SOURCES.includes(brut)) {",
      vers: "  if (false) {",
    },
    {
      regle: "validation du canal et de la version",
      de: "  if (!ETIQUETTES.includes(brut) && !VERSION_EXACTE.test(brut)) {",
      vers: "  if (false) {",
    },
    {
      // Sans la reconnaissance des versions exactes, une campagne ne se rejoue
      // plus : seules les étiquettes passeraient, et elles bougent.
      regle: "les versions exactes sont acceptées",
      de: "export const VERSION_EXACTE = /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/u;",
      vers: "export const VERSION_EXACTE = /^$/u;",
    },
    {
      // Si le libellé de `depot` change, TOUTES les références payées deviennent
      // incomparables d'un coup.
      regle: "le libellé historique de depot est préservé",
      de: '    : "isolé (tarballs, hors dépôt)";',
      vers: '    : "isolé (tarballs)";',
    },
    {
      // Si le canal n'entre pas dans le libellé, deux versions publiées
      // différentes se comparent comme si elles étaient la même mesure.
      regle: "le canal entre dans le décor en source registre",
      de: "      ? `registre npm (${canal})`",
      vers: '      ? "registre npm"',
    },
  ];

  console.log(
    "\n━━ --prove : mutation de chaque règle (le contrôle doit TOMBER)",
  );
  const moi = fileURLToPath(import.meta.url);
  for (const m of mutations) {
    if (!source.includes(m.de)) {
      rouges.push(
        `[--prove] ancre introuvable pour « ${m.regle} » — mutation MORTE`,
      );
      continue;
    }
    // La copie vit À CÔTÉ de l'original : ses imports relatifs doivent résoudre.
    const voisine = path.join(
      ici,
      `.prove-decor-source.${mutations.indexOf(m)}.mjs`,
    );
    writeFileSync(voisine, source.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [moi, "--module", voisine], {
      encoding: "utf8",
    });
    rmSync(voisine, { force: true });
    if (r.status === 0) {
      rouges.push(`[--prove] « ${m.regle} » mutée : RIEN n'est tombé`);
      console.log(`  ❌ ${m.regle} — le contrôle reste vert, il ne garde rien`);
    } else {
      verts += 1;
      console.log(`  ✅ ${m.regle} — le contrôle tombe`);
    }
  }
}

console.log(
  rouges.length === 0
    ? `✅ decor-source.selftest — ${verts} cas`
    : `❌ decor-source.selftest — ${rouges.length} écart(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
