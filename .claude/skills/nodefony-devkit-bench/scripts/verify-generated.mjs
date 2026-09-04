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
import { garderDrapeaux } from "./lib/argv.mjs";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  utimesSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIsolated,
  installFromTarballs,
  packTarballs,
} from "./lib/isolation.mjs";
import { envDecor } from "./lib/env-decor.mjs";
import { besoinDeShell } from "./lib/exec-portable.mjs";
import { extraitEchec } from "./lib/extrait-echec.mjs";

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

// 🔴 Avant toute chose : ce banc installe une application complète, la
// compile et la démarre. Un drapeau mal tapé lui faisait dérouler tout ça « au
// cas où » — la même garde protège les trois bancs, depuis une seule
// implémentation.
garderDrapeaux({
  args: process.argv.slice(2),
  connus: ["--database", "--keep", "--link", "--repack"],
  aValeur: ["--database"],
  usage: [
    "Banc de vérité du code généré — compile-t-il, teste-t-il, répond-il ?",
    "",
    "  node verify-generated.mjs                  décor ISOLÉ, toutes les étapes",
    "  node verify-generated.mjs --database <m>   le moteur du décor (défaut : sqlite)",
    "",
    "  --link    décor lié au dépôt : boucle courte, verdict AMPUTÉ",
    "  --keep    conserve le décor à la fin (pour inspecter)",
    "  --repack  refabrique les tarballs même s'ils paraissent à jour",
    "",
    "Sorties : 0 toutes les étapes passent · 1 une étape a échoué · 64 usage",
  ].join("\n"),
  avertissement:
    "Rien n'a été lancé — ce banc installe, compile et démarre une application.",
});

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
 * Lit une option `--nom valeur` de la ligne de commande.
 *
 * @param {string} nom - l'option, tirets compris.
 * @param {string} defaut - la valeur retenue quand l'option est absente.
 * @returns {string} la valeur.
 */
function option(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

/**
 * Le MOTEUR de base de données de l'application témoin.
 *
 * Il ne se surcharge PAS par une variable d'environnement, et c'est le coeur du
 * sujet : le dialecte n'est pas un reglage d'execution, c'est une decision prise
 * a la CREATION de l'application. Les entites sont ecrites pour lui
 * (`createXTable("postgres")`), et l'ORM refuse de demarrer sur un autre en
 * nommant l'entite fautive. Pointer une application SQLite vers un serveur
 * PostgreSQL ne l'eprouve donc pas : il faut une AUTRE application.
 *
 * C'est aussi pourquoi le decor porte le moteur dans son chemin : deux passes
 * de moteurs differents ne doivent jamais se marcher dessus, ni l'une conserver
 * le decor que l'autre vient d'ecraser.
 */
const DATABASE = option("--database", "sqlite");
const MOTEURS = ["sqlite", "postgres", "mysql", "mariadb"];
if (!MOTEURS.includes(DATABASE)) {
  process.stderr.write(
    `--database ${DATABASE} inconnu — attendus : ${MOTEURS.join(", ")}\n`,
  );
  process.exit(78);
}

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
/**
 * Le décor vit HORS du dépôt dans les deux modes, et c'est structurel.
 *
 * `--link` le posait dans `REPO/tmp/devkit-verify`, par commodité — un décor
 * qu'on retrouve à côté du code qu'on débogue. Le prix était invisible et
 * total : le `.gitignore` du dépôt ignore `tmp/`, oxlint respecte les
 * `.gitignore` REMONTANTS, et aucune option ne le désactive (`--no-ignore` ne
 * porte que sur `.eslintignore`). L'étape de lint rendait donc
 * « No files found to lint » — le banc entier s'arrêtait là, et jamais un seul
 * mode `--link` n'a pu aller jusqu'au bout.
 *
 * La leçon vaut au-delà d'oxlint : **un décor de banc placé sous un chemin
 * ignoré hérite en silence de règles écrites pour autre chose**. Deux dossiers
 * distincts, pour qu'un run lié n'écrase pas un décor isolé conservé.
 */
const ROOT = path.join(
  os.tmpdir(),
  (LINKED ? "nodefony-devkit-verify-link" : "nodefony-devkit-verify") +
    (DATABASE === "sqlite" ? "" : `-${DATABASE}`),
);
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
/** Le nom de sa classe exportée — `blog` → `BlogModule`, la règle du générateur. */
const PASCAL_MODULE = MODULE[0].toUpperCase() + MODULE.slice(1);

/**
 * Le controller RÉSERVÉ à une habilitation, et le rôle qu'il exige.
 *
 * Un rôle qu'aucune application générée ne déclare : sinon la hiérarchie
 * attendue serait vraie AVANT le premier geste, et l'étape passerait sur un
 * générateur qui n'a rien fait.
 */
const CONTROLLER_GARDE = "coffre";
const CONTROLLER_GARDE_CLASS = "CoffreController";
const ROLE_GARDE = "ROLE_COFFRE";

/**
 * Le service témoin, la méthode qui REMPLACE son exemple, et la commande qui
 * l'appelle.
 *
 * Trois générateurs sur sept n'étaient exercés par rien ici (`controller` l'est
 * indirectement par `create module --controller rest`) — et c'est exactement par
 * ce trou qu'un défaut est passé : `create command --service` exigeait la méthode
 * `greet()` du gabarit, que ce même gabarit dit de remplacer. Suivre le conseil
 * cassait la commande. Le banc fait donc le geste que le gabarit RÉCLAME.
 *
 * La méthode d'exemple ne se renomme pas au hasard : un générateur ne doit
 * dépendre d'AUCUN nom de son propre exemple.
 */
const SERVICE = "Report";
const SERVICE_METHOD = "bilan";
/** Le service qui INJECTE le premier — `create service … --inject`. */
const INJECTED_SERVICE = "Facture";
const COMMAND_ACTION = "sync";
const COMMAND_CLASS = "SyncCommand";

/**
 * Nom complet de la commande générée (`<module>:<action>`), DÉRIVÉ du `super(…)`
 * de l'`index.ts` au moment de la génération — jamais écrit en dur : c'est le
 * générateur qui décide du préfixe, et le banc ne doit pas figer sa décision.
 */
let commandFullName = null;

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
    env: envDecor(PORTS, env),
    // `npm` sous Windows est un `.cmd` : sans shell, Node rend `ENOENT` — un
    // message qui accuse une installation absente. Cf `lib/exec-portable.mjs`.
    shell: besoinDeShell(cmd),
  });
  if (res.status !== 0) {
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    // La sortie ENTIÈRE sur disque avant tout filtrage — l'affichage, lui, ne
    // peut pas tout porter. Vécu : le lanceur du framework refusait la readiness
    // en NOMMANT le module qui manquait, puis un moteur de test écrivait sa
    // propre pile par-dessus ; garder « la fin » ne montrait plus que la pile,
    // et le diagnostic — produit, exact — n'atteignait aucun lecteur. C'est
    // `extraitEchec` qui choisit maintenant quoi montrer : la cause d'abord.
    const journal = path.join(ROOT, "echec.log");
    try {
      writeFileSync(journal, `$ ${cmd} ${args.join(" ")}\n\n${out}\n`);
    } catch {
      /* le décor a pu être démonté — le message reste utile sans le fichier */
    }
    throw new Error(
      `${cmd} ${args.join(" ")} → code ${res.status}` +
        ` (sortie entière : ${journal})\n${extraitEchec(out)}`,
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
        // Le témoin naît avec un FRONT, et c'est `vue` — pas par préférence :
        // le compilateur de composants monofichiers TRANSFORME le gabarit
        // (un `src="/…"` littéral y devient un import d'asset du bundle),
        // là où Angular garde son template dans une chaîne TypeScript et où
        // JSX laisse la chaîne intacte. C'est donc le front où le build de
        // production dit quelque chose que le mode développement ne dit pas —
        // vécu sur la vitrine du dépôt, cassée depuis sa création et invisible
        // jusqu'au premier build (`606add6c`).
        //
        // Rien d'autre à câbler : le `npm run build` de l'application générée
        // enchaîne déjà `nodefony frontend:build` dès qu'un front existe
        // (`templates/app/base/package.json.tpl:14`). L'étape « build » de ce
        // banc bâtit donc le front sans une ligne de plus.
        "--frontend",
        "vue",
        // Le moteur est un argument de CRÉATION, pas d'exécution : c'est lui
        // qui décide du dialecte dans lequel les entités seront écrites.
        "--database",
        DATABASE,
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
  "un SERVICE, puis la COMMANDE qui l'appelle — exemple REMPLACÉ",
  "Le geste que le gabarit RÉCLAME, et qu'un générateur punissait : suivre son conseil le cassait.",
  // Le service visé est DÉSIGNÉ (`--service <Nom>`), il n'est plus déduit de
  // l'ordre du disque. Cette étape reposait sur « le dossier n'existe pas
  // encore, donc le premier service trouvé est forcément le nôtre » — un
  // présupposé que la première application livrant deux services d'exemple a
  // suffi à casser : le générateur choisissait alors le premier
  // ALPHABÉTIQUEMENT, et l'assertion ci-dessous ne mesurait plus rien de ce
  // qu'elle prétend. Un banc ne doit pas dépendre d'un ordre de répertoire.
  () => {
    run(process.execPath, [BIN, "create", "service", SERVICE, "--yes"]);
    const svcFile = path.join(
      APP,
      "nodefony",
      "service",
      `${SERVICE}Service.ts`,
    );
    const ifaceFile = path.join(
      APP,
      "nodefony",
      "interfaces",
      `I${SERVICE}Service.ts`,
    );
    // « Exemple de méthode métier — à remplacer par la vôtre » : on le fait, dans
    // la classe ET dans son interface — sinon ce n'est plus le même contrat, et
    // le typecheck de l'étape suivante le dirait à notre place.
    for (const file of [svcFile, ifaceFile]) {
      const before = readFileSync(file, "utf8");
      const after = before.replaceAll("greet(", `${SERVICE_METHOD}(`);
      if (after === before) {
        throw new Error(
          `méthode d'exemple introuvable dans ${path.basename(file)} — ` +
            "le gabarit a changé de forme, et cette étape ne mesure plus rien",
        );
      }
      writeFileSync(file, after, "utf8");
    }

    run(process.execPath, [
      BIN,
      "create",
      "command",
      COMMAND_ACTION,
      "--service",
      `${SERVICE}Service`,
      "--yes",
    ]);

    // Un SECOND service, injecté par le premier. Le geste que le banc de
    // découvrabilité a mesuré ROUGE : sans exemple ACTIF, l'agent passe
    // exclusivement par `container.get`, et sa dépendance n'est ni déclarée ni
    // ordonnée. Ici l'appel généré porte sur la méthode RENOMMÉE — donc il
    // prouve, comme la commande, que le générateur cherche au lieu de supposer.
    run(process.execPath, [
      BIN,
      "create",
      "service",
      INJECTED_SERVICE,
      "--inject",
      `${SERVICE}Service`,
      "--yes",
    ]);
    const injected = readFileSync(
      path.join(APP, "nodefony", "service", `${INJECTED_SERVICE}Service.ts`),
      "utf8",
    );
    if (!injected.includes(`@inject("${SERVICE}Service")`)) {
      throw new Error(
        "le service généré n'injecte rien par le constructeur — `--inject` a-t-il été honoré ?",
      );
    }
    if (!injected.includes(`.${SERVICE_METHOD}()`)) {
      throw new Error(
        `le service injecté n'est jamais APPELÉ (${SERVICE_METHOD}) — ` +
          "une dépendance déclarée et non lue ne compile pas, et ne montre rien",
      );
    }

    const generated = readFileSync(
      path.join(APP, "nodefony", "command", `${COMMAND_CLASS}.ts`),
      "utf8",
    );
    if (!generated.includes(`.${SERVICE_METHOD}(`)) {
      throw new Error(
        `la commande n'appelle pas « ${SERVICE_METHOD}() » — ` +
          "le générateur a-t-il CHERCHÉ la méthode, ou l'a-t-il supposée ?",
      );
    }
    if (/\bgreet\b/u.test(generated)) {
      throw new Error(
        "la commande appelle « greet » : le générateur exige encore son propre exemple",
      );
    }

    // Un controller RÉSERVÉ à une habilitation — la seule voie par laquelle la
    // garde de rôle générée est COMPILÉE quelque part. Elle sort d'un bloc
    // conditionnel du gabarit (import compris) : les assertions de chaînes du
    // dépôt la lisent, personne ne la compile, et un décorateur importé de
    // nulle part passerait tous les contrôles jusqu'à l'application de
    // l'utilisateur.
    run(process.execPath, [
      BIN,
      "create",
      "controller",
      CONTROLLER_GARDE,
      "--role",
      ROLE_GARDE,
      "--yes",
    ]);
    const garde = readFileSync(
      path.join(APP, "nodefony", "controllers", `${CONTROLLER_GARDE_CLASS}.ts`),
      "utf8",
    );
    if (!garde.includes(`@IsGranted("${ROLE_GARDE}")`)) {
      throw new Error(
        `le controller généré ne porte pas la garde « ${ROLE_GARDE} » — ` +
          "`--role` a-t-il été honoré ?",
      );
    }
    // La hiérarchie vit dans le manifeste de l'APPLICATION : sans elle,
    // l'administrateur devrait porter le rôle, et la garde ne généralise pas.
    const manifeste = readFileSync(
      path.join(APP, "nodefony.config.ts"),
      "utf8",
    );
    if (
      !new RegExp(`ROLE_ADMIN\\s*:\\s*\\[[^\\]]*"${ROLE_GARDE}"`, "u").test(
        manifeste,
      )
    ) {
      throw new Error(
        `« ${ROLE_GARDE} » n'est pas déclaré sous ROLE_ADMIN dans roleHierarchy — ` +
          "la garde ne vaudrait que pour les porteurs du rôle",
      );
    }

    // Le câblage, constaté sur le disque plutôt que supposé : une classe que
    // rien n'enregistre compile parfaitement et n'existe pour personne.
    const index = readFileSync(path.join(APP, "index.ts"), "utf8");
    if (
      !new RegExp(`@services\\(\\[[^\\]]*${SERVICE}Service`, "u").test(index)
    ) {
      throw new Error(
        `${SERVICE}Service absent de @services([…]) — le conteneur ne le connaîtra pas`,
      );
    }
    if (!index.includes(`this.addCommand(${COMMAND_CLASS})`)) {
      throw new Error(
        `addCommand(${COMMAND_CLASS}) absent d'index.ts — la commande ne sera jamais atteignable`,
      );
    }
    // Le préfixe vient du module que l'`index.ts` DÉCLARE, pas du nom du paquet.
    const declared = /super\(\s*"([^"]+)"/u.exec(index);
    if (!declared) {
      throw new Error(
        'nom de module introuvable dans index.ts (`super("…"`) — impossible de nommer la commande',
      );
    }
    commandFullName = `${declared[1]}:${COMMAND_ACTION}`;
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

/**
 * Les expressions de code citées dans un document que l'agent lit d'office.
 *
 * On garde la CHAÎNE D'ACCÈS (`this.context?.cspNonce`, `this.renderJson`) en
 * coupant à l'appel : les arguments d'un exemple (`obj`, `html`, `f`) sont des
 * noms libres qu'aucun décor ne peut fournir, alors que le membre visé, lui,
 * se compile tel quel — c'est là que se logent les fautes.
 */
function expressionsCitees(markdown) {
  const trouvees = new Set();
  for (const [, inline] of markdown.matchAll(/`([^`\n]+)`/gu)) {
    for (const [expr] of inline.matchAll(/this(?:\??\.[A-Za-z_$][\w$]*)+/gu)) {
      trouvees.add(expr);
    }
  }
  return [...trouvees].sort();
}

step(
  "le code écrit dans les AGENTS.md COMPILE",
  "Un exemple faux AGIT : trois agents ont recopié `this.context.cspNonce` sans le `?.` — typecheck rouge 3/3.",
  // Ce document est lu AVANT le code par tout agent qui entre dans l'app :
  // ce qu'il montre pèse plus que ce qu'il explique. Rien ne le compilait —
  // ni `create.test.ts` (qui cherche des chaînes) ni le typecheck de l'app
  // (le markdown n'est pas une source). La sonde replace chaque expression
  // dans le contexte où l'agent la recopiera, et laisse le compilateur juger.
  () => {
    const cibles = [
      {
        md: path.join(APP, "AGENTS.md"),
        classe: "Controller",
        depuis: 'import { Controller } from "@nodefony/framework";',
      },
      {
        md: path.join(APP, "modules", MODULE, "AGENTS.md"),
        classe: "Module",
        depuis: 'import { Module } from "nodefony";',
      },
    ];
    const imports = [];
    const classes = [];
    let total = 0;
    for (const [i, cible] of cibles.entries()) {
      if (!existsSync(cible.md)) {
        throw new Error(`${path.relative(APP, cible.md)} n'a pas été généré`);
      }
      const exprs = expressionsCitees(readFileSync(cible.md, "utf8"));
      total += exprs.length;
      if (!exprs.length) {
        continue;
      }
      imports.push(cible.depuis);
      classes.push(
        `class SondeAgents${i} extends ${cible.classe} {\n` +
          `  sonde(): void {\n` +
          exprs.map((e) => `    void (${e});`).join("\n") +
          `\n  }\n}\nexport type _Sonde${i} = SondeAgents${i};`,
      );
    }
    // Un gate qui ne trouve plus rien à compiler ne garde plus rien, et il le
    // dit en vert. Le seuil est bas à dessein : il constate que l'extraction
    // MORD encore, il ne juge pas la densité du document.
    if (total < 3) {
      throw new Error(
        `seulement ${total} expression(s) extraites des AGENTS.md — l'extraction ne mord plus, ce gate ne prouverait rien`,
      );
    }
    const sonde = path.join(APP, "tests", "agents-md.probe.ts");
    writeFileSync(
      sonde,
      `// Sonde du banc — expressions citées dans les AGENTS.md générés.\n` +
        `${[...new Set(imports)].join("\n")}\n\n${classes.join("\n\n")}\n`,
      "utf8",
    );
    try {
      run("npm", ["run", "typecheck"]);
    } finally {
      rmSync(sonde, { force: true });
    }
  },
);

/**
 * Efface un fichier de travail du banc — et SEULEMENT s'il est dans l'app.
 *
 * Payé pendant l'écriture de l'étape suivante : en débranchant le gate pour le
 * voir rouge, le chemin de la config a été pointé sur celle du DÉPÔT, et le
 * nettoyage de fin l'a supprimée pour de bon. Un `rmSync` sur un chemin calculé
 * doit donc être BORNÉ par construction, jamais par la prudence de qui l'édite.
 */
function effaceDansApp(cible) {
  const dansApp = path.relative(APP, cible);
  if (dansApp.startsWith("..") || path.isAbsolute(dansApp)) {
    throw new Error(
      `refus d'effacer hors de l'application témoin : ${cible} (le banc ne nettoie que ${APP})`,
    );
  }
  rmSync(cible, { force: true });
}

/**
 * Témoin du gate de lint : il DOIT être signalé, sinon le lint ne lit rien.
 *
 * Il porte la faute exacte déjà payée — une erreur re-jetée sans sa `cause`,
 * que le gabarit de config d'un module a portée deux sessions durant.
 */
const OXLINT_TEMOIN = `export function temoinDuBanc(): never {
  try {
    throw new Error("témoin");
  } catch (e) {
    throw new Error(\`témoin \${String(e)}\`);
  }
}
`;

step(
  "le code généré passe le LINT",
  "Un avertissement n'est ni une erreur de type ni une chaîne absente : rien d'autre ne le voit.",
  // Ce que cette étape protège, vécu : le gabarit `defineModuleConfig.ts.tpl`
  // re-jetait une erreur sans sa `cause`. Ni `create.test.ts` (qui cherche des
  // chaînes), ni le typecheck (un avertissement n'est pas un type faux), ni le
  // lint du dépôt (un `.tpl` n'est pas du TypeScript) ne pouvaient le voir. Il
  // a fallu qu'un module GÉNÉRÉ soit commité dans le dépôt pour que la forge
  // le trouve — sur une machine où personne ne débogue.
  () => {
    // La grille est celle du dépôt, COPIÉE dans l'app — pas relue, pas
    // réécrite : le fichier porte des commentaires (JSONC), et le dériver
    // demanderait un parseur qu'on n'a pas. La copie règle en même temps le
    // piège mesuré : les motifs d'exclusion sont résolus depuis le dossier de
    // la CONFIG, si bien que le `tmp/**` du dépôt écartait tout le décor lié —
    // oxlint répondait « No files found to lint » et l'étape rendait VERT sans
    // avoir rien lu. Posés dans l'app, ces mêmes motifs ne désignent plus rien.
    copyFileSync(
      path.join(REPO, ".oxlintrc.json"),
      path.join(APP, ".oxlintrc.banc.json"),
    );
    const rcPath = path.join(APP, ".oxlintrc.banc.json");
    const bin = path.join(
      REPO,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "oxlint.cmd" : "oxlint",
    );
    const lance = () =>
      spawnSync(bin, ["--config", rcPath, "--deny-warnings", "."], {
        cwd: APP,
        encoding: "utf8",
        timeout: 120_000,
        // `oxlint.cmd` est un script batch : son chemin a beau être ABSOLU,
        // Node ne peut pas l'exécuter sans shell. Le symptôme est `status null`
        // — pas un message d'erreur — et la garde ci-dessous le traduisait en
        // « un motif d'exclusion écarte l'application », qui envoyait chercher
        // du côté de la configuration. Cf `lib/exec-portable.mjs`.
        shell: besoinDeShell(bin),
      });
    const temoin = path.join(APP, "tests", "oxlint.selfcheck.ts");
    try {
      // 1. Le gate se prouve AVANT de juger : un témoin fautif doit tomber.
      writeFileSync(temoin, OXLINT_TEMOIN, "utf8");
      const preuve = lance();
      const vu = `${preuve.stdout ?? ""}${preuve.stderr ?? ""}`;
      effaceDansApp(temoin);
      if (preuve.status === 0 || !vu.includes("oxlint.selfcheck")) {
        throw new Error(
          `le lint ne LIT PAS l'application témoin (code ${preuve.status}) — ` +
            `un motif d'exclusion l'écarte, et ce gate rendrait vert sans rien juger :\n${extraitEchec(vu, { budget: 800 })}`,
        );
      }
      // 2. Verdict réel, témoin retiré.
      const verdict = lance();
      if (verdict.status !== 0) {
        throw new Error(
          extraitEchec(`${verdict.stdout ?? ""}${verdict.stderr ?? ""}`),
        );
      }
    } finally {
      effaceDansApp(temoin);
      effaceDansApp(rcPath);
    }
  },
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
  "le MODULE généré tient debout comme un PAQUET",
  "Il compile, se teste, se consomme, et sa config REFUSE une faute de frappe.",
  // Le module est un paquet npm complet — configuration validée, exports,
  // types, documents pour agents, bundler. Chacune de ces pièces peut être
  // fausse sans qu'aucune assertion de chaîne ne s'en aperçoive : c'est
  // exactement par là qu'un défaut est déjà passé sur `create command`.
  //
  // ⚠️ Ce que cette étape ne prouve PAS, et qu'il faut savoir avant de la lire :
  // le `include` du tsconfig d'une application ne contient pas `modules/**`,
  // mais `create module` CHAÎNE les scripts de l'app vers ses workspaces
  // (`ensureWorkspaces`, engine.ts) — le module est donc bien typechecké, testé
  // et bâti par `npm run typecheck|test|build` de l'app. La lecture du seul
  // tsconfig fait conclure à un trou qui n'existe pas ; c'est le chaînage npm
  // qui décide. D'où le TÉMOIN FAUTIF ci-dessous : il constate que ce chaînage
  // MORD, au lieu de le supposer d'après un fichier de configuration.
  //
  // Ce qui restait, lui, sans preuve : la frontière de paquet (les types du
  // module se résolvent-ils depuis l'application ?) et le refus d'une clé de
  // configuration mal orthographiée.
  () => {
    const dossier = path.join(APP, "modules", MODULE);

    // 1. IL COMPILE — avec SON tsconfig, tests compris. La sonde se prouve
    //    d'abord sur un témoin fautif : un typecheck qui ne lit rien rend vert.
    const temoin = path.join(dossier, "nodefony", "temoin-du-banc.ts");
    try {
      writeFileSync(
        temoin,
        'const faux: number = "pas un nombre";\nexport default faux;\n',
        "utf8",
      );
      let aTremble = false;
      try {
        run("npm", ["--workspace", MODULE_PKG, "run", "typecheck"]);
      } catch {
        aTremble = true;
      }
      if (!aTremble) {
        throw new Error(
          "le typecheck du module ne LIT PAS ses sources — un type faux le laisse vert, " +
            "cette sonde ne prouverait rien (vérifier `include` de son tsconfig)",
        );
      }
    } finally {
      effaceDansApp(temoin);
    }
    run("npm", ["--workspace", MODULE_PKG, "run", "typecheck"]);

    // 2. IL SE TESTE — le gabarit livre trois cas (import sans kernel, défauts,
    //    refus d'une config invalide) et rien ne les lançait.
    run("npm", ["--workspace", MODULE_PKG, "run", "test"]);

    // 3. IL SE CONSOMME — ses types doivent se résoudre depuis l'APPLICATION,
    //    pas seulement depuis son propre dossier. C'est la frontière de paquet
    //    que le typecheck du module ne franchit jamais.
    const consommateur = path.join(APP, "nodefony", "consommateur-du-banc.ts");
    try {
      writeFileSync(
        consommateur,
        `import ${PASCAL_MODULE}Module from "${MODULE_PKG}";\n` +
          `export const _sonde: typeof ${PASCAL_MODULE}Module = ${PASCAL_MODULE}Module;\n`,
        "utf8",
      );
      run("npm", ["run", "typecheck"]);
    } finally {
      effaceDansApp(consommateur);
    }

    // 4. SA CONFIG REFUSE UNE FAUTE DE FRAPPE — au DÉMARRAGE, pas en silence.
    //    Zod retire par défaut les clés qu'il ne connaît pas : `use()` avec
    //    `greting` produirait une application qui démarre en ignorant ce que
    //    l'utilisateur a écrit, et le défaut n'éclate qu'à la lecture.
    const manifeste = path.join(APP, "nodefony.config.ts");
    const intact = readFileSync(manifeste, "utf8");
    try {
      // La forme écrite par `create module` est `use("<pkg>", {}),` — cf
      // `engine.ts`. Viser une autre forme rendrait la sonde muette : d'où le
      // refus explicite ci-dessous plutôt qu'un remplacement silencieux.
      const fautif = intact.replace(
        `use("${MODULE_PKG}", {})`,
        `use("${MODULE_PKG}", { greting: "faute de frappe" } as never)`,
      );
      if (fautif === intact) {
        throw new Error(
          `impossible d'injecter une clé fautive dans le manifeste — ` +
            `\`use("${MODULE_PKG}")\` ne s'y trouve pas sous la forme attendue`,
        );
      }
      writeFileSync(manifeste, fautif, "utf8");
      // Le refus peut tomber à DEUX moments, et les deux sont bons : `build`
      // démarre un kernel (c'est ainsi qu'il rend le `dist/`), donc une erreur
      // de configuration l'arrête avant même qu'on inspecte. N'attendre le refus
      // que d'`inspect` faisait lire cette réussite comme un échec du banc.
      let refus = null;
      for (const geste of [
        () => run("npm", ["run", "build"]),
        () => run(process.execPath, [BIN, "inspect", "routes", "--json"]),
      ]) {
        try {
          geste();
        } catch (e) {
          refus = e;
          break;
        }
      }
      if (!refus) {
        throw new Error(
          "une clé de config INCONNUE (`greting`) est acceptée en silence : " +
            "l'application démarre en ignorant ce que l'utilisateur a écrit",
        );
      }
      if (!/greting/u.test(String(refus.message))) {
        throw new Error(
          "l'application refuse, mais SANS nommer la clé fautive — le message " +
            `n'aide pas à corriger : ${String(refus.message).slice(0, 300)}`,
        );
      }
    } finally {
      writeFileSync(manifeste, intact, "utf8");
      run("npm", ["run", "build"]);
    }
  },
);

step(
  "le FRONT généré se bâtit — pour de bon, pas « à jour »",
  "Un composant qui ne compile qu'en développement passe TOUT le reste du banc.",
  // Étape séparée du build ci-dessus, et pour deux raisons qui se cumulent —
  // sans elle, ce banc croirait couvrir le front sans jamais le compiler :
  //
  //  1. `nodefony frontend:build` est INCRÉMENTAL : le front a déjà été bâti
  //     par `create app`, donc le `npm run build` précédent répond « à jour »
  //     et ne compile RIEN. `--force` est ce qui distingue une compilation
  //     d'une constatation de fraîcheur.
  //  2. `create app` AVALE l'échec : il l'annonce (« npm run build a échoué »)
  //     puis rend 0, parce que l'application, elle, est bien créée. Un banc qui
  //     s'en remettrait au code de sortie de la création ne verrait donc jamais
  //     un front cassé — c'est exactement ce qui a laissé une vitrine du dépôt
  //     ne plus se bâtir pendant des semaines.
  //
  // Ce que ça attrape et que rien d'autre ne peut voir : le compilateur de
  // composants monofichiers TRANSFORME le gabarit (une URL littérale y devient
  // un import d'asset), et le mode développement sert la même page sans rien
  // résoudre. Seul un build de PRODUCTION tranche.
  () => run("npx", ["nodefony", "frontend:build", "--force"]),
);

step(
  "la COMMANDE générée s'EXÉCUTE, et son service RÉPOND",
  "Ni le typecheck ni un test ne voient qu'un service n'est pas enregistré au conteneur.",
  // La sonde porte sur le CONTENU de la sortie, et pas sur le code de retour :
  // le gabarit journalise « service non enregistré » puis rend la main
  // NORMALEMENT — un service absent du conteneur sortirait donc en 0. C'est la
  // seule preuve que les trois maillons tiennent ensemble : la classe est
  // enregistrée (`@services`), la commande est câblée (`addCommand`), et la clé
  // de conteneur écrite par le générateur est bien celle du `super(…)` du
  // service.
  () => {
    const out = run(process.execPath, [BIN, commandFullName, "-j"]);
    if (!/"message"\s*:/u.test(out)) {
      throw new Error(
        `${commandFullName} n'a rendu aucun JSON — service « ${SERVICE.toLowerCase()} » ` +
          "absent du conteneur, ou commande non atteignable (elle sort 0 en le journalisant)",
      );
    }
  },
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

/**
 * Le geste que la documentation prescrit à un développeur, et que ce banc ne
 * faisait pas — d'où un e2e qui ne pouvait pas passer.
 *
 * Le harnais e2e généré applique les migrations avant le trafic (c'est le patron
 * de production : en `ddl: none`, le démarrage ne fabrique JAMAIS le schéma).
 * Mais il applique ce qui EXISTE : celles du framework, livrées dans le paquet,
 * et celles de l'application… si quelqu'un les a écrites. Le banc crée cinq
 * entités et n'écrivait jamais les leurs : les tables du framework arrivaient,
 * les tables applicatives non, et toutes les routes de ressources rendaient 500.
 *
 * Une seule commande manquait, celle qu'un développeur tape après avoir modifié
 * une entité. La faire ici, c'est éprouver la chaîne entière — générer, puis
 * appliquer — sur l'application que l'utilisateur reçoit.
 */
step(
  "les migrations de l'application sont ÉCRITES",
  "Le geste du développeur après une entité : `orm:generate`. Sans lui, la " +
    "production démarre sur une base sans tables applicatives.",
  () => {
    // 🔴 Le refus attendu, et son geste de sortie — les deux comptent.
    //
    // À ce point, la base de développement EXISTE et porte déjà les tables :
    // toute commande de l'application démarre un kernel, et en développement le
    // DDL `auto` matérialise le schéma. Demander alors la PREMIÈRE migration,
    // c'est demander un « CREATE TABLE » de tables qui existent — la garde
    // d'adoption le refuse, à raison : le fichier serait inapplicable, et
    // l'adopter graverait un schéma que la base n'a pas.
    //
    // Ce banc ne contourne donc pas le refus : il le CONSTATE, puis fait le
    // geste que le produit prescrit dans sa propre sortie. C'est le parcours
    // réel d'un développeur qui a laissé le mode développement fabriquer sa
    // base — et il vaut mieux que l'ancien, qui ne prouvait qu'une génération
    // sur une base vide : ici, un refus qui n'offrirait pas d'issue ferait
    // tomber l'étape.
    // `run` JETTE sur un code non nul — or ici l'échec est une réponse
    // possible du produit, pas une panne. On exécute donc à la main pour LIRE
    // le refus au lieu de le subir.
    const essai = spawnSync(
      process.execPath,
      [BIN, "orm:generate", "--name", "schema_initial"],
      {
        cwd: APP,
        encoding: "utf8",
        timeout: 600_000,
        env: envDecor(PORTS, {}),
        shell: besoinDeShell(process.execPath),
      },
    );
    const premier = `${essai.stdout ?? ""}${essai.stderr ?? ""}`;
    const refusee = /NF_GENERATE_DATABASE_NOT_ADOPTED/u.test(premier);
    if (essai.status !== 0 && !refusee) {
      throw new Error(
        `orm:generate a échoué pour une autre raison — sortie :\n${premier}`,
      );
    }
    if (refusee) {
      const adoption = run(process.execPath, [
        BIN,
        "orm:migrate:baseline",
        "--from-database",
        "--connector",
        "default",
      ]);
      if (!/déclarée?\(s\) comme appliquée|base_existante/u.test(adoption)) {
        throw new Error(
          `le geste que le refus PRESCRIT n'a rien produit — sortie :\n${adoption}`,
        );
      }
      return;
    }
    if (!/Migration \S+ écrite/u.test(premier)) {
      throw new Error(
        `orm:generate n'a écrit aucune migration — sortie :\n${premier}`,
      );
    }
  },
);

step(
  "une entité `User` AMPUTÉE fait REFUSER — au build ET au démarrage",
  "Le seul chemin qui prouve le contrat de bout en bout : app générée, entité " +
    "de l'application, kernel qui démarre pour de vrai.",
  // 🔴 Ce que rien d'autre ne voit, et pourquoi cette étape existe ici.
  //
  // Le contrôle du contrat de colonnes est éprouvé par des tests unitaires du
  // dépôt (`user-contrat-colonnes.test.ts`, trois dialectes) — mais ceux-là
  // appellent `registerDrizzleFrameworkStores` DIRECTEMENT. Ils ne disent rien
  // du chemin réel : une entité écrite par un développeur dans SON application,
  // compilée dans SON `dist/`, chargée par un kernel qui démarre. Entre les
  // deux il y a le câblage de `index.ts`, l'ordre de chargement des modules,
  // le `dist`, et surtout la POLITIQUE DE RÉSILIENCE DU BOOT — qui a déjà
  // dégradé ce refus en simple avertissement, laissant démarrer une
  // application amputée de six colonnes avec un code de sortie nul.
  //
  // Le geste simulé est celui que le produit REDOUTE : régénérer son `User`
  // avec ses propres champs, et laisser tomber une colonne du contrat en
  // chemin. Sans refus, l'application démarre, la commande qui liste les
  // comptes les AFFICHE, et le défaut n'éclate qu'à la première lecture de la
  // colonne absente — des semaines plus tard.
  () => {
    const entite = path.join(APP, "nodefony", "entity", "User.ts");
    const rendu = path.join(APP, "dist", "nodefony", "entity", "User.js");
    const sourceIntacte = readFileSync(entite, "utf8");
    const renduIntact = readFileSync(rendu, "utf8");
    // 🔴 Les DATES aussi, pas seulement le contenu.
    //
    // Réécrire un fichier à l'identique lui donne un mtime NEUF. Cette étape
    // rendait donc une source plus récente que son `dist` — et l'étape
    // suivante, `nodefony check`, refusait l'application sur « Fraîcheur du
    // build » : des sources ont changé après le dernier build. Un jour entier
    // de forge rouge sur toutes les plateformes, pour un fichier dont pas un
    // octet n'avait bougé. Tout ce qui raisonne sur la fraîcheur — ce
    // contrôle, un build incrémental, un watcher — lit la DATE, jamais le
    // contenu : restaurer un fichier, c'est restaurer sa date.
    const datesSource = statSync(entite);
    const datesRendu = statSync(rendu);

    // Grammaire du moteur de CETTE passe : une table Drizzle est écrite pour un
    // dialecte, et la lire dans un autre LÈVE (mesuré sur les six croisements).
    const grammaire =
      DATABASE === "postgres"
        ? {
            core: "pg-core",
            table: "pgTable",
            col: (nom) => `text("${nom}")`,
            imports: "pgTable, text",
          }
        : DATABASE === "mysql" || DATABASE === "mariadb"
          ? {
              core: "mysql-core",
              table: "mysqlTable",
              col: (nom) => `varchar("${nom}", { length: 255 })`,
              imports: "mysqlTable, varchar",
            }
          : {
              core: "sqlite-core",
              table: "sqliteTable",
              col: (nom) => `text("${nom}")`,
              imports: "sqliteTable, text",
            };

    // Le corps est le MÊME en source et en rendu : le gabarit n'écrit que de
    // l'ESM, et le bundler ne fait ici que retirer les types. Une seule
    // définition, donc, pour que les deux constats portent sur la même entité.
    const corps = `import { defineEntity } from "@nodefony/orm-core";
import { FRAMEWORK_CONNECTOR } from "@nodefony/drizzle";
import { ${grammaire.imports} } from "drizzle-orm/${grammaire.core}";

// SONDE DU BANC — une entité \`User\` d'application à qui manquent des colonnes
// que le framework LIT (\`roles\` en tête). Restaurée en fin d'étape.
export const userTable = ${grammaire.table}("User", {
  id: ${grammaire.col("id")}.primaryKey(),
  identifier: ${grammaire.col("identifier")}.notNull().unique(),
  password: ${grammaire.col("password")},
  createdAt: ${grammaire.col("createdAt")}.notNull(),
  updatedAt: ${grammaire.col("updatedAt")}.notNull(),
});

export const UserEntity = defineEntity({
  name: "User",
  module: "app",
  connector: FRAMEWORK_CONNECTOR,
  schema: userTable,
});
`;

    /** Un refus qui ne dit ni la colonne, ni son lecteur, ni le geste de sortie
     * envoie chercher au hasard : il vaut à peine mieux que le silence. */
    const exigerLeMessage = (sortie, quand) => {
      for (const [quoi, motif] of [
        ["la colonne manquante", /\broles\b/u],
        ["un lecteur de la colonne", /countActiveAdmins|role=/u],
        ["le geste de sortie", /orm:generate/u],
      ]) {
        if (!motif.test(sortie)) {
          throw new Error(
            `${quand} : le refus ne nomme pas ${quoi} — sortie :\n${sortie}`,
          );
        }
      }
    };

    const lancer = (cmd, args) =>
      spawnSync(cmd, args, {
        cwd: APP,
        encoding: "utf8",
        timeout: 600_000,
        env: envDecor(PORTS, {}),
        shell: besoinDeShell(cmd),
      });

    try {
      // ── 1. Au BUILD — le développeur est arrêté au plus tôt ────────────────
      // Le `build` d'une application Nodefony DÉMARRE un kernel (il bâtit le
      // front par la configuration effective), donc le contrôle y tombe déjà.
      // Ce n'est pas le sujet de l'étape, mais c'est gratuit et ça vaut d'être
      // gardé : si un jour le build cessait de booter, ce constat le dirait.
      writeFileSync(entite, corps, "utf8");
      const build = lancer("npm", ["run", "build"]);
      const sortieBuild = `${build.stdout ?? ""}${build.stderr ?? ""}`;
      if (build.status === 0) {
        throw new Error(
          `le build a RÉUSSI avec une entité \`User\` amputée — sortie :\n${sortieBuild}`,
        );
      }
      exigerLeMessage(sortieBuild, "au build");

      // ── 2. Au DÉMARRAGE — le vrai sujet ───────────────────────────────────
      // Le build vient d'échouer : le `dist/` porte donc encore l'entité
      // INTACTE. On ampute le RENDU directement — c'est le seul fichier que le
      // kernel charge, et le seul moyen d'atteindre le démarrage sans repasser
      // par un build qui refuse. Sans cette précaution, l'étape mesurerait un
      // kernel lisant l'entité complète, et serait verte sans rien prouver.
      writeFileSync(entite, sourceIntacte, "utf8");
      writeFileSync(rendu, corps, "utf8");
      if (readFileSync(rendu, "utf8") === renduIntact) {
        throw new Error(
          "le rendu n'a pas changé — l'étape mesurerait l'entité intacte",
        );
      }
      const boot = lancer(process.execPath, [BIN, "orm:migrate:status"]);
      const sortieBoot = `${boot.stdout ?? ""}${boot.stderr ?? ""}`;
      if (boot.status === 0) {
        throw new Error(
          "l'application a DÉMARRÉ avec une entité `User` amputée — le refus " +
            "existe mais la politique de résilience du boot le dégrade en " +
            `avertissement. Sortie :\n${sortieBoot}`,
        );
      }
      exigerLeMessage(sortieBoot, "au démarrage");
    } finally {
      writeFileSync(entite, sourceIntacte, "utf8");
      writeFileSync(rendu, renduIntact, "utf8");
      utimesSync(entite, datesSource.atime, datesSource.mtime);
      utimesSync(rendu, datesRendu.atime, datesRendu.mtime);
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
      // Deux routes, et la seconde n'est pas un doublon : `/api/posts` vient de
      // l'APPLICATION, `/api/<module>` d'un MODULE — un paquet npm séparé, que
      // le Kernel importe par son nom et dont les controllers sont montés par
      // un autre chemin. Un module qui se charge sans monter ses routes rendait
      // 404 sans que rien ne le signale : le boot est vert, l'inventaire des
      // routes se lit hors serveur, et aucune étape ne le frappait EN VRAI.
      for (const chemin of ["/api/posts", `/api/${MODULE}`]) {
        const res = execFileSync(
          process.execPath,
          [
            "-e",
            `fetch("http://127.0.0.1:${PORTS.NF_PORT}${chemin}")` +
              `.then((r) => { if (!r.ok && r.status !== 401 && r.status !== 403) ` +
              `{ console.error("${chemin} → status " + r.status); process.exit(1); } })` +
              `.catch((e) => { console.error("${chemin} → " + String(e.message ?? e)); process.exit(1); })`,
          ],
          { encoding: "utf8", timeout: 30_000 },
        );
        void res;
      }
    } finally {
      // Toujours, même en échec : un serveur détaché qui survit au banc tient
      // les ports et fait échouer le run SUIVANT sur un symptôme sans rapport.
      spawnSync(process.execPath, [BIN, "stop"], {
        cwd: APP,
        encoding: "utf8",
        env: envDecor(PORTS),
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

step(
  "l'app sait émettre le JETON de sa propre porte MCP",
  "Sans audience déclarée, l'émetteur refuse (`invalid_target`) et `ai:mcp --auth` livre une porte que rien n'ouvre.",
  () => {
    // 🔴 Le défaut que cette étape existe pour fermer : le DÉPÔT savait émettre
    // ce jeton grâce à son module de banc, qui déclarait `security.jwt.audiences`
    // pour toute l'application. Aucune application générée ne l'a — et rien ici
    // ne pouvait le montrer, puisque tous les essais tournaient dans le dépôt.
    // Une audience est une décision d'APPLICATION : elle appartient au gabarit,
    // et une étape qui l'EXÉCUTE est la seule preuve qui vaille.
    const out = run(
      process.execPath,
      [BIN, "security:token", "--json", "--ttl", "15", "--scope", "admin:read"],
      APP,
      // La porte MCP est servie par un module de DÉVELOPPEMENT : sans cet
      // environnement, le CLI démarre en production et la porte n'existe pas.
      { NODE_ENV: "development" },
    );
    const token = JSON.parse(out);
    if (typeof token.access_token !== "string" || !token.access_token) {
      throw new Error("aucun token rendu");
    }
    // L'audience INSCRITE, pas celle demandée : c'est elle que la porte
    // comparera à son propre URI, et elle seule dit que le jeton ouvrira.
    const charge = JSON.parse(
      Buffer.from(token.access_token.split(".")[1], "base64url").toString(),
    );
    if (!String(charge.aud ?? "").endsWith("/nodefony/mcp")) {
      throw new Error(
        `token émis pour « ${charge.aud} » — ce n'est pas la porte MCP`,
      );
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
  // ⚠️ Sur une forge, cette machine est JETÉE à la fin du job : le chemin ne
  // désigne alors rien, et il envoie le lecteur ouvrir un dossier qui n'existe
  // plus. Ce qu'il lui reste est l'objet déposé — c'est cela qu'il faut nommer.
  process.stdout.write(
    process.env.CI
      ? `\n  décor NON récupérable (machine de forge jetée) — la preuve est` +
          ` dans l'objet déposé du job, pas dans ${APP}\n`
      : `\n  décor CONSERVÉ pour investigation : ${APP}\n`,
  );
}
process.stdout.write(
  failed
    ? "\n❌ le code généré ne tient pas — corrige avant de dire « fait »\n"
    : "\n✅ le code généré compile, se teste et répond\n",
);
process.exit(failed ? 1 : 0);
