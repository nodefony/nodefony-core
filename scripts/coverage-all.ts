/**
 * Rejoue la couverture de CHAQUE module qui en déclare une, avec le DÉCOR
 * d'infra — et dit ce qu'elle n'a pas mesuré.
 *
 * Pourquoi cet outil plutôt qu'une boucle à la main : une couverture lancée sans
 * le décor sort **sous-estimée sans le dire**. Les suites qui parlent à un vrai
 * serveur (PostgreSQL, MySQL, Mongo, Redis) se skippent faute de leurs
 * variables, un skip compte comme un succès, et le taux qui en sort décrit un
 * périmètre plus petit que celui qu'on croit juger. Le décor n'est donc pas
 * réécrit ici : il est DÉRIVÉ de `vitest.gates.ts`, la source unique du dépôt,
 * exactement comme le fait `scripts/test-all.ts`.
 *
 * Ce script MESURE ; il ne pose aucun seuil et ne fait échouer que sur un module
 * dont la commande sort en erreur. Fixer un plancher de couverture est une
 * décision de projet, pas un effet de bord d'un outil de mesure.
 *
 * Usage :
 *   npm run coverage                    # tous les modules qui en déclarent une
 *   npm run coverage -- --only http     # un seul (filtre sur le nom du paquet)
 *   npm run coverage -- --json          # le tableau seul, pour un rapport
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const arg = (nom: string): string | undefined => {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
};
const ONLY = arg("only");
const JSON_SEUL = process.argv.includes("--json");

const log = (s: string) => {
  if (!JSON_SEUL) process.stdout.write(s);
};

// ── Le décor, dérivé de la source unique ───────────────────────────────────
interface Gate {
  service?: { name: string };
  values?: () => Record<string, string>;
}
const gates: Record<string, unknown> = await import(
  path.join(ROOT, "vitest.gates.ts")
);
// ⚠️ Surtout PAS `test-all.ts` : c'est un SCRIPT, son corps s'exécute à l'import
// — en importer une fonction relançait l'infra, le build et la batterie entière.
import { containerHealthy } from "./lib/docker.ts";

const posees: Record<string, string> = {};
const absents: string[] = [];
for (const [nom, g] of Object.entries(gates)) {
  const gate = g as Gate | null;
  if (!gate || typeof gate !== "object" || typeof gate.values !== "function") {
    continue;
  }
  // 🔴 Poser la variable d'un service ABSENT ne rend pas les tests skippés : il
  // les fait ÉCHOUER. Un banc qui n'a personne au bout de son URL ne se tait
  // pas, il tombe — et le rouge est alors imputé au produit. Vécu ici même :
  // `NF_LOKI_TEST_URL` posée sans Loki, quatre tests du cœur en échec, aucun
  // rapport de couverture produit pour le module entier. On CONSTATE donc la
  // santé du conteneur, exactement comme `test-all.ts`, avant de poser quoi que
  // ce soit.
  if (gate.service?.name && !containerHealthy(gate.service.name)) {
    absents.push(gate.service.name);
    continue;
  }
  try {
    for (const [cle, valeur] of Object.entries(gate.values())) {
      if (valeur) {
        process.env[cle] = valeur;
        posees[cle] = nom;
      }
    }
  } catch {
    // Un gate qui ne sait pas se calculer ici n'est pas une erreur : il décrit
    // une infra absente. On CONSTATE son absence, on ne l'invente pas.
  }
}
log(
  `décor : ${Object.keys(posees).length} variable(s) posée(s) depuis vitest.gates.ts\n` +
    (Object.keys(posees).length
      ? `        ${Object.keys(posees).join(" · ")}\n`
      : `        ⚠️ AUCUNE — les suites sur serveur réel vont se skipper, et un skip compte comme vert.\n`) +
    (absents.length
      ? `        ⚠️ service(s) ABSENT(s), variables NON posées : ${[...new Set(absents)].join(" · ")}\n` +
        `           (leurs suites se skipperont proprement ; les poser sans le service les ferait ÉCHOUER)\n`
      : "") +
    `        démarrer l'infra manquante : npm run test:all -- --infra\n\n`,
);

// ── Les cibles : ce que les paquets DÉCLARENT, jamais une liste écrite ─────
interface Workspace {
  name: string;
  location: string;
}
const workspaces: Workspace[] = JSON.parse(
  execFileSync("npm", ["query", ".workspace"], {
    encoding: "utf8",
    maxBuffer: 1e8,
  }),
);
const cibles = workspaces.filter((w) => {
  const p = path.join(ROOT, w.location, "package.json");
  if (!existsSync(p)) return false;
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  if (!pkg.scripts?.coverage) return false;
  return ONLY ? w.name.includes(ONLY) : true;
});

if (!cibles.length) {
  console.error(
    ONLY
      ? `Aucun module ne correspond à « ${ONLY} » parmi ceux qui déclarent \`coverage\`.`
      : "Aucun module ne déclare de script `coverage`.",
  );
  process.exit(1);
}
log(`${cibles.length} module(s) à couvrir\n\n`);

// ── De QUOI un taux est-il fait ? ──────────────────────────────────────────
//
// Un pourcentage unique laisse croire que toutes les lignes couvertes le sont de
// la même façon. C'est faux ici, et pas qu'un peu : les suites de ce dépôt ne
// poursuivent pas le même but.
//
// Le cas le plus parlant est le test d'ATTAQUE. Il exerce du code — donc il fait
// monter le taux — mais ce qu'il prouve est qu'une intrusion ÉCHOUE : le chemin
// nominal de la fonction visée peut rester entièrement non éprouvé pendant que
// ses lignes comptent comme couvertes. Un banc de CHARGE, lui, traverse le
// pipeline des milliers de fois sans rien affirmer sur sa correction. À
// l'inverse, un test unitaire vérifie un contrat, et lui seul autorise à lire
// « couvert » comme « éprouvé ».
//
// D'où ce classement : il ne corrige pas le taux — un taux ne se corrige pas —
// il dit AVEC QUOI il a été obtenu, pour qu'on cesse de comparer deux nombres
// qui ne mesurent pas la même chose.
const NATURES = [
  { cle: "attaque", re: /(attack|redteam|red-team)/i },
  { cle: "charge", re: /(tests?\/load\/|[.-]load[.-]|stress|soak)/i },
  { cle: "mémoire", re: /memory\.test\./i },
  { cle: "intégration", re: /(tests?\/integration\/|e2e|\.integration\.)/i },
] as const;

function ventilerTests(dossier: string): Record<string, number> {
  const compte: Record<string, number> = {};
  let fichiers: string[] = [];
  try {
    fichiers = execFileSync(
      "git",
      ["ls-files", "--", `${dossier}/**/*.test.ts`, `${dossier}/**/*.test.mts`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1e8 },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return compte;
  }
  for (const f of fichiers) {
    const nature =
      NATURES.find((n) => n.re.test(f))?.cle ??
      // Le défaut n'est pas « autre » : un fichier de test qui n'entre dans
      // aucune catégorie spéciale EST un test unitaire dans ce dépôt.
      "unitaire";
    compte[nature] = (compte[nature] ?? 0) + 1;
  }
  return compte;
}

/**
 * Compte les scripts de banc qui éprouvent le produit HORS des suites d'un
 * module — donc hors de tout taux de couverture.
 *
 * Ils vivent dans les skills (`nodefony-load-test`, `nodefony-devkit-bench`,
 * `nodefony-multipod-bench`) et dans `scripts/`. Le comptage vient de
 * `git ls-files` : ce qui n'est pas versionné n'est pas un banc du dépôt.
 */
function compterBancs(): Record<string, number> {
  // ⚠️ On liste le DOSSIER, puis on filtre l'extension en JS. Un pathspec
  // `dossier/**/*.mjs` ne matche PAS les fichiers posés à la racine du dossier :
  // il exigeait un sous-répertoire, et rendait 4 scripts là où il y en a 44.
  // Un comptage faux dans un outil qui sert précisément à dire « ce chiffre ne
  // dit pas tout » est la pire des ironies — d'où la forme la plus bête possible.
  const zones: Record<string, string> = {
    "charge · rupture · e2e (skill nodefony-load-test)":
      ".claude/skills/nodefony-load-test/scripts",
    "épreuves du scaffold (skill nodefony-devkit-bench)":
      ".claude/skills/nodefony-devkit-bench/scripts",
    "multi-pods (skill nodefony-multipod-bench)":
      ".claude/skills/nodefony-multipod-bench/scripts",
    "outillage du dépôt (scripts/)": "scripts",
  };
  const out: Record<string, number> = {};
  for (const [libelle, dossier] of Object.entries(zones)) {
    try {
      const n = execFileSync("git", ["ls-files", "--", dossier], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 1e8,
      })
        .split("\n")
        .filter((f) => f.endsWith(".mjs") || f.endsWith(".sh")).length;
      if (n) out[libelle] = n;
    } catch {
      // Zone absente : on ne l'invente pas, on ne la compte pas.
    }
  }
  return out;
}

interface Resultat {
  module: string;
  location: string;
  code: number | null;
  secondes: number;
  stmts: number | null;
  branches: number | null;
  fonctions: number | null;
  lignes: number | null;
  skipped: number;
  natures: Record<string, number>;
}

const resultats: Resultat[] = [];
const journaux: Record<string, string> = {};

for (const [i, w] of cibles.entries()) {
  log(`[${String(i + 1).padStart(2)}/${cibles.length}] ${w.name.padEnd(30)} `);
  const t0 = Date.now();
  const r = spawnSync("npm", ["run", "coverage", "--silent"], {
    cwd: path.join(ROOT, w.location),
    encoding: "utf8",
    env: process.env,
    timeout: 15 * 60_000,
    maxBuffer: 1e9,
  });
  const sortie = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const secondes = Math.round((Date.now() - t0) / 1000);

  // Les taux se lisent dans le RAPPORT ÉCRIT, pas dans la sortie console.
  // Parser le texte paraissait plus simple ; c'était faux pour dix modules sur
  // seize : leur reporter est `text-summary` (qui n'imprime aucune ligne
  // « All files ») et leur `reportsDirectory` est `.coverage`, pas `coverage`.
  // On lisait donc « pas de tableau » sur des modules parfaitement mesurés.
  // `coverage-summary.json` est la sortie machine du même run — c'est aussi ce
  // que lit `docsReader.readCoverage` pour l'afficher dans la console d'admin.
  // DEUX sources, parce que les modules ne sont pas configurés pareil et qu'il
  // n'y a aucune raison de leur imposer une config pour être mesurés :
  //   • `coverage-summary.json` quand le reporter `json-summary` est déclaré —
  //     la source machine, exacte, et celle que lit déjà la console d'admin ;
  //   • la ligne « All files » du reporter texte sinon.
  // N'en lire qu'une donne un faux « pas mesuré » : la première version de cet
  // outil lisait le texte et rendait 6 taux sur 16, la deuxième lisait le JSON
  // et en perdait d'autres. Les modules muets n'avaient rien de commun — sauf
  // de ne pas correspondre à la source unique que je regardais.
  let m: [unknown, number, number, number, number] | null = null;
  const resume = ["coverage", ".coverage"]
    .map((d) => path.join(ROOT, w.location, d, "coverage-summary.json"))
    .find((f) => existsSync(f));
  if (resume) {
    try {
      const t = JSON.parse(readFileSync(resume, "utf8")).total;
      m = [
        null,
        t.statements.pct,
        t.branches.pct,
        t.functions.pct,
        t.lines.pct,
      ];
    } catch {
      // Rapport illisible : on retombe sur le texte plutôt que de rendre 0,
      // qui se lirait « rien n'est couvert » au lieu de « je n'ai pas pu lire ».
    }
  }
  if (!m) {
    const t =
      /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(
        sortie,
      );
    if (t) m = [null, +t[1], +t[2], +t[3], +t[4]];
  }
  const skipped = Number(/(\d+) skipped/.exec(sortie)?.[1] ?? "0");

  resultats.push({
    module: w.name,
    location: w.location,
    code: r.status,
    secondes,
    stmts: m ? Number(m[1]) : null,
    branches: m ? Number(m[2]) : null,
    fonctions: m ? Number(m[3]) : null,
    lignes: m ? Number(m[4]) : null,
    skipped,
    natures: ventilerTests(w.location),
  });
  journaux[w.name] = sortie;

  log(
    r.status === 0
      ? `✅ ${m ? `${String(m[1]).padStart(5)} % stmts` : "  (aucun rapport écrit)"}` +
          `${skipped ? ` · ${skipped} skip` : ""} · ${secondes}s\n`
      : `❌ code ${r.status} · ${secondes}s\n`,
  );
}

mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
const OUT = path.join(ROOT, "tmp", "coverage-all.json");
writeFileSync(
  OUT,
  JSON.stringify({ decor: posees, modules: resultats, journaux }, null, 2),
);

if (JSON_SEUL) {
  console.log(JSON.stringify(resultats, null, 2));
} else {
  const rouges = resultats.filter((r) => r.code !== 0);
  const avecTaux = resultats.filter((r) => r.code === 0 && r.stmts !== null);
  const skips = resultats.reduce((s, r) => s + r.skipped, 0);

  console.log(`\n══ COUVERTURE — ${resultats.length} modules ══`);
  for (const r of [...avecTaux].sort(
    (a, b) => (a.stmts ?? 0) - (b.stmts ?? 0),
  )) {
    console.log(
      `  ${String(r.stmts).padStart(5)} % ${r.module.padEnd(30)}` +
        ` branches ${String(r.branches).padStart(5)} %` +
        ` · fonctions ${String(r.fonctions).padStart(5)} %`,
    );
  }
  if (avecTaux.length) {
    const moy =
      avecTaux.reduce((s, r) => s + (r.stmts ?? 0), 0) / avecTaux.length;
    console.log(
      `\n  moyenne non pondérée : ${moy.toFixed(1)} % sur ${avecTaux.length} module(s)` +
        `\n  ⚠️ une moyenne de taux n'est pas un taux : un module de 40 lignes y pèse` +
        ` autant qu'un module de 4 000.`,
    );
  }

  // ── CE QUE LE TAUX AGRÈGE ────────────────────────────────────────────────
  const total: Record<string, number> = {};
  for (const r of resultats) {
    for (const [nature, n] of Object.entries(r.natures)) {
      total[nature] = (total[nature] ?? 0) + n;
    }
  }
  const fichiers = Object.values(total).reduce((s, n) => s + n, 0);
  if (fichiers) {
    console.log(
      `\n══ DE QUOI CE TAUX EST FAIT — ${fichiers} fichiers de test ══`,
    );
    for (const [nature, n] of Object.entries(total).sort(
      (a, b) => b[1] - a[1],
    )) {
      const pct = ((n / fichiers) * 100).toFixed(0);
      console.log(
        `  ${String(n).padStart(4)} ${nature.padEnd(13)} ${pct.padStart(3)} %`,
      );
    }
    if (total.attaque) {
      console.log(
        `\n  🔴 ${total.attaque} suites d'ATTAQUE : elles prouvent qu'une intrusion ÉCHOUE.` +
          `\n     Elles exercent du code — donc elles FONT MONTER ce taux — sans rien dire du` +
          `\n     chemin nominal, qui peut rester entièrement non éprouvé derrière des lignes` +
          `\n     comptées « couvertes ».`,
      );
    }
    if (total.charge) {
      console.log(
        `  ⚠️ ${total.charge} suites de CHARGE : elles traversent le pipeline des milliers de` +
          `\n     fois sans affirmer sa correction. Du volume, pas de la preuve.`,
      );
    }
    // ── Ce qui éprouve le produit SANS jamais entrer dans un taux ──────────
    //
    // Le taux ne connaît que les suites vitest d'un module. Or une grande part
    // de ce qui éprouve réellement Nodefony vit AILLEURS : bancs de charge,
    // preuves e2e sans navigateur, bancs multi-pods, épreuves du scaffold. Ces
    // scripts lancent de vrais serveurs, de vraies bases, de vrais agents — et
    // pèsent ZÉRO dans le pourcentage ci-dessus.
    //
    // Conséquence à ne jamais perdre de vue : le taux SOUS-ESTIME ce qui est
    // éprouvé, autant que les suites d'attaque le SURESTIMENT. Un chiffre pris
    // entre ces deux biais ne se lit pas comme une note.
    const bancs = compterBancs();
    const totalBancs = Object.values(bancs).reduce((s, n) => s + n, 0);
    if (totalBancs) {
      console.log(
        `\n══ ÉPROUVÉ HORS DE TOUT TAUX — ${totalBancs} scripts de banc ══`,
      );
      for (const [ou, n] of Object.entries(bancs).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(4)} ${ou}`);
      }
      console.log(
        `\n  Charge, rupture, e2e sans navigateur, multi-pods, épreuves du scaffold :` +
          `\n  ces bancs lancent de vrais serveurs et de vraies bases, et ne comptent` +
          `\n  pour RIEN dans le pourcentage ci-dessus.`,
      );
    }

    console.log(
      `\n  Un taux dit ce qui a été EXÉCUTÉ par les suites d'un module, jamais ce qui a` +
        `\n  été VÉRIFIÉ, ni tout ce qui est éprouvé ailleurs. Il est SURESTIMÉ par les` +
        `\n  suites d'attaque et SOUS-ESTIMÉ par les bancs hors module. Ne pas le lire` +
        `\n  comme une note de qualité, ni comparer deux modules dont les suites n'ont` +
        `\n  pas la même nature. Détail : docs/guides/integration-continue.md`,
    );
  }
  if (rouges.length) {
    console.log(`\n  ✖ ${rouges.length} module(s) en ÉCHEC :`);
    for (const r of rouges) console.log(`      ${r.module} — code ${r.code}`);
  }
  if (skips) {
    console.log(
      `\n  ⚠️ ${skips} test(s) SKIPPÉS — un skip compte comme vert, et ce qu'il` +
        `\n     n'exécute pas ressort comme non couvert. Vérifier le décor avant de conclure.`,
    );
  }
  console.log(`\n  journaux complets : ${OUT}`);
}

// Seuls des modules en ÉCHEC font échouer ce script : il MESURE, il ne juge pas.
process.exit(resultats.some((r) => r.code !== 0) ? 1 : 0);
