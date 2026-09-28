/**
 * Noyau de la mesure de surface publique : ce qu'un paquet expose, et ce qui a
 * changé entre deux versions — sous-chemins d'`exports`, exports à l'exécution,
 * exports de types, et membre par membre pour les classes et interfaces.
 *
 * Tout ce qui décide est PUR ici (éprouvé par `api-diff-core.test.mjs`) ; les
 * commandes `api-diff.mjs` et `types-rigor.mjs` ne font qu'aller chercher les
 * fichiers et imprimer. Seule `listRuntimeExports` lance un process : c'est la
 * seule façon honnête de savoir ce qu'un module exporte réellement.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/** Conditions lues pour trouver l'entrée JavaScript d'un export. */
export const JS_CONDITIONS = ["import", "node", "default"];
/** Conditions lues pour trouver l'entrée de types — `types` d'abord, puis on descend. */
export const TYPES_CONDITIONS = ["types", "import", "node", "default"];

/**
 * Résout la cible d'une entrée `exports` en suivant la première condition connue, à toute profondeur.
 *
 * @param target - valeur d'une entrée `exports` (chaîne ou objet de conditions).
 * @param conditions - conditions acceptées, par ordre de préférence.
 * @returns le chemin relatif, ou `null` si aucune condition ne mène à une chaîne.
 */
export function resolveExportTarget(target, conditions) {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object") return null;
  for (const condition of conditions) {
    if (condition in target)
      return resolveExportTarget(target[condition], conditions);
  }
  return null;
}

/**
 * Liste les sous-chemins d'un manifeste avec leur entrée JavaScript et leur entrée de types.
 *
 * Un sous-chemin à motif (`*`) n'a pas d'entrée unique : il est listé, sans cible.
 *
 * @param pkg - le manifeste.
 * @param dir - dossier du paquet, pour rendre des chemins absolus.
 * @returns `{ [sousChemin]: { js, dts } }`, chemins absolus ou `null`.
 */
export function exportEntries(pkg, dir) {
  let map = pkg.exports ?? { ".": { types: pkg.types, default: pkg.main } };
  if (
    typeof map === "string" ||
    !Object.keys(map).some((k) => k.startsWith("."))
  )
    map = { ".": map };
  const entries = {};
  for (const [subpath, target] of Object.entries(map)) {
    const js = resolveExportTarget(target, JS_CONDITIONS);
    const dts = resolveExportTarget(target, TYPES_CONDITIONS);
    entries[subpath] = {
      js:
        js && /\.m?js$/.test(js) && !js.includes("*")
          ? path.join(dir, js)
          : null,
      dts:
        dts && /\.d\.m?ts$/.test(dts) && !dts.includes("*")
          ? path.join(dir, dts)
          : null,
    };
  }
  return entries;
}

/**
 * Compare deux listes de noms.
 *
 * @returns `{ removed, added }` — ce que `before` avait et `after` n'a plus, et l'inverse.
 */
export function diffNames(before, after) {
  const a = new Set(before);
  const b = new Set(after);
  return {
    removed: before.filter((k) => !b.has(k)),
    added: after.filter((k) => !a.has(k)),
  };
}

/**
 * Liste les exports RÉELS d'un module par import dans un process isolé.
 *
 * Isolé, parce que deux builds du même paquet chargés dans un seul process
 * explosent sur les registres globaux (« entité déjà enregistrée »).
 *
 * @param file - chemin absolu du module.
 * @returns les noms triés, ou `{ error }` avec la première ligne de l'erreur.
 */
export function listRuntimeExports(file) {
  try {
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        "import(process.argv[1]).then(m=>console.log(JSON.stringify(Object.keys(m).sort()))).catch(e=>{console.error(e.message);process.exit(2)})",
        pathToFileURL(file).href,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        cwd: path.dirname(file),
        timeout: 60_000,
      },
    );
    return JSON.parse(out.trim().split("\n").pop());
  } catch (error) {
    const text = String(error.stderr || error.message);
    return { error: text.split("\n").find((l) => l.trim()) ?? text };
  }
}

/**
 * Lit les exports de types d'un fichier de déclarations, avec le texte de chaque déclaration.
 *
 * Les alias (`export { X } from`) sont suivis jusqu'à leur déclaration réelle.
 *
 * @param file - chemin absolu du `.d.ts`.
 * @returns `{ [nom]: texte }` — plusieurs déclarations (fusion) jointes par ` || `.
 */
export function readTypeDeclarations(file) {
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  const declarations = {};
  if (!moduleSymbol) return declarations;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    declarations[exported.name] = (symbol.declarations ?? [])
      .map((d) => stripComments(d.getText()).replace(/^export (declare )?/, ""))
      .sort()
      .join(" || ");
  }
  return declarations;
}

const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Efface ce qui change le texte d'un type sans rien changer pour qui l'utilise.
 *
 * `?: T | undefined` (effet d'`exactOptionalPropertyTypes` à l'émission),
 * `Promise<unknown> | unknown`, extension `.js` dans un `import("…")`,
 * parenthèses autour d'un type fonction.
 *
 * @param text - texte d'une déclaration ou d'un membre.
 * @returns le texte comparable.
 */
export function normalizeDeclaration(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/ ?\| undefined\b/g, "")
    .replace(/\bundefined \| /g, "")
    .replace(
      /Promise<unknown> \| unknown|unknown \| Promise<unknown>/g,
      "unknown",
    )
    .replace(/import\("([^"]+)\.js"\)/g, 'import("$1")')
    .replace(/\((\([^()]*\) => [^()|]*)\)/g, "$1")
    .trim();
}

function parseMembers(text) {
  const source = text
    .split(" || ")
    .map((t) => `declare ${t.replace(/^declare /, "")}`)
    .join("\n");
  const sf = ts.createSourceFile(
    "decl.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  // Un membre peut s'appeler `constructor` ou `toString` : pas de prototype.
  const members = Object.create(null);
  let kind = null;
  let header = null;
  sf.forEachChild((node) => {
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      kind = ts.isClassDeclaration(node) ? "class" : "interface";
      header = normalizeDeclaration(node.getText(sf).split("{")[0]);
      for (const member of node.members) {
        const isPrivate =
          member.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.PrivateKeyword,
          ) ||
          (member.name && ts.isPrivateIdentifier(member.name)) ||
          member.getText(sf).startsWith("#private");
        if (isPrivate) continue;
        const name = member.name
          ? member.name.getText(sf)
          : ts.isConstructorDeclaration(member)
            ? "constructor"
            : "[index]";
        const isStatic = member.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.StaticKeyword,
        );
        (members[`${isStatic ? "static " : ""}${name}`] ??= []).push(
          normalizeDeclaration(member.getText(sf)),
        );
      }
    } else kind ??= ts.SyntaxKind[node.kind];
  });
  return { kind, header, members };
}

const isOptionalMember = (text) => /^(readonly )?[\w$"'[\]]+\?/.test(text);

/**
 * Classe le changement d'une déclaration entre deux versions.
 *
 * Catégories : `unchanged` (identique une fois normalisé), `additive` (membres
 * ajoutés seulement, et facultatifs s'il s'agit d'une interface), `review`
 * (membre retiré ou modifié, en-tête changé, membre requis ajouté à une
 * interface, ou fonction/type modifié — un humain tranche), `kind-changed`.
 *
 * @param before - texte de la déclaration dans la version de référence.
 * @param after - texte dans la version comparée.
 * @returns `{ kind, category, removed, changed, added, addedRequired, headerChanged }`.
 */
export function classifyDeclaration(before, after) {
  const a = parseMembers(before);
  const b = parseMembers(after);
  const result = {
    kind: a.kind,
    category: "unchanged",
    removed: [],
    changed: [],
    added: [],
    addedRequired: [],
    headerChanged: false,
  };
  if (a.kind !== b.kind) return { ...result, category: "kind-changed" };
  if (a.kind !== "class" && a.kind !== "interface") {
    result.category =
      normalizeDeclaration(before) === normalizeDeclaration(after)
        ? "unchanged"
        : "review";
    return result;
  }
  const namesA = Object.keys(a.members);
  const namesB = Object.keys(b.members);
  result.removed = namesA.filter((n) => !(n in b.members));
  result.added = namesB.filter((n) => !(n in a.members));
  result.changed = namesA.filter(
    (n) => n in b.members && a.members[n].join("|") !== b.members[n].join("|"),
  );
  result.addedRequired =
    a.kind === "interface"
      ? result.added.filter((n) => !b.members[n].every(isOptionalMember))
      : [];
  result.headerChanged = a.header !== b.header;
  if (
    result.removed.length ||
    result.changed.length ||
    result.addedRequired.length ||
    result.headerChanged
  ) {
    result.category = "review";
  } else if (result.added.length) result.category = "additive";
  return result;
}

/**
 * Texte avant/après des membres modifiés d'une classe ou interface, pour la relecture humaine.
 *
 * @returns `[{ member, before, after }]`.
 */
export function changedMemberTexts(before, after, names) {
  const a = parseMembers(before).members;
  const b = parseMembers(after).members;
  return names.map((member) => ({
    member,
    before: a[member].join(" ; "),
    after: b[member].join(" ; "),
  }));
}

/**
 * Compte, dans l'arbre syntaxique d'un fichier de déclarations, les `any`, les
 * `unknown`, les déclarations de premier niveau et celles qui contiennent au moins un `any`.
 *
 * L'arbre et pas le texte : un `any` dans un commentaire ou un nom n'en est pas un.
 *
 * @param sourceText - contenu du `.d.ts`.
 * @returns `{ any, unknown, declarations, declarationsWithAny, lines }`.
 */
export function countTypeLooseness(sourceText) {
  const sf = ts.createSourceFile(
    "x.d.ts",
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
  );
  const counts = {
    any: 0,
    unknown: 0,
    declarations: 0,
    declarationsWithAny: 0,
    lines: 0,
  };
  counts.lines = sourceText
    .split("\n")
    .filter((l) => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
  const isTopDeclaration = (n) =>
    ts.isClassDeclaration(n) ||
    ts.isInterfaceDeclaration(n) ||
    ts.isTypeAliasDeclaration(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isVariableStatement(n) ||
    ts.isEnumDeclaration(n);
  const visit = (node, current) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      counts.any++;
      if (current) current.hit = true;
    } else if (node.kind === ts.SyntaxKind.UnknownKeyword) counts.unknown++;
    let scope = current;
    if (!current && isTopDeclaration(node)) {
      scope = { hit: false };
      counts.declarations++;
    }
    ts.forEachChild(node, (child) => visit(child, scope));
    if (scope && scope !== current && scope.hit) counts.declarationsWithAny++;
  };
  visit(sf, null);
  return counts;
}

const quote = (names) => names.map((n) => `\`${n}\``).join(", ");

/**
 * Traduit un rapport de mesure en entrées de CHANGELOG, à la forme de celles
 * que `analyserCommits` rend (`{ portee, texte, sha, rupture }`).
 *
 * Seul ce qui CASSE un consommateur devient une entrée : sous-chemin, export
 * ou type retiré, membre retiré (→ `Removed`), membre requis ajouté à une
 * interface (→ `Changed`). Les membres MODIFIÉS restent au rapport : leur
 * verdict demande un humain, et une entrée par signature noierait le reste.
 *
 * @param report - le rapport de `measureApiDiff`.
 * @returns `{ removed, changed }`, deux listes d'entrées marquées rupture.
 */
export function apiDiffChangelogEntries(report) {
  const removed = [];
  const changed = [];
  const suffix = " (mesuré par release:api-diff)";
  for (const [name, entry] of Object.entries(report.packages)) {
    if (entry.absentFromReference) continue;
    const portee = name.replace(/^@nodefony\//, "");
    const spec = (subpath) =>
      subpath === "." ? name : `${name}${subpath.slice(1)}`;
    const push = (list, texte) =>
      list.push({ portee, texte: texte + suffix, sha: "", rupture: true });
    for (const subpath of entry.subpaths.removed)
      push(removed, `retirer le sous-chemin d'import \`${spec(subpath)}\``);
    for (const [subpath, r] of Object.entries(entry.entries)) {
      const names = [
        ...new Set([
          ...(r.runtime?.removed ?? []),
          ...(r.types?.removed ?? []),
        ]),
      ].sort();
      if (names.length)
        push(removed, `retirer ${quote(names)} de \`${spec(subpath)}\``);
      for (const d of r.types?.declarations ?? []) {
        if (d.removed.length)
          push(
            removed,
            `retirer ${quote(d.removed.map((m) => `${d.name}.${m}`))} de \`${spec(subpath)}\``,
          );
        if (d.addedRequired.length)
          push(
            changed,
            `\`${d.name}\` (\`${spec(subpath)}\`) exige désormais ${quote(d.addedRequired)} : un implémenteur doit les fournir`,
          );
      }
    }
  }
  return { removed, changed };
}
