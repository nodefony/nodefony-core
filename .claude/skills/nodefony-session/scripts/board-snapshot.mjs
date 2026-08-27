#!/usr/bin/env node
/**
 * Instantané du pilotage — projette les tickets GitHub DANS le dépôt.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Le reste-à-faire de la 10.0.0 vit dans les issues : c'est le seul endroit où
 * un état ne se périme pas, puisqu'on le change en faisant le travail. Mais un
 * agent qui reprend une session hors ligne — ou le jour où GitHub ne répond
 * pas — n'a alors AUCUNE vue du pilotage, et se rabat sur un document écrit à
 * la main qui, lui, ment.
 *
 * La réponse est celle de `.ai/symbols.json` : une PROJECTION dérivée, commitée,
 * que personne n'édite. Elle ne peut pas diverger de sa source puisqu'elle n'est
 * jamais écrite à la main ; et `git log -p` donne en prime l'historique du
 * tableau de bord, que GitHub ne rend pas facilement.
 *
 * Deux gardes, toutes deux payées par des vécus du dépôt :
 *   1. un échec d'appel n'écrase JAMAIS l'instantané existant — un instrument
 *      qui rend « vide » sur une panne acquitterait le produit à tort ;
 *   2. une chute brutale du nombre d'items est REFUSÉE (jeton restreint, panne
 *      partielle) sauf `--force` : perdre le filet en silence est pire que ne
 *      pas le rafraîchir.
 *
 * Il vit DANS le skill, pas à la racine : son résultat s'interprète (une
 * empreinte fraîche et une empreinte de trois jours ne disent pas la même
 * chose ; la sortie 2 signifie « non vérifié », ce qui n'est pas un vert) et
 * son moment de lancement appartient au cycle de session — c'est le critère
 * de `scripts-audit.mjs`.
 *
 * @usage    npm run board:snapshot
 * @usage    node .claude/skills/nodefony-session/scripts/board-snapshot.mjs
 * @usage    node .claude/skills/nodefony-session/scripts/board-snapshot.mjs --check
 * @option   --check  ne rien écrire ; sortie 1 si l'empreinte a dérivé, 2 si GitHub est muet
 * @option   --force  passer outre la garde de plausibilité
 * @output   .ai/board.json (machine) + .ai/BOARD.md (lisible) — jamais édités à la main
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const JSON_OUT = path.join(ROOT, ".ai", "board.json");
const MD_OUT = path.join(ROOT, ".ai", "BOARD.md");

const PROJECT_NUMBER = "2";
const PROJECT_OWNER = "nodefony";
/** En deçà, on suspecte la source plutôt que le projet : voir garde n° 2. */
const CHUTE_TOLEREE = 0.5;

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const FORCE = args.has("--force");

/** Lance une commande et rend sa sortie ; les erreurs remontent telles quelles. */
function sh(cmd, argv) {
  return execFileSync(cmd, argv, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Interroge GitHub. Rend `null` si l'API n'est pas joignable — l'appelant
 * décide alors de NE RIEN écrire, ce qui est la seule conduite sûre.
 */
function fetchLive() {
  try {
    sh("gh", ["api", "rate_limit", "--jq", ".rate.remaining"]);
  } catch {
    return null;
  }

  const milestones = JSON.parse(
    sh("gh", [
      "api",
      "repos/:owner/:repo/milestones",
      "--jq",
      "[.[] | {title, open: .open_issues, closed: .closed_issues, dueOn: (.due_on // null)}]",
    ]),
  );

  // GraphQL, et NON `gh project item-list` : mesuré le 27 août, le client en
  // ligne de commande rendait 39 items là où l'API en comptait 40 — un ticket
  // ajouté à la minute était ABSENT de sa sortie, sans le moindre avertissement.
  // Un instrument qui perd une ligne en silence est pire qu'un instrument muet.
  const QUERY = `query($org:String!, $number:Int!, $after:String) {
    organization(login:$org) {
      projectV2(number:$number) {
        items(first:100, after:$after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            fieldValues(first:20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
            content {
              ... on Issue {
                number title url state
                milestone { title }
                labels(first:20) { nodes { name } }
              }
            }
          }
        }
      }
    }
  }`;

  const noeuds = [];
  let after = null;
  for (;;) {
    const argv = [
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-F",
      `org=${PROJECT_OWNER}`,
      "-F",
      `number=${PROJECT_NUMBER}`,
    ];
    if (after) argv.push("-F", `after=${after}`);
    const page = JSON.parse(sh("gh", argv)).data.organization.projectV2.items;
    noeuds.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  /** Les valeurs de champ arrivent en liste : on les indexe par NOM de champ. */
  const champs = (n) => {
    const out = Object.create(null);
    for (const v of n.fieldValues?.nodes ?? []) {
      const nom = v.field?.name;
      if (!nom) continue;
      out[nom] = v.number ?? v.name ?? null;
    }
    return out;
  };

  const items = noeuds
    .filter((n) => n.content?.number)
    .map((n) => {
      const f = champs(n);
      return {
        number: n.content.number,
        // Le titre vient du CONTENU de l'issue, jamais du champ recopié par le
        // tableau de bord : mesuré, 38 items sur 38 portaient l'ancien libellé.
        title: n.content.title,
        url: n.content.url ?? null,
        state: n.content.state ?? null,
        status: f.Status ?? null,
        milestone: n.content.milestone?.title ?? null,
        priorite: f["Priorité"] ?? null,
        jours: typeof f.Jours === "number" ? f.Jours : null,
        ordre: typeof f.Ordre === "number" ? f.Ordre : null,
        labels: (n.content.labels?.nodes ?? []).map((l) => l.name),
      };
    })
    .sort(
      (a, b) => (a.ordre ?? 9999) - (b.ordre ?? 9999) || a.number - b.number,
    );

  return { milestones, items };
}

/** Garde n° 2 — une chute brutale trahit la source, pas le projet. */
function plausible(live, ancien) {
  if (!ancien || !Array.isArray(ancien.items) || ancien.items.length === 0)
    return true;
  const seuil = Math.floor(ancien.items.length * CHUTE_TOLEREE);
  return live.items.length >= seuil;
}

/** Construit l'objet exact qui sera écrit — c'est LUI que `--check` compare. */
function snapshot(live, generatedAt) {
  return {
    generatedAt,
    source: "github:nodefony/nodefony-core",
    project: `${PROJECT_OWNER}/${PROJECT_NUMBER}`,
    ...live,
  };
}

function renderJson(live, generatedAt) {
  return `${JSON.stringify(snapshot(live, generatedAt), null, 2)}\n`;
}

function renderMarkdown(live, generatedAt) {
  const ouverts = live.items.filter((i) => i.status !== "Done");
  const parJalon = new Map();
  for (const it of ouverts) {
    const clef = it.milestone ?? "sans jalon";
    if (!parJalon.has(clef)) parJalon.set(clef, []);
    parJalon.get(clef).push(it);
  }

  const prochain = ouverts.find((i) => i.ordre !== null) ?? ouverts[0] ?? null;

  const lignes = [
    "<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).",
    "     NE PAS ÉDITER À LA MAIN.",
    "     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour",
    "     reprendre le travail hors ligne. L'éditer ferait diverger la copie",
    "     de sa source, ce que ce fichier existe précisément pour empêcher. -->",
    "",
    "# État du pilotage — empreinte des tickets",
    "",
    `> Empreinte prise le **${generatedAt.slice(0, 16).replace("T", " ")}** (UTC).`,
    "> La **source** est le tableau de bord GitHub ; relire ici ne dispense pas de",
    "> vérifier en ligne quand le réseau répond — une empreinte vieille de trois",
    "> jours a manqué trois jours de travail.",
    "",
    "## Jalons",
    "",
    "| Jalon | Ouverts | Fermés | Échéance |",
    "| --- | ---: | ---: | --- |",
    ...live.milestones.map(
      (m) =>
        `| ${m.title} | ${m.open} | ${m.closed} | ${m.dueOn ? m.dueOn.slice(0, 10) : "—"} |`,
    ),
    "",
  ];

  if (prochain) {
    lignes.push(
      "## ➡️ Le prochain dans l'ordre",
      "",
      `**#${prochain.number} — ${prochain.title}**`,
      "",
      `Ordre ${prochain.ordre ?? "—"} · ${prochain.priorite ?? "priorité non posée"} · ${prochain.jours ?? "—"} j · jalon ${prochain.milestone ?? "—"}`,
      "",
      "> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le",
      "> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).",
      "",
    );
  }

  for (const [jalon, items] of parJalon) {
    lignes.push(`## Jalon ${jalon} — ${items.length} ouverts`, "");
    lignes.push(
      "| Ordre | Prio | Jours | Ticket | Titre |",
      "| --- | --- | ---: | --- | --- |",
    );
    for (const it of items) {
      lignes.push(
        `| ${it.ordre ?? "—"} | ${it.priorite ?? "—"} | ${it.jours ?? "—"} | #${it.number} | ${it.title} |`,
      );
    }
    lignes.push("");
  }

  return `${lignes.join("\n")}\n`;
}

function lireAncien() {
  try {
    return JSON.parse(fs.readFileSync(JSON_OUT, "utf8"));
  } catch {
    return null;
  }
}

/** Compare deux instantanés sur ce qui compte — le contenu, pas l'heure. */
function memeContenu(a, b) {
  if (!a || !b) return false;
  const nettoie = ({ generatedAt, ...reste }) => JSON.stringify(reste);
  return nettoie(a) === nettoie(b);
}

const ancien = lireAncien();
const live = fetchLive();

if (!live) {
  if (CHECK) {
    console.error(
      "⚠️  GitHub injoignable — dérive NON vérifiée (ce n'est pas un verdict vert).",
    );
    process.exit(2);
  }
  console.error(
    "⚠️  GitHub injoignable — l'instantané existant est CONSERVÉ tel quel.\n" +
      "   Un échec d'appel ne doit jamais se traduire par un fichier vide : on\n" +
      "   perdrait le filet au moment précis où il sert.",
  );
  process.exit(1);
}

if (!FORCE && !plausible(live, ancien)) {
  console.error(
    `❌ Refus d'écrire : ${live.items.length} items rendus contre ${ancien.items.length} dans l'instantané.\n` +
      "   Une telle chute trahit la source (jeton restreint, panne partielle) plus\n" +
      "   souvent que le projet. Relancer avec --force si la chute est réelle.",
  );
  process.exit(1);
}

const generatedAt = new Date().toISOString();

if (CHECK) {
  const aJour = memeContenu(snapshot(live, generatedAt), ancien);
  if (aJour) {
    console.log(`✅ Instantané à jour — ${live.items.length} items.`);
    process.exit(0);
  }
  console.error(
    "❌ L'instantané a dérivé du tableau de bord. Régénérer : `npm run board:snapshot`.",
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
fs.writeFileSync(JSON_OUT, renderJson(live, generatedAt));
fs.writeFileSync(MD_OUT, renderMarkdown(live, generatedAt));

const ouverts = live.items.filter((i) => i.status !== "Done").length;
console.log(
  `✅ Empreinte écrite — ${live.items.length} items (${ouverts} ouverts) → .ai/board.json + .ai/BOARD.md`,
);
