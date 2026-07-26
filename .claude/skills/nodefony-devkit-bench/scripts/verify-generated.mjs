#!/usr/bin/env node
/**
 * Banc de VÉRITÉ du code généré — « ce que le scaffold produit tient-il debout ? »
 *
 * Le banc frère (`bench-discoverability.mjs`) mesure la DÉCOUVRABILITÉ : un agent lâché
 * dans une app fraîche trouve-t-il l'outillage ? Celui-ci mesure autre chose, et
 * la distinction est la raison d'être des deux : **le code généré compile-t-il,
 * ses tests passent-ils, et répond-il vraiment en HTTP ?**
 *
 * Pourquoi il existe : jusqu'à sa création, RIEN ne compilait le code produit par
 * `create entity`. Les assertions du dépôt lisent des chaînes dans des fichiers
 * rendus — elles ne peuvent pas voir qu'un échantillon viole son propre schéma
 * Zod, qu'une relation déclarée fait lever l'ORM au démarrage, ou qu'un type
 * généré ne compile pas. Ces trois pannes ont été trouvées par ce protocole,
 * joué à la main, en une seule session. Un protocole qui trouve des bugs mérite
 * d'être rejouable.
 *
 * À lancer AVANT de dire qu'une évolution du scaffold est finie, et après toute
 * modification de : templates, `entityFields.ts`, `engine.ts`, `ResourceController`,
 * ou du DDL de développement.
 *
 * Usage :
 *   node scripts/devkit-verify.mjs              # décor + toutes les étapes
 *   node scripts/devkit-verify.mjs --keep       # garde l'app témoin (pour fouiller)
 *   node scripts/devkit-verify.mjs --no-e2e     # saute le boot réel (plus rapide)
 *
 * Prérequis : le checkout est BUILDÉ (`npm run build`) — l'app témoin se lie au
 * `dist/` local via `--link`, donc elle teste ce que tu viens de compiler.
 *
 * Sortie : rapport console + code de sortie 1 à la première étape rouge.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Racine du dépôt, trouvée en REMONTANT plutôt qu'en comptant les « .. ».
 *
 * Ces scripts vivent dans un skill, et un skill se déplace : un chemin relatif
 * figé casse au premier rangement, sur une erreur (« module introuvable ») qui
 * ne dit pas qu'elle parle d'un déplacement.
 */
function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt Nodefony introuvable depuis " + from);
}

const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(REPO, "src/nodefony/bin/nodefony");
const ROOT = path.join(REPO, "tmp/devkit-verify");
const APP = path.join(ROOT, "app");

const keep = process.argv.includes("--keep");
const withE2e = !process.argv.includes("--no-e2e");

/**
 * Entités générées par le banc — choisies pour EXERCER la grammaire, pas pour
 * faire joli. Chaque champ couvre un cas qui a déjà cassé :
 *  - `!` unique     → le 409 (et l'échantillon paramétré qui l'évite au test) ;
 *  - `enum(...)=`   → union TS + `z.enum` + défaut posé côté JS ;
 *  - `int=0`        → défaut numérique (littéral nu, pas une chaîne) ;
 *  - `:index`       → index réellement émis en base ;
 *  - `ref:`         → relation déclarée, et son entité cible enregistrée au test.
 *
 * `Author` et non `User` : une entité nommée `User` entre en collision avec celle
 * du module de sécurité, et l'application ne démarre plus. Le banc ne doit pas
 * échouer sur un piège qu'il ne teste pas.
 */
const ENTITIES = [
  ["Author", "email:string!", "name:string"],
  [
    "Post",
    "title:string!",
    "status:enum(draft,published)=draft",
    "views:int=0",
    "slug:string:index",
    "author:ref:Author",
  ],
  // Tailles de colonne et index de table — la moitié d'un schéma réel. Chacun de
  // ces champs a produit une entité cassée avant d'être couvert ici : un
  // échantillon de test qui violait le schéma de sa propre entité (décimal et
  // caractère fixe), et une référence dont le type ne correspondait pas à la clé
  // visée — invisible tant qu'on lit les fichiers rendus au lieu de les exécuter.
  [
    "Invoice",
    "reference:string(40)!",
    "currency:char(3)",
    "amount:decimal(12,2)",
    "trace:uuid",
    "author:ref:Author",
    "--index",
    "author,createdAt",
    "--unique",
    "reference,currency",
  ],
  // Les DEUX suivantes sont émises pour PostgreSQL, et c'est indispensable : en
  // SQLite, une clé `uuid` et une colonne texte sont le MÊME type, si bien qu'une
  // référence mal typée y est indétectable. La sonde de cohérence FK ↔ PK ne peut
  // donc mordre que sur un moteur qui distingue les deux. Aucune base n'est
  // requise — Drizzle déclare ces types sans se connecter.
  // `--no-tests` : leurs tests s'exécuteraient sur la base SQLite en mémoire de
  // l'application, avec un schéma PostgreSQL — un échec qui ne dirait rien du
  // générateur. Ces deux entités ne servent qu'à faire LIRE leurs types.
  ["PgAuthor", "email:string!", "--dialect", "postgres", "--no-tests"],
  [
    "PgInvoice",
    "reference:string(40)!",
    "currency:char(3)",
    "amount:decimal(12,2)",
    "author:ref:PgAuthor",
    "--dialect",
    "postgres",
    "--no-tests",
    "--no-controller",
  ],
];

/**
 * Sonde de cohérence FK ↔ PK, écrite dans l'application témoin par le banc.
 *
 * Drizzle expose la configuration réelle d'une table (`getTableConfig`) : on y
 * lit le type de la colonne de référence et celui de la clé primaire visée. S'ils
 * divergent, aucune jointure SQL ne s'exécutera — et rien d'autre dans ce banc ne
 * le remarquerait.
 */
const FK_TYPE_PROBE = `import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pgAuthorTable } from "../nodefony/entity/PgAuthor";
import { pgInvoiceTable } from "../nodefony/entity/PgInvoice";

/** Type SQL réel d'une colonne, tel que Drizzle le déclare au moteur. */
const columnType = (table: unknown, name: string): string => {
  const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
  const column = config.columns.find((c) => c.name === name);
  if (!column) throw new Error(\`colonne « \${name} » absente de \${config.name}\`);
  return column.getSQLType();
};

describe("une référence porte le type de la clé qu'elle vise", () => {
  it("PgInvoice.author correspond à PgAuthor.id", () => {
    // Avec une colonne texte face à une clé \`uuid\`, PostgreSQL refuse la
    // jointure : « operator does not exist: text = uuid ». L'ORM, lui, continue
    // de charger la relation — il procède par requêtes paramétrées — donc rien
    // d'autre dans ce banc ne le verrait.
    expect(columnType(pgInvoiceTable, "author")).toBe(
      columnType(pgAuthorTable, "id"),
    );
  });

  it("les tailles déclarées sont bien celles émises", () => {
    // Un \`char(3)\` qui sortirait en 255 passerait toutes les autres épreuves.
    expect(columnType(pgInvoiceTable, "currency")).toBe("char(3)");
    expect(columnType(pgInvoiceTable, "reference")).toBe("varchar(40)");
    expect(columnType(pgInvoiceTable, "amount")).toBe("numeric(12, 2)");
  });
});
`;

const steps = [];
let failed = false;

/** Joue une étape, la chronomètre, et retient son verdict. */
function step(label, why, run) {
  if (failed) return;
  process.stdout.write(`\n━━ ${label}\n   ${why}\n`);
  const started = process.hrtime.bigint();
  try {
    run();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    steps.push({ label, ok: true, ms });
    process.stdout.write(`   ✅ ${Math.round(ms)} ms\n`);
  } catch (error) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    steps.push({ label, ok: false, ms, error: String(error.message ?? error) });
    process.stdout.write(
      `   ❌ ${String(error.message ?? error).slice(0, 400)}\n`,
    );
    failed = true;
  }
}

/**
 * Ports DÉDIÉS à l'application témoin.
 *
 * Sans eux, le banc se fait piéger par n'importe quel serveur Nodefony déjà en
 * marche : `--detach --wait` sonde les ports par défaut, l'AUTRE serveur répond,
 * la readiness est déclarée — et tous les tests interrogent alors une
 * application qui n'est pas celle qu'on teste. Le symptôme est un 404 partout,
 * y compris sur les routes du gabarit, ce qui envoie chercher très loin d'ici.
 */
const PORTS = { NF_PORT: "5361", NF_PORT_HTTPS: "5362" };

/** Exécute une commande dans l'app témoin, en faisant remonter sa sortie si elle échoue. */
function run(cmd, args, cwd = APP) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, ...PORTS },
  });
  if (res.status !== 0) {
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    throw new Error(
      `${cmd} ${args.join(" ")} → code ${res.status}\n${out.slice(-1500)}`,
    );
  }
  return `${res.stdout ?? ""}`;
}

process.stdout.write(
  "Banc de vérité du code généré — le scaffold produit-il du code qui tient ?\n",
);

step(
  "décor : application témoin liée au checkout",
  "`--link` fait pointer les dépendances vers ce que tu viens de compiler.",
  () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    run(
      process.execPath,
      [
        BIN,
        "create",
        "app",
        "app",
        "--preset",
        "complete",
        "--frontend",
        "none",
        "--link",
        "--yes",
      ],
      ROOT,
    );
    // `--link` symlinke les paquets du framework, mais npm ne hisse PAS leurs
    // dépendances dans l'app : `drizzle-orm` manque, et le typecheck d'une
    // entité échoue sur un import introuvable. Ce n'est pas un défaut du code
    // généré — on le neutralise pour mesurer ce qu'on veut mesurer.
    run("npm", ["install", "drizzle-orm@0.45.2", "--no-audit", "--no-fund"]);
  },
);

step(
  "génération : deux entités qui exercent toute la grammaire",
  "unique, énumération, défauts, index et relation — les cas qui ont déjà cassé.",
  () => {
    for (const [name, ...fields] of ENTITIES) {
      run(process.execPath, [
        BIN,
        "create",
        "entity",
        name,
        ...fields,
        "--yes",
      ]);
    }
  },
);

step(
  "le code généré COMPILE",
  "L'étape qui n'existait pas : les assertions de chaînes ne voient pas un type faux.",
  () => run("npm", ["run", "typecheck"]),
);

step(
  "les entités d'un AUTRE dialecte quittent le câblage",
  "Un schéma PostgreSQL enregistré sur un connecteur SQLite fait échouer le boot.",
  // Elles restent sur le disque — c'est leur COMPILATION et leurs TYPES qu'on
  // veut, pas leur exécution. Les laisser déclarées demanderait à l'ORM de créer
  // une table `uuid`/`numeric` dans SQLite, et l'application ne démarrerait plus :
  // un échec qui ne dirait rien du générateur.
  () => {
    const index = path.join(APP, "index.ts");
    const before = readFileSync(index, "utf8");
    const after = before
      .replace(/,\s*PgAuthorEntity/u, "")
      .replace(/,\s*PgInvoiceEntity/u, "")
      .replace(/,\s*PgAuthorController/u, "");
    if (after === before) {
      throw new Error(
        "câblage des entités PostgreSQL introuvable dans index.ts — le scaffold a changé de forme",
      );
    }
    writeFileSync(index, after, "utf8");
  },
);

step(
  "une RÉFÉRENCE a le type de la clé qu'elle vise",
  "Sinon la jointure est refusée par le moteur — invisible en SQLite, fatale ailleurs.",
  // Ce que ce banc protège, mesuré : avec une colonne texte face à une clé
  // `uuid`, PostgreSQL refuse « operator does not exist: text = uuid ». Le
  // chargement de relation de l'ORM, lui, continue de marcher — il procède par
  // requêtes paramétrées — donc ni les tests générés ni la ressource HTTP ne le
  // voient. Seule la comparaison des TYPES le dit, et elle vaut pour les trois
  // moteurs sans qu'aucune base soit nécessaire.
  () => {
    writeFileSync(
      path.join(APP, "tests", "fk-type.probe.test.ts"),
      FK_TYPE_PROBE,
      "utf8",
    );
    run("npx", ["vitest", "run", "tests/fk-type.probe.test.ts"]);
  },
);

step(
  "le code généré est BÂTI",
  "Le runtime charge le `dist/` : sans build, une entité neuve est invisible du serveur.",
  // Étape à part entière, et pas un détail de décor : c'est la cause n°1 des
  // « ma route répond 404 alors qu'elle existe ». Le banc la joue explicitement
  // pour que son absence se voie ici plutôt qu'en session.
  () => run("npm", ["run", "build"]),
);

step(
  "les tests générés PASSENT",
  "Couche donnée : la table se crée, l'aller-retour marche, le schéma refuse le vide.",
  () => {
    const out = run("npm", ["test"]);
    if (/\bskipped\b/.test(out) && !/0 skipped/.test(out)) {
      // Un test sauté compte comme vert et ne prouve rien : on le dit.
      process.stdout.write(
        "   ⚠ des tests ont été SAUTÉS — vérifie qu'ils devaient l'être\n",
      );
    }
  },
);

if (withE2e) {
  step(
    "la ressource RÉPOND vraiment (HTTP, serveur réel)",
    "201+Location, 422, 409 sur doublon, page hasNext, PATCH, 204 puis 404.",
    () => run("npm", ["run", "test:e2e"]),
  );
}

step(
  "l'app se laisse INSPECTER sans ouvrir de port",
  "`inspect` doit rendre un flux JSON pur, même si un serveur occupe déjà les ports.",
  () => {
    const out = run(process.execPath, [BIN, "inspect", "routes", "--json"]);
    const routes = JSON.parse(out);
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error(
        "aucune route rendue — le plan d'administration est-il monté ?",
      );
    }
    const entity = routes.find((r) => String(r.path).startsWith("/api/posts"));
    if (!entity) {
      throw new Error("les routes de l'entité générée n'apparaissent pas");
    }
  },
);

// ── Rapport ─────────────────────────────────────────────────────────────────
process.stdout.write("\n━━ verdict\n");
for (const s of steps) {
  process.stdout.write(
    `  ${s.ok ? "✅" : "❌"} ${s.label} (${Math.round(s.ms)} ms)\n`,
  );
}
const report = { steps, app: APP, generatedAt: null };
if (existsSync(ROOT)) {
  writeFileSync(
    path.join(ROOT, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
if (!failed && !keep) {
  rmSync(ROOT, { recursive: true, force: true });
} else if (failed) {
  process.stdout.write(`\n  décor CONSERVÉ pour investigation : ${APP}\n`);
}
process.stdout.write(
  failed
    ? "\n❌ le code généré ne tient pas — corrige avant de dire « fait »\n"
    : "\n✅ le code généré compile, se teste et répond\n",
);
process.exit(failed ? 1 : 0);
