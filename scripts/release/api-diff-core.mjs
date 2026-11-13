/**
 * Noyau de la mesure de surface publique : ce qu'un paquet expose, et ce qui a
 * changé entre deux versions — sous-chemins d'`exports`, exports à l'exécution,
 * exports de types, et membre par membre pour les classes et interfaces.
 *
 * Tout ce qui décide est PUR ici (éprouvé par `api-diff-core.test.mjs`) ; les
 * commandes `api-diff.mjs` et `types-rigor.mjs` ne font qu'aller chercher les
 * fichiers et imprimer. Seule `listRuntimeExports` lance un process : c'est la
 * seule façon honnête de savoir ce qu'un module exporte réellement.
 *
 * @usage import { listRuntimeExports, exportEntries } from "./api-diff-core.mjs"
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
 * Options du programme TypeScript qui LIT des déclarations publiées — la façon
 * dont un consommateur les résout (`Bundler`), sans vérifier les bibliothèques.
 */
export const TYPES_PROGRAM_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

/**
 * Dit si un membre de classe ou d'interface est hors de la surface publique.
 *
 * `private` se lit sur le modificateur ; un champ `#x` s'émet en `#private;`
 * dans un `.d.ts`. `protected` reste PUBLIC : une classe qu'on étend l'expose.
 *
 * @param member - nœud membre d'une déclaration de classe ou d'interface.
 * @param sf - fichier source du nœud.
 * @returns `true` si le membre n'appartient pas à la surface publique.
 */
export function isPrivateMember(member, sf) {
  return Boolean(
    member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ||
    (member.name && ts.isPrivateIdentifier(member.name)) ||
    member.getText(sf).startsWith("#private"),
  );
}

/**
 * Nom d'un membre, tel qu'on le cite : `constructor` et `[index]` pour ceux qui n'en ont pas.
 *
 * @param member - nœud membre d'une déclaration de classe ou d'interface.
 * @param sf - fichier source du nœud.
 * @returns le nom affichable.
 */
export function memberName(member, sf) {
  if (member.name) return member.name.getText(sf);
  return ts.isConstructorDeclaration(member) ? "constructor" : "[index]";
}

/**
 * Étiquette TSDoc d'une surface expérimentale (`StandardTags.experimental`) :
 * son API peut changer dans une version mineure (ADR-0026 D11).
 */
export const EXPERIMENTAL_TAG = "experimental";

const hasExperimentalTag = (node) =>
  ts.getJSDocTags(node).some((tag) => tag.tagName.text === EXPERIMENTAL_TAG);

const memberKey = (member, sf) =>
  `${
    member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
      ? "static "
      : ""
  }${memberName(member, sf)}`;

/**
 * Lit la surface de types d'un fichier de déclarations : le texte de chaque
 * déclaration exportée, et ce qui porte l'étiquette `@experimental`.
 *
 * Les alias (`export { X } from`) sont suivis jusqu'à leur déclaration réelle.
 * L'étiquette se lit sur le symbole (`X`) ou sur un membre public d'une classe
 * ou d'une interface (`X.membre`, `X.static membre` — la clé de
 * {@link classifyDeclaration}) : un champ neuf d'une interface stable nomme son
 * membre, jamais l'interface entière.
 *
 * @param file - chemin absolu du `.d.ts` (l'artefact publié, pas la source).
 * @returns `{ declarations, experimental }` — `{ [nom]: texte }` (plusieurs
 *   déclarations fusionnées jointes par ` || `) et la liste triée des noms étiquetés.
 */
export function readTypeSurface(file) {
  const program = ts.createProgram([file], TYPES_PROGRAM_OPTIONS);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  const declarations = {};
  const experimental = new Set();
  if (!moduleSymbol) return { declarations, experimental: [] };
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const nodes = symbol.declarations ?? [];
    declarations[exported.name] = nodes
      .map((d) => stripComments(d.getText()).replace(/^export (declare )?/, ""))
      .sort()
      .join(" || ");
    if (nodes.some(hasExperimentalTag)) experimental.add(exported.name);
    for (const node of nodes) {
      if (!ts.isClassDeclaration(node) && !ts.isInterfaceDeclaration(node))
        continue;
      const sf = node.getSourceFile();
      for (const member of node.members) {
        if (isPrivateMember(member, sf) || !hasExperimentalTag(member))
          continue;
        experimental.add(`${exported.name}.${memberKey(member, sf)}`);
      }
    }
  }
  return { declarations, experimental: [...experimental].sort() };
}

/**
 * Lit les exports de types d'un fichier de déclarations, avec le texte de chaque déclaration.
 *
 * @param file - chemin absolu du `.d.ts`.
 * @returns `{ [nom]: texte }` — la part `declarations` de {@link readTypeSurface}.
 */
export function readTypeDeclarations(file) {
  return readTypeSurface(file).declarations;
}

/**
 * Stabilité déclarée d'un paquet : la clé `nodefony.stability` de son manifeste.
 *
 * @param pkg - le manifeste.
 * @returns `"experimental"`, ou `"stable"` (l'absence vaut stable).
 */
export function packageStability(pkg) {
  return pkg?.nodefony?.stability === "experimental"
    ? "experimental"
    : "stable";
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
        if (isPrivateMember(member, sf)) continue;
        const name = memberName(member, sf);
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

/** Préfixe d'une entrée de changelog qui touche une surface expérimentale. */
export const EXPERIMENTAL_ENTRY_PREFIX = "(expérimental) ";

/**
 * Traduit un rapport de mesure en entrées de CHANGELOG, à la forme de celles
 * que `analyserCommits` rend (`{ portee, texte, sha, rupture }`).
 *
 * Seul ce qui CASSE un consommateur devient une entrée : sous-chemin, export
 * ou type retiré, membre retiré (→ `Removed`), membre requis ajouté à une
 * interface (→ `Changed`). Les membres MODIFIÉS restent au rapport : leur
 * verdict demande un humain, et une entrée par signature noierait le reste.
 *
 * La stabilité décide de la rupture (ADR-0026 D11, point 5) : un changement
 * dans un paquet `experimental`, ou sur un symbole ou un membre étiqueté
 * `@experimental` DANS LA VERSION DE RÉFÉRENCE (celle qui le portait), est un
 * changement expérimental — annoncé, préfixé {@link EXPERIMENTAL_ENTRY_PREFIX},
 * jamais `rupture`. Une liste mêlée se scinde en deux entrées.
 *
 * @param report - le rapport de `measureApiDiff` (`stability` par paquet,
 *   `types.experimental` par entrée, lus dans la référence).
 * @returns `{ removed, changed }`, chaque entrée marquée `rupture` ou non.
 */
export function apiDiffChangelogEntries(report) {
  const removed = [];
  const changed = [];
  const suffix = " (mesuré par release:api-diff)";
  for (const [name, entry] of Object.entries(report.packages)) {
    if (entry.absentFromReference) continue;
    const portee = name.replace(/^@nodefony\//, "");
    const wholePackage = entry.stability === "experimental";
    const spec = (subpath) =>
      subpath === "." ? name : `${name}${subpath.slice(1)}`;
    const push = (list, texte, experimental) =>
      list.push(
        experimental
          ? {
              portee,
              texte: EXPERIMENTAL_ENTRY_PREFIX + texte + suffix,
              sha: "",
              rupture: false,
            }
          : { portee, texte: texte + suffix, sha: "", rupture: true },
      );
    // Une liste de noms → une entrée stable et une expérimentale, selon `isTagged`.
    const pushSplit = (list, names, isTagged, render) => {
      const tagged = wholePackage ? names : names.filter(isTagged);
      const stable = wholePackage ? [] : names.filter((n) => !isTagged(n));
      if (stable.length) push(list, render(stable), false);
      if (tagged.length) push(list, render(tagged), true);
    };
    for (const subpath of entry.subpaths.removed)
      push(
        removed,
        `retirer le sous-chemin d'import \`${spec(subpath)}\``,
        wholePackage,
      );
    for (const [subpath, r] of Object.entries(entry.entries)) {
      const tagged = new Set(r.types?.experimental ?? []);
      const names = [
        ...new Set([
          ...(r.runtime?.removed ?? []),
          ...(r.types?.removed ?? []),
        ]),
      ].sort();
      pushSplit(
        removed,
        names,
        (n) => tagged.has(n),
        (list) => `retirer ${quote(list)} de \`${spec(subpath)}\``,
      );
      for (const d of r.types?.declarations ?? []) {
        const declarationTagged = tagged.has(d.name);
        pushSplit(
          removed,
          d.removed.map((m) => `${d.name}.${m}`),
          (m) => declarationTagged || tagged.has(m),
          (list) => `retirer ${quote(list)} de \`${spec(subpath)}\``,
        );
        if (d.addedRequired.length)
          push(
            changed,
            `\`${d.name}\` (\`${spec(subpath)}\`) exige désormais ${quote(d.addedRequired)} : un implémenteur doit les fournir`,
            wholePackage || declarationTagged,
          );
      }
    }
  }
  return { removed, changed };
}
