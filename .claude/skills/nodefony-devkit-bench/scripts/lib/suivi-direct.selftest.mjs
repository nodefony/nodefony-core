/**
 * Auto-contrôle du suivi EN DIRECT (`suivi-direct.mjs`, lu par `suivre-run.mjs`).
 *
 * La règle éprouvée : un ÉCHEC s'affiche avec la commande qui l'a produit, même
 * quand le filtre a écarté l'appel — vécu sur un journal Copilot (#785), où le
 * suivi n'affichait que `✗ exit 128`. Les événements ci-dessous ont la forme
 * RÉELLE de `~/.copilot/session-state/<id>/events.jsonl`, texte de fin compris.
 *
 * `--prove` mute le vrai module et exige que ce contrôle TOMBE.
 *
 * Usage : `node lib/suivi-direct.selftest.mjs [--prove]`
 * Sorties : `0` toutes les règles tiennent · `1` au moins un écart.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE = !process.argv.includes("--module")
  ? "./suivi-direct.mjs"
  : // Une URL, pas un chemin : `import("C:\\…")` lève sous Windows.
    pathToFileURL(
      path.resolve(process.argv[process.argv.indexOf("--module") + 1]),
    ).href;
const { lecteurDeGestes } = await import(MODULE);

const PROVE =
  process.argv.includes("--prove") && MODULE === "./suivi-direct.mjs";
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

/** Un appel `bash` Copilot, forme réelle. */
const appel = (id, command) =>
  JSON.stringify({
    type: "tool.execution_start",
    data: {
      toolCallId: id,
      toolName: "bash",
      arguments: { command, description: "…" },
    },
    timestamp: "2026-11-16T17:27:35.110Z",
  });

/** Sa fin, forme réelle : le code n'est que dans le TEXTE de la sortie. */
const fin = (id, exitCode) =>
  JSON.stringify({
    type: "tool.execution_complete",
    data: {
      toolCallId: id,
      success: true,
      shellExecution: { exitCode },
      result: {
        content: `sortie…\n<shellId: 44 completed with exit code ${exitCode}>`,
      },
    },
    timestamp: "2026-11-16T17:27:36.110Z",
  });

/** Rejoue des lignes dans un lecteur NEUF, rend tout ce qu'il affiche. */
function rejouer(lignes, options) {
  const lire = lecteurDeGestes("copilot", options);
  return lignes.flatMap((l) => lire(l));
}

// ── L'échec porte SA commande, même si l'appel a été filtré ──────────────────
{
  // `git status` n'est pas « intéressant » : l'appel ne s'affiche pas. Son
  // échec, lui, doit dire de quoi il s'agit — c'est tout le défaut vécu.
  const out = rejouer([
    appel("c1", "pwd && git status --short"),
    fin("c1", 128),
  ]);
  cas("l'appel filtré ne s'affiche pas", out.length === 1);
  cas(
    "l'échec nomme la commande de SON appel",
    out[0] === "    ✗ exit 128 · bash · pwd && git status --short",
  );
}

// ── Deux appels en vol : chaque fin retrouve le sien, pas le dernier ─────────
{
  const out = rejouer([
    appel("a", "npm run typecheck"),
    appel("b", "npm run lint"),
    fin("b", 1),
    fin("a", 2),
  ]);
  cas(
    "les fins entrelacées sont reliées par identifiant",
    out.join("\n") ===
      "    ✗ exit 1 · bash · npm run lint\n    ✗ exit 2 · bash · npm run typecheck",
  );
}

// ── Un succès ne s'affiche pas ; une fin sans appel lu le DIT ────────────────
cas(
  "un exit 0 n'affiche rien",
  rejouer([appel("s", "ls"), fin("s", 0)]).length === 0,
);
cas(
  "une fin dont l'appel n'a pas été lu le dit, au lieu de se taire",
  rejouer([fin("x", 64)])[0] === "    ✗ exit 64 · (appel non lu)",
);

// ── Un appel « intéressant » s'affiche toujours ──────────────────────────────
cas(
  "une commande du framework s'affiche à l'appel",
  rejouer([appel("n", "npx nodefony doctor")])[0] ===
    "  bash · npx nodefony doctor",
);

// ── --prove : muter le vrai module, exiger que ce contrôle TOMBE ─────────────
if (PROVE) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "suivi-direct.mjs"), "utf8");
  const mutations = [
    {
      // Le défaut vécu : l'échec orphelin.
      regle: "l'échec est relié à son appel",
      de: "const appel = g.id == null ? undefined : ouverts.get(g.id);",
      vers: "const appel = undefined;",
    },
    {
      // Ne mémoriser l'appel QUE s'il est affiché rendrait orphelins tous les
      // échecs des commandes filtrées — c'est-à-dire presque tous.
      regle: "l'appel est retenu même quand il est filtré",
      de: "if (g.id != null) ouverts.set(g.id, { outil: g.outil, arg: g.arg });",
      vers: "",
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
      `.prove-suivi-direct.${mutations.indexOf(m)}.mjs`,
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
    ? `✅ suivi-direct.selftest — ${verts} cas`
    : `❌ suivi-direct.selftest — ${rouges.length} écart(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
