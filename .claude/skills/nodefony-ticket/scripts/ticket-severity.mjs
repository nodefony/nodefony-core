#!/usr/bin/env node
/**
 * Pose la gravité d'un ticket existant : la colonne « Gravité » du tableau de
 * bord (classe de l'IEEE 1044, SOURCE de la classe) et, au corps, la ligne du
 * motif — plus la ligne CVSS 3.1, score CALCULÉ, quand le défaut est une faille.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * La classe vit dans une colonne du tableau, que `gh issue edit` ne sait pas
 * poser : il faut l'identifiant de l'item, du champ et de l'option. Fait à la
 * main, le geste se rate (une colonne posée, le motif oublié, ou l'inverse) et
 * `ticket:lint` le signale ensuite (`BUG-SANS-GRAVITE`). `ticket:open --gravite`
 * fait le même geste à la création ; celui-ci sert aux tickets déjà ouverts —
 * ceux d'avant la règle, et ceux nés du formulaire GitHub, qui ne peut pas
 * poser une colonne du tableau.
 *
 * @usage  node .claude/skills/nodefony-ticket/scripts/ticket-severity.mjs <N> "<Classe> — motif" [--cvss CVSS:3.1/…]
 * @option --cvss  vecteur CVSS 3.1 d'une faille (le score est calculé et écrit au corps)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardCli } from "../../nodefony-session/scripts/cli-guard.mjs";
import { checkCvss, checkSeverity, withSeverityLine } from "./severity.mjs";

const OWNER = "nodefony";
const REPO = "nodefony-core";
const PROJECT = 2;
const FIELD = "Gravité";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/**
 * Lit l'identifiant de l'item du tableau qui porte une issue.
 *
 * @param numero - numéro de l'issue
 * @returns l'identifiant de l'item, ou `null` si l'issue n'est pas au tableau
 */
function itemOf(numero) {
  const out = sh("gh", [
    "api",
    "graphql",
    "-f",
    `query=query{repository(owner:"${OWNER}",name:"${REPO}"){issue(number:${Number(
      numero,
    )}){projectItems(first:10){nodes{id project{number}}}}}}`,
  ]);
  const nodes =
    JSON.parse(out)?.data?.repository?.issue?.projectItems?.nodes ?? [];
  return nodes.find((n) => n.project?.number === PROJECT)?.id ?? null;
}

/**
 * Pose une option d'un champ à choix unique sur un item du tableau.
 *
 * @param itemId - identifiant de l'item
 * @param fieldName - nom du champ
 * @param optionName - nom exact de l'option
 * @throws Si le champ ou l'option n'existent pas au tableau
 */
export function setSingleSelect(itemId, fieldName, optionName) {
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
  const field = fields.find((f) => f.name === fieldName);
  const option = field?.options?.find((o) => o.name === optionName);
  if (!field || !option) {
    throw new Error(
      `champ « ${fieldName} » ou option « ${optionName} » absent du tableau`,
    );
  }
  sh("gh", [
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    projectId,
    "--field-id",
    field.id,
    "--single-select-option-id",
    option.id,
  ]);
}

/**
 * Lit `<N> "<Classe> — motif" [--cvss <vecteur>]`, l'option à n'importe quelle place.
 *
 * @param argv - arguments de la ligne de commande, sans `node` ni le script
 * @returns `{ numero, gravite, cvss }` — `cvss` vaut `null` sans l'option
 */
export function parseSeverityArgs(argv) {
  const out = { numero: undefined, gravite: undefined, cvss: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--cvss") {
      out.cvss = argv[i + 1] ?? null;
      i += 1;
    } else rest.push(argv[i]);
  }
  [out.numero, out.gravite] = rest;
  return out;
}

if (process.argv[1]?.endsWith("ticket-severity.mjs")) {
  guardCli(import.meta.url);
  const {
    numero,
    gravite,
    cvss: cvssArg,
  } = parseSeverityArgs(process.argv.slice(2));
  if (!numero || !gravite) {
    console.error(
      'usage : ticket-severity.mjs <N> "<Classe> — motif" [--cvss CVSS:3.1/…]',
    );
    process.exit(2);
  }
  const checked = checkSeverity(gravite);
  if (!checked.ok) {
    console.error(`refusé : ${checked.reason}`);
    process.exit(2);
  }
  const cvss = cvssArg === null ? null : checkCvss(cvssArg);
  if (cvss && !cvss.ok) {
    console.error(`refusé : ${cvss.reason}`);
    process.exit(2);
  }
  const itemId = itemOf(numero);
  if (itemId === null) {
    console.error(
      `refusé : #${String(numero)} n'est pas au tableau de bord — l'y inscrire d'abord`,
    );
    process.exit(2);
  }
  let body = sh("gh", [
    "issue",
    "view",
    String(numero),
    "--repo",
    `${OWNER}/${REPO}`,
    "--json",
    "body",
    "-q",
    ".body",
  ]);
  body = withSeverityLine(body, checked.line);
  if (cvss) body = withSeverityLine(body, cvss.line);
  // Le corps passe par un fichier : un corps de ticket dépasse vite ce qu'une
  // ligne de commande porte, et il contient des caractères que le shell lirait.
  const dir = mkdtempSync(join(tmpdir(), "nf-severity-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, body);
    sh("gh", [
      "issue",
      "edit",
      String(numero),
      "--repo",
      `${OWNER}/${REPO}`,
      "--body-file",
      file,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  setSingleSelect(itemId, FIELD, checked.cls);
  console.log(
    `#${String(numero)} · Gravité = ${String(checked.cls)}` +
      (cvss ? ` · ${cvss.line.replace("**CVSS** : ", "CVSS ")}` : ""),
  );
}
