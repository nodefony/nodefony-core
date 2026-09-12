/**
 * Auto-contrôle du socle de la tâche 0.
 *
 * `--prove` ampute les règles une à une et EXIGE que des cas tombent : un
 * auto-contrôle qu'on n'a jamais vu échouer ne prouve rien. Les mutations
 * visent ce qui a déjà coûté un faux verdict ailleurs dans ce banc — supposer
 * un chemin, lire une plage de version au lieu de la version résolue, laisser
 * `node_modules` entrer dans une recherche.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Le module éprouvé est paramétrable : `--prove` relance CE MÊME fichier sur
// des copies mutées. Une seule liste de cas, donc — la faire diverger ferait
// « prouver » à la mutation un contrôle qui n'est pas celui qu'on exécute.
// Même patron que `reference.selftest.mjs` : une règle, une implémentation.
const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./tache-zero.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  canalDe,
  commandeCreation,
  resoudreAppGeneree,
  versionInstallee,
  situerTours,
  REFERENCE_CONCURRENTE,
} = await import(MODULE);

const PROVE = process.argv.includes("--prove") && MODULE === "./tache-zero.mjs";
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
 * Un faux système de fichiers — l'injection rend la règle éprouvable sans décor.
 *
 * @param {Record<string, object|null>} paquets - chemin → package.json (ou null).
 * @param {Record<string, string[]>} dossiers - chemin → sous-dossiers.
 */
function io(paquets, dossiers = {}) {
  return {
    lirePackage: (d) => paquets[d] ?? null,
    listerDossiers: (d) => dossiers[d] ?? [],
  };
}

// ── canalDe ──────────────────────────────────────────────────────────────────
cas("canal par défaut = alpha", canalDe({}) === "alpha");
cas(
  "canal explicite respecté",
  canalDe({ NF_DEVKIT_BENCH_CANAL: "latest" }) === "latest",
);
{
  // Un canal mal orthographié servirait la version 7 depuis npm, en silence.
  let leve = false;
  try {
    canalDe({ NF_DEVKIT_BENCH_CANAL: "aplha" });
  } catch {
    leve = true;
  }
  cas("un canal inconnu LÈVE (sinon npm sert la version 7)", leve);
}

// ── commandeCreation ─────────────────────────────────────────────────────────
cas(
  "la commande porte le canal",
  commandeCreation("alpha") === "npm create nodefony@alpha" &&
    commandeCreation("latest") === "npm create nodefony@latest",
);

// ── resoudreAppGeneree ───────────────────────────────────────────────────────
const APP = { dependencies: { nodefony: "10.0.0-alpha.5" } };

cas(
  "app créée dans un SOUS-dossier au nom libre",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide/ma-messagerie": APP }, { "/vide": ["ma-messagerie"] }),
    );
    return r.ok && r.dir === "/vide/ma-messagerie";
  })(),
);

cas(
  "app créée DANS le dossier courant (--dir .)",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide": APP }, { "/vide": [] }),
    );
    return r.ok && r.dir === "/vide";
  })(),
);

cas(
  "aucune application ⇒ cause nommée, pas une exception",
  (() => {
    const r = resoudreAppGeneree("/vide", io({}, { "/vide": ["notes"] }));
    return !r.ok && r.cause === "aucune-application";
  })(),
);

cas(
  "deux candidats ⇒ NON jugée plutôt que devinée",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide/a": APP, "/vide/b": APP }, { "/vide": ["a", "b"] }),
    );
    return !r.ok && r.cause === "application-ambigue";
  })(),
);

cas(
  "node_modules ne peut pas passer pour l'application",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/node_modules": APP, "/vide/app": APP },
        { "/vide": ["node_modules", "app"] },
      ),
    );
    return r.ok && r.dir === "/vide/app";
  })(),
);

cas(
  "un dossier caché n'est pas un candidat",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/.cache": APP, "/vide/app": APP },
        { "/vide": [".cache", "app"] },
      ),
    );
    return r.ok && r.dir === "/vide/app";
  })(),
);

cas(
  "une dépendance en devDependencies compte aussi",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/app": { devDependencies: { nodefony: "10.0.0" } } },
        { "/vide": ["app"] },
      ),
    );
    return r.ok;
  })(),
);

// ── versionInstallee ─────────────────────────────────────────────────────────
cas(
  "version RÉSOLUE lue dans node_modules, pas la plage du manifeste",
  versionInstallee(
    "/app",
    io({
      "/app": { dependencies: { nodefony: "^10.0.0-alpha.5" } },
      "/app/node_modules/nodefony": { version: "10.0.0-alpha.5" },
    }),
  ) === "10.0.0-alpha.5",
);

cas(
  "version illisible ⇒ null, jamais une plage",
  versionInstallee(
    "/app",
    io({ "/app": { dependencies: { nodefony: "^10.0.0" } } }),
  ) === null,
);

// ── situerTours ──────────────────────────────────────────────────────────────
cas(
  "moins de tours que le concurrent se lit « MOINS »",
  situerTours(43).lecture.includes("MOINS"),
);
cas("plus de tours se lit « PLUS »", situerTours(120).lecture.includes("PLUS"));
cas(
  "la réserve accompagne TOUJOURS la comparaison",
  situerTours(43).lecture.includes("assistée") ||
    situerTours(43).lecture.includes("ASSISTÉE"),
);
cas(
  "tours non mesurés ⇒ pas de verdict inventé",
  situerTours(null).ecart === null,
);
cas(
  "la référence porte sa réserve et son transcript",
  REFERENCE_CONCURRENTE.relancesHumaines === 4 &&
    REFERENCE_CONCURRENTE.transcript.endsWith(".jsonl"),
);

// ── --prove : MUTER le vrai module, et exiger que ce contrôle TOMBE ─────────
// Les mutations s'appliquent à une COPIE dans un répertoire temporaire : muter
// le fichier du dépôt le laisserait cassé à la première interruption.
if (PROVE) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "tache-zero.mjs"), "utf8");
  const mutations = [
    {
      // L'état exact d'un juge naïf : `node_modules` porte des centaines de
      // `package.json` dépendant de `nodefony` — le premier venu passerait pour
      // l'application de l'agent.
      regle: "node_modules et dossiers cachés écartés",
      de: '    if (sous === "node_modules" || sous.startsWith(".")) continue;\n',
      vers: "",
    },
    {
      // Deviner entre deux candidats, c'est juger le mauvais dossier — et le
      // verdict aurait l'aplomb d'une mesure.
      regle: "refus de trancher entre deux candidats",
      de: "  if (candidats.length > 1) {",
      vers: "  if (false) {",
    },
    {
      // Un canal mal orthographié sert la version 7 depuis npm, en silence.
      regle: "validation du canal",
      de: "  if (!CANAUX.includes(brut)) {",
      vers: "  if (false) {",
    },
    {
      // Lire la plage du manifeste au lieu de la version résolue ferait
      // comparer deux runs séparés par une publication.
      regle: "version RÉSOLUE, pas la plage déclarée",
      de: "  const pkg = io.lirePackage(`${appDir}/node_modules/nodefony`);",
      vers: "  const pkg = io.lirePackage(appDir);",
    },
    {
      // Sans la réserve, la comparaison surestime le concurrent : ses 86 tours
      // sont ASSISTÉS de 4 relances humaines.
      regle: "la réserve accompagne la comparaison des tours",
      de: "    lecture: `${lecture} (${REFERENCE_CONCURRENTE.reserve})`,",
      vers: "    lecture,",
    },
  ];

  console.log(
    "\n━━ --prove : mutation de chaque règle (le contrôle doit TOMBER)",
  );
  const tmp = mkdtempSync(path.join(os.tmpdir(), "tz-prove-"));
  const moi = fileURLToPath(import.meta.url);
  for (const m of mutations) {
    if (!source.includes(m.de)) {
      rouges.push(
        `[--prove] ancre introuvable pour « ${m.regle} » — mutation MORTE`,
      );
      continue;
    }
    const copie = path.join(tmp, `tache-zero.${mutations.indexOf(m)}.mjs`);
    writeFileSync(copie, source.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [moi, "--module", copie], {
      encoding: "utf8",
    });
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
    ? `✅ tache-zero.selftest — ${verts} cas${PROVE ? " (dont les amputations)" : ""}`
    : `❌ tache-zero.selftest — ${rouges.length} rouge(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
