#!/usr/bin/env node
/**
 * Auto-contrôle des sondes du banc de découvrabilité — le juge, AVANT le verdict.
 *
 * Ce fichier existe parce que les sondes de ce banc ont recalé des agents qui
 * avaient fait JUSTE, quatre fois, sur le même mode de défaillance : une sonde
 * qui lisait les tests alors qu'elle visait la configuration ; une autre qui
 * lisait les tests alors qu'elle visait le code de production ; une regex qui
 * ne franchissait pas la parenthèse d'un appel imbriqué ; un interdit posé sans
 * la condition qui le rend un interdit. À chaque fois le défaut n'a été vu
 * qu'après avoir lancé de vrais agents et relu les diffs à la main — une heure
 * d'analyse pour une faute qu'un échantillon de trois lignes aurait montrée.
 *
 * Le principe : chaque sonde reçoit deux échantillons FIGÉS — un qu'elle doit
 * accepter, un qu'elle doit refuser. Aucun agent n'est lancé, aucun décor n'est
 * monté ; le contrôle coûte quelques secondes et zéro token.
 *
 * Il appelle `evaluateProbe` du banc, jamais une copie de la règle : un
 * auto-contrôle qui réimplémente ce qu'il vérifie ne vérifie que lui-même.
 *
 *   node bench-discoverability.selftest.mjs
 *   node bench-discoverability.selftest.mjs --prove   # ampute chaque sonde
 *
 * Sorties — la distinction compte, et elle est volontaire :
 *   0  toutes les sondes couvertes se comportent comme annoncé, couverture complète
 *   1  une sonde couverte MENT (elle accepte ce qu'elle doit refuser, ou l'inverse)
 *   2  couverture INCOMPLÈTE — les sondes sans échantillon sont NOMMÉES. Un vert
 *      incomplet lu comme un vert complet est le piège maison n° 1 ; une sonde
 *      qu'on ajoute sans son échantillon doit se voir, pas se fondre dans le vert.
 */
import { TASKS, evaluateProbe } from "./bench-discoverability.mjs";

/**
 * Matières par défaut — un échantillon ne renseigne QUE ce qu'il exerce.
 *
 * `added` est le diff des lignes ajoutées : ses lignes commencent par `+`,
 * et plusieurs sondes s'appuient sur cette forme. Les échantillons la
 * respectent, sans quoi ils éprouveraient une matière qui n'existe pas.
 */
const EMPTY = {
  files: [],
  added: "",
  addedTs: "",
  content: "",
  transcript: "",
};

/**
 * Deux échantillons par sonde, indexés `"<id> :: <nom exact>"`.
 *
 * `pass` doit rendre `pass: true`, `fail` doit rendre `pass: false` — y compris
 * pour les sondes inversées, où `pass` est donc l'échantillon VERTUEUX (celui
 * qui ne porte pas l'interdit) et `fail` celui qui porte le contournement.
 *
 * `extra` sert aux cas qu'une paire ne capture pas : aujourd'hui le waiver
 * `unless`, où le motif interdit est présent ET la voie correcte aussi.
 */
const SAMPLES = {
  // ── T1 ────────────────────────────────────────────────────────────────────
  "1 :: a lancé create entity": {
    pass: { transcript: `{"command":"npx nodefony create entity Product"}` },
    fail: {
      transcript: `{"text":"j'écris l'entité à la main dans nodefony/entity"}`,
    },
  },
  "1 :: a lu AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/README.md"}` },
  },
  "1 :: entité générée (nodefony/entity/)": {
    pass: { files: ["nodefony/entity/Product.ts"] },
    fail: { files: ["nodefony/services/Product.ts"] },
  },
  "1 :: pas de CRUD artisanal (ResourceController attendu)": {
    pass: {
      content: `export class ProductController extends ResourceController {}`,
    },
    fail: { content: `export class ProductController extends Controller {}` },
  },
  "1 :: 409 obtenu SANS mapping artisanal (généré/framework attendu)": {
    pass: { added: `+  // le 409 vient du contrat de ressource` },
    fail: { added: `+  throw new nodefonyError("duplicate", 409);` },
  },

  // ── T2 ────────────────────────────────────────────────────────────────────
  "2 :: a lu AGENTS.md ou la doc security": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/firewall.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "2 :: garde du framework (@IsGranted ou zone firewall)": {
    pass: { content: `  @IsGranted("ROLE_ADMIN")\n  async index() {}` },
    fail: {
      content: `  async index() { if (!user) return this.renderJson({}, 401); }`,
    },
  },
  "2 :: pas de contrôle artisanal (401/403 renvoyé à la main)": {
    pass: { added: `+  @IsGranted("ROLE_ADMIN")` },
    fail: { added: `+    return this.renderJson({ error: "nope" }, 403);` },
  },

  // ── T3 ────────────────────────────────────────────────────────────────────
  "3 :: a lancé create controller --kind realtime": {
    pass: {
      transcript: `{"command":"npx nodefony create controller Chat --kind realtime"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create controller Chat"}` },
  },
  "3 :: façade realtime (RealtimeController/@RealtimeChannel)": {
    pass: {
      content: `export class ChatController extends RealtimeController {}`,
    },
    fail: { content: `export class ChatController extends Controller {}` },
  },
  "3 :: pas de WS bas-niveau bricolé côté serveur": {
    pass: { added: `+  @RealtimeChannel("chat")` },
    fail: { added: `+  const wss = new WebSocketServer({ port: 8080 });` },
  },
  "3 :: côté client : la façade isomorphe est montrée (RealtimeClient / nodefony/react)":
    {
      pass: { content: `import { useRealtime } from "nodefony/react";` },
      fail: { content: `const socket = new WebSocket("ws://localhost:5151");` },
    },
  "3 :: pas de client WS recomposé à la main (new WebSocket)": {
    pass: { added: `+  const { messages } = useRealtime("chat");` },
    fail: { added: `+  const socket = new WebSocket("ws://localhost:5151");` },
  },

  // ── T4 ────────────────────────────────────────────────────────────────────
  "4 :: a lancé create command": {
    pass: {
      transcript: `{"command":"npx nodefony create command import:users"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create controller Users"}` },
  },
  "4 :: a lu AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/tsconfig.json"}` },
  },
  "4 :: commande générée (nodefony/command/)": {
    pass: { files: ["nodefony/command/ImportUsers.ts"] },
    fail: { files: ["scripts/import-users.ts"] },
  },
  "4 :: façade du framework (extends Command)": {
    pass: { content: `export class ImportUsers extends Command {}` },
    fail: { content: `export async function main() {}` },
  },
  "4 :: pas de parsing d'argv artisanal ni de parseur tiers": {
    pass: { added: `+    this.addOption("--dry-run", "simule");` },
    fail: { added: `+import { program } from "commander";` },
  },

  // ── T5 ────────────────────────────────────────────────────────────────────
  "5 :: a démarré par le framework (npm run dev / nodefony development)": {
    pass: { transcript: `{"command":"npm run dev"}` },
    fail: { transcript: `{"command":"node dist/index.js"}` },
  },
  "5 :: a employé nodefony status ou nodefony stop": {
    pass: { transcript: `{"command":"npx nodefony stop"}` },
    fail: { transcript: `{"command":"npx nodefony development"}` },
  },
  "5 :: pas d'arrêt bricolé (kill -9 / pkill / lsof)": {
    pass: { transcript: `{"command":"npx nodefony stop"}` },
    fail: { transcript: `{"command":"kill -9 $(lsof -ti:5151)"}` },
  },

  // ── T6 ────────────────────────────────────────────────────────────────────
  "6 :: a interrogé l'environnement (nodefony env)": {
    pass: { transcript: `{"command":"npx nodefony env --json"}` },
    fail: { transcript: `{"command":"cat .env.local"}` },
  },
  "6 :: aucune valeur en dur dans le code TypeScript": {
    // La bonne réponse vit dans `.env.local`, gitignoré : le code, lui, ne doit
    // porter que la LECTURE de la variable.
    pass: { addedTs: `+  url: env.NF_DATABASE_URL,` },
    fail: { addedTs: `+  url: "postgres://user:secret@localhost:5432/app",` },
  },

  // ── T7 ────────────────────────────────────────────────────────────────────
  "7 :: a ouvert le catalogue des modules (contenu vu, pas seulement cité)": {
    pass: {
      transcript: `{"text":"Prends-le quand tes documents sont hétérogènes"}`,
    },
    fail: { transcript: `{"text":"j'ai regardé le catalogue des modules"}` },
  },
  "7 :: a nommé la bonne brique (@nodefony/mongoose)": {
    pass: { content: `npm install @nodefony/mongoose` },
    fail: { content: `npm install mongoose` },
  },
  "7 :: a rapporté la limite ASSUMÉE (les stores que l'adaptateur ne couvre pas)":
    {
      pass: {
        content: `Limite : le store d'idempotence n'est pas couvert par cet adaptateur.`,
      },
      fail: { content: `Cet adaptateur couvre tous les besoins.` },
    },
  "7 :: aucun chemin du monorepo (inapplicable chez l'utilisateur npm)": {
    pass: { added: `+import { defineEntity } from "@nodefony/orm-core";` },
    fail: {
      added: `+import x from "../../src/packages/@nodefony/mongoose/index";`,
    },
  },

  // ── T8 ────────────────────────────────────────────────────────────────────
  "8 :: a demandé au scaffold de se décrire (--describe-json)": {
    pass: {
      transcript: `{"command":"npx nodefony create entity --describe-json"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create entity --help"}` },
  },
  "8 :: a simulé au lieu d'écrire (--dry-run)": {
    pass: {
      transcript: `{"command":"npx nodefony create entity Order --dry-run"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create entity Order"}` },
  },
  "8 :: le plan est écrit (DISCOVERY.md)": {
    pass: { files: ["DISCOVERY.md"] },
    fail: { files: ["docs/DISCOVERY.md"] },
  },

  // ── T9 ────────────────────────────────────────────────────────────────────
  "9 :: a interrogé l'application (nodefony inspect)": {
    pass: { transcript: `{"command":"npx nodefony inspect routes --json"}` },
    fail: { transcript: `{"pattern":"@route","path":"nodefony/controllers"}` },
  },
  "9 :: le rapport est écrit (AUDIT.md)": {
    pass: { files: ["AUDIT.md"] },
    fail: { files: ["audit.md"] },
  },

  // ── T10 ───────────────────────────────────────────────────────────────────
  "10 :: service déclaré au conteneur (@injectable)": {
    pass: {
      content: `@injectable()\nexport class DiscountService extends Service {}`,
    },
    fail: { content: `export class DiscountUtils {}` },
  },
  "10 :: enregistré sur un module (@services([…]))": {
    pass: {
      content: `@services([DiscountService])\nclass App extends Module {}`,
    },
    fail: { content: `class App extends Module {}` },
  },
  "10 :: pas d'instanciation manuelle (new XService())": {
    // Le contournement se juge hors des tests : instancier le service DANS son
    // test est la réponse attendue (« testable seul »), pas une faute. La sonde
    // lisant `addedTs`, l'échantillon vertueux vaut pour le code de production.
    pass: { addedTs: `+    this.discountService = discountService;` },
    fail: { addedTs: `+    const svc = new DiscountService();` },
  },

  // ── T11 ───────────────────────────────────────────────────────────────────
  "11 :: journal du framework (this.log avec une gravité)": {
    pass: {
      content: `this.log({ resource: "order" }, "INFO", "RESOURCE_CREATED");`,
    },
    fail: { content: `this.log("commande créée");` },
  },
  "11 :: pas de console.log (il ne remonte à aucun collecteur)": {
    pass: { added: `+    this.log({ id }, "INFO");` },
    fail: { added: `+    console.log("created", id);` },
  },
  // La charge loggée appelle une méthode : c'est le cas EXACT qui a recalé une
  // réponse exemplaire, et il doit rester couvert pour de bon.
  "11 :: journal du framework (this.log avec une gravité) — charge avec appel imbriqué":
    {
      of: "11 :: journal du framework (this.log avec une gravité)",
      pass: {
        content: `this.log({ pct: this.svc.getDiscountPercentage(), total }, "INFO", "RESOURCE_CREATED");`,
      },
    },

  // ── T12 ───────────────────────────────────────────────────────────────────
  "12 :: accroché à une phase du cycle de vie (onKernelBoot/Ready)": {
    pass: { content: `  async onKernelBoot(): Promise<this> { return this; }` },
    fail: { content: `  async start(): Promise<void> {}` },
  },
  "12 :: pas de temporisation pour « attendre » le démarrage": {
    pass: { added: `+    this.table = await load();`, content: `` },
    fail: {
      added: `+    setTimeout(() => this.load(), 3000);`,
      content: `class App extends Module {}`,
    },
    extra: [
      {
        // Le waiver : l'interdit est là, mais la voie correcte AUSSI — c'est
        // une I/O asynchrone dans un chargement accroché au cycle de vie, pas
        // une temporisation qui attend le démarrage.
        label: "setTimeout d'I/O SOUS un hook de cycle de vie → sans objet",
        matter: {
          added: `+      await new Promise((r) => setTimeout(r, 10));`,
          content: `  async onKernelBoot() { await this.performLoad(); return this; }`,
        },
        expect: true,
      },
    ],
  },

  // ── T13 ───────────────────────────────────────────────────────────────────
  "13 :: a lancé create service": {
    pass: { transcript: `{"command":"npx nodefony create service Vat"}` },
    fail: {
      transcript: `{"text":"j'écris la classe du service à la main"}`,
    },
  },
  "13 :: la dépendance vient du conteneur (@inject ou container.get)": {
    pass: {
      content: `  constructor(module: Module, @inject("VatService") private vat: VatService) {}`,
    },
    fail: { content: `  private vat = new VatService();` },
  },
  "13 :: pas d'exemplaire fabriqué à la main (new XService())": {
    // Le contournement se juge hors des tests : `new VatService()` DANS son
    // test est la réponse attendue (« testable séparément »).
    pass: { addedTs: `+    this.vat = vat;` },
    fail: { addedTs: `+    const vat = new VatService();` },
  },
  "13 :: voie déclarative trouvée (injection par constructeur)": {
    pass: { content: `    @inject("VatService") private vat: VatService,` },
    fail: { content: `    this.vat = this.container.get("vat");` },
  },
  // L'AUTRE voie légitime doit rester acceptée par la sonde de consommation :
  // c'est elle que l'`AGENTS.md` nomme en premier, et la recaler ferait
  // dégrader une réponse juste pour plaire à l'instrument.
  "13 :: la dépendance vient du conteneur (@inject ou container.get) — par résolution":
    {
      of: "13 :: la dépendance vient du conteneur (@inject ou container.get)",
      pass: { content: `    const vat = this.container.get("vat");` },
    },
};

const key = (task, probe) => `${task.id} :: ${probe.name}`;
const matter = (sample) => ({ ...EMPTY, ...sample });

/**
 * Les cas d'un échantillon, mis à plat : paire de base + extras éventuels.
 *
 * `prefix` nomme la PROVENANCE du cas. Sans lui, un cas ajouté par une entrée
 * `of:` porte le même libellé que la paire de base, et le rapport désigne un
 * cas pour un autre — on cherche alors le défaut au mauvais endroit, ce qui est
 * précisément le temps que cet outil doit faire économiser.
 */
function casesFor(entry, prefix = "") {
  const at = (label) => (prefix ? `${prefix} → ${label}` : label);
  const cases = [];
  if (entry.pass)
    cases.push({
      label: at("accepte la bonne réponse"),
      matter: matter(entry.pass),
      expect: true,
    });
  if (entry.fail)
    cases.push({
      label: at("refuse le contournement"),
      matter: matter(entry.fail),
      expect: false,
    });
  for (const x of entry.extra ?? []) {
    cases.push({
      label: at(x.label),
      matter: matter(x.matter),
      expect: x.expect,
    });
  }
  return cases;
}

function main() {
  const prove = process.argv.includes("--prove");
  const probes = [];
  for (const task of TASKS) {
    for (const probe of task.probes) {
      if (probe.kind === "gate") continue;
      probes.push({ task, probe });
    }
  }

  // Un échantillon peut viser une sonde déjà couverte pour ajouter un cas
  // (`of`) : il ne crée pas une couverture, il l'approfondit.
  const extraByProbe = new Map();
  for (const [k, entry] of Object.entries(SAMPLES)) {
    if (!entry.of) continue;
    const list = extraByProbe.get(entry.of) ?? [];
    list.push({ label: k, entry });
    extraByProbe.set(entry.of, list);
  }

  const uncovered = [];
  const wrong = [];
  const toothless = [];
  let checked = 0;

  for (const { task, probe } of probes) {
    const k = key(task, probe);
    const entry = SAMPLES[k];
    if (!entry) {
      uncovered.push(k);
      continue;
    }
    const cases = casesFor(entry);
    for (const { label, entry: e } of extraByProbe.get(k) ?? []) {
      cases.push(
        ...casesFor(e, label.slice(k.length).replace(/^\s*—\s*/u, "")),
      );
    }

    for (const c of cases) {
      checked += 1;
      const { pass } = evaluateProbe(probe, c.matter);
      if (pass !== c.expect) {
        wrong.push(
          `${k}\n      cas « ${c.label} » : attendu ${c.expect ? "accepté" : "refusé"}, obtenu ${pass ? "accepté" : "refusé"}`,
        );
      }
    }

    if (prove) {
      // AMPUTATION — le motif ne peut plus rien reconnaître. Un contrôle qui
      // reste vert sur une sonde aveugle ne contrôle rien : ses échantillons
      // ne l'exercent pas. Vaut pour les deux sens — sur une sonde inversée,
      // c'est le cas « refuse le contournement » qui doit tomber.
      const blind = { ...probe, pattern: /(?!)/u };
      const detected = cases.some(
        (c) => evaluateProbe(blind, c.matter).pass !== c.expect,
      );
      if (!detected) toothless.push(k);
    }
  }

  for (const w of wrong) console.log(`  ✗ ${w}`);
  for (const t of toothless) {
    console.log(
      `  ✗ ${t}\n      amputée, la sonde reste verte — les échantillons ne l'exercent pas`,
    );
  }
  for (const u of uncovered) console.log(`  ⚠ non couverte : ${u}`);

  const covered = probes.length - uncovered.length;
  console.log(
    `\n━━ ${covered}/${probes.length} sonde(s) couverte(s), ${checked} cas joué(s)` +
      (prove ? ` — amputation vérifiée sur ${covered}` : "") +
      `${wrong.length + toothless.length > 0 ? `, ${wrong.length + toothless.length} DÉFAUT(S)` : ""}`,
  );

  if (wrong.length > 0 || toothless.length > 0) return 1;
  if (uncovered.length > 0) {
    console.log(
      `(${uncovered.length} sonde(s) sans échantillon — le contrôle ne dit RIEN d'elles)`,
    );
    return 2;
  }
  return 0;
}

process.exit(main());
