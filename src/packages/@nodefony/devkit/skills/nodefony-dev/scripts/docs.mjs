#!/usr/bin/env node
/**
 * Cherche dans la documentation INSTALLÉE avec les paquets Nodefony.
 *
 * Elle est invisible à une recherche ordinaire : `rg "terme"` lancé à la racine
 * d'un projet ne descend pas dans `node_modules` (git l'ignore, `rg` le suit).
 * Le sujet paraît absent alors qu'il occupe des dizaines de pages — mesuré sur
 * une application générée : 70 fichiers, plus de 38 000 lignes.
 *
 * Ce script les lit toutes et rend les passages qui répondent, avec leur chemin
 * exact et leur ligne. Il ne remplace pas la lecture : il dit QUOI ouvrir.
 *
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs session cookie
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --list
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --open firewall
 * `@option` --list - énumère les pages installées (sujet, titre, chemin), sans chercher
 * `@option` --open - rend le CHEMIN d'une page désignée par son sujet, son titre ou un fragment
 * `@option` --json - la même réponse, sérialisée, pour rechaîner
 * `@option` --limit - nombre de pages rendues (défaut 6)
 * `@option` --root - racine du projet (défaut : le dossier courant)
 * `@output` les pages classées, avec chemin, ligne et extrait — ou un refus qui DIT pourquoi
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Nombre de pages rendues par défaut — au-delà, personne ne lit. */
const DEFAULT_LIMIT = 6;

/** Extraits rendus par page. Deux suffisent à décider si l'on ouvre. */
const SNIPPETS_PER_PAGE = 2;

/** Les marques diacritiques Unicode, retirées avant toute comparaison. */
const COMBINING_MARKS = /[\u0300-\u036f]/gu;

const FLAGS = new Set([
  "--list",
  "--open",
  "--json",
  "--limit",
  "--root",
  "--help",
  "-h",
]);

/**
 * Lit les arguments, et REFUSE ce qu'il ne comprend pas.
 *
 * Un drapeau inconnu qu'on ignore fait croire à une recherche vide plutôt qu'à
 * une faute de frappe — le lecteur conclut alors « ce n'est pas documenté ».
 *
 * @param argv - les arguments, sans `node` ni le chemin du script.
 * @returns les options lues.
 * @throws Error quand un drapeau est inconnu ou qu'une valeur manque.
 */
export function parseArgs(argv) {
  const opts = {
    terms: [],
    list: false,
    open: null,
    json: false,
    limit: DEFAULT_LIMIT,
    root: process.cwd(),
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      opts.terms.push(arg);
      continue;
    }
    if (!FLAGS.has(arg)) throw new Error(`drapeau inconnu : ${arg}`);
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--open") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-"))
        throw new Error(
          "--open attend un sujet, un titre ou un fragment de chemin",
        );
      opts.open = value;
      i += 1;
    } else if (arg === "--limit") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0)
        throw new Error("--limit attend un entier positif");
      opts.limit = value;
      i += 1;
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-"))
        throw new Error("--root attend un chemin");
      opts.root = value;
      i += 1;
    }
  }
  return opts;
}

/**
 * Les dossiers `docs/` des paquets Nodefony installés.
 *
 * On ne balaie PAS tout `node_modules` : un projet en porte des dizaines de
 * milliers de fichiers, et la réponse mettrait une minute à venir pour y
 * mélanger la documentation de tiers.
 *
 * @param root - la racine du projet.
 * @returns les dossiers trouvés, `nodefony` d'abord puis les paquets triés.
 */
export function docDirectories(root) {
  const modules = path.join(root, "node_modules");
  const found = [];
  const push = (dir) => {
    const docs = path.join(dir, "docs");
    try {
      if (statSync(docs).isDirectory()) found.push(docs);
    } catch {
      /* pas de docs dans ce paquet — le cas ordinaire */
    }
  };
  push(path.join(modules, "nodefony"));
  const scope = path.join(modules, "@nodefony");
  let entries = [];
  try {
    entries = readdirSync(scope);
  } catch {
    return found;
  }
  for (const name of entries.sort()) push(path.join(scope, name));
  return found;
}

/**
 * Tous les fichiers `.md` d'un dossier, en descendant.
 *
 * @param dir - le dossier de départ.
 * @returns les chemins, triés pour que deux exécutions se comparent.
 */
function markdownFiles(dir) {
  const out = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".md")) out.push(child);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Le frontmatter d'une page, réduit aux champs qui servent au classement.
 *
 * Écrit à la main plutôt que par un analyseur YAML : ce script tourne chez
 * l'utilisateur, depuis `node_modules`, et ne doit avoir AUCUNE dépendance. Une
 * page non conforme est ignorée, jamais une recherche qui échoue.
 *
 * @param source - le contenu complet du fichier.
 * @returns `{ title, module, topic, section, tags }`, champs manquants compris.
 */
export function readHeader(source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  const front = block?.[1] ?? "";
  const field = (name) => {
    const match = new RegExp(`^${name}:[ \\t]*(.+)$`, "mu").exec(front);
    return (match?.[1] ?? "").trim().replace(/^["']|["']$/gu, "");
  };
  // Les tags s'écrivent en ligne (`[a, b]`) ou éclatés sur plusieurs lignes —
  // prettier reformate les listes longues, les deux formes coexistent donc dans
  // le même corpus. Un motif qui n'en lirait qu'une manquerait la moitié des
  // pages sans le dire.
  let tags = [];
  const inline = /^tags:[ \t]*\[([\s\S]*?)\]/mu.exec(front);
  if (inline) {
    tags = inline[1]
      .split(",")
      .map((tag) => tag.trim().replace(/^["']|["']$/gu, ""))
      .filter(Boolean);
  }
  return {
    title: field("title"),
    module: field("module"),
    topic: field("topic"),
    section: field("section"),
    tags,
  };
}

/**
 * Le corps d'une page, frontmatter retiré, avec le décalage de lignes.
 *
 * Sans ce décalage, toute ligne citée serait fausse de la hauteur du
 * frontmatter — et une ancre plausible mais fausse a l'air d'une preuve.
 *
 * @param source - le contenu complet.
 * @returns `{ body, offset }` — `offset` = lignes consommées par l'en-tête.
 */
export function splitBody(source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source);
  if (!block) return { body: source, offset: 0 };
  return {
    body: source.slice(block[0].length),
    offset: block[0].split("\n").length - 1,
  };
}

/**
 * Normalise pour comparer : minuscules, diacritiques retirés.
 *
 * Le corpus est en français et les demandes arrivent sans accents aussi souvent
 * qu'avec — « securite » doit trouver « sécurité », sinon la recherche paraît
 * vide sur le mot le plus courant du corpus.
 *
 * @param value - la chaîne à normaliser.
 * @returns la chaîne comparable.
 */
export function normalize(value) {
  return value.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Classe une page pour une demande.
 *
 * Les poids ne sont pas arbitraires : un terme dans le TITRE désigne la page
 * entière, un terme dans un `topic` ou un `tag` désigne son sujet, un terme dans
 * un titre de section désigne un passage, et un terme dans le corps ne désigne
 * qu'une mention — qui peut n'être qu'une note de bas de page.
 *
 * @param page - la page indexée.
 * @param terms - les termes déjà normalisés.
 * @returns `{ score, hits }` — `hits` porte les lignes retenues.
 */
export function score(page, terms) {
  let total = 0;
  const hits = [];
  const title = normalize(page.title);
  const topic = normalize(page.topic);
  const tags = page.tags.map(normalize);

  for (const term of terms) {
    if (title.includes(term)) total += 12;
    if (topic === term) total += 10;
    else if (topic !== "" && topic.includes(term)) total += 5;
    if (tags.some((tag) => tag === term)) total += 8;
    else if (tags.some((tag) => tag.includes(term))) total += 3;
  }

  // Le corps : une ligne qui porte TOUS les termes vaut bien plus que deux
  // lignes qui en portent un chacune — c'est ce qui fait remonter le passage
  // traitant vraiment de la conjonction demandée.
  page.lines.forEach((text, lineIndex) => {
    const haystack = normalize(text);
    const present = terms.filter((term) => haystack.includes(term));
    if (present.length === 0) return;
    const all = present.length === terms.length;
    const heading = /^#{1,6}\s/u.test(text);
    total += all ? 4 : 1;
    if (heading) total += all ? 6 : 2;
    hits.push({
      line: lineIndex + 1 + page.offset,
      text: text.trim(),
      all,
      heading,
    });
  });

  return { score: total, hits };
}

/**
 * Indexe toutes les pages installées.
 *
 * @param root - la racine du projet.
 * @returns les pages, ou un tableau vide si rien n'est installé.
 */
export function index(root) {
  const pages = [];
  for (const dir of docDirectories(root)) {
    for (const file of markdownFiles(dir)) {
      let source = "";
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const header = readHeader(source);
      const { body, offset } = splitBody(source);
      pages.push({
        ...header,
        // Le chemin VOYAGE — il s'affiche et se recopie dans une commande : il
        // s'écrit donc en `/` sur les trois plateformes. Ce qu'on OUVRE, plus
        // haut, est resté natif.
        file: path.relative(root, file).split(path.sep).join("/"),
        lines: body.split("\n"),
        offset,
      });
    }
  }
  return pages;
}

/**
 * Le refus quand aucune documentation n'est installée.
 *
 * ⚠️ À ne PAS confondre avec « ce n'est pas documenté ». Un projet dont les
 * dépendances ne sont pas installées n'a pas de documentation à lire — le dire
 * est une information ; s'en taire envoie réécrire à la main ce qu'on n'a pas
 * pu lire.
 *
 * @param root - la racine examinée.
 * @returns le texte du refus, qui nomme la cause ET le geste.
 */
export function missingDocsMessage(root) {
  const modules = path.join(root, "node_modules");
  let installed = false;
  try {
    installed = statSync(modules).isDirectory();
  } catch {
    /* absent */
  }
  return installed
    ? `Aucun paquet Nodefony avec un dossier docs/ sous ${path.join(modules, "@nodefony")}.\n` +
        "Ce projet n'est peut-être pas une application Nodefony — ou ses paquets ne sont pas installés."
    : `node_modules/ n'existe pas sous ${root} : la documentation n'est pas là.\n` +
        "Ce n'est PAS « le sujet n'est pas documenté ». Lance « npm install », puis rejoue cette commande.";
}

/**
 * Les extraits d'une page, les plus informatifs d'abord.
 *
 * @param hits - les lignes retenues par le classement.
 * @returns au plus {@link SNIPPETS_PER_PAGE} extraits.
 */
function bestSnippets(hits) {
  return [...hits]
    .sort(
      (a, b) =>
        Number(b.all) - Number(a.all) ||
        Number(b.heading) - Number(a.heading) ||
        a.line - b.line,
    )
    .slice(0, SNIPPETS_PER_PAGE);
}

/**
 * Cherche, et rend le résultat prêt à afficher.
 *
 * @param opts - les options lues par {@link parseArgs}.
 * @returns `{ pages, total, indexed }` — `pages` déjà tronqué à la limite.
 */
export function search(opts) {
  const pages = index(opts.root);
  const terms = opts.terms.map(normalize).filter(Boolean);
  const ranked = pages
    .map((page) => ({ page, ...score(page, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.page.file.localeCompare(b.page.file),
    );
  return {
    pages: ranked.slice(0, opts.limit),
    total: ranked.length,
    indexed: pages.length,
  };
}

/**
 * Le mode `--open` : désigner une page sans la chercher.
 *
 * @param opts - les options lues.
 * @returns les pages dont le sujet, le titre ou le chemin correspond.
 */
export function resolvePage(opts) {
  const target = normalize(opts.open);
  return index(opts.root).filter(
    (page) =>
      normalize(page.topic) === target ||
      normalize(page.file).includes(target) ||
      (page.title !== "" && normalize(page.title).includes(target)),
  );
}

/** Retire du rendu les champs de travail, qui ne servent qu'au classement. */
const publicShape = ({ lines: _lines, offset: _offset, ...rest }) => rest;

const USAGE = `
Cherche dans la documentation INSTALLÉE des paquets Nodefony — celle qu'une
recherche ordinaire ne voit pas, parce qu'elle vit sous node_modules/.

  docs.mjs <termes...>        les pages qui répondent, avec chemin et ligne
  docs.mjs --list             les pages installées, par module
  docs.mjs --open <sujet>     le chemin d'une page désignée
  docs.mjs --json             la même réponse, sérialisée
  docs.mjs --limit <n>        nombre de pages rendues (défaut ${DEFAULT_LIMIT})
  docs.mjs --root <chemin>    racine du projet (défaut : dossier courant)

Codes de sortie : 0 trouvé · 1 rien trouvé · 64 mauvais usage · 78 rien d'installé
`.trim();

/**
 * Point d'entrée.
 *
 * @returns le code de sortie du processus.
 */
export function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 64;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const pages = index(opts.root);
  if (pages.length === 0) {
    process.stderr.write(`${missingDocsMessage(opts.root)}\n`);
    return 78;
  }

  if (opts.list) {
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify(pages.map(publicShape), null, 2)}\n`,
      );
      return 0;
    }
    const byModule = new Map();
    for (const page of pages) {
      const key = page.module || "(sans module)";
      if (!byModule.has(key)) byModule.set(key, []);
      byModule.get(key).push(page);
    }
    process.stdout.write(`${pages.length} pages installées\n\n`);
    for (const [module, group] of [...byModule].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      process.stdout.write(`${module}\n`);
      for (const page of group)
        process.stdout.write(
          `  ${(page.topic || "—").padEnd(22)} ${page.title}\n      ${page.file}\n`,
        );
      process.stdout.write("\n");
    }
    return 0;
  }

  if (opts.open !== null) {
    const matches = resolvePage(opts);
    if (matches.length === 0) {
      process.stderr.write(
        `Aucune page ne correspond à « ${opts.open} ». « --list » les énumère.\n`,
      );
      return 1;
    }
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify(matches.map(publicShape), null, 2)}\n`,
      );
      return 0;
    }
    for (const page of matches) process.stdout.write(`${page.file}\n`);
    return 0;
  }

  if (opts.terms.length === 0) {
    process.stderr.write(`Aucun terme à chercher.\n\n${USAGE}\n`);
    return 64;
  }

  const result = search(opts);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          terms: opts.terms,
          indexed: result.indexed,
          total: result.total,
          pages: result.pages.map((entry) => ({
            file: entry.page.file,
            title: entry.page.title,
            module: entry.page.module,
            topic: entry.page.topic,
            score: entry.score,
            snippets: bestSnippets(entry.hits),
          })),
        },
        null,
        2,
      )}\n`,
    );
    return result.pages.length === 0 ? 1 : 0;
  }

  if (result.pages.length === 0) {
    process.stdout.write(
      `Rien sur « ${opts.terms.join(" ")} » dans les ${result.indexed} pages installées.\n` +
        "Essaie un seul mot, ou « --list » pour voir les sujets couverts.\n",
    );
    return 1;
  }

  const shown = result.pages.length;
  process.stdout.write(
    `${result.total} page${result.total > 1 ? "s" : ""} sur « ${opts.terms.join(" ")} »` +
      `${result.total > shown ? ` — les ${shown} premières` : ""}\n\n`,
  );
  for (const entry of result.pages) {
    process.stdout.write(
      `${entry.page.title || entry.page.file}  [${entry.page.module || "—"}]\n`,
    );
    process.stdout.write(`  ${entry.page.file}\n`);
    for (const snippet of bestSnippets(entry.hits))
      process.stdout.write(
        `  ${String(snippet.line).padStart(5)}: ${snippet.text.slice(0, 120)}\n`,
      );
    process.stdout.write("\n");
  }
  return 0;
}

// Exécuté directement (et non importé par son auto-contrôle) : rendre le code.
// La comparaison passe par une URL, jamais par un chemin : sous Windows, `D:\…`
// verrait son `d:` lu comme un protocole, et un `endsWith` sur le nom de base
// confondrait deux scripts homonymes de deux skills.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.exitCode = main();
}
