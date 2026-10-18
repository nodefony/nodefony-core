#!/usr/bin/env node
/**
 * Réordonne un lot de tickets au tableau de bord : pose le champ `Ordre` ET la position
 * physique sur la grille (le champ seul ne trie pas la vue).
 *
 * Usage :
 *   node .claude/skills/nodefony-ticket/scripts/ticket-reorder.mjs 630=4.01 472=4.02 …
 *   … --dry-run   affiche le plan sans rien écrire
 *
 * La position se chaîne : le premier ticket (plus petit ordre) se place après l'item de
 * l'empreinte `.ai/board.json` qui porte le plus grand ordre inférieur au sien, puis chaque
 * ticket après le précédent. L'empreinte doit donc être fraîche (`npm run board:snapshot`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const PROJECT = 2;

const gql = (query, vars = {}) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars))
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" })).data;
};

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  console.log("Usage : ticket-reorder.mjs <numéro>=<ordre> … [--dry-run]");
  process.exit(argv.length === 0 ? 1 : 0);
}
const dryRun = argv.includes("--dry-run");
const plan = argv
  .filter((a) => a.includes("="))
  .map((a) => {
    const [n, o] = a.split("=");
    const number = Number(n);
    const ordre = Number(o);
    if (!Number.isInteger(number) || Number.isNaN(ordre))
      throw new Error(`argument illisible : ${a}`);
    return { number, ordre };
  })
  .sort((a, b) => a.ordre - b.ordre);

const board = JSON.parse(readFileSync(path.join(".ai", "board.json"), "utf8"));
const items = board.items ?? board;
const inPlan = new Set(plan.map((p) => p.number));
const before = items
  .filter(
    (i) =>
      !inPlan.has(i.number) &&
      typeof i.ordre === "number" &&
      i.ordre < plan[0].ordre,
  )
  .sort((a, b) => b.ordre - a.ordre)[0];

const meta = gql(
  `query($o:String!,$n:Int!){ organization(login:$o){ projectV2(number:$n){ id
     field(name:"Ordre"){ ... on ProjectV2Field { id } } } } }`,
  { o: OWNER, n: PROJECT },
).organization.projectV2;

const itemId = (number) => {
  const nodes = gql(
    `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){
       projectItems(first:10){ nodes { id project { number } } } } } }`,
    { o: OWNER, r: REPO, n: number },
  ).repository.issue.projectItems.nodes;
  const hit = nodes.find((x) => x.project.number === PROJECT);
  if (!hit)
    throw new Error(`#${number} n'est pas au tableau de bord ${PROJECT}`);
  return hit.id;
};

let previous = before ? itemId(before.number) : null;
console.log(
  `après : ${before ? `#${before.number} (ordre ${before.ordre})` : "tête de grille"}`,
);
for (const step of plan) {
  const id = itemId(step.number);
  console.log(`#${step.number} → ordre ${step.ordre}`);
  if (!dryRun) {
    // L'ordre s'écrit en littéral : `gh -F` ne convertit que les ENTIERS, un 4.01 partirait en chaîne.
    gql(
      `mutation($p:ID!,$i:ID!,$f:ID!){ updateProjectV2ItemFieldValue(input:{
         projectId:$p,itemId:$i,fieldId:$f,value:{number:${step.ordre}}}){ clientMutationId } }`,
      { p: meta.id, i: id, f: meta.field.id },
    );
    const pos = previous
      ? `mutation($p:ID!,$i:ID!,$a:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){ clientMutationId } }`
      : `mutation($p:ID!,$i:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i}){ clientMutationId } }`;
    gql(
      pos,
      previous ? { p: meta.id, i: id, a: previous } : { p: meta.id, i: id },
    );
  }
  previous = id;
}
if (dryRun) console.log("(essai à blanc — rien d'écrit)");
