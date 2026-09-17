#!/usr/bin/env node
/**
 * Auto-contrôle de la règle « d'où vient le journal de cet agent ».
 *
 * Il tourne sans agent installé, sans dossier de session et sans attendre qu'un
 * run de vingt minutes se termine : la liste des journaux et l'instant du
 * lancement sont des ARGUMENTS. C'est ce qui permet d'éprouver le cas qui a
 * coûté cher — un journal ANTÉRIEUR au run, qui appartient à quelqu'un d'autre —
 * sans le fabriquer sur le disque de celui qui lance le banc.
 *
 * `--prove` ampute la règle et exige que les cas tombent : une sonde qui reste
 * verte débranchée n'éprouve rien.
 *
 * Usage :
 *   node lib/journal-source.selftest.mjs
 *   node lib/journal-source.selftest.mjs --prove
 */
import {
  JOURNAUX_HORS_STDOUT,
  capturerJournal,
  choisirJournal,
  provenanceLisible,
} from "./journal-source.mjs";

/** Un disque de banc : ce qu'on lui donne, et rien d'autre. */
const disque = (arbre, home = "/home/x") => ({
  home,
  // La règle de choix suit la MUTATION : sinon les cas qui passent par
  // `capturerJournal` resteraient verts débranchés, et leur vert ne dirait rien.
  choisir: regle,
  existe: (p) => Object.hasOwn(arbre, p),
  listeDossiers: (p) =>
    Object.keys(arbre)
      .filter((f) => f.startsWith(`${p}/`))
      .map((f) => f.slice(p.length + 1).split("/")[0])
      .filter((v, i, a) => a.indexOf(v) === i),
  mtimeMs: (p) => arbre[p].mtimeMs,
  lire: (p) => arbre[p].contenu,
});

const PROVE = process.argv.includes("--prove");

/**
 * La règle AMPUTÉE — « prends le plus récent », sans regarder le début du run.
 * C'est la version naïve qu'on écrit spontanément, et elle ramasse la session
 * précédente de l'utilisateur en la faisant passer pour le résultat du banc.
 *
 * @param {{path: string, mtimeMs: number}[]} candidats - les journaux trouvés.
 * @returns {{path: string}|{path: null, raison: string}} le choix naïf.
 */
const debranchee = (candidats) =>
  candidats.length === 0
    ? { path: null, raison: "vide" }
    : {
        path: candidats.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a)).path,
      };

const regle = PROVE ? debranchee : choisirJournal;

const T0 = 1_000_000;

const cas = [
  {
    quoi: "un journal touché PENDANT le run est retenu",
    calcul: () =>
      regle([{ path: "/s/run/events.jsonl", mtimeMs: T0 + 50 }], T0).path,
    attendu: "/s/run/events.jsonl",
  },
  {
    quoi: "un journal ANTÉRIEUR au run est REFUSÉ (session d'un autre travail)",
    calcul: () =>
      regle([{ path: "/s/avant/events.jsonl", mtimeMs: T0 - 5000 }], T0).path,
    attendu: null,
  },
  {
    quoi: "entre deux journaux du run, le plus récent gagne",
    calcul: () =>
      regle(
        [
          { path: "/s/a/events.jsonl", mtimeMs: T0 + 10 },
          { path: "/s/b/events.jsonl", mtimeMs: T0 + 900 },
        ],
        T0,
      ).path,
    attendu: "/s/b/events.jsonl",
  },
  {
    quoi: "un journal du run gagne sur un journal ANTÉRIEUR plus gros/plus vieux",
    calcul: () =>
      regle(
        [
          { path: "/s/vieux/events.jsonl", mtimeMs: T0 - 99_999 },
          { path: "/s/nous/events.jsonl", mtimeMs: T0 + 1 },
        ],
        T0,
      ).path,
    attendu: "/s/nous/events.jsonl",
  },
  {
    quoi: "un journal pile à l'instant du lancement compte (la borne est inclusive)",
    calcul: () =>
      regle([{ path: "/s/pile/events.jsonl", mtimeMs: T0 }], T0).path,
    attendu: "/s/pile/events.jsonl",
  },
  {
    quoi: "aucun candidat → aucun chemin, et une raison",
    calcul: () => regle([], T0).path,
    attendu: null,
  },
  {
    quoi: "un refus DIT pourquoi — jamais un silence",
    calcul: () =>
      typeof regle([{ path: "/s/avant/events.jsonl", mtimeMs: T0 - 1 }], T0)
        .raison === "string",
    attendu: true,
  },
  {
    quoi: "un agent hors table lit sa sortie standard",
    calcul: () => provenanceLisible("claude", "/home/x"),
    attendu: "sortie standard du processus",
  },
  {
    quoi: "copilot déclare un journal HORS sortie standard",
    calcul: () => provenanceLisible("copilot", "/home/x"),
    attendu: "/home/x/.copilot/session-state/<id>/events.jsonl",
  },
  {
    quoi: "un agent HORS table reçoit sa sortie standard telle quelle",
    calcul: () =>
      capturerJournal("claude", '{"type":"assistant"}', 0, disque({})).contenu,
    attendu: '{"type":"assistant"}',
  },
  {
    quoi: "copilot : le journal du run REMPLACE la sortie standard",
    calcul: () =>
      capturerJournal(
        "copilot",
        "OK\n",
        T0,
        disque({
          "/home/x/.copilot/session-state": {},
          "/home/x/.copilot/session-state/s1/events.jsonl": {
            mtimeMs: T0 + 5,
            contenu: "LE JOURNAL",
          },
        }),
      ).contenu,
    attendu: "LE JOURNAL",
  },
  {
    quoi: "🔴 racine ABSENTE → le problème est NOMMÉ, jamais un silence",
    calcul: () => {
      const r = capturerJournal("copilot", "OK\n", T0, disque({}));
      return (
        typeof r.probleme === "string" && r.probleme.includes("n'existe pas")
      );
    },
    attendu: true,
  },
  {
    quoi: "🔴 journaux tous ANTÉRIEURS → problème nommé, et la sortie standard en repli",
    calcul: () => {
      const r = capturerJournal(
        "copilot",
        "OK\n",
        T0,
        disque({
          "/home/x/.copilot/session-state": {},
          "/home/x/.copilot/session-state/vieux/events.jsonl": {
            mtimeMs: T0 - 9,
            contenu: "PAS LE NÔTRE",
          },
        }),
      );
      return r.probleme !== undefined && r.contenu === "OK\n";
    },
    attendu: true,
  },
  {
    quoi: "un journal RETENU ne porte aucun problème",
    calcul: () =>
      capturerJournal(
        "copilot",
        "OK\n",
        T0,
        disque({
          "/home/x/.copilot/session-state": {},
          "/home/x/.copilot/session-state/s1/events.jsonl": {
            mtimeMs: T0 + 1,
            contenu: "J",
          },
        }),
      ).probleme,
    attendu: undefined,
  },
  {
    quoi: "la table ne déclare que les agents qui en ont besoin",
    calcul: () => Object.keys(JOURNAUX_HORS_STDOUT).join(","),
    attendu: "copilot",
  },
];

let verts = 0;
let rouges = 0;
for (const c of cas) {
  let obtenu;
  try {
    obtenu = c.calcul();
  } catch (err) {
    obtenu = `levée: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ok = obtenu === c.attendu;
  if (ok) verts += 1;
  else rouges += 1;
  process.stdout.write(`  ${ok ? "✅" : "❌"} ${c.quoi}\n`);
  if (!ok) {
    process.stdout.write(
      `      attendu ${JSON.stringify(c.attendu)}, obtenu ${JSON.stringify(obtenu)}\n`,
    );
  }
}

if (PROVE) {
  // Débranchée, la règle ignore le début du run : les TROIS cas qui refusent un
  // journal antérieur doivent tomber — les deux qui l'appellent directement, et
  // celui qui passe par `capturerJournal`, dont le disque de banc injecte la
  // même mutation. S'ils passent quand même, c'est qu'aucun échantillon
  // n'exerce la borne temporelle — et l'auto-contrôle ne garde rien.
  const attendus = 3;
  if (rouges < attendus) {
    process.stdout.write(
      `\n❌ règle débranchée : ${rouges} cas tombé(s), ${attendus} attendus — ` +
        `la borne du début de run n'est pas exercée par les échantillons\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `\n✅ règle débranchée : ${rouges} cas tombent, la sonde MORD\n`,
  );
  process.exit(0);
}

process.stdout.write(`\n${verts} vert(s), ${rouges} rouge(s)\n`);
process.exit(rouges === 0 ? 0 : 1);
