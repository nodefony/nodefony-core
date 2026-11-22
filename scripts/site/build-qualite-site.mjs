#!/usr/bin/env node
/**
 * Construit le site « Qualité » publié — le verdict d'une CAMPAGNE DE TEST par version.
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL NE FAIT PAS.
 * Il ne TESTE rien et ne mesure rien. Une campagne se joue à la main, sur une machine
 * nommée, en plusieurs heures — le protocole vit dans le skill `nodefony-test-campaign`.
 * Son résultat est COMMITÉ dans `docs/qualite/data/<version>.json`, décor compris ; ce
 * script ne fait que le RENDRE. Il est donc déterministe et son résultat ne dépend pas
 * de la machine qui l'exécute — même contrat que `build-perf-site.mjs`.
 *
 * La page répond à UNE question : « peut-on publier cette version ? ». D'où l'ordre —
 * le verdict d'abord, la preuve ensuite, et ce qui n'a PAS été éprouvé au même rang que
 * ce qui l'a été : c'est la moitié du verdict, et c'est la moitié qu'on oublie d'écrire.
 *
 * Usage :
 *   node scripts/site/build-qualite-site.mjs [--out tmp/sites/quality] [--data docs/qualite/data]
 *
 * Sortie 1 si AUCUNE version n'a pu être rendue (un site vide se publierait en silence).
 *
 * @usage node scripts/site/build-qualite-site.mjs [--out tmp/sites/quality] [--data docs/qualite/data]
 */
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import {
  doc,
  section,
  cards,
  table,
  lineChart,
  note,
  warn,
  printButton,
  fmt,
  COLORS,
} from "../../.claude/skills/nodefony-html-report/lib/report.mjs";
import {
  bars,
  pie,
  couple,
  figure,
  STYLE_GRAPHES,
} from "../../.claude/skills/nodefony-html-report/lib/echarts.mjs";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import { siteNav } from "./lib/site-nav.mjs";
import { seoHead, brandTitle, webPage } from "./lib/seo-head.mjs";
import { clipSummary } from "./lib/page-summary.mjs";

function arg(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? defaut : process.argv[i + 1];
}
// Adresse publique du site : base des adresses canoniques. Les pages vivent sous
// `/qualite/` — le préfixe que `siteNav` pose déjà, et que `build-site.mjs` donne
// à `--out`.
const SITE_URL = arg("site-url", "https://nodefony.net").replace(/\/+$/, "");
/** Site `/next/` : aucune page indexable (`build-site.mjs` pose l'option). */
const NOINDEX = process.argv.includes("--noindex");
const canonicalOf = (cheminSousQualite) =>
  `${SITE_URL}/qualite/${cheminSousQualite}`;
const OUT = path.resolve(ROOT, arg("out", "tmp/sites/quality"));
const DATA = path.resolve(ROOT, arg("data", "docs/qualite/data"));

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

/** Un étage se lit à son verdict, pas à son total : un « vert » qui saute la moitié
 *  des cas n'est pas un vert. La pastille porte donc le verdict, la ligne le compte. */
const PASTILLE = {
  vert: `<span style="color:${COLORS.green}">●</span> vert`,
  instruit: `<span style="color:${COLORS.amber}">●</span> instruit`,
  rouge: `<span style="color:${COLORS.vermillion}">●</span> rouge`,
};

const CAUSES = {
  saturation: COLORS.amber,
  décor: COLORS.skyblue,
  "état partagé": COLORS.purple,
  instrument: COLORS.pink,
  produit: COLORS.vermillion,
};

function rendre(d) {
  // 🔴 Les étages se RECOUVRENT : C1 rejoue tout `test:all` avec des interrupteurs
  // ouverts, donc additionner A + B + C1 compte trois fois la même suite unitaire.
  // Un total gonflé est le mensonge le plus facile à publier dans un rapport de
  // qualité — et le plus difficile à rattraper une fois cité. On rend donc le
  // passage le PLUS LARGE, nommé, et le reste se lit étage par étage.
  const large = d.etages.reduce((a, e) => (e.passes > a.passes ? e : a));
  const totalPasses = large.passes;
  const totalSautes = large.sautes;
  const rougesProduit = d.rouges
    .filter((r) => r.cause === "produit")
    .reduce((s, r) => s + r.n, 0);
  const rougesAutres = d.rouges
    .filter((r) => r.cause !== "produit")
    .reduce((s, r) => s + r.n, 0);

  const sections = [];

  // ── BLUF : la réponse en dix secondes ────────────────────────────────────
  sections.push(
    section(
      "Le verdict",
      cards([
        {
          k: "Cas passés",
          v: fmt.int(totalPasses),
          sub: `passage le plus large (étage ${large.id})`,
        },
        {
          k: "Régressions du produit",
          v: String(rougesProduit),
          sub: rougesProduit === 0 ? "aucune" : "à instruire",
        },
        {
          k: "Rouges de décor ou d'instrument",
          v: String(rougesAutres),
          sub: "n'appartiennent pas au code",
        },
        {
          k: "Cas non exécutés",
          v: fmt.int(totalSautes),
          sub: "sur ce même passage",
        },
      ]) +
        note(
          `Les étages se <strong>recouvrent</strong> — plusieurs rejouent tout ou partie du socle. ` +
            `Ces chiffres sont donc ceux du passage le plus large, jamais une somme : additionner compterait trois fois la même suite. ` +
            `Et un total ne dit rien seul — <strong>${fmt.int(totalSautes)} cas n'ont pas tourné</strong> sur ce seul passage, ` +
            `un cas sauté comptant comme vert. Ce que la campagne n'a pas éprouvé est en bas de page, au même rang que le reste.`,
        ),
      { break: "avoid" },
    ),
  );

  // ── Les étages ───────────────────────────────────────────────────────────
  sections.push(
    section(
      "Ce qui a été joué, étage par étage",
      figure(
        couple(bars, {
          horizontal: true,
          empile: true,
          etiquettes: false,
          axeValeur: "cas",
          largeur: 900,
          series: [
            {
              nom: "passés",
              data: d.etages.map((e) => [`${e.id} — ${e.nom}`, e.passes]),
            },
            {
              nom: "sautés",
              data: d.etages.map((e) => [`${e.id} — ${e.nom}`, e.sautes ?? 0]),
            },
            {
              nom: "rouges",
              data: d.etages.map((e) => [`${e.id} — ${e.nom}`, e.echecs ?? 0]),
            },
          ],
        }),
        {
          titre: "Cas joués par étage",
          desc: "les étages se recouvrent : ne pas additionner les barres. Un cas sauté compte comme vert pour l'outil, pas ici.",
        },
      ) +
        table(
          [
            { label: "Étage", strong: true },
            { label: "Ce qu'il ajoute" },
            { label: "Passés", align: "right" },
            { label: "Rouges", align: "right" },
            { label: "Sautés", align: "right" },
            { label: "Durée", align: "right", dim: true },
            { label: "Verdict" },
          ],
          d.etages.map((e) => [
            `${esc(e.id)} — ${esc(e.nom)}<br><code style="font-size:.85em;opacity:.7">${esc(e.commande)}</code>`,
            esc(e.note),
            fmt.int(e.passes),
            e.echecs ? `<strong>${e.echecs}</strong>` : "—",
            e.sautes ? fmt.int(e.sautes) : "—",
            esc(e.duree),
            PASTILLE[e.verdict] ?? esc(e.verdict),
          ]),
          { sortable: true, id: "etages" },
        ),
    ),
  );

  // ── Les rouges, par CAUSE — c'est la cause qui décide de l'action ────────
  sections.push(
    section(
      "Les rouges, triés par cause instruite",
      note(
        "Sur une campagne complète, le produit est le <strong>dernier</strong> suspect. " +
          "Chaque rouge est instruit avant d'être imputé : le même cas passe-t-il isolé (saturation) ? " +
          "le décor est-il celui que le banc suppose ? un état partagé s'est-il accumulé ? l'instrument dit-il vrai ?",
      ) +
        figure(
          couple(pie, {
            largeur: 640,
            hauteur: 300,
            parts: Object.entries(
              d.rouges.reduce(
                (m, r) => ((m[r.cause] = (m[r.cause] ?? 0) + r.n), m),
                {},
              ),
            ).map(([nom, valeur]) => ({ nom, valeur })),
          }),
          {
            titre: "Rouges par cause instruite",
            desc: "nombre de cas rouges, par cause établie",
          },
        ) +
        table(
          [
            { label: "Cause", strong: true },
            { label: "Nb", align: "right" },
            { label: "Où" },
            { label: "Symptôme" },
            { label: "Ce qui l'établit" },
          ],
          d.rouges.map((r) => [
            `<span style="color:${CAUSES[r.cause] ?? COLORS.grey}">●</span> ${esc(r.cause)}`,
            String(r.n),
            esc(r.ou),
            `<code>${esc(r.symptome)}</code>`,
            esc(r.preuve),
          ]),
          { sortable: true, id: "rouges" },
        ),
    ),
  );

  // ── Mémoire : le gate qui bloque un commit ───────────────────────────────
  // L'unité appartient à la campagne : le gate a changé de grandeur (MB retenus
  // après la charge, puis octets retenus PAR UNITÉ de travail).
  const unite = d.memoireUnite ?? "MB";
  sections.push(
    section(
      "Seuils mémoire",
      figure(
        couple(bars, {
          horizontal: true,
          axeValeur: `${unite} retenus`,
          decimales: true,
          largeur: 900,
          series: [
            { nom: "mesuré", data: d.memoire.map((m) => [m.cas, m.mesure]) },
            { nom: "seuil", data: d.memoire.map((m) => [m.cas, m.seuil]) },
          ],
        }),
        {
          titre: "Mémoire retenue face au seuil bloquant",
          desc: `${unite} retenus ; un dépassement bloque le commit`,
        },
      ) +
        table(
          [
            { label: "Cas", strong: true },
            { label: `Mesuré (${unite})`, align: "right" },
            { label: `Seuil (${unite})`, align: "right" },
            { label: "Marge", align: "right" },
          ],
          d.memoire.map((m) => [
            esc(m.cas),
            fmt.dec(m.mesure, 2),
            String(m.seuil),
            m.mesure <= 0
              ? "∞"
              : `×${fmt.dec(m.seuil / Math.max(m.mesure, 0.001), 1)}`,
          ]),
          { sortable: true, id: "memoire" },
        ),
    ),
  );

  // ── Capacité ─────────────────────────────────────────────────────────────
  sections.push(
    section(
      "Capacité d'un pod",
      table(
        [
          { label: "Transport", strong: true },
          { label: "Médiane (rps)", align: "right" },
          { label: "Dispersion", align: "right" },
          { label: "p99 (ms)", align: "right" },
          { label: "Boucle occupée", align: "right" },
        ],
        d.capacite.map((c) => [
          esc(c.transport),
          fmt.int(c.rps),
          esc(c.ecart),
          fmt.dec(c.p99, 2),
          fmt.pct(c.elu),
        ]),
        { sortable: true, id: "capacite" },
      ) +
        cards([
          {
            k: "Plafond WebSocket",
            v: fmt.int(d.websocket.plafond),
            unit: "sockets",
            sub: `${d.websocket.coutParConnexion} KB par connexion`,
          },
          {
            k: "Écho WebSocket",
            v: fmt.int(d.websocket.debitEcho),
            unit: "msg/s",
            sub: "1 pour 1",
          },
          {
            k: "Diffusion",
            v: fmt.int(d.websocket.fanout),
            unit: "liv./s",
            sub: "1 vers 100 sockets",
          },
          {
            k: "Latence cross-pod",
            v: fmt.int(d.multipod.latenceP50),
            unit: "ms (p50)",
            sub: `${fmt.int(d.multipod.livraisons)} livraisons, ${d.multipod.pertePct} % de perte`,
          },
        ]) +
        warn(
          `<strong>Décor :</strong> ${esc(d.decor.note)} Ces chiffres situent un ordre de grandeur ; ils ne se transposent pas à une autre machine.`,
        ),
    ),
  );

  // ── La tenue : la seule chose qu'une pente montre et qu'un nombre cache ──
  // Les séries quand la campagne a joué son soak ; sinon le renvoi à celle qui
  // l'a fait, écrit dans les données. La lecture des courbes appartient à SES
  // runs : elle vit dans les données (`soakNote`, `soakReserve`), jamais ici —
  // écrite dans le code, elle décrirait les runs d'une autre campagne.
  if (d.soak) {
    const couleurs = [COLORS.blue, COLORS.amber, COLORS.green];
    const sRss = Object.entries(d.soak).map(([k, v], i) => ({
      label: `${k} — RSS`,
      color: couleurs[i % couleurs.length],
      points: v.map((p) => ({ x: p.w, y: p.rss })),
    }));
    const sHeap = Object.entries(d.soak).map(([k, v], i) => ({
      label: `${k} — tas V8`,
      color: couleurs[i % couleurs.length],
      points: v.map((p) => ({ x: p.w, y: p.heap })),
    }));
    sections.push(
      section(
        "Tenue dans la durée — la pente que le nombre cache",
        (d.soakNote ? note(d.soakNote) : "") +
          lineChart(sRss, {
            xLabel: "fenêtre",
            yLabel: "mémoire résidente `rss` (MB)",
          }) +
          lineChart(sHeap, { xLabel: "fenêtre", yLabel: "tas V8 (MB)" }) +
          table(
            [
              { label: "Run", strong: true },
              { label: "Durée retenue" },
              { label: "Décor" },
              { label: "Tas" },
              { label: "Handles" },
              { label: "Verdict du banc" },
            ],
            (d.soakVerdicts ?? []).map((v) => [
              esc(v.run),
              esc(v.duree),
              esc(v.decor),
              esc(v.tas),
              esc(v.handles),
              esc(v.verdict),
            ]),
            { id: "soak" },
          ) +
          (d.soakReserve ? warn(d.soakReserve) : ""),
      ),
    );
  } else if (d.tenue) {
    sections.push(
      section("Tenue dans la durée", note(d.tenue), { break: "avoid" }),
    );
  }

  // ── Ce qui n'a PAS été éprouvé — au même rang que le reste ───────────────
  sections.push(
    section(
      "Ce que cette campagne n'a PAS éprouvé",
      note(
        "Un banc sauté compte comme vert. Cette liste est la moitié du verdict.",
      ) + `<ul>${d.nonEprouve.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
      { break: "avoid" },
    ),
  );

  // ── Ce que la campagne a ouvert ─────────────────────────────────────────
  sections.push(
    section(
      "Ce que la campagne a ouvert",
      table(
        [
          { label: "Ticket", strong: true },
          { label: "Objet" },
          { label: "Jalon" },
          { label: "Priorité" },
        ],
        d.tickets.map((t) => [
          `<a href="https://github.com/nodefony/nodefony-core/issues/${t.n}">#${t.n}</a>`,
          esc(t.titre),
          esc(t.jalon),
          esc(t.prio),
        ]),
        { id: "tickets" },
      ),
      { break: "avoid" },
    ),
  );

  const titre = `Campagne de test — Nodefony ${d.version}`;
  const sousTitre =
    rougesProduit === 0
      ? "Aucune régression du produit. Tous les rouges sont instruits et imputés au décor ou à l'instrument."
      : `${rougesProduit} régression(s) du produit à instruire avant publication.`;
  // La version est dans le titre ET la description : deux campagnes ne se ressemblent pas.
  const description = clipSummary(
    `Verdict de la campagne de test de Nodefony ${d.version}, jouée le ${d.campagne} : ${sousTitre}`,
  );
  const url = canonicalOf(`${d.version}/`);
  return doc({
    nav: siteNav(`/qualite/${d.version}/`),
    title: titre,
    documentTitle: brandTitle(titre),
    subtitle: sousTitre,
    head: seoHead({
      noindex: NOINDEX,
      title: titre,
      description,
      url,
      jsonLd: webPage({
        type: "WebPage",
        title: titre,
        description,
        url,
        siteUrl: SITE_URL,
      }),
    }),
    sections,
    style: STYLE_GRAPHES,
    data: d,
    footer:
      `Campagne du ${esc(d.campagne)} — ${esc(d.decor.machine)}, ${esc(d.decor.ram)}, ${esc(d.decor.os)}, Node ${esc(d.decor.node)}.<br>` +
      (d.commit ? `Code éprouvé : ${esc(d.commit)}.<br>` : "") +
      `Infrastructure exercée : ${d.decor.infra.map(esc).join(" · ")}.<br>` +
      `Protocole : skill <code>nodefony-test-campaign</code>. Page rendue par <code>node scripts/site/build-qualite-site.mjs</code>.` +
      printButton(),
  });
}

// ── rendu ──────────────────────────────────────────────────────────────────
if (!existsSync(DATA)) {
  console.error(`✘ dossier de données introuvable : ${DATA}`);
  process.exit(1);
}
const versions = readdirSync(DATA)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

if (versions.length === 0) {
  console.error(
    `✘ aucune version dans ${DATA} — un site vide se publierait en silence.`,
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
let rendus = 0;
let derniere = null;
for (const v of versions) {
  const d = JSON.parse(readFileSync(path.join(DATA, `${v}.json`), "utf8"));
  const html = rendre(d);
  mkdirSync(path.join(OUT, v), { recursive: true });
  writeFileSync(path.join(OUT, v, "index.html"), html);
  console.log(
    `✓ ${v} → ${path.relative(ROOT, path.join(OUT, v, "index.html"))}`,
  );
  rendus++;
  derniere = html;
}
// `latest` : l'URL qu'on cite sans avoir à connaître le numéro de version.
mkdirSync(path.join(OUT, "latest"), { recursive: true });
writeFileSync(path.join(OUT, "latest", "index.html"), derniere);

// Sommaire : une version reste attachée à SES chiffres, définitivement.
writeFileSync(
  path.join(OUT, "index.html"),
  doc({
    nav: siteNav("/qualite/"),
    title: "Campagnes de test — Nodefony",
    documentTitle: brandTitle("Campagnes de test — Nodefony"),
    subtitle:
      "Un verdict par version publiée, avec son décor et ce qu'il n'a pas éprouvé.",
    head: seoHead({
      noindex: NOINDEX,
      title: "Campagnes de test — Nodefony",
      description:
        "Une campagne de test complète par version de Nodefony : verdict, rouges instruits, décor de la machine et ce que la campagne n'a pas éprouvé.",
      url: canonicalOf(""),
      jsonLd: webPage({
        type: "CollectionPage",
        title: "Campagnes de test — Nodefony",
        description:
          "Une campagne de test complète par version de Nodefony : verdict, rouges instruits, décor de la machine et ce que la campagne n'a pas éprouvé.",
        url: canonicalOf(""),
        siteUrl: SITE_URL,
      }),
    }),
    sections: [
      section(
        "Versions",
        `<ul>${versions
          .map((v) => `<li><a href="${esc(v)}/">Nodefony ${esc(v)}</a></li>`)
          .join("")}</ul>`,
      ),
    ],
    footer: "Rendu par <code>node scripts/site/build-qualite-site.mjs</code>.",
  }),
);
console.log(`✓ ${rendus} version(s) rendue(s) → ${path.relative(ROOT, OUT)}`);
