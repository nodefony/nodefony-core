#!/usr/bin/env node
/**
 * Auto-contrôle du juge « vérificateur du framework ».
 *
 * Ce qu'il éprouve, et pourquoi chaque cas existe :
 *
 *  1. les trois issues se DISTINGUENT — conforme, manquement, instrument. La
 *     confusion des deux dernières est le défaut coûteux : `doctor-illisible`
 *     est imputé au DÉCOR, `doctor-manquement` à l'AGENT. Les mélanger
 *     condamne l'agent pour une panne d'outil, ou l'acquitte d'une vraie faute.
 *  2. la collecte traverse les SECTIONS — c'est le seul point que le juge ne
 *     pouvait pas voir de lui-même : un rapport range presque tous ses constats
 *     sous `freshness`, `readiness`, `wiring`… et n'en garde presque jamais à
 *     la racine. Un juge qui ne lirait que la racine rendrait « sort en 1 sans
 *     nommer de constat » sur un rapport qui en porte cinq.
 *  3. la CAUSE tient sur UNE ligne — `lireCause` lit une ligne. Un message de
 *     `doctor` qui en compte trois casserait le contrat en silence : la cause
 *     serait tronquée à sa première ligne, souvent la moins parlante.
 *  4. le rapport reste borné — un document cyclique ne doit pas faire tourner
 *     le juge à l'infini pendant une nuit de banc.
 *
 * Aucune application n'est montée : le contrôle appelle `analyser`, jamais une
 * copie de sa règle.
 *
 *   node gate-doctor.selftest.mjs
 *   node gate-doctor.selftest.mjs --prove   # règle amputée : des cas DOIVENT tomber
 *
 * Sorties : 0 tout est distingué · 1 au moins un défaut.
 */
import { analyser, tousLesConstats } from "./gate-doctor.mjs";

const PROVE = process.argv.includes("--prove");

/**
 * La règle AMPUTÉE : elle ne lit que la racine du rapport.
 *
 * C'est exactement le juge qu'on aurait écrit en énumérant les sections à la
 * main, puis en oubliant d'en ajouter une. Sous `--prove`, elle remplace la
 * vraie : les cas qui tiennent la traversée DOIVENT tomber, sinon ils ne
 * gardaient rien.
 *
 * @param {{status: number|null, stdout: string, stderr: string}} execution
 * @returns {{code: number, cause: string, details: string[]}}
 */
function analyserAmputee({ status, stdout, stderr }) {
  if (status === 0) {
    return { code: 0, cause: "ok", details: [] };
  }
  let rapport;
  try {
    rapport = JSON.parse(stdout ?? "");
  } catch {
    return {
      code: 2,
      cause: `CAUSE=doctor-illisible — ${stderr}`,
      details: [],
    };
  }
  const racine = Array.isArray(rapport.findings) ? rapport.findings : [];
  if (racine.length === 0) {
    return {
      code: 1,
      cause: `CAUSE=doctor-manquement — le vérificateur sort en ${status} sans nommer de constat`,
      details: [],
    };
  }
  return {
    code: 1,
    cause: `CAUSE=doctor-manquement — racine/${racine[0].kind} : ${racine[0].message}`,
    details: [],
  };
}

const juger = PROVE ? analyserAmputee : analyser;
const rates = [];

/**
 * @param {string} label - ce que le cas garde.
 * @param {boolean} ok - le verdict du cas.
 */
const verifier = (label, ok) => {
  if (!ok) rates.push(label);
};

// ── 1. Conforme ─────────────────────────────────────────────────────────────
{
  const v = juger({ status: 0, stdout: "", stderr: "" });
  verifier("un verdict conforme sort en 0", v.code === 0);
  verifier(
    "un verdict conforme ne nomme AUCUNE cause",
    !v.cause.includes("CAUSE="),
  );
}

// ── 2. L'instrument a lâché — imputé au DÉCOR ───────────────────────────────
{
  const v = juger({
    status: 1,
    stdout: "",
    stderr: 'npm error Missing script: "doctor"',
  });
  verifier("une sortie non-JSON sort en 2, pas en 1", v.code === 2);
  verifier(
    "… et se nomme doctor-illisible",
    v.cause.includes("CAUSE=doctor-illisible"),
  );
  verifier(
    "… en citant ce que l'outil a dit, sinon on rouvre le décor pour rien",
    v.cause.includes("Missing script"),
  );
}
{
  const v = juger({ status: 127, stdout: "", stderr: "" });
  verifier(
    "une sortie VIDE le dit, plutôt que de rendre une cause creuse",
    v.code === 2 && v.cause.includes("sortie vide"),
  );
}

// ── 3. Un manquement nommé — imputé à l'AGENT ───────────────────────────────
{
  const rapport = {
    findings: [
      { kind: "dep-absente", message: "le paquet X n'est pas déclaré" },
    ],
  };
  const v = juger({ status: 1, stdout: JSON.stringify(rapport), stderr: "" });
  verifier("un manquement sort en 1", v.code === 1);
  verifier(
    "… se nomme doctor-manquement",
    v.cause.includes("CAUSE=doctor-manquement"),
  );
  verifier(
    "… et NOMME le constat",
    v.cause.includes("dep-absente") &&
      v.cause.includes("le paquet X n'est pas déclaré"),
  );
}

// ── 4. 🔴 La traversée des SECTIONS — le cas que `--prove` fait tomber ──────
{
  const rapport = {
    findings: [],
    freshness: {
      findings: [
        {
          kind: "dist-stale",
          message: "des sources ont changé APRÈS le build",
        },
      ],
    },
  };
  const v = juger({ status: 1, stdout: JSON.stringify(rapport), stderr: "" });
  verifier(
    "un constat rangé dans une SECTION est trouvé — pas seulement à la racine",
    v.cause.includes("freshness/dist-stale"),
  );
}
{
  const rapport = {
    wiring: { findings: [{ kind: "a", message: "premier" }] },
    surface: { findings: [{ kind: "b", message: "deuxième" }] },
    deep: { nested: { findings: [{ kind: "c", message: "troisième" }] } },
  };
  const v = juger({ status: 1, stdout: JSON.stringify(rapport), stderr: "" });
  verifier(
    "les constats de PLUSIEURS sections sont comptés",
    v.cause.includes("2 autre(s)"),
  );
  verifier(
    "… et les suivants sont rendus, un par ligne",
    v.details.length === 2,
  );
}

// ── 5. Le contrat `CAUSE=` — UNE ligne ──────────────────────────────────────
{
  const rapport = {
    findings: [
      { kind: "multi", message: "première ligne\ndeuxième ligne\n  troisième" },
    ],
  };
  const v = juger({ status: 1, stdout: JSON.stringify(rapport), stderr: "" });
  verifier(
    "un message multiligne est APLATI — `lireCause` ne lit qu'une ligne",
    !v.cause.includes("\n") &&
      v.cause.includes("première ligne deuxième ligne troisième"),
  );
}

// ── 6. Sortie non nulle sans aucun constat ──────────────────────────────────
{
  const v = juger({
    status: 1,
    stdout: JSON.stringify({ root: "/x" }),
    stderr: "",
  });
  verifier(
    "un rouge sans constat reste opposable et le DIT",
    v.code === 1 && v.cause.includes("sans nommer de constat"),
  );
}

// ── 7. La borne de profondeur (la règle pure, hors amputation) ──────────────
{
  const cyclique = { findings: [] };
  cyclique.self = cyclique;
  let fini = false;
  try {
    tousLesConstats(cyclique);
    fini = true;
  } catch {
    fini = false;
  }
  verifier("un rapport CYCLIQUE ne fait pas tourner le juge sans fin", fini);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const CAS_QUE_L_AMPUTATION_DOIT_FAIRE_TOMBER = [
  "un constat rangé dans une SECTION est trouvé — pas seulement à la racine",
  "les constats de PLUSIEURS sections sont comptés",
];

if (PROVE) {
  const manques = CAS_QUE_L_AMPUTATION_DOIT_FAIRE_TOMBER.filter(
    (c) => !rates.includes(c),
  );
  if (manques.length > 0) {
    console.error(
      `✗ règle amputée et pourtant VERTE sur ${manques.length} cas — ils ne gardent rien :`,
    );
    for (const m of manques) console.error(`    · ${m}`);
    process.exit(1);
  }
  console.log(
    `✓ amputation vérifiée sur ${CAS_QUE_L_AMPUTATION_DOIT_FAIRE_TOMBER.length} cas ` +
      `(la traversée des sections)`,
  );
  process.exit(0);
}

if (rates.length > 0) {
  console.error(`✗ ${rates.length} cas non tenu(s) par le juge :`);
  for (const r of rates) console.error(`    · ${r}`);
  process.exit(1);
}
console.log("✓ juge du vérificateur — 14 cas, les trois issues se distinguent");
process.exit(0);
