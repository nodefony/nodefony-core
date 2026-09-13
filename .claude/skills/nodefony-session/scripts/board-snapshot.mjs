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
import { chooseNextTicket } from "./board-next.mjs";

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
// Le dépôt, pour composer les badges d'avancement de shields.io. Ils
// interrogent GitHub à la LECTURE de la page : ils ne se périment pas avec
// cette empreinte, contrairement à tout le reste de ce fichier.
const REPO_OWNER = "nodefony";
const REPO_NAME = "nodefony-core";
/** En deçà, on suspecte la source plutôt que le projet : voir garde n° 2. */
const CHUTE_TOLEREE = 0.5;

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const FORCE = args.has("--force");
const README = args.has("--readme");
/** Montre ce qui PARTIRAIT chez GitHub, sans rien y écrire. */
const DRY = args.has("--dry-run");

export const ITEMS_QUERY = `query($org:String!, $number:Int!, $after:String) {
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
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
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
      "[.[] | {number, title, open: .open_issues, closed: .closed_issues, dueOn: (.due_on // null)}]",
    ]),
  );

  // GraphQL, et NON `gh project item-list` : mesuré le 27 août, le client en
  // ligne de commande rendait 39 items là où l'API en comptait 40 — un ticket
  // ajouté à la minute était ABSENT de sa sortie, sans le moindre avertissement.
  // Un instrument qui perd une ligne en silence est pire qu'un instrument muet.
  const QUERY = ITEMS_QUERY;

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

  return { milestones, items: projectItems(noeuds) };
}

/**
 * Indexe par NOM les valeurs de champ d'un item — elles arrivent en liste plate,
 * et chaque type de champ porte sa valeur sous une clef différente.
 *
 * @param n - un nœud d'item du tableau de bord
 * @returns un objet `{ [nom du champ]: valeur }`
 */
export function indexFieldValues(n) {
  const out = Object.create(null);
  for (const v of n.fieldValues?.nodes ?? []) {
    const nom = v.field?.name;
    if (!nom) continue;
    // ⚠️ `?? v.date` n'est pas décoratif : une valeur de DATE n'arrive ni sous
    // `number` ni sous `name`. Sans elle la frise se lit `null` sans une erreur.
    out[nom] = v.number ?? v.name ?? v.date ?? null;
  }
  return out;
}

/**
 * Projette les nœuds bruts du tableau de bord en items d'empreinte, triés.
 *
 * Pure et exportée : c'est le maillon où une donnée peut disparaître en
 * silence, donc celui qui doit s'éprouver sans réseau.
 *
 * @param noeuds - les nœuds d'items rendus par GraphQL
 * @returns les items projetés, triés par ordre puis par numéro
 */
export function projectItems(noeuds) {
  const items = noeuds
    .filter((n) => n.content?.number)
    .map((n) => {
      const f = indexFieldValues(n);
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
        // La FRISE. Sans elle, un décalage de planification n'existe que dans
        // `ticket:lint`, qui exige le réseau : hors ligne on relisait un ordre
        // de travail sans jamais pouvoir constater que son calendrier avait
        // glissé de dix jours. La donnée voyage ici ; le VERDICT reste au lint,
        // seul endroit d'où l'on peut reposer les dates (1 règle = 1 implémentation).
        debut: f["Début"] ?? null,
        cible: f.Cible ?? null,
        labels: (n.content.labels?.nodes ?? []).map((l) => l.name),
      };
    })
    .sort(
      (a, b) => (a.ordre ?? 9999) - (b.ordre ?? 9999) || a.number - b.number,
    );

  return items;
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

/**
 * Rend la frise d'un ticket en une cellule lisible côte à côte avec la date de
 * l'empreinte — c'est cette juxtaposition qui rend un décalage VISIBLE hors
 * ligne : une frise qui démarre après le jour où l'empreinte a été prise n'a
 * jamais commencé, et rien d'autre ici ne le dirait.
 *
 * @param it - l'item du tableau de bord
 * @returns `2026-09-11 → 09-19`, `2026-09-11 → ?`, ou `—` si rien n'est daté
 */
export function renderFrise(it) {
  if (!it.debut && !it.cible) return "—";
  const fin = it.cible
    ? it.cible.slice(0, 4) === (it.debut ?? "").slice(0, 4)
      ? it.cible.slice(5)
      : it.cible
    : "?";
  return `${it.debut ?? "?"} → ${fin}`;
}

function renderMarkdown(live, generatedAt) {
  const ouverts = live.items.filter((i) => i.status !== "Done");
  const parJalon = new Map();
  for (const it of ouverts) {
    const clef = it.milestone ?? "sans jalon";
    if (!parJalon.has(clef)) parJalon.set(clef, []);
    parJalon.get(clef).push(it);
  }

  // Le prochain se choisit dans le JALON COURANT — l'ordre court à travers tous
  // les jalons, si bien qu'un ticket d'une version ultérieure peut porter un rang
  // plus petit et se faire annoncer comme la prochaine chose (vécu le 09-08).
  const choix = chooseNextTicket(ouverts, live.milestones);
  const prochain = choix?.ticket ?? null;
  const jalonCourant = choix?.milestone ?? null;

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
    "> Les badges viennent de shields.io et se mettent à jour **tout seuls** : ils",
    "> interrogent GitHub au moment où la page est lue, ils ne sont pas une photo.",
    "> Ils ne peuvent pas vivre dans la description d'un jalon — mesuré le 09-06 :",
    "> GitHub y rend le texte BRUT, ni tableau, ni image, ni gras.",
    "",
    "| Jalon | Avancement | Fait | Reste | Échéance |",
    "| --- | --- | ---: | ---: | --- |",
    // Trié par ÉCHÉANCE puis par nom : le tableau doit raconter la SÉQUENCE
    // (alpha → beta → 10.0.0 → suivantes), pas l'ordre de création côté API.
    ...[...live.milestones]
      .sort(
        (a, b) =>
          (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
          a.title.localeCompare(b.title, "en", { numeric: true }),
      )
      .map((m) => {
        const total = m.open + m.closed;
        const pct = total === 0 ? 0 : Math.round((m.closed / total) * 100);
        // Barre en caractères pleins : lisible dans un terminal, où le badge ne
        // s'affiche pas. Les deux disent la même chose, par deux canaux.
        const barre = "█".repeat(Math.round(pct / 10)).padEnd(10, "░");
        const badge = `![${m.title}](https://img.shields.io/github/milestones/progress-percent/${REPO_OWNER}/${REPO_NAME}/${m.number}?style=flat-square&label=)`;
        return `| **${m.title}** | ${badge} \`${barre}\` ${pct}% | ${m.closed} | ${m.open} | ${m.dueOn ? m.dueOn.slice(0, 10) : "—"} |`;
      }),
    "",
  ];

  if (prochain) {
    lignes.push(
      "## ➡️ Le prochain dans l'ordre",
      "",
      `**#${prochain.number} — ${prochain.title}**`,
      "",
      `Ordre ${prochain.ordre ?? "—"} · ${prochain.priorite ?? "priorité non posée"} · ${prochain.jours ?? "—"} j · jalon ${prochain.milestone ?? "—"} · frise ${renderFrise(prochain)}`,
      "",
      jalonCourant
        ? `> Choisi dans le **jalon courant \`${jalonCourant}\`**, qui a encore ${parJalon.get(jalonCourant)?.length ?? 0} tickets ouverts. ` +
            "Un ticket d'un jalon ULTÉRIEUR ne passe jamais devant, même mieux classé : " +
            "l'ordre encode les dépendances, le jalon encode la livraison."
        : "> Aucun jalon n'a de travail ouvert — ce ticket vient du backlog.",
      "",
      "> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le",
      "> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).",
      "",
    );
  }

  for (const [jalon, items] of parJalon) {
    // Un ticket sans jalon n'est pas un jalon nommé « sans jalon » : c'est le
    // BACKLOG — aucun engagement de date, par opposition à un jalon qui en promet un.
    const titre =
      jalon === "sans jalon"
        ? `## Backlog — aucune date promise · ${items.length} ouverts`
        : `## Jalon ${jalon} — ${items.length} ouverts`;
    lignes.push(titre, "");
    lignes.push(
      "| Ordre | Prio | Jours | Frise | Ticket | Titre |",
      "| --- | --- | ---: | --- | --- | --- |",
    );
    for (const it of items) {
      lignes.push(
        `| ${it.ordre ?? "—"} | ${it.priorite ?? "—"} | ${it.jours ?? "—"} | ${renderFrise(it)} | #${it.number} | ${it.title} |`,
      );
    }
    lignes.push("");
  }

  return `${lignes.join("\n")}\n`;
}

/**
 * Marqueurs de la zone GÉNÉRÉE du README du projet GitHub.
 *
 * Le README porte deux natures qu'il ne faut surtout pas confondre : le
 * POURQUOI du périmètre, écrit à la main et durable, et l'ÉTAT d'avancement,
 * qui se périme en un jour. Les marqueurs permettent de régénérer le second
 * sans jamais toucher au premier — sans eux, publier reviendrait à écraser
 * l'éditorial à chaque passage.
 */
const README_DEBUT =
  "<!-- BOARD:AUTO:DEBUT — généré par board-snapshot.mjs, ne pas éditer à la main -->";
const README_FIN = "<!-- BOARD:AUTO:FIN -->";

/**
 * Rend la zone générée du README du projet : avancement par jalon et prochain
 * ticket dans l'ordre.
 *
 * Pourquoi ici plutôt que dans un graphique du tableau de bord : GitHub
 * n'expose AUCUNE mutation pour les Insights de Projects v2 (vérifié par
 * introspection du schéma — aucun champ `*Insight*` ni `*Chart*` dans
 * `mutationType`). Leur configuration ne vit que dans l'interface web, donc
 * elle ne se versionne pas et ne se régénère pas. Le README, lui, est un champ
 * de `updateProjectV2` : c'est la SEULE surface visuelle du projet qu'un
 * script puisse tenir à jour.
 *
 * @param live - l'état rendu par `fetchLive`
 * @param generatedAt - l'horodatage ISO de l'empreinte
 * @returns le bloc Markdown, marqueurs compris
 */
function renderProjectReadme(live, generatedAt) {
  const ouverts = live.items.filter((i) => i.status !== "Done");
  const choix = chooseNextTicket(ouverts, live.milestones);

  const jalons = [...live.milestones]
    .filter((m) => m.open + m.closed > 0)
    .sort(
      (a, b) =>
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.title.localeCompare(b.title),
    );

  const lignes = [
    README_DEBUT,
    "",
    "## 📊 Avancement — régénéré, jamais saisi",
    "",
    `> Photo du **${generatedAt.slice(0, 16).replace("T", " ")}** UTC, prise par`,
    "> `npm run board:snapshot -- --readme`. Ce qui est au-dessus de ce trait est",
    "> écrit à la main et dit le POURQUOI ; ce qui est en dessous est CALCULÉ et",
    "> dit l'état. Éditer cette zone à la main la ferait diverger au prochain",
    "> passage — et une carte qui ment coûte plus qu'une carte absente.",
    "",
    "```",
  ];

  const largeur = Math.max(...jalons.map((m) => m.title.length));
  for (const m of jalons) {
    const total = m.open + m.closed;
    const pct = total ? Math.round((m.closed / total) * 100) : 0;
    const pleins = Math.round(pct / 10);
    const barre = "█".repeat(pleins) + "░".repeat(10 - pleins);
    const ech = m.dueOn ? m.dueOn.slice(0, 10) : "—";
    lignes.push(
      ` ${m.title.padEnd(largeur)}  ${barre} ${String(pct).padStart(3)}%  ` +
        `${String(m.closed).padStart(3)}✅ ${String(m.open).padStart(3)}⬜   ${ech}`,
    );
  }
  lignes.push("```", "");

  // Le reste-à-faire se compte en TICKETS, pas en jours : mesuré sur 96 tickets
  // fermés, le travail médian est d'UNE séance quelle que soit la taille estimée.
  lignes.push(
    `**${ouverts.length} tickets ouverts.** C'est ce nombre qui prédit le reste-à-faire —`,
    "pas une somme de jours : le travail médian constaté est d'**une séance par",
    "ticket**, quelle que soit la taille estimée (`ticket-effort.mjs`, 96 tickets",
    "fermés). Le champ `Jours` ne sert qu'au tri.",
    "",
  );

  if (choix?.ticket) {
    const t = choix.ticket;
    lignes.push(
      "### ➡️ Le prochain dans l'ordre",
      "",
      `**[#${t.number}](${t.url}) — ${t.title}**`,
      "",
      `Ordre ${t.ordre} · ${t.priorite ?? "sans priorité"} · jalon \`${choix.milestone ?? "sans jalon"}\``,
      "",
      "> Choisi dans le **jalon courant** : un ticket d'un jalon ultérieur ne passe",
      "> jamais devant, même mieux classé. L'ordre encode les dépendances, le jalon",
      "> encode la livraison.",
      "",
    );
  }

  lignes.push(README_FIN);
  return lignes.join("\n");
}

/**
 * Republie la zone générée dans le README du projet GitHub, en PRÉSERVANT tout
 * ce qui vit hors des marqueurs.
 *
 * À la première pose, les marqueurs n'existent pas : la zone est ajoutée à la
 * fin plutôt qu'en tête, pour qu'aucune ligne écrite à la main ne se retrouve
 * déplacée sans qu'on l'ait voulu.
 *
 * @param live - l'état rendu par `fetchLive`
 * @param generatedAt - l'horodatage ISO de l'empreinte
 */
function pushProjectReadme(live, generatedAt) {
  const pid = JSON.parse(
    sh("gh", [
      "api",
      "graphql",
      "-f",
      `query={organization(login:"${PROJECT_OWNER}"){projectV2(number:${PROJECT_NUMBER}){id readme}}}`,
    ]),
  ).data.organization.projectV2;

  const bloc = renderProjectReadme(live, generatedAt);
  const actuel = pid.readme ?? "";
  if (DRY) {
    console.log("\n───── APERÇU de la zone générée (rien n'est écrit) ─────\n");
    console.log(bloc);
    console.log(
      `\n───── fin ─────\n${actuel.includes(README_DEBUT) ? "Les marqueurs EXISTENT : seule cette zone serait remplacée." : "Marqueurs ABSENTS : la zone serait AJOUTÉE à la fin, l'éditorial intact."}`,
    );
    return;
  }
  const i = actuel.indexOf(README_DEBUT);
  const j = actuel.indexOf(README_FIN);

  let suivant;
  if (i !== -1 && j !== -1 && j > i) {
    suivant = actuel.slice(0, i) + bloc + actuel.slice(j + README_FIN.length);
  } else {
    suivant = (actuel.trimEnd() + "\n\n---\n\n" + bloc + "\n").trimStart();
  }

  // Comparer SANS l'horodatage : il change à chaque minute, si bien qu'une
  // égalité littérale ne serait jamais vraie et que le script annoncerait
  // « republié » à chaque passage, y compris quand rien n'a bougé. Un
  // instrument qui crie sans raison finit par ne plus être lu.
  const sansDate = (t) => t.replace(/^> Photo du .*$/m, "");
  if (sansDate(suivant) === sansDate(actuel)) {
    console.log(
      "✅ README du projet déjà à jour — rien à publier (comparé hors horodatage).",
    );
    return;
  }

  sh("gh", [
    "api",
    "graphql",
    "-f",
    "query=mutation($p:ID!,$r:String!){updateProjectV2(input:{projectId:$p,readme:$r}){projectV2{id}}}",
    "-f",
    `p=${pid.id}`,
    "-f",
    `r=${suivant}`,
  ]);
  console.log(
    `✅ README du projet republié — ${i === -1 ? "marqueurs POSÉS (première fois)" : "zone générée remplacée"}.`,
  );
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

// ─────────────────────────────────────────── point d'entrée
// Sans cette garde, un simple `import` de ce fichier interrogerait GitHub et
// RÉÉCRIRAIT l'empreinte — les fonctions pures ci-dessus seraient donc
// inéprouvables, et c'est exactement là que la donnée disparaissait en silence.
if (!process.argv[1]?.endsWith("board-snapshot.mjs")) {
  // Importé (test) : on n'exécute rien.
} else {
  main();
}

function main() {
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

  // Le README du projet n'est republié QUE sur demande : il part chez GitHub,
  // hors du dépôt, et une écriture distante ne doit jamais être un effet de
  // bord d'une commande qu'on lance à chaque reprise de session.
  if (README) pushProjectReadme(live, generatedAt);
}
