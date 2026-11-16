/**
 * Auto-contrôle du diagnostic des canaux vers `AGENTS.md` (`canaux-agents-md.mjs`).
 *
 * Les formes ci-dessous sont celles des journaux RÉELS : l'`init` de Claude
 * (`-p --output-format stream-json`) et le `system.message` de Copilot
 * (`~/.copilot/session-state/<id>/events.jsonl`, run de référence de #785).
 * La consigne est relue dans le gabarit de `create.ts` : si le produit la
 * reformule, ce contrôle tombe au lieu de déclarer « jamais reçue » à tort.
 *
 * `--prove` mute le vrai module et exige que ce contrôle TOMBE.
 *
 * Usage : `node lib/canaux-agents-md.selftest.mjs [--prove]`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE = !process.argv.includes("--module")
  ? "./canaux-agents-md.mjs"
  : // Une URL, pas un chemin : `import("C:\\…")` lève sous Windows.
    pathToFileURL(
      path.resolve(process.argv[process.argv.indexOf("--module") + 1]),
    ).href;
const { CONSIGNE_CREATE_APP, skillsAnnonces, canauxAgentsMd } = await import(
  MODULE
);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PROVE =
  process.argv.includes("--prove") && MODULE === "./canaux-agents-md.mjs";
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

const INIT_CLAUDE = JSON.stringify({
  type: "system",
  subtype: "init",
  tools: ["Bash", "Skill"],
  skills: ["nodefony-dev", "nodefony-add-crud", "update-config"],
});
const SYSTEME_COPILOT_SANS = JSON.stringify({
  type: "system.message",
  data: { content: "<skills><skill>customize-cloud-agent</skill></skills>" },
});
const SORTIE_AVEC = JSON.stringify({
  type: "tool.execution_complete",
  data: {
    result: {
      content: "✓ app créée\nPour ton agent — lis AGENTS.md AVANT d'écrire…",
    },
  },
});

// ── Le produit imprime bien ce que le banc cherche ───────────────────────────
{
  const createTs = readFileSync(
    path.join(
      ICI,
      "..",
      "..",
      "..",
      "..",
      "..",
      "src/nodefony/src/cli/create.ts",
    ),
    "utf8",
  );
  // Le gabarit écrit `lis ${agents}` : on rend la forme imprimée pour `.`.
  const imprime = createTs.replaceAll("${agents}", "AGENTS.md");
  cas(
    "la consigne de create.ts est reconnue (le produit n'a pas reformulé)",
    CONSIGNE_CREATE_APP.test(imprime),
  );
}

// ── Les skills annoncés, par harness ─────────────────────────────────────────
cas(
  "Claude : les nodefony-* de l'init sont comptés",
  skillsAnnonces(INIT_CLAUDE) === 2,
);
cas(
  "Copilot : un message système sans nodefony-* compte ZÉRO",
  skillsAnnonces(SYSTEME_COPILOT_SANS) === 0,
);
cas(
  "aucun événement de démarrage : non lisible, jamais zéro",
  skillsAnnonces(SORTIE_AVEC) === null,
);
cas(
  "un nodefony-* cité dans un AUTRE événement système (notification) ne compte pas",
  skillsAnnonces(
    `${SYSTEME_COPILOT_SANS}\n${JSON.stringify({ type: "system.notification", data: { content: "skill nodefony-dev chargé" } })}`,
  ) === 0,
);

// ── Le diagnostic en une ligne — le cas réel de #785 ─────────────────────────
cas(
  "le run de #785 : consigne jamais reçue, aucun skill",
  canauxAgentsMd(SYSTEME_COPILOT_SANS) ===
    "canaux : consigne de create app JAMAIS reçue · AUCUN skill nodefony-* annoncé au démarrage",
);
cas(
  "consigne reçue et skills annoncés : les deux le disent",
  canauxAgentsMd(`${INIT_CLAUDE}\n${SORTIE_AVEC}`) ===
    "canaux : consigne de create app REÇUE · 2 skill(s) nodefony-* annoncé(s) au démarrage",
);

// ── --prove : muter le vrai module, exiger que ce contrôle TOMBE ─────────────
if (PROVE) {
  const source = readFileSync(path.join(ICI, "canaux-agents-md.mjs"), "utf8");
  const mutations = [
    {
      // Compter les nodefony-* de tout le journal ferait passer pour « annoncé »
      // un skill que l'agent a seulement lu dans un fichier.
      regle: "seul l'événement de démarrage compte",
      de: "    if (porteur === null) continue;",
      vers: "    if (porteur === null) {\n      vu = true;\n      for (const m of ligne.matchAll(/nodefony-[a-z0-9-]+/gu)) noms.add(m[0]);\n      continue;\n    }",
    },
    {
      // Un harness illisible rendu en « zéro » accuserait la découverte des
      // skills d'un défaut qu'on n'a pas pu observer.
      regle: "illisible ne vaut pas zéro",
      de: "  return vu ? noms.size : null;",
      vers: "  return noms.size;",
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
    const voisine = path.join(
      ICI,
      `.prove-canaux-agents-md.${mutations.indexOf(m)}.mjs`,
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
    ? `✅ canaux-agents-md.selftest — ${verts} cas`
    : `❌ canaux-agents-md.selftest — ${rouges.length} écart(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
