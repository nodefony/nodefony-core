/**
 * readmes.mjs — assemble les trois README depuis UNE matrice de sections.
 *
 * Trois pages présentent Nodefony, et chacune était écrite à la main : le README
 * du dépôt (GitHub), la page npm du paquet `nodefony` (recopie du premier, qui
 * avait déjà divergé), et le README de chaque application générée — donc de la
 * vitrine `nodefony/nodefony`. Ici, une section = un fichier de
 * `scripts/generate/readme/`, et la {@link MATRIX} dit quelle page la porte.
 *
 * Une section se décline par cible avec des blocs `<!-- @if core,npm -->` …
 * `<!-- @end -->` (non imbriqués) : l'écart entre deux pages se VOIT dans la
 * source, au lieu de vivre dans deux copies.
 *
 * Trois règles de rendu :
 *   - page npm et application : les liens relatifs d'une section partagée avec
 *     le dépôt deviennent absolus (GitHub, `raw` pour une image) — ils n'ont pas
 *     de dépôt autour d'eux ;
 *   - les chapitres de l'application (docker, tests, qualité, dépannage,
 *     production) sont du gabarit eta, conditionnel. Le README du dépôt les
 *     embarque RENDUS avec le préréglage de la vitrine (`runScaffold` simulé, rien
 *     n'est écrit) : ce qu'on lit sur le dépôt est mot pour mot ce que montre la
 *     vitrine ;
 *   - les pages markdown passent par prettier, le formateur du dépôt — sinon le
 *     pre-commit les reformaterait et `--check` crierait à tort.
 *
 * Le rendu de la vitrine lit le paquet `nodefony` BÂTI (`npm run build`).
 *
 *   node scripts/generate/readmes.mjs           # régénère les trois pages
 *   node scripts/generate/readmes.mjs --check   # refuse une page périmée ou retouchée
 *
 * @usage node scripts/generate/readmes.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as prettier from "prettier";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const SECTIONS = path.join(REPO_ROOT, "scripts", "generate", "readme");
const GITHUB = "https://github.com/nodefony/nodefony-core";
const RAW = "https://raw.githubusercontent.com/nodefony/nodefony-core/main";
const GENERATED =
  "<!-- GÉNÉRÉ par scripts/generate/readmes.mjs (npm run readme:build) depuis scripts/generate/readme/ — ne pas éditer ici. -->";

/** Les pages produites. `format` : la page passe par prettier. */
export const TARGETS = {
  core: { file: "README.md", format: true },
  npm: { file: path.join("src", "nodefony", "README.md"), format: true },
  app: {
    file: path.join(
      "src",
      "nodefony",
      "templates",
      "app",
      "base",
      "README.md.tpl",
    ),
    format: false,
  },
};

const ALL = ["core", "npm", "app"];
const SITE = ["core", "npm"];

/**
 * LA matrice : l'ordre des sections, et la page qui porte chacune. `embed` :
 * sections de l'application rendues avec le préréglage de la vitrine, puis
 * insérées (un niveau de titre plus bas) dans les pages du dépôt.
 */
export const MATRIX = [
  { section: "00-intro", in: ALL },
  { section: "01-en-bref", in: ALL },
  { section: "02-d-ou-ca-vient", in: SITE },
  { section: "03-une-action-deux-transports", in: SITE },
  { section: "04-un-seul-langage", in: SITE },
  { section: "05-temps-reel", in: ALL },
  { section: "06-prets-pour-les-agents", in: SITE },
  { section: "07-ia-mcp", in: ALL },
  { section: "08-demarrage", in: ALL },
  { section: "09-visite-guidee", in: ["app"] },
  { section: "10-se-regarde-tourner", in: ALL },
  { section: "11-securite", in: SITE },
  { section: "12-structure", in: ["app"] },
  {
    section: "13-application-generee",
    in: SITE,
    embed: [
      "14-infra-docker",
      "15-tests",
      "16-qualite",
      "17-depannage",
      "18-production",
    ],
  },
  { section: "14-infra-docker", in: ["app"] },
  { section: "15-tests", in: ["app"] },
  { section: "16-qualite", in: ["app"] },
  { section: "17-depannage", in: ["app"] },
  { section: "18-production", in: ["app"] },
  { section: "19-boite", in: SITE },
  { section: "20-developper-le-framework", in: ["core", "app"] },
  { section: "21-ou-aller-ensuite", in: ALL },
  { section: "22-etat", in: SITE },
  { section: "23-api-coeur", in: ["npm"] },
];

const OPEN = /^<!-- @if ([a-z,]+) -->$/;
const CLOSE = /^<!-- @end -->$/;
const FENCE = /^\s*(```|~~~)/;
/** Une cible relative : ni schéma (`https:`, `mailto:`), ni ancre, ni chemin absolu. */
const LOCAL = /^(?![a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * Garde d'une section les lignes destinées à une cible.
 *
 * @param name - nom de la section (sans `.md`), pour les messages.
 * @param text - source de la section.
 * @param target - `core`, `npm` ou `app`.
 * @returns les lignes gardées ; `shared` = la ligne vaut aussi pour le dépôt.
 * @throws Error sur un bloc imbriqué, non fermé ou visant une cible inconnue.
 */
export function selectLines(name, text, target) {
  const kept = [];
  let block = null;
  text.split("\n").forEach((line, index) => {
    const open = OPEN.exec(line);
    if (open) {
      if (block !== null)
        throw new Error(`${name}.md:${index + 1} : bloc @if imbriqué`);
      block = open[1].split(",");
      const unknown = block.find((t) => !(t in TARGETS));
      if (unknown)
        throw new Error(
          `${name}.md:${index + 1} : cible inconnue « ${unknown} »`,
        );
      return;
    }
    if (CLOSE.test(line)) {
      if (block === null)
        throw new Error(`${name}.md:${index + 1} : @end sans @if`);
      block = null;
      return;
    }
    if (block === null || block.includes(target)) {
      kept.push({ line, shared: block === null || block.includes("core") });
    }
  });
  if (block !== null) throw new Error(`${name}.md : bloc @if non fermé`);
  return kept;
}

/**
 * Rend absolus les liens et images relatifs d'une ligne markdown.
 *
 * @param line - ligne hors bloc de code.
 * @returns la ligne, cibles relatives réécrites vers GitHub.
 */
export function absolutize(line) {
  return line
    .replace(/(<img\s[^>]*?src=")([^"]+)(")/g, (all, head, url, tail) =>
      LOCAL.test(url) ? `${head}${RAW}/${url}${tail}` : all,
    )
    .replace(/\]\(([^)\s]+)\)/g, (all, url) =>
      LOCAL.test(url)
        ? `](${GITHUB}/${url.endsWith("/") ? "tree" : "blob"}/main/${url})`
        : all,
    );
}

/** Lit une section, ou lève en la nommant. */
function readSection(name) {
  return readFileSync(path.join(SECTIONS, `${name}.md`), "utf8");
}

/**
 * Rend une section pour une cible : sélection, puis liens absolus hors dépôt.
 *
 * @param name - section.
 * @param target - cible.
 * @returns le markdown, sans ligne vide finale.
 */
export function renderSection(name, target) {
  let fenced = false;
  const lines = selectLines(name, readSection(name), target).map(
    ({ line, shared }) => {
      const fence = FENCE.test(line);
      if (fence) fenced = !fenced;
      const rewritten =
        target !== "core" && shared && !fenced ? absolutize(line) : line;
      return { text: rewritten, prose: !fenced && !fence };
    },
  );
  return tidy(lines);
}

/** Une ligne faite SEULEMENT de balises de contrôle eta (`<% if … %>`, `<% } %>`). */
const CONTROL = /^(?:<%(?![=~])(?:(?!%>).)*%>)+$/;

/**
 * Ce que le gabarit d'origine faisait à la main, et que prettier exige du rendu
 * BRUT (`check-scaffold-format.mjs`) : une ligne de contrôle eta rend une ligne
 * VIDE — elle TIENT LIEU de séparateur, elle ne s'y ajoute pas. Hors blocs de
 * code : on retire les lignes vides qui la bordent, on fusionne les vides
 * consécutifs (ceux que laisse un bloc `@if` écarté), on rogne les bords.
 *
 * @param lines - lignes sélectionnées ; `prose` = hors bloc de code.
 * @returns le markdown de la section.
 */
function tidy(lines) {
  const blank = (i) => lines[i]?.prose && lines[i].text.trim() === "";
  const control = (i) => lines[i]?.prose && CONTROL.test(lines[i].text);
  const kept = lines.filter((_, i) => {
    if (!blank(i)) return true;
    if (control(i - 1) || control(i + 1)) return false;
    return !blank(i - 1);
  });
  while (kept.length && kept[0].prose && kept[0].text.trim() === "")
    kept.shift();
  while (kept.length && kept.at(-1).prose && kept.at(-1).text.trim() === "") {
    kept.pop();
  }
  return kept.map((l) => l.text).join("\n");
}

/**
 * Joint les sections : une ligne vide entre deux, sauf quand l'une borde
 * l'autre par une ligne de contrôle eta — c'est elle, alors, le séparateur.
 *
 * @param parts - sections rendues.
 * @returns la page.
 */
function join(parts) {
  return parts.reduce((page, part) => {
    if (page === "") return part;
    const edge =
      CONTROL.test(page.slice(page.lastIndexOf("\n") + 1)) ||
      CONTROL.test(part.split("\n", 1)[0]);
    return `${page}${edge ? "\n" : "\n\n"}${part}`;
  }, "");
}

/** Premier titre `## ` d'une section rendue pour l'application. */
function headingOf(name) {
  const heading = renderSection(name, "app")
    .split("\n")
    .find((l) => l.startsWith("## "));
  if (!heading)
    throw new Error(`${name}.md : aucun titre « ## » côté application`);
  return heading;
}

/**
 * Le bloc `embed` d'une ligne de matrice, pris dans le README que rend la
 * vitrine : du titre de sa première section au titre de la section qui suit la
 * dernière, chaque titre descendu d'un niveau.
 *
 * @param row - ligne de matrice portant `embed`.
 * @param vitrine - README rendu de la vitrine.
 * @returns le markdown à insérer.
 */
export function extractEmbed(row, vitrine) {
  const last = MATRIX.findIndex((r) => r.section === row.embed.at(-1));
  const next = MATRIX.slice(last + 1).find((r) => r.in.includes("app"));
  const lines = vitrine.split("\n");
  const from = lines.indexOf(headingOf(row.embed[0]));
  const to = next ? lines.indexOf(headingOf(next.section)) : lines.length;
  if (from < 0 || to < from) {
    throw new Error(
      `vitrine : chapitres « ${row.embed.join(", ")} » introuvables dans le rendu`,
    );
  }
  let fenced = false;
  return lines
    .slice(from, to)
    .map((line) => {
      if (FENCE.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Rend le README de la vitrine par le scaffold lui-même, en simulation : même
 * moteur, mêmes conditions que `create app nodefony --preset complete
 * --frontend react` dans le flux de publication. Rien n'est écrit sur disque.
 *
 * @returns le README rendu.
 */
async function renderVitrine() {
  const { runScaffold } = await import("nodefony");
  const version = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "src", "nodefony", "package.json"),
      "utf8",
    ),
  ).version;
  const dir = path.join(tmpdir(), `nf-readme-vitrine-${process.pid}`);
  const result = runScaffold(
    {
      type: "app",
      dir,
      answers: {
        name: "nodefony",
        preset: "complete",
        frontend: "react",
        license: "MIT",
      },
    },
    version,
    { dryRun: true },
  );
  const readme = result.changes?.find(
    (c) => c.path === path.join(dir, "README.md"),
  );
  if (!readme)
    throw new Error("vitrine : le scaffold simulé ne rend pas de README.md");
  return readme.content;
}

/**
 * Assemble une page.
 *
 * @param target - cible.
 * @param vitrine - README rendu de la vitrine (pages du dépôt), ou `null`.
 * @returns la page, formatée si sa cible l'exige.
 */
export async function buildPage(target, vitrine) {
  const parts = [];
  for (const row of MATRIX) {
    if (!row.in.includes(target)) continue;
    parts.push(renderSection(row.section, target));
    if (row.embed) parts.push(extractEmbed(row, vitrine));
  }
  const { file, format } = TARGETS[target];
  if (!format) {
    // Une dernière ligne de contrôle eta rend déjà le saut de ligne final.
    const page = join(parts);
    return CONTROL.test(page.slice(page.lastIndexOf("\n") + 1))
      ? page
      : `${page}\n`;
  }
  const abs = path.join(REPO_ROOT, file);
  const options = (await prettier.resolveConfig(abs)) ?? {};
  return prettier.format(`${GENERATED}\n\n${join(parts)}\n`, {
    ...options,
    filepath: abs,
  });
}

/**
 * Compare ou écrit une page.
 *
 * @returns `true` si la page sur disque est (désormais) à jour.
 */
function settle(target, content, check) {
  const abs = path.join(REPO_ROOT, TARGETS[target].file);
  let current;
  try {
    current = readFileSync(abs, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return true;
  if (check) {
    console.error(`✗ ${TARGETS[target].file} — périmé ou retouché à la main`);
    return false;
  }
  writeFileSync(abs, content);
  console.log(`✓ ${TARGETS[target].file} — régénéré`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.find((a) => a !== "--check");
  if (unknown) {
    console.error(
      `option inconnue : ${unknown}\nusage : node scripts/generate/readmes.mjs [--check]`,
    );
    process.exit(2);
  }
  const check = args.includes("--check");
  // Le gabarit d'abord : la vitrine se rend depuis lui, tel qu'il est sur disque.
  let ok = settle("app", await buildPage("app", null), check);
  const vitrine = await renderVitrine();
  for (const target of SITE) {
    ok = settle(target, await buildPage(target, vitrine), check) && ok;
  }
  if (!ok) {
    console.error(
      "\nUne page générée diffère de sa source. Éditer scripts/generate/readme/, puis « npm run readme:build ».",
    );
    process.exit(1);
  }
  if (check)
    console.log("✓ README à jour — dépôt, page npm, gabarit d'application");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
