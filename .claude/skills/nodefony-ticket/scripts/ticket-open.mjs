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
 *   node .claude/skills/nodefony-ticket/scripts/ticket-open.mjs --title "fix(x): …" --body-file corps.md \
 *     [--milestone 10.0.0] [--label irrattrapable] [--jours 0.5] \
 *     [--priorite P0|P1|P2|P3] [--parent 63] [--ordre 12.5] [--backlog]
 *
 * `--backlog` retire le jalon et pose le label `backlog` : un jalon promet une
 * date, le backlog n'en promet aucune.
 *
 * L'ORDRE — pourquoi il se pose ICI, à la création
 *
 * `Ordre` encode les DÉPENDANCES : ce qui doit passer avant quoi. Un item qui n'en
 * a pas tombe en fin de tri et n'est jamais proposé — le même oubli silencieux que
 * l'inscription au tableau, une case plus loin. Avec `--parent`, il se DÉRIVE du
 * parent (50 → 50.1, 50.2, …), sur le modèle de la seule grappe qui soit restée
 * cohérente. Sans parent et sans `--ordre`, le script le DIT au lieu de se taire.
 *
 * ⚠️ L'ordre entre frères est celui des DÉPENDANCES, jamais celui des numéros
 * d'issue. Constaté sur la grappe #54 : sept sous-tickets rangés à `numéro − 4`,
 * ce qui plaçait le socle après ce qui en dépend et un ticket d'un autre jalon en
 * tête. Un remplissage mécanique ressemble à un arbitrage et n'en est pas un.
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

/**
 * Dérive l'ordre d'un sous-ticket depuis celui de son parent.
 *
 * Le parent garde son cran entier, chaque enfant prend un dixième dans l'ordre où
 * il DOIT être fait — jamais dans l'ordre où il a été créé. `rang` est le nombre
 * de frères déjà inscrits : le nouvel enfant se range derrière eux.
 *
 * @param parentOrdre - ordre du parent, tel qu'il est au tableau de bord
 * @param rang - nombre de frères DÉJÀ présents (0 pour le premier enfant)
 * @returns l'ordre à poser, arrondi au dixième
 * @throws Si le parent n'a pas d'ordre, ou si la grappe dépasse neuf enfants —
 *   au-delà, un dixième mordrait sur le cran suivant et l'ordre deviendrait faux.
 */
export function deriveOrdre(parentOrdre, rang) {
  if (typeof parentOrdre !== "number" || Number.isNaN(parentOrdre)) {
    throw new Error(
      "le parent n'a pas d'ordre au tableau de bord — le lui poser d'abord, " +
        "sinon la grappe entière tombe en fin de tri",
    );
  }
  if (rang >= 9) {
    throw new Error(
      `grappe de plus de neuf sous-tickets (rang ${rang}) : un dixième mordrait ` +
        "sur le cran suivant — réordonner la grappe à la main",
    );
  }
  return Math.round((parentOrdre + (rang + 1) / 10) * 10) / 10;
}

/** Convention du dépôt (cf `ticket-progress.mjs`) : rien ne s'exécute à l'import,
 * pour que les fonctions pures ci-dessus soient éprouvables sans toucher GitHub. */
if (process.argv[1] && process.argv[1].endsWith("ticket-open.mjs")) {
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

  // L'ORDRE — explicite, sinon dérivé du parent, sinon ANNONCÉ manquant.
  let ordre = args.ordre === undefined ? undefined : Number(args.ordre);
  if (ordre === undefined && args.parent) {
    const items = JSON.parse(
      sh("gh", [
        "project",
        "item-list",
        String(PROJECT),
        "--owner",
        OWNER,
        "--limit",
        "200",
        "--format",
        "json",
      ]),
    ).items;
    const numOf = (it) => it.content?.number;
    const parentItem = items.find((it) => numOf(it) === Number(args.parent));
    const parentOrdre = parentItem?.ordre;
    // Les frères sont les enfants DÉJÀ inscrits : ceux dont l'ordre tombe dans le
    // dixième du parent. On compte, on ne devine pas.
    const rang = items.filter(
      (it) =>
        typeof it.ordre === "number" &&
        numOf(it) !== Number(args.parent) &&
        it.ordre > parentOrdre &&
        it.ordre < parentOrdre + 1,
    ).length;
    try {
      ordre = deriveOrdre(parentOrdre, rang);
    } catch (err) {
      console.error(`⚠️ ordre NON posé — ${err.message}`);
    }
  }
  if (ordre !== undefined) {
    setNumber("Ordre", ordre);
  } else {
    console.error(
      "⚠️ ordre NON posé : cet item tombera en fin de tri et ne sera jamais " +
        "proposé. Le poser avec --ordre, ou rattacher le ticket par --parent.",
    );
  }

  console.log(
    `inscrit au tableau de bord — #${number} · Todo` +
      (args.priorite ? ` · ${args.priorite}` : "") +
      (args.jours ? ` · ${args.jours} j` : "") +
      (ordre !== undefined ? ` · ordre ${ordre}` : " · SANS ORDRE"),
  );
}
