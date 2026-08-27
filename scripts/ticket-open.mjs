#!/usr/bin/env node
/**
 * Ouvre un ticket ET l'inscrit au tableau de bord, d'un seul geste.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * `gh issue create` crée l'issue et s'arrête là : elle n'entre PAS au tableau de
 * bord. Un ticket hors tableau est invisible de tout compteur d'avancement — il ne
 * figure ni dans l'ordre de travail, ni dans le reste-à-faire, et personne ne
 * s'aperçoit qu'il manque. Constaté sur #82, ouvert et resté hors tableau jusqu'à
 * un contrôle manuel. Un oubli qui ne se voit pas est pire qu'une erreur qui crie.
 *
 * Les champs se posent dans la foulée pour la même raison : un item sans priorité
 * ni estimation ne se trie pas, donc ne se prend jamais.
 *
 * Usage :
 *   node scripts/ticket-open.mjs --title "fix(x): …" --body-file corps.md \
 *     [--milestone 10.0.0] [--label irrattrapable] [--jours 0.5] \
 *     [--priorite P0|P1|P2|P3] [--parent 63] [--backlog]
 *
 * `--backlog` retire le jalon et pose le label `backlog` : un jalon promet une
 * date, le backlog n'en promet aucune.
 */
import { execFileSync } from "node:child_process";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const PROJECT = 2;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/** Lit `--clé valeur` et les drapeaux, en autorisant les clés répétables. */
export function parseArgs(argv) {
  const out = { label: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "backlog") {
      out.backlog = true;
      continue;
    }
    const value = argv[i + 1];
    i += 1;
    if (key === "label") out.label.push(value);
    else out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.title || !args.bodyFile) {
  console.error("usage : --title <titre> --body-file <fichier> [options]");
  process.exit(2);
}

const create = [
  "issue",
  "create",
  "--repo",
  `${OWNER}/${REPO}`,
  "--title",
  args.title,
  "--body-file",
  args.bodyFile,
  "--assignee",
  "@me",
];
if (args.backlog) {
  create.push("--label", "backlog");
} else if (args.milestone) {
  create.push("--milestone", args.milestone, "--label", args.milestone);
}
for (const l of args.label) create.push("--label", l);
if (args.parent) create.push("--parent", args.parent);

const url = sh("gh", create).split("\n").pop();
const number = url.split("/").pop();
console.log(`ouvert : ${url}`);

// L'inscription au tableau — la moitié que `gh issue create` ne fait pas.
const projectId = JSON.parse(
  sh("gh", [
    "project",
    "view",
    String(PROJECT),
    "--owner",
    OWNER,
    "--format",
    "json",
  ]),
).id;
const itemId = JSON.parse(
  sh("gh", [
    "project",
    "item-add",
    String(PROJECT),
    "--owner",
    OWNER,
    "--url",
    url,
    "--format",
    "json",
  ]),
).id;

const fields = JSON.parse(
  sh("gh", [
    "project",
    "field-list",
    String(PROJECT),
    "--owner",
    OWNER,
    "--format",
    "json",
  ]),
).fields;
const field = (name) => fields.find((f) => f.name === name);

const setSelect = (name, prefix) => {
  const f = field(name);
  const opt = f?.options?.find((o) => o.name.startsWith(prefix));
  if (!f || !opt) return;
  sh("gh", [
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    projectId,
    "--field-id",
    f.id,
    "--single-select-option-id",
    opt.id,
  ]);
};
const setNumber = (name, value) => {
  const f = field(name);
  if (!f || value === undefined) return;
  sh("gh", [
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    projectId,
    "--field-id",
    f.id,
    "--number",
    String(value),
  ]);
};

setSelect("Status", "Todo");
if (args.priorite) setSelect("Priorité", args.priorite);
if (args.jours) setNumber("Jours", Number(args.jours));

console.log(
  `inscrit au tableau de bord — #${number} · Todo` +
    (args.priorite ? ` · ${args.priorite}` : "") +
    (args.jours ? ` · ${args.jours} j` : ""),
);
