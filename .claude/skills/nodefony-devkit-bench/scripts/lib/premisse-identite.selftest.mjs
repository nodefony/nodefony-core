#!/usr/bin/env node
/**
 * Auto-contrôle de la PRÉMISSE d'identité — la garde qui évite de payer un
 * agent pour un verdict qu'on sait d'avance ne pas pouvoir rendre.
 *
 * Deux familles de règles, et la seconde est celle qui rouvre la famille :
 *
 * 1. **le COMPORTEMENT** de la garde — elle écarte quand la session ne s'ouvre
 *    pas, elle laisse passer quand elle s'ouvre, et surtout elle rend le décor
 *    DANS L'ÉTAT OÙ ELLE L'A TROUVÉ. Les dépendances étant injectées, tout cela
 *    s'éprouve en une seconde, sans décor et sans agent.
 * 2. **l'EXHAUSTIVITÉ du marquage** — toute tâche dont le verdict passe par une
 *    session `admin` doit porter la garde. C'est LA règle qui manquait : la
 *    leçon avait été tirée sur une tâche et pas portée aux sept autres, et rien
 *    ne le disait. Elle se dérive du CODE des juges, jamais d'une liste écrite
 *    à la main — une liste se périme au premier juge ajouté.
 *
 *   node lib/premisse-identite.selftest.mjs
 *   node lib/premisse-identite.selftest.mjs --prove   # débranche : ce contrôle doit tomber
 *
 * Sorties : 0 les règles tiennent · 1 au moins une est muette.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./premisse-identite.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const { constaterPremisseIdentite } = await import(MODULE);

const defauts = [];
let regles = 0;

/**
 * @param {boolean} ok - la règle tient-elle ?
 * @param {string} regle - ce qui est éprouvé.
 * @param {string} preuve - ce qu'on a lu.
 */
function verifier(ok, regle, preuve) {
  regles += 1;
  if (!ok) defauts.push(`${regle} — ${preuve}`);
  console.log(`  ${ok ? "✅" : "❌"} ${regle}`);
}

/**
 * Un décor de pacotille : personne n'écoute, et chaque dépendance est un TÉMOIN
 * qui enregistre ce qu'on lui a demandé.
 *
 * @param {{constat: number, demarre?: boolean}} regime - le verdict de la
 *   constatation, et si le démarrage réussit.
 * @returns {object} le décor et son journal.
 */
function decorTemoin({ constat, demarre = true }) {
  const journal = [];
  return {
    journal,
    decor: {
      // Un dossier qui n'est pas une application : `appPortUnderTest` n'y
      // trouvera aucun état de runtime, donc « personne n'écoute pour nous ».
      app: ICI,
      port: 1,
      env: {},
      demarrer: () => {
        journal.push("demarrer");
        return demarre;
      },
      arreter: () => journal.push("arreter"),
      attendre: () => {
        journal.push("attendre");
        return true;
      },
      constater: () => {
        journal.push("constater");
        return {
          status: constat,
          sortie:
            constat === 0
              ? "DECOR=pose — session « admin » ouverte et cookie rejoué"
              : "DECOR=ABSENT — le compte « admin » n'ouvre pas de session",
        };
      },
    },
  };
}

// ── 1. Le comportement ─────────────────────────────────────────────────────
{
  const { decor, journal } = decorTemoin({ constat: 1 });
  const r = constaterPremisseIdentite(decor);
  verifier(
    r.ok === false,
    "session refusée ⇒ la prémisse TOMBE (la tâche ne sera pas jouée)",
    JSON.stringify(r),
  );
  verifier(
    r.detail.includes("DECOR=ABSENT"),
    "…et le motif de la sonde est RENDU, pas avalé",
    r.detail,
  );
  verifier(
    journal.join(">") === "demarrer>constater>arreter>attendre",
    "l'application démarrée par la garde est ARRÊTÉE, port attendu",
    journal.join(">"),
  );
}
{
  const { decor, journal } = decorTemoin({ constat: 0 });
  const r = constaterPremisseIdentite(decor);
  verifier(
    r.ok === true && r.detail.includes("DECOR=pose"),
    "session ouverte ⇒ la prémisse TIENT, et la provenance est dite",
    JSON.stringify(r),
  );
  verifier(
    journal.join(">") === "demarrer>constater>arreter>attendre",
    "…et le décor est quand même rendu à l'arrêt (rien ne reste en marche)",
    journal.join(">"),
  );
}
{
  // Le cas du régime `auth`, et de la tâche dont la prémisse a DÉJÀ démarré
  // l'application : la garde n'a rien démarré, elle ne doit rien arrêter.
  const { decor, journal } = decorTemoin({ constat: 0, demarre: false });
  const r = constaterPremisseIdentite(decor);
  verifier(
    r.demarreeIci === false && !journal.includes("arreter"),
    "une application que la garde n'a PAS démarrée n'est pas arrêtée",
    journal.join(">"),
  );
  verifier(
    r.ok === true,
    "…et le verdict reste celui de la constatation",
    String(r.ok),
  );
}

// ── 2. L'exhaustivité du marquage ──────────────────────────────────────────
// Dérivée du CODE : une tâche dont un juge emploie l'identité `admin` doit
// porter `premisseIdentiteAdmin`. La tâche 34 est la seule exception admise —
// elle porte sa propre garde de décor, plus exigeante (elle relit aussi les
// comptes externes), appelée dans son `prepare`.
const { TASKS } = await import("../bench-discoverability.mjs");
const { fichiersDuVerdict } = await import("./reference.mjs");

/** Ce juge ouvre-t-il une session « admin » ? Lu dans SON source. */
const emploieAdmin = (nom) => {
  const f = path.join(ICI, nom);
  if (!existsSync(f)) return false;
  const src = readFileSync(f, "utf8");
  return (
    /from "\.\/identites\.mjs"/u.test(src) &&
    /\bADMIN\b|etablirIdentites/u.test(src)
  );
};

const attendues = [];
const marquees = [];
for (const t of TASKS) {
  if (t.premisseIdentiteAdmin === true) marquees.push(t.id);
  // Une tâche en décor VIDE n'a RIEN à interroger : l'application n'existe pas
  // encore, c'est l'agent qui la crée. La garde ne s'y applique pas, et le
  // lanceur l'écarte par la même condition.
  if (t.decor === "vide") continue;
  if (fichiersDuVerdict(t).some((nom) => emploieAdmin(nom)))
    attendues.push(t.id);
}
const GARDE_PROPRE = 34;
const manquantes = attendues.filter(
  (id) => id !== GARDE_PROPRE && !marquees.includes(id),
);
const superflues = marquees.filter((id) => !attendues.includes(id));

verifier(
  attendues.length >= 8,
  `la dérivation TROUVE les juges qui emploient « admin » (${attendues.length})`,
  `tâches : ${attendues.join(", ")}`,
);
verifier(
  manquantes.length === 0,
  "toute tâche jugée depuis une session « admin » porte la garde de prémisse",
  `sans garde : ${manquantes.join(", ")}`,
);
verifier(
  superflues.length === 0,
  "…et aucune tâche ne paie un démarrage dont son verdict n'a pas besoin",
  `marquées pour rien : ${superflues.join(", ")}`,
);

for (const d of defauts) console.log(`     ${d}`);
console.log(
  defauts.length === 0
    ? `\n━━ ${regles}/${regles} : la prémisse écarte avant de payer, et ` +
        `${marquees.length} tâche(s) + la garde propre de la ${GARDE_PROPRE} la portent`
    : `\n━━ ${defauts.length} règle(s) en défaut`,
);

// ── Preuve négative ────────────────────────────────────────────────────────
if (process.argv.includes("--prove")) {
  console.log("\n🔬 débranchement — ces règles doivent tomber");
  const source = readFileSync(path.join(ICI, "premisse-identite.mjs"), "utf8");
  const mutations = [
    {
      regle: "la garde ne regarde plus le verdict de la constatation",
      de: "    ok: c.status === 0,",
      vers: "    ok: true,",
    },
    {
      regle: "l'application démarrée par la garde reste EN MARCHE",
      de: "  if (demarreeIci) {\n    arreter(app, env);",
      vers: "  if (false) {\n    arreter(app, env);",
    },
    {
      regle: "le motif de la sonde est avalé (un rouge muet)",
      de: '    detail: (c.sortie ?? "").trim()',
      vers: '    detail: "".trim()',
    },
  ];
  let muets = 0;
  for (const [i, m] of mutations.entries()) {
    if (!source.includes(m.de)) {
      console.log(
        `  ⚠️ ${m.regle} — ancre introuvable, DÉBRANCHEMENT NON FAIT`,
      );
      muets += 1;
      continue;
    }
    // La copie mutée vit À CÔTÉ de ses voisins : elle importe `http-probe.mjs`
    // et `exec-portable.mjs` en relatif, et une copie isolée tomberait sur un
    // module introuvable — un rouge qui ne dirait rien de la règle mutée.
    const copie = path.join(ICI, `premisse-identite-prove-${i}.tmp.mjs`);
    writeFileSync(copie, source.replace(m.de, m.vers));
    let r;
    try {
      r = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--module", copie],
        { encoding: "utf8" },
      );
    } finally {
      rmSync(copie, { force: true });
    }
    const mord = r.status === 1;
    if (!mord) muets += 1;
    console.log(
      `  ${mord ? "✅" : "❌"} ${m.regle} → ce contrôle sort ${r.status}` +
        (mord ? "" : "  (IL NE MORD PAS)"),
    );
  }
  // Le marquage se débranche sur la TÂCHE, pas sur le module : on retire la
  // garde d'une tâche et l'on exige que la dérivation la redemande.
  {
    const lanceur = path.join(ICI, "..", "bench-discoverability.mjs");
    const avant = readFileSync(lanceur, "utf8");
    const cible = "    premisseIdentiteAdmin: true,\n";
    if (!avant.includes(cible)) {
      console.log("  ⚠️ marquage — ancre introuvable, DÉBRANCHEMENT NON FAIT");
      muets += 1;
    } else {
      writeFileSync(lanceur, avant.replace(cible, ""));
      let r;
      try {
        r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
          encoding: "utf8",
        });
      } finally {
        writeFileSync(lanceur, avant);
      }
      const mord = r.status === 1;
      if (!mord) muets += 1;
      console.log(
        `  ${mord ? "✅" : "❌"} une tâche PERD sa garde de prémisse → ce ` +
          `contrôle sort ${r.status}` +
          (mord ? "" : "  (IL NE MORD PAS)"),
      );
    }
  }
  console.log(
    muets === 0
      ? `━━ les ${mutations.length + 1} règles sont VUES rouges quand on les débranche`
      : `━━ ${muets} règle(s) NON PROUVÉE(S)`,
  );
  process.exit(defauts.length || muets ? 1 : 0);
}

process.exit(defauts.length ? 1 : 0);
