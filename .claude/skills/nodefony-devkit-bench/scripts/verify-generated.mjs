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
 *   node scripts/verify-generated.mjs            # décor ISOLÉ + toutes les étapes
 *   node scripts/verify-generated.mjs --link     # décor lié au checkout (boucle courte)
 *   node scripts/verify-generated.mjs --repack   # force le re-pack des tarballs
 *   node scripts/verify-generated.mjs --keep     # garde l'app témoin (pour fouiller)
 *   node scripts/verify-generated.mjs --no-e2e   # saute le boot réel (plus rapide)
 *
 * Prérequis : le checkout est BUILDÉ (`npm run build`) — les tarballs sont
 * fabriqués depuis le `dist/` local, donc le banc teste ce que tu viens de
 * compiler, mais tel qu'un installeur le reçoit.
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIsolated,
  installFromTarballs,
  packTarballs,
} from "./lib/isolation.mjs";

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

/**
 * Décor LIÉ au checkout — boucle courte, verdict amputé.
 *
 * `--link` symlinke les paquets du framework depuis le dépôt : c'est rapide,
 * mais la résolution de modules de Node remonte alors jusqu'aux `node_modules`
 * du monorepo, et l'application témoin TROUVE des paquets qu'elle ne déclare
 * pas. Toute la famille « dépendance manquante du gabarit » devient invisible —
 * mesuré : l'étape production restait verte avec ET sans `@node-rs/argon2`,
 * alors qu'une application réellement installée mourait au boot.
 */
const LINKED = process.argv.includes("--link");

/**
 * Où vit le décor. HORS du dépôt par défaut : la distance fait partie du
 * verdict, elle ne s'obtient pas en interdisant un chemin.
 *
 * Deux gestes, tous deux nécessaires — l'un sans l'autre ne suffit pas : le
 * décor sort du dépôt (sinon la remontée des `node_modules` y ramène) et les
 * paquets s'installent depuis les TARBALLS (sinon le lien rebranche les sources
 * malgré la distance). Le banc de découvrabilité l'avait appris avant nous ;
 * l'implémentation est PARTAGÉE (`lib/isolation.mjs`) et non recopiée — deux
 * copies de « isolé » divergent en silence, chacune passant ses propres contrôles.
 */
const ROOT = LINKED
  ? path.join(REPO, "tmp", "devkit-verify")
  : path.join(os.tmpdir(), "nodefony-devkit-verify");
const APP = path.join(ROOT, "app");

/**
 * Le module témoin, et son nom NPM.
 *
 * Les deux, parce qu'ils ne coïncident pas : le dossier est `modules/blog`, le
 * paquet `@app/blog` — c'est ce dernier que le Kernel importe et que le
 * manifeste déclare. Confondre les deux est l'erreur qui rend un module
 * introuvable au démarrage, avec un message qui parle de paquet manquant.
 */
const MODULE = "blog";
const MODULE_PKG = `@app/${MODULE}`;

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
function run(cmd, args, cwd = APP, env = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, ...PORTS, ...env },
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

/** Constat d'isolation du décor — repris dans le rapport, `null` tant qu'il n'est pas monté. */
let isolation = null;

step(
  LINKED
    ? "décor : application témoin LIÉE au checkout"
    : "décor : application témoin ISOLÉE, installée depuis les tarballs",
  LINKED
    ? "`--link` pointe vers ce que tu viens de compiler — mais masque toute dépendance manquante."
    : "Ce qu'un installeur npm reçoit, et rien de plus : hors du dépôt, paquets dépaquetés.",
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
        ...(LINKED ? ["--link"] : []),
        "--yes",
      ],
      ROOT,
    );
    if (LINKED) {
      // `--link` symlinke les paquets du framework, mais npm ne hisse PAS leurs
      // dépendances dans l'app : `drizzle-orm` peut manquer, et le typecheck
      // d'une entité échoue sur un import introuvable. Ce n'est pas un défaut du
      // code généré — on le neutralise pour mesurer ce qu'on veut mesurer.
      run("npm", ["install", "drizzle-orm@0.45.2", "--no-audit", "--no-fund"]);
    } else {
      installFromTarballs(
        APP,
        packTarballs(REPO, process.argv.includes("--repack")),
      );
    }

    // L'isolation se CONSTATE avant la première mesure : mieux vaut aucun
    // verdict qu'un verdict rendu sur un décor mieux servi que l'utilisateur.
    isolation = assertIsolated(REPO, APP);
    for (const f of isolation.facts) process.stdout.write(`   ${f}\n`);
    if (!LINKED && !isolation.ok) {
      throw new Error(
        "décor NON isolé — une dépendance manquante du gabarit resterait invisible",
      );
    }
    if (LINKED) {
      process.stdout.write(
        "   ⚠️  décor LIÉ (--link) : les dépendances du monorepo restent " +
          "atteignables — aucune dépendance manquante n'est détectable ici\n",
      );
    }
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
  "un MODULE naît câblé, et porte sa propre entité",
  "Le chemin que rien n'éprouvait : workspace npm, manifeste, entité ciblée.",
  // `create module` est le générateur le plus structurant et le seul qui n'avait
  // aucun banc. Ce qu'il pose n'est pas un dossier mais un **workspace npm** :
  // le Kernel importe un module PAR SON NOM, donc npm doit savoir le résoudre.
  // Si l'une des trois pièces manque — le workspace déclaré, le symlink installé,
  // l'entrée `use()` du manifeste — l'application ne démarre pas, et le message
  // parle d'un paquet introuvable, jamais du câblage.
  //
  // L'installation n'est PAS neutralisée ici : le symlink de workspace EST ce qui
  // rend le module chargeable, et un banc qui l'évite mesurerait autre chose.
  () => {
    run(process.execPath, [
      BIN,
      "create",
      "module",
      MODULE,
      "--controller",
      "rest",
      "--yes",
    ]);
    // L'entité va DANS le module — c'est l'usage réel, et le seul qui exerce la
    // résolution du nom npm par le générateur.
    run(process.execPath, [
      BIN,
      "create",
      "entity",
      "Comment",
      "body:text",
      "author:string",
      "--module",
      MODULE_PKG,
      "--yes",
    ]);

    // Les trois pièces du câblage, constatées sur le disque plutôt que supposées.
    const manifest = JSON.parse(
      readFileSync(path.join(APP, "package.json"), "utf8"),
    );
    if (!(manifest.workspaces ?? []).some((w) => String(w).includes("modules")))
      throw new Error(
        "`modules/*` absent des workspaces npm — le module ne sera pas résolvable par son nom",
      );
    if (!existsSync(path.join(APP, "modules", MODULE, "package.json")))
      throw new Error(
        "le module n'a pas de package.json — ce n'est pas un paquet",
      );
    const config = readFileSync(path.join(APP, "nodefony.config.ts"), "utf8");
    if (!config.includes(MODULE_PKG))
      throw new Error(
        `${MODULE_PKG} absent du manifeste \`modules\` — le Kernel ne le chargera pas`,
      );
    // Et l'entité doit être déclarée DANS le module, pas dans l'app.
    const moduleIndex = readFileSync(
      path.join(APP, "modules", MODULE, "index.ts"),
      "utf8",
    );
    if (!/@entities\(\[[^\]]*CommentEntity/u.test(moduleIndex))
      throw new Error(
        "CommentEntity n'est pas déclarée dans le module — sa table ne sera pas créée",
      );
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
    "201+Location, 422, 409 sur doublon, page hasNext, PATCH, 204 puis 404 — " +
      "et la suppression EXIGE une identité : refusée sans elle, la donnée survit.",
    () => run("npm", ["run", "test:e2e"]),
  );
}

/**
 * Le mode qu'aucune étape n'exerçait — développement partout ailleurs.
 *
 * Le mot de passe admin est POSÉ à dessein : sans lui le provisionnement
 * s'arrête avant de hacher (`seedAdmin` rend la main quand aucun mot de passe
 * n'est fourni en production), l'encodeur n'est jamais chargé, et l'étape serait
 * verte sans avoir rien exercé. Une vraie production, elle, a un mot de passe.
 *
 * Elle a été écrite pour garder le défaut qu'un agent tiers venait de trouver :
 * une application générée qui meurt au boot en production sur `Cannot find
 * package '@node-rs/argon2'`, dépendance absente du `package.json` généré.
 *
 * Longtemps elle ne pouvait pas le voir, et c'était mesuré : jouée AVEC la
 * dépendance puis SANS elle, elle était verte les deux fois. La cause était le
 * décor, pas la sonde — monté sous le dépôt et lié au checkout, il laissait la
 * résolution de modules de Node remonter jusqu'aux `node_modules` du monorepo,
 * où le binding est installé. L'application trouvait une dépendance qu'elle ne
 * déclarait pas. Le décor par défaut est désormais ISOLÉ (hors du dépôt,
 * paquets dépaquetés depuis les tarballs), et c'est la FAMILLE entière des
 * dépendances manquantes qui devient visible ici — pas seulement `argon2`.
 *
 * ⚠️ Sous `--link`, l'angle mort revient tel quel : le mode est là pour la
 * boucle courte, et son verdict sur la production ne vaut pas preuve.
 *
 * Ce qu'elle garde en propre, indépendamment des dépendances : que le mode
 * production BOOTE et SERVE — un hook de cycle de vie qui jette, une config
 * absente en production, un service `policy:"dev"` requis au boot.
 */
step(
  "l'app DÉMARRE en PRODUCTION et sert une route",
  "Le mode que les autres étapes n'exercent jamais — un défaut de dépendance " +
    "n'y apparaît qu'au déploiement, quand plus personne ne regarde.",
  () => {
    const env = { NF_ADMIN_PASSWORD: "banc-verite-admin" };
    run(process.execPath, [BIN, "production", "--detach", "--wait"], APP, env);
    try {
      // `--wait` dit que le serveur écoute ; il ne dit pas qu'il RÉPOND. Le
      // boot peut aussi échouer APRÈS l'ouverture du port (hook de cycle de
      // vie), et c'est exactement le cas qu'on garde ici.
      const res = execFileSync(
        process.execPath,
        [
          "-e",
          `fetch("http://127.0.0.1:${PORTS.NF_PORT}/api/posts")` +
            `.then((r) => { if (!r.ok && r.status !== 401 && r.status !== 403) ` +
            `{ console.error("statut " + r.status); process.exit(1); } })` +
            `.catch((e) => { console.error(String(e.message ?? e)); process.exit(1); })`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      void res;
    } finally {
      // Toujours, même en échec : un serveur détaché qui survit au banc tient
      // les ports et fait échouer le run SUIVANT sur un symptôme sans rapport.
      spawnSync(process.execPath, [BIN, "stop"], {
        cwd: APP,
        encoding: "utf8",
        env: { ...process.env, ...PORTS },
      });
    }
  },
);

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
const report = {
  steps,
  app: APP,
  generatedAt: null,
  // Le décor est une VARIABLE du verdict, pas un détail d'exécution : sous
  // `--link`, l'étape production ne prouve rien sur les dépendances déclarées.
  decor: LINKED ? "lié au checkout (--link)" : "isolé (tarballs, hors dépôt)",
  isolation,
};
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
