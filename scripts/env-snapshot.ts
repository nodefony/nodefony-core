#!/usr/bin/env tsx
/**
 * Catalogue des variables d'environnement — projection DÉRIVÉE, jamais saisie.
 *
 * ## Pourquoi ce script existe
 *
 * Sur ce dépôt, une variable d'environnement absente ne lève presque jamais :
 * elle fait **sauter des tests en silence**, et un test sauté compte comme vert.
 * Le coût ne se voit donc pas au moment où il est payé — il se voit des jours
 * plus tard, quand on découvre que la preuve qu'on croyait avoir n'existe pas.
 *
 * La question qui coûte le plus n'est pas « que fait cette variable ? » mais
 * **« que se passe-t-il si elle est absente ? »**. C'est le seul champ que
 * personne ne peut déduire du code sans le lire en entier, et c'est celui que
 * ce catalogue exige.
 *
 * ## Ce qui est catalogué, et ce qui ne l'est pas
 *
 * Le périmètre se **CONSTATE**, il ne se choisit pas — trois familles, décidées
 * par le SITE de lecture :
 *
 * - **infra** et **interrupteur de coût** : déjà décrites dans `vitest.gates.ts`,
 *   source unique du dépôt. Elles sont **LUES** de là, jamais redéclarées : deux
 *   descriptions de la même variable divergent, c'est le défaut que ce fichier
 *   existe pour ne pas reproduire.
 * - **décor de banc** : lue UNIQUEMENT par du code de test ou de harnais, jamais
 *   par le produit. C'est la famille qui a coûté, c'est donc la seule dont la
 *   description est **EXIGÉE** (catalogue `env-catalog.ts`).
 * - **runtime produit** : lue par le produit. Relevée pour mémoire, sans
 *   description exigée — sa vérité est son TSDoc, au site de lecture.
 *
 * ## Ce qui rend l'instrument fiable
 *
 * Le **refus**, pas le document. Le script sort non nul dans les deux sens de
 * dérive : une variable de décor lue sans description, une description sans
 * lecture. Sans cela, ce serait un fichier de plus qui vieillit — et une page
 * qui ment coûte plus cher que pas de page.
 *
 * @example
 * ```bash
 * tsx scripts/env-snapshot.ts          # écrit .ai/env.json + .ai/ENV.md
 * tsx scripts/env-snapshot.ts --check  # ne rien écrire : juste le verdict
 * ```
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BENCH_DECOR, type IEnvDeclaration } from "./env-catalog";
import {
  OPT_IN_SWITCHES,
  PG_GATE,
  MYSQL_GATE,
  MYSQL_COMMUNITY_GATE,
  REDIS_GATE,
  MONGO_GATE,
  LOKI_GATE,
  OPENSEARCH_GATE,
  PROXY_GATE,
  gateEnv,
  type EnvGate,
} from "../vitest.gates";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");

/** Dossiers balayés — les seuls qui portent du code exécuté. */
const SCANNED = ["src", "scripts"];

/** Ce qu'on ne lit jamais : produit du build, dépendances, artefacts. */
const IGNORED = new Set(["node_modules", "dist", ".git", "coverage", "tmp"]);

/** Familles, dans l'ordre où elles sont utiles à celui qui cherche. */
type Family = "infra" | "interrupteur" | "décor de banc" | "runtime produit";

/** Une lecture relevée sur le disque. */
interface IReading {
  /** Chemin relatif à la racine, TOUJOURS en « / » : il voyage. */
  file: string;
  /** Ligne, 1-indexée. */
  line: number;
}

/** Une variable, telle que le catalogue la rend. */
interface IEnvEntry {
  name: string;
  family: Family;
  /** Le rôle, en une phrase — d'où qu'il vienne. */
  what: string | null;
  /** Grammaire des valeurs acceptées, si elle est bornée. */
  values: string | null;
  /** Ce qui se passe quand elle est absente. Exigé pour le décor de banc. */
  absent: string | null;
  /** Décor auquel elle appartient, pour grouper ce qui se pose ensemble. */
  group: string | null;
  /** Chaque site qui la LIT. */
  readings: IReading[];
}

/**
 * Un fichier est-il du code de banc ?
 *
 * Constaté sur le CHEMIN, jamais déduit d'un nom de variable : c'est le site de
 * lecture qui décide de la famille, et un chemin ne se trompe pas sur
 * lui-même. Le module `src/modules/test` en fait partie — il n'existe que pour
 * les bancs, et ses entités portent des décors (cf `NF_ADOPT_FIXTURE`).
 *
 * @param rel - chemin relatif à la racine, en « / ».
 * @returns vrai si ce fichier ne s'exécute que sous un banc.
 */
function isBenchFile(rel: string): boolean {
  return (
    rel.includes("/tests/") ||
    rel.startsWith("tests/") ||
    rel.endsWith(".test.ts") ||
    rel.includes("harness") ||
    rel.startsWith("src/modules/test/")
  );
}

/**
 * Toutes les lectures d'une variable `NF_*` sous un dossier, et toutes ses
 * RÉFÉRENCES — deux relevés distincts, pour deux usages distincts.
 *
 * Les **lectures** (`process.env.NF_X`, `process.env["NF_X"]`) sont ce que le
 * catalogue publie : un ancrage `fichier:ligne` où l'on voit ce que la variable
 * fait.
 *
 * Les **références** ratissent bien plus large — un accès `<objet>.NF_X`, un
 * littéral `"NF_X"` — et ne servent QU'AU CLASSEMENT. Elles existent parce que
 * le produit ne lit pas toujours `process.env` en direct : il passe par un objet
 * d'environnement injecté (`env.NF_REDIS_HOST`) ou par une table de noms
 * (`pick(env, ["NF_DATABASE_URL", …])`). Sans ce second relevé, ces variables
 * paraissent n'être lues que par des bancs, et le générateur exige d'elles une
 * description de décor qu'elles ne méritent pas. **Un refus FAUX est pire qu'une
 * absence** : il apprend à passer outre l'instrument.
 *
 * @param dir - dossier à balayer, absolu.
 * @param out - accumulateur des lectures, indexé par nom de variable.
 * @param refs - accumulateur des fichiers qui MENTIONNENT chaque variable.
 */
async function scan(
  dir: string,
  out: Map<string, IReading[]>,
  refs: Map<string, Set<string>>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORED.has(e.name)) {
      continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await scan(full, out, refs);
      continue;
    }
    if (!/\.(ts|mts|mjs|js|tsx)$/.test(e.name)) {
      continue;
    }
    const content = await fs.readFile(full, "utf8");
    if (!content.includes("NF_")) {
      continue;
    }
    // Un chemin qui VOYAGE s'écrit en « / » : celui-ci part dans un JSON et
    // dans une page, où il est lu sur trois systèmes.
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] as string;
      for (const m of text.matchAll(
        /process\.env\.(NF_[A-Z0-9_]+)|process\.env\[["'](NF_[A-Z0-9_]+)["']\]/g,
      )) {
        const name = (m[1] ?? m[2]) as string;
        const list = out.get(name) ?? [];
        list.push({ file: rel, line: i + 1 });
        out.set(name, list);
      }
      for (const m of text.matchAll(/[.["'](NF_[A-Z0-9_]+)/g)) {
        const name = m[1] as string;
        const set = refs.get(name) ?? new Set<string>();
        set.add(rel);
        refs.set(name, set);
      }
    }
  }
}

/** Les gates d'infra, avec le nom sous lequel le rapport les affiche. */
const GATES: ReadonlyArray<{ gate: EnvGate }> = [
  { gate: PG_GATE },
  { gate: MYSQL_GATE },
  { gate: MYSQL_COMMUNITY_GATE },
  { gate: REDIS_GATE },
  { gate: MONGO_GATE },
  { gate: LOKI_GATE },
  { gate: OPENSEARCH_GATE },
  { gate: PROXY_GATE },
];

/**
 * Ce que `vitest.gates.ts` sait déjà — lu, jamais recopié.
 *
 * @returns pour chaque variable d'infra ou d'interrupteur, sa description.
 */
function fromGates(): Map<
  string,
  { family: Family; what: string; group: string }
> {
  const known = new Map<
    string,
    { family: Family; what: string; group: string }
  >();
  for (const { gate } of GATES) {
    for (const name of gateEnv(gate)) {
      known.set(name, {
        family: "infra",
        what: `Ouvre la cible d'infrastructure « ${gate.label} ».`,
        group: gate.label,
      });
    }
  }
  for (const s of OPT_IN_SWITCHES) {
    known.set(s.env, {
      family: "interrupteur",
      what: s.what,
      group: "interrupteurs de coût",
    });
  }
  return known;
}

/**
 * Compose le catalogue à partir du disque et des deux sources déclaratives.
 *
 * @returns les entrées triées par nom, et les écarts qui doivent faire échouer.
 */
async function build(): Promise<{
  entries: IEnvEntry[];
  undeclared: string[];
  orphans: string[];
}> {
  const readings = new Map<string, IReading[]>();
  const refs = new Map<string, Set<string>>();
  for (const d of SCANNED) {
    await scan(path.join(ROOT, d), readings, refs);
  }
  const gates = fromGates();
  const entries: IEnvEntry[] = [];
  const undeclared: string[] = [];

  for (const [name, sites] of [...readings.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const known = gates.get(name);
    if (known) {
      entries.push({
        name,
        family: known.family,
        what: known.what,
        values: null,
        absent: null,
        group: known.group,
        readings: sites,
      });
      continue;
    }
    // La famille se CONSTATE : ni lue, ni même MENTIONNÉE hors d'un banc. Le
    // classement est conservateur — au moindre doute, runtime produit.
    const mentions = refs.get(name) ?? new Set<string>();
    const benchOnly =
      sites.every((s) => isBenchFile(s.file)) &&
      [...mentions].every((f) => isBenchFile(f));
    if (!benchOnly) {
      entries.push({
        name,
        family: "runtime produit",
        what: null,
        values: null,
        absent: null,
        group: null,
        readings: sites,
      });
      continue;
    }
    const decl: IEnvDeclaration | undefined = BENCH_DECOR[name];
    if (!decl) {
      undeclared.push(name);
      continue;
    }
    entries.push({
      name,
      family: "décor de banc",
      what: decl.what,
      values: decl.values ?? null,
      absent: decl.absent,
      group: decl.group,
      readings: sites,
    });
  }

  // L'autre sens de la dérive : une description que plus rien ne lit. Elle est
  // aussi trompeuse que l'absence — on cherche une variable qui n'existe plus.
  const orphans = Object.keys(BENCH_DECOR)
    .filter((n) => !readings.has(n))
    .sort();

  return { entries, undeclared, orphans };
}

/**
 * Rend la page destinée aux humains et aux agents.
 *
 * @param entries - le catalogue composé.
 * @returns le markdown complet.
 */
function renderMarkdown(entries: IEnvEntry[]): string {
  const byFamily = (f: Family): IEnvEntry[] =>
    entries.filter((e) => e.family === f);
  let out =
    `<!-- GÉNÉRÉ par scripts/env-snapshot.ts (npm run env:snapshot).\n` +
    `     NE PAS ÉDITER À LA MAIN.\n` +
    `     Les descriptions d'infra et d'interrupteurs viennent de vitest.gates.ts ;\n` +
    `     celles du décor de banc de scripts/env-catalog.ts. Éditer ici ferait\n` +
    `     diverger la copie de sa source, ce que ce fichier existe pour empêcher. -->\n\n` +
    `# Variables d'environnement du dépôt\n\n` +
    `> **La question utile est « absente ⇒ quoi ? »** — sur ce dépôt une variable\n` +
    `> manquante ne lève presque jamais : elle fait sauter des tests en silence,\n` +
    `> et un test sauté compte comme vert.\n\n` +
    `| Famille | Variables |\n| --- | ---: |\n` +
    `| Infrastructure | ${byFamily("infra").length} |\n` +
    `| Interrupteur de coût | ${byFamily("interrupteur").length} |\n` +
    `| Décor de banc | ${byFamily("décor de banc").length} |\n` +
    `| Runtime produit | ${byFamily("runtime produit").length} |\n\n`;

  out +=
    `## Décor de banc\n\n` +
    `Lues UNIQUEMENT par du code de test ou de harnais. Leur absence ne casse\n` +
    `rien : elle change ce qui est EXÉCUTÉ.\n\n`;
  const groups = new Map<string, IEnvEntry[]>();
  for (const e of byFamily("décor de banc")) {
    const g = e.group ?? "divers";
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  for (const [group, list] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out += `### ${group}\n\n| Variable | Rôle | Valeurs | Absente ⇒ |\n| --- | --- | --- | --- |\n`;
    for (const e of list) {
      out += `| \`${e.name}\` | ${e.what} | ${e.values ?? "—"} | ${e.absent} |\n`;
    }
    out += "\n";
  }

  out +=
    `## Infrastructure\n\n` +
    `Décrites dans [\`vitest.gates.ts\`](../vitest.gates.ts), qui porte AUSSI la\n` +
    `commande docker et le rapporteur qui fait échouer la CI quand une cible\n` +
    `déclarée n'a pas été exercée.\n\n| Variable | Cible |\n| --- | --- |\n`;
  for (const e of byFamily("infra")) {
    out += `| \`${e.name}\` | ${e.group} |\n`;
  }

  out += `\n## Interrupteurs de coût\n\n| Variable | Ce qu'il ouvre |\n| --- | --- |\n`;
  for (const e of byFamily("interrupteur")) {
    out += `| \`${e.name}\` | ${e.what} |\n`;
  }

  const runtime = byFamily("runtime produit");
  out +=
    `\n## Runtime produit (${runtime.length})\n\n` +
    `Lues par le produit : leur vérité est le TSDoc de leur site de lecture, et\n` +
    `c'est là qu'elle doit rester — la recopier ici en ferait une seconde vérité.\n` +
    `Ce relevé donne le premier site de lecture, pour y aller directement.\n\n` +
    `| Variable | Premier site |\n| --- | --- |\n`;
  for (const e of runtime) {
    const first = e.readings[0] as IReading;
    out += `| \`${e.name}\` | \`${first.file}:${first.line}\` |\n`;
  }
  return `${out}\n`;
}

/**
 * Point d'entrée — écrit les deux fichiers, ou rend le verdict seul.
 */
async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const { entries, undeclared, orphans } = await build();

  if (undeclared.length > 0 || orphans.length > 0) {
    if (undeclared.length > 0) {
      process.stderr.write(
        `\n❌ ${undeclared.length} variable(s) de décor de banc LUE(S) sans description :\n` +
          undeclared.map((n) => `   • ${n}\n`).join("") +
          `\n   Les décrire dans scripts/env-catalog.ts (rôle, valeurs, « absente ⇒ quoi ? »).\n` +
          `   Une variable de décor sans description fait sauter un banc en silence :\n` +
          `   c'est exactement ce que ce catalogue existe pour rendre visible.\n`,
      );
    }
    if (orphans.length > 0) {
      process.stderr.write(
        `\n❌ ${orphans.length} description(s) que PLUS RIEN ne lit :\n` +
          orphans.map((n) => `   • ${n}\n`).join("") +
          `\n   Les retirer de scripts/env-catalog.ts. Une description orpheline envoie\n` +
          `   chercher une variable qui n'existe plus — elle coûte plus qu'elle ne rend.\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const json = {
    generatedBy: "scripts/env-snapshot.ts",
    counts: {
      infra: entries.filter((e) => e.family === "infra").length,
      interrupteur: entries.filter((e) => e.family === "interrupteur").length,
      decor: entries.filter((e) => e.family === "décor de banc").length,
      runtime: entries.filter((e) => e.family === "runtime produit").length,
    },
    variables: entries,
  };

  if (check) {
    process.stdout.write(
      `✓ catalogue cohérent — ${entries.length} variables ` +
        `(${json.counts.decor} de décor décrites, ${json.counts.runtime} de runtime relevées)\n`,
    );
    return;
  }

  await fs.writeFile(
    path.join(ROOT, ".ai", "env.json"),
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(ROOT, ".ai", "ENV.md"),
    renderMarkdown(entries),
    "utf8",
  );
  process.stdout.write(
    `✓ .ai/env.json + .ai/ENV.md — ${entries.length} variables ` +
      `(${json.counts.decor} de décor, ${json.counts.runtime} de runtime)\n`,
  );
}

await main();
