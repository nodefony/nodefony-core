/**
 * Référence d'API du site : ce que chaque paquet publié EXPOSE, rendu en pages
 * Markdown que le générateur de documentation publie sous `api/`.
 *
 * La source est la déclaration de types PUBLIÉE (`exports` → `.d.ts`) : la
 * surface qu'une application reçoit, et rien d'autre. Le graphe symbolique ne
 * convenait pas — il dit « exporté par le fichier », pas « exposé par le
 * paquet », ne porte aucune signature de méthode et tronque le TSDoc.
 *
 * Les pages ne sont écrites NULLE PART dans le dépôt : elles naissent au rendu
 * du site, depuis le code du moment, et ne peuvent donc pas être périmées. Pour
 * corriger une page, on corrige le TSDoc.
 *
 * Deux temps, séparés pour être éprouvés sans TypeScript : `extractApiModel`
 * lit les déclarations (seul à toucher au disque), `renderApiPages` est PUR.
 *
 * @usage import { extractApiModel, renderApiPages } from "./lib/api-reference.mjs"
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  exportEntries,
  isPrivateMember,
  memberName,
  normalizeDeclaration,
  TYPES_PROGRAM_OPTIONS,
} from "../../release/api-diff-core.mjs";
import { publishableWorkspaces } from "../../lib/workspaces.mjs";

/** Taille au-delà de laquelle une page se découpe — un outil de récupération HTTP tronque plus haut. */
export const API_PAGE_MAX_BYTES = 50 * 1024;

/** Les familles de symboles, dans l'ordre de lecture d'une page. */
export const API_KINDS = [
  { kind: "class", label: "Classes" },
  { kind: "function", label: "Fonctions" },
  { kind: "const", label: "Constantes" },
  { kind: "interface", label: "Interfaces" },
  { kind: "type", label: "Types" },
  { kind: "enum", label: "Énumérations" },
  { kind: "namespace", label: "Espaces de noms" },
  { kind: "reexport", label: "Bibliothèques réexportées" },
];

/** Longueur au-delà de laquelle une signature s'abrège : une page n'est pas un `.d.ts`. */
const SIGNATURE_MAX = 400;
const MEMBER_MAX = 200;

const printer = ts.createPrinter({ removeComments: true });

/** Texte d'un nœud SANS ses commentaires, sur une ligne, débarrassé du bruit d'émission. */
function printed(node, sf) {
  return normalizeDeclaration(
    printer.printNode(ts.EmitHint.Unspecified, node, sf),
  )
    .replace(/^export (default )?/, "")
    .replace(/^declare /, "")
    .replace(/;$/, "");
}

const abridge = (text, max) =>
  text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;

/**
 * Le paquet tiers qui porte un fichier de déclarations, ou `null` s'il est à nous.
 *
 * Un workspace atteint par son lien symbolique dans `node_modules` se résout à
 * son vrai chemin : seul un paquet installé y reste.
 */
function libraryOf(fileName) {
  const parts = fileName.split(/[\\/]/);
  const i = parts.lastIndexOf("node_modules");
  if (i === -1) return null;
  const first = parts[i + 1] ?? "";
  return first.startsWith("@") ? `${first}/${parts[i + 2]}` : first;
}

const KIND_PRIORITY = [
  [ts.SyntaxKind.ClassDeclaration, "class"],
  [ts.SyntaxKind.FunctionDeclaration, "function"],
  [ts.SyntaxKind.VariableDeclaration, "const"],
  [ts.SyntaxKind.EnumDeclaration, "enum"],
  [ts.SyntaxKind.InterfaceDeclaration, "interface"],
  [ts.SyntaxKind.TypeAliasDeclaration, "type"],
  [ts.SyntaxKind.ModuleDeclaration, "namespace"],
];

/** La famille d'un symbole fusionné (`const X` + `type X`) : la plus « exécutable » l'emporte. */
function kindOf(declarations) {
  for (const [syntax, kind] of KIND_PRIORITY)
    if (declarations.some((d) => d.kind === syntax)) return kind;
  return "type";
}

/** Le premier paragraphe d'un TSDoc, sur une ligne. */
export function firstParagraph(doc) {
  return (doc.split(/\n\s*\n/)[0] ?? "").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * La première phrase d'un TSDoc — un point suivi d'un espace, hors code inline.
 *
 * @param doc - texte du commentaire.
 * @returns la phrase, abrégée au-delà de {@link MEMBER_MAX}.
 */
export function firstSentence(doc) {
  const para = firstParagraph(doc);
  let inCode = false;
  for (let i = 0; i < para.length; i++) {
    if (para[i] === "`") inCode = !inCode;
    else if (
      !inCode &&
      ".!?".includes(para[i]) &&
      (i === para.length - 1 || para[i + 1] === " ")
    )
      return abridge(para.slice(0, i + 1), MEMBER_MAX);
  }
  return abridge(para, MEMBER_MAX);
}

/** Le TSDoc d'un symbole, liens traduits. */
const docOf = (symbol, checker) =>
  tsdocToMarkdown(
    ts.displayPartsToString(symbol.getDocumentationComment(checker)),
  );

/** Les membres publics d'une classe ou d'une interface, avec la première phrase de leur TSDoc. */
function membersOf(declaration, sf, checker) {
  const members = [];
  for (const member of declaration.members) {
    if (isPrivateMember(member, sf)) continue;
    const symbol = member.name
      ? checker.getSymbolAtLocation(member.name)
      : undefined;
    const doc = symbol ? docOf(symbol, checker) : "";
    members.push({
      name: memberName(member, sf),
      signature: abridge(printed(member, sf), MEMBER_MAX),
      summary: firstSentence(doc),
    });
  }
  return members;
}

/** Ce qu'une page dit d'une déclaration, selon sa famille. */
function signatureOf(declaration, sf) {
  if (
    ts.isClassDeclaration(declaration) ||
    ts.isInterfaceDeclaration(declaration)
  )
    return printed(declaration, sf).split("{")[0].trim();
  if (ts.isVariableDeclaration(declaration)) {
    const list = declaration.parent;
    const keyword =
      list &&
      ts.isVariableDeclarationList(list) &&
      list.flags & ts.NodeFlags.Const
        ? "const"
        : "let";
    return abridge(`${keyword} ${printed(declaration, sf)}`, SIGNATURE_MAX);
  }
  if (ts.isModuleDeclaration(declaration))
    return `namespace ${declaration.name.getText(sf)}`;
  return abridge(printed(declaration, sf), SIGNATURE_MAX);
}

/** Racines de sources qui ne disent rien du sujet d'une déclaration. */
const SOURCE_ROOTS = new Set(["src", "nodefony"]);

/**
 * Emplacement d'une déclaration dans son paquet — ses dossiers (`dist/types/`,
 * `src/` et `nodefony/` traversés), puis le nom du fichier. C'est l'axe de
 * découpe d'une page trop lourde.
 *
 * Mesuré depuis le PAQUET, pas depuis l'entrée du sous-chemin : `nodefony/client`
 * déclare dans `dist/types/client/` ce que son code isomorphe porte ailleurs.
 *
 * @param fileName - fichier de la déclaration (séparateurs indifférents).
 * @param packageDir - dossier du paquet.
 * @param grammar - `path` ou `path.win32`, injectable pour éprouver Windows.
 * @returns `[...dossiers, fichier]` ; `[]` pour une déclaration venue d'un autre de nos paquets.
 */
export function locationOf(fileName, packageDir, grammar = path) {
  const relative = grammar.relative(packageDir, fileName).split(/[\\/]/);
  if (relative[0] === "..") return [];
  // Le préfixe de BUILD (`dist/types/`, `dist/client/types/`) se retire en bloc :
  // `types` n'est pas traversé ailleurs, c'est aussi un vrai dossier du cœur.
  const build = relative[0] === "dist" ? relative.indexOf("types") : -1;
  if (build !== -1 && build <= 2) relative.splice(0, build + 1);
  while (SOURCE_ROOTS.has(relative[0] ?? "")) relative.shift();
  const file = (relative.pop() ?? "").replace(/\.d\.[mc]?ts$/, "");
  return [...relative, file];
}

/**
 * Traduit les balises de lien TSDoc en Markdown : `{@link X}` → `X` en code,
 * `{@link X | texte}` → le texte. Une URL garde son lien.
 *
 * Le vérificateur rend le lien SANS sa barre (`{@link X texte}`) : les deux
 * formes s'acceptent.
 */
export function tsdocToMarkdown(text) {
  return text.replace(
    /\{@link(?:code|plain)?\s+([^}|\s]+)(?:\s*\|?\s*([^}]*))?\}/g,
    (_, target, label) => {
      if (/^https?:\/\//.test(target))
        return `[${label?.trim() || target}](${target})`;
      return label?.trim() ? label.trim() : code(target);
    },
  );
}

/** Les symboles exportés par une entrée de types, lus par le vérificateur. */
function readSymbols(program, checker, dts, packageDir) {
  const sourceFile = program.getSourceFile(dts);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];
  const symbols = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const declarations = symbol.declarations ?? [];
    const library = declarations
      .map((d) => libraryOf(d.getSourceFile().fileName))
      .find(Boolean);
    if (library || declarations.length === 0) {
      symbols.push({
        name: exported.name,
        kind: "reexport",
        library: library ?? null,
        location: [],
      });
      continue;
    }
    const kind = kindOf(declarations);
    const tags = symbol.getJsDocTags(checker);
    const deprecated = tags.find((t) => t.name === "deprecated");
    const main =
      declarations.find((d) => kindOf([d]) === kind) ?? declarations[0];
    const sf = main.getSourceFile();
    const entry = {
      name: exported.name,
      kind,
      location: locationOf(sf.fileName, packageDir),
      summary: firstParagraph(docOf(symbol, checker)),
      deprecated: deprecated
        ? tsdocToMarkdown(ts.displayPartsToString(deprecated.text ?? [])) ||
          true
        : null,
      signatures: [
        ...new Set(
          declarations
            .filter((d) => kindOf([d]) === kind)
            .map((d) => signatureOf(d, d.getSourceFile())),
        ),
      ],
      members:
        ts.isClassDeclaration(main) || ts.isInterfaceDeclaration(main)
          ? membersOf(main, sf, checker)
          : [],
    };
    symbols.push(entry);
  }
  return symbols.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * Lit la surface publique de chaque paquet publiable, depuis ses déclarations de types publiées.
 *
 * Un paquet sans entrée de types (une commande pure) n'a pas de page.
 *
 * @param root - racine du dépôt.
 * @returns `[{ name, version, subpaths: [{ subpath, specifier, symbols }] }]`, triés par nom.
 * @throws Si une entrée de types déclarée n'existe pas : le paquet n'est pas bâti.
 */
export function extractApiModel(root) {
  return readPackagesApi(
    publishableWorkspaces(root).map((w) => path.join(root, w.location)),
    root,
  );
}

/**
 * Lit la surface publique de paquets donnés par leur dossier — le cœur de
 * {@link extractApiModel}, éprouvable sur un paquet de décor.
 *
 * @param dirs - dossiers de paquets (chacun porte son `package.json`).
 * @param root - base des chemins cités dans une erreur.
 * @returns le modèle, trié par nom de paquet.
 * @throws Si une entrée de types déclarée n'existe pas : le paquet n'est pas bâti.
 */
export function readPackagesApi(dirs, root) {
  const packages = [];
  const missing = [];
  for (const dir of dirs) {
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const entries = Object.entries(exportEntries(pkg, dir)).filter(
      ([, e]) => e.dts !== null,
    );
    if (entries.length === 0) continue;
    for (const [, e] of entries) if (!existsSync(e.dts)) missing.push(e.dts);
    packages.push({ name: pkg.name, version: pkg.version, dir, entries });
  }
  if (missing.length > 0)
    throw new Error(
      `déclarations de types absentes — lancer \`npm run build\` :\n  ${missing
        .map((f) => path.relative(root, f).split(path.sep).join("/"))
        .join("\n  ")}`,
    );

  const program = ts.createProgram(
    packages.flatMap((p) => p.entries.map(([, e]) => e.dts)),
    TYPES_PROGRAM_OPTIONS,
  );
  const checker = program.getTypeChecker();
  return packages
    .map((p) => ({
      name: p.name,
      version: p.version,
      subpaths: p.entries.map(([subpath, e]) => ({
        subpath,
        specifier: subpath === "." ? p.name : `${p.name}${subpath.slice(1)}`,
        symbols: readSymbols(program, checker, e.dts, p.dir),
      })),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

// ─── Rendu (pur) ─────────────────────────────────────────────────────────────

/** Code inline sûr : un accent grave dans le texte allonge la clôture. */
export function code(text) {
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Nom court d'un paquet : la clé de ses pages (`nodefony` → `core`). */
export function packageKey(name) {
  return name === "nodefony" ? "core" : name.replace(/^@nodefony\//, "");
}

/** La part d'un sous-chemin dans un nom de page (`./testing` → `testing`). */
const subpathKey = (subpath) =>
  subpath === "." ? "" : subpath.slice(2).replace(/[^\w-]+/g, "-");

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function renderSymbol(s) {
  const lines = [`#### ${code(s.name)}`, ""];
  if (s.kind === "reexport") {
    lines.push(
      s.library
        ? `La bibliothèque ${code(s.library)}, réexportée telle quelle : sa documentation est la sienne.`
        : "Réexport sans déclaration lisible.",
      "",
    );
    return lines.join("\n");
  }
  if (s.deprecated)
    lines.push(
      `> ⚠️ **Déprécié**${typeof s.deprecated === "string" ? ` — ${s.deprecated.replace(/\s*\n\s*/g, " ")}` : "."}`,
      "",
    );
  lines.push("```ts", ...s.signatures, "```", "");
  if (s.summary) lines.push(s.summary, "");
  if (s.members.length > 0) {
    for (const m of s.members)
      lines.push(`- ${code(m.signature)}${m.summary ? ` — ${m.summary}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderSymbols(symbols) {
  const out = [];
  for (const { kind, label } of API_KINDS) {
    const items = symbols.filter((s) => s.kind === kind);
    if (items.length === 0) continue;
    out.push(`### ${label} (${items.length})`, "", ...items.map(renderSymbol));
  }
  return out.join("\n");
}

const frontmatter = (fields) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n\n`;

/** L'avertissement de tête : d'où vient la page, et où la corriger. */
const origin = (pkg) =>
  `> Générée depuis les déclarations de types publiées de ${code(pkg.name)} ` +
  `**${pkg.version}** : exactement ce que reçoit une application qui l'installe. ` +
  `Cette page n'existe dans aucun dépôt — pour la corriger, on corrige le TSDoc du code.`;

/**
 * Une page de symboles : en-tête, fil d'Ariane, puis chaque sous-chemin et ses familles.
 *
 * @param spec - `{ relPath, title, navTitle, crumbs, pkg, sections: [{ specifier, symbols }] }`.
 */
function renderPage(spec) {
  const count = spec.sections.reduce((n, s) => n + s.symbols.length, 0);
  const body = spec.sections
    .map(
      (s) =>
        `## ${code(s.specifier)}\n\n` +
        `${code(`import { … } from "${s.specifier}"`)} — ${plural(s.symbols.length, "symbole", "symboles")}.\n\n` +
        renderSymbols(s.symbols),
    )
    .join("\n");
  return {
    relPath: spec.relPath,
    title: spec.title,
    navTitle: spec.navTitle,
    markdown:
      frontmatter({
        title: spec.title,
        navTitle: spec.navTitle,
        lang: "fr",
        status: "stable",
        description: `${plural(count, "symbole public", "symboles publics")} de ${spec.pkg.name} ${spec.pkg.version}, avec leurs signatures et leur TSDoc.`,
      }) +
      `# ${spec.title}\n\n${spec.crumbs}\n\n${origin(spec.pkg)}\n\n${body}\n` +
      `---\n\n[← Toutes les références d'API](${spec.back})\n`,
  };
}

const byteLength = (page) => Buffer.byteLength(page.markdown);

/** Compose une clé de page ; un dossier qui répète le sous-chemin (`client/client`) ne s'ajoute pas. */
const joinKey = (prefix, key) =>
  !key || key === prefix ? prefix : prefix ? `${prefix}-${key}` : key;

/** Regroupe des symboles selon une clé, groupes triés par clé. */
function groupBy(symbols, keyOf) {
  const groups = new Map();
  for (const s of symbols) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Découpe les symboles d'un sous-chemin en parts qui tiennent : dossier par
 * dossier, puis fichier par fichier, puis — un fichier trop lourd à lui seul —
 * en tranches consécutives.
 *
 * @returns `[{ key, symbols }]`.
 */
function splitSymbols(symbols, depth, prefix, fits) {
  const parts = [];
  // Les symboles d'un fichier posé à CE niveau forment le groupe sans nom.
  const atLevel = (s) =>
    s.location.length > depth + 1 ? s.location[depth] : "";
  for (const [dir, items] of groupBy(symbols, atLevel)) {
    const key = dir
      ? joinKey(prefix, dir)
      : joinKey(prefix, depth === 0 ? "racine" : "");
    if (fits(items)) parts.push({ key, symbols: items });
    else if (dir !== "")
      parts.push(...splitSymbols(items, depth + 1, key, fits));
    else
      for (const [file, inFile] of groupBy(
        items,
        (s) => s.location.at(-1) ?? "",
      )) {
        const fileKey = joinKey(key, file) || "racine";
        if (fits(inFile)) {
          parts.push({ key: fileKey, symbols: inFile });
          continue;
        }
        let slice = [];
        let n = 1;
        for (const s of inFile) {
          if (slice.length > 0 && !fits([...slice, s])) {
            parts.push({ key: `${fileKey}-${n++}`, symbols: slice });
            slice = [];
          }
          slice.push(s);
        }
        parts.push({ key: `${fileKey}-${n}`, symbols: slice });
      }
  }
  return parts;
}

/**
 * Découpe un paquet trop lourd pour une page : un part par sous-chemin, et un
 * sous-chemin trop lourd découpé à son tour ({@link splitSymbols}).
 *
 * @returns `[{ key, label, sections }]` ; une seule part = pas de découpe.
 */
function partsOf(pkg, fits) {
  if (fits(pkg.subpaths))
    return [{ key: "", label: "", sections: pkg.subpaths }];
  const parts = [];
  for (const sub of pkg.subpaths) {
    const sk = subpathKey(sub.subpath);
    const one = (s) => fits([{ ...sub, symbols: s }]);
    const pieces = one(sub.symbols)
      ? [{ key: sk || "racine", symbols: sub.symbols }]
      : splitSymbols(sub.symbols, 0, sk, one);
    for (const piece of pieces)
      parts.push({
        key: piece.key,
        // Un sous-chemin et un dossier du point d'entrée peuvent porter le même
        // nom (`nodefony/syslog` et `src/syslog/`) : le sous-chemin le dit.
        fromSubpath: sk !== "",
        label:
          pieces.length === 1
            ? sub.specifier
            : `${sub.specifier} — ${piece.key.slice(sk ? sk.length + 1 : 0) || "racine"}`,
        sections: [{ ...sub, symbols: piece.symbols }],
      });
  }
  const taken = new Set();
  for (const p of parts) {
    let key =
      taken.has(p.key) && p.fromSubpath ? `sous-chemin-${p.key}` : p.key;
    for (let n = 2; taken.has(key); n++) key = `${p.key}-${n}`;
    taken.add(key);
    p.key = key;
  }
  return parts;
}

/**
 * Rend les pages de la référence d'API : un index, puis une page par paquet —
 * ou un sommaire et une page par part quand le paquet dépasse {@link API_PAGE_MAX_BYTES}.
 *
 * @param model - le résultat de {@link extractApiModel}.
 * @param options - `{ maxBytes }` pour éprouver la découpe sans un paquet réel.
 * @returns `[{ relPath, title, navTitle, markdown }]`, chemins relatifs à `docs/`, en `/`.
 */
export function renderApiPages(model, { maxBytes = API_PAGE_MAX_BYTES } = {}) {
  const pages = [];
  const rows = [];
  // Le cœur d'abord : c'est par lui qu'on entre, et `@` le reléguerait en dernier.
  const ordered = [...model].sort((a, b) =>
    a.name === "nodefony"
      ? -1
      : b.name === "nodefony"
        ? 1
        : a.name < b.name
          ? -1
          : 1,
  );
  for (const pkg of ordered) {
    const key = packageKey(pkg.name);
    const title = `Référence d'API — ${pkg.name}`;
    const count = pkg.subpaths.reduce((n, s) => n + s.symbols.length, 0);
    const single = {
      relPath: `api/${key}.md`,
      title,
      navTitle: pkg.name,
      crumbs: `[Documentation](../index.md) › [Référence d'API](index.md) › ${code(pkg.name)}`,
      back: "index.md",
      pkg,
    };
    const fits = (sections) =>
      byteLength(renderPage({ ...single, sections })) <= maxBytes;
    const parts = partsOf(pkg, fits);
    if (parts.length === 1) {
      pages.push(renderPage({ ...single, sections: pkg.subpaths }));
      rows.push(
        `| [${code(pkg.name)}](${key}.md) | ${pkg.version} | ${count} | 1 |`,
      );
      continue;
    }
    const links = [];
    for (const part of parts) {
      const n = part.sections.reduce((m, s) => m + s.symbols.length, 0);
      pages.push(
        renderPage({
          relPath: `api/${key}/${part.key}.md`,
          title: `Référence d'API — ${part.label}`,
          navTitle: `${pkg.name} · ${part.key}`,
          crumbs: `[Documentation](../../index.md) › [Référence d'API](../index.md) › [${code(pkg.name)}](index.md) › ${part.key}`,
          back: "../index.md",
          pkg,
          sections: part.sections,
        }),
      );
      links.push({ part, n });
    }
    pages.push({
      relPath: `api/${key}/index.md`,
      title,
      navTitle: pkg.name,
      markdown:
        frontmatter({
          title,
          navTitle: pkg.name,
          lang: "fr",
          status: "stable",
          description: `${plural(count, "symbole public", "symboles publics")} de ${pkg.name} ${pkg.version}, répartis en ${links.length} pages.`,
        }) +
        `# ${title}\n\n[Documentation](../../index.md) › [Référence d'API](../index.md) › ${code(pkg.name)}\n\n` +
        `${origin(pkg)}\n\n` +
        `Trop vaste pour une seule page, la surface de ${code(pkg.name)} se lit en ${links.length} parts : ` +
        `une par sous-chemin d'import, et le point d'entrée principal découpé par dossier source.\n\n` +
        `| Part | Symboles |\n| --- | --- |\n` +
        links
          .map(
            ({ part, n }) => `| [${code(part.label)}](${part.key}.md) | ${n} |`,
          )
          .join("\n") +
        `\n\n---\n\n[← Toutes les références d'API](../index.md)\n`,
    });
    rows.push(
      `| [${code(pkg.name)}](${key}/index.md) | ${pkg.version} | ${count} | ${links.length} |`,
    );
  }
  pages.unshift({
    relPath: "api/index.md",
    title: "Référence d'API",
    navTitle: "Référence d'API",
    markdown:
      frontmatter({
        title: "Référence d'API",
        navTitle: "Référence d'API",
        lang: "fr",
        status: "stable",
        description:
          "Ce qu'expose chaque paquet publié de Nodefony — classes, fonctions, interfaces, types — avec leurs signatures et leur TSDoc.",
      }) +
      `# Référence d'API\n\n[Documentation](../index.md) › Référence d'API\n\n` +
      `Ce qu'expose chaque paquet publié de Nodefony : les symboles qu'on importe, leur signature, ` +
      `et la première phrase de leur documentation. Rien n'y est écrit à la main — chaque page est ` +
      `tirée des déclarations de types que le paquet publie, donc de ce qu'une application reçoit ` +
      `vraiment en l'installant.\n\n` +
      `Ces pages servent à qui évalue le framework sans l'avoir installé. Une fois installé, la même ` +
      `matière est à portée de main : l'éditeur affiche le TSDoc au survol, la console d'administration ` +
      `a un onglet API, et un agent interroge le graphe ${code(".ai/symbols.json")} de l'application.\n\n` +
      `| Paquet | Version | Symboles | Pages |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`,
  });
  return pages;
}
