/**
 * Les types publiés d'un paquet n'importent-ils que ce que l'installeur RECEVRA ?
 *
 * Un `.d.ts` publié qui importe un module tiers (`import type { WebSocket } from
 * "ws"`) exige que l'application trouve les TYPES de ce module. Si le paquet
 * déclare `ws` en `dependencies` mais garde `@types/ws` en `devDependencies`,
 * l'installeur reçoit le module sans ses types : une application stricte sans
 * `skipLibCheck` prend un `TS7016` DANS nos déclarations. Vécu : 14 erreurs chez
 * un consommateur de `@nodefony/http` et du cœur, invisibles à toutes les suites
 * du dépôt (`skipLibCheck` posé dans `tarball-types.test.mjs`, faute de pouvoir
 * installer le graphe sans réseau).
 *
 * Contrôle STATIQUE, sans réseau : pour chaque module nu importé par les
 * `.d.ts` du `dist`, le paquet doit le fournir —
 * - pair (`peerDependencies`) : l'application l'installe, avec ses types ;
 * - pair FACULTATIF (`peerDependenciesMeta.optional`) : seulement l'application
 *   qui s'en sert l'installe. Il ne doit donc JAMAIS être atteint depuis les
 *   types du point d'entrée principal (`exports["."]`), sans quoi une application
 *   qui ne s'en sert pas prend `TS2307` dès que `skipLibCheck` vaut `false`
 *   (constaté, ADR-0026 D12). Sa place est un sous-chemin (`nodefony/react`,
 *   `@nodefony/http/grpc`) ;
 * - dépendance : le module embarque ses types, ou `@types/<module>` est déclaré
 *   hors `devDependencies` ;
 * - non déclaré : seulement s'il figure dans {@link DELIBERATELY_UNDECLARED}, avec
 *   sa raison.
 *
 * @usage node scripts/release/dts-deps.mjs
 */
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releasableWorkspaces } from "../lib/workspaces.mjs";

/**
 * Modules importés par des types publiés et VOLONTAIREMENT non déclarés.
 * Raison commune : un pair, même facultatif, satisfait par une dépendance de
 * développement de l'application, RESTE dans son image de production
 * (`npm prune --omit=dev` le garde — mesuré, cf `PACK_PEER_OPTIONAL` dans
 * `pack-all.mjs`). Ces outils de build n'ont rien à y faire.
 */
export const DELIBERATELY_UNDECLARED = Object.freeze({
  rolldown:
    "outil de build (`nodefony/bundler`) : l'application l'a en devDependency",
  typescript:
    "compilateur, chargé à la demande par le graphe symbolique : l'application l'a en devDependency",
});

const BUILTINS = new Set(builtinModules);

/** Nom du paquet `@types` d'un module (`@scope/x` → `@types/scope__x`). */
export function typesPackageName(moduleName) {
  return moduleName.startsWith("@")
    ? `@types/${moduleName.slice(1).replace("/", "__")}`
    : `@types/${moduleName}`;
}

/** Nom de paquet d'un spécificateur nu (`ws/lib/x` → `ws`, `@a/b/c` → `@a/b`). */
export function packageNameOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Tous les spécificateurs importés par un `.d.ts`, relatifs compris — lignes de
 * commentaire ignorées (un exemple de TSDoc n'est pas un import).
 *
 * @param {string} source - contenu du `.d.ts`.
 * @returns {string[]} spécificateurs, dans l'ordre du fichier.
 */
export function importSpecifiers(source) {
  const found = [];
  const pattern =
    /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gu;
  for (const line of source.split("\n")) {
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("//")
    ) {
      continue;
    }
    for (const m of line.matchAll(pattern)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec !== undefined) found.push(spec);
    }
  }
  return found;
}

/**
 * Le spécificateur désigne-t-il un PAQUET (ni chemin relatif ou absolu, ni
 * module natif) ?
 */
function isPackageSpecifier(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  return !spec.startsWith("node:") && !BUILTINS.has(spec);
}

/**
 * Spécificateurs NUS importés par un `.d.ts` — lignes de commentaire ignorées,
 * chemins relatifs et modules natifs exclus.
 *
 * @param {string} source - contenu du `.d.ts`.
 * @returns {Set<string>} noms de paquets.
 */
export function bareImports(source) {
  const found = new Set();
  for (const spec of importSpecifiers(source)) {
    if (isPackageSpecifier(spec)) found.add(packageNameOf(spec));
  }
  return found;
}

/**
 * Fichiers de types du point d'entrée PRINCIPAL : chaque feuille `types`
 * d'`exports["."]` (variantes navigateur et Node comprises), sinon le champ
 * `types` du manifeste. Chemins POSIX relatifs au paquet, sans `./`.
 *
 * @param {{ exports?: unknown, types?: string }} manifest
 * @returns {string[]}
 */
export function mainTypeEntries(manifest) {
  const out = [];
  const walk = (node, underTypes) => {
    if (typeof node === "string") {
      if (underTypes) out.push(node.replace(/^\.\//u, ""));
    } else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, key === "types");
      }
    }
  };
  const exportsField = manifest.exports;
  const main =
    exportsField !== null && typeof exportsField === "object"
      ? exportsField["."]
      : undefined;
  if (main !== undefined) walk(main, false);
  if (out.length === 0 && typeof manifest.types === "string") {
    out.push(manifest.types.replace(/^\.\//u, ""));
  }
  return [...new Set(out)];
}

/**
 * Paquets atteints par les types d'un point d'entrée, en suivant ses imports
 * RELATIFS de proche en proche — exactement ce que TypeScript charge quand
 * l'application importe ce point d'entrée.
 *
 * Fonction PURE : le disque est injecté (`readDeclaration`).
 *
 * @param {object} input
 * @param {string[]} input.entries - `.d.ts` de départ (POSIX, relatifs au paquet).
 * @param {(file: string) => string | null} input.readDeclaration - contenu d'un
 *   `.d.ts` (POSIX, relatif au paquet), `null` s'il n'existe pas.
 * @returns {Map<string, string>} paquet → premier `.d.ts` atteint qui l'importe.
 */
export function reachableTypeImports({ entries, readDeclaration }) {
  const imports = new Map();
  const seen = new Set();
  const queue = [...entries];
  const resolveRelative = (from, spec) => {
    const base = path.posix.join(path.posix.dirname(from), spec);
    const candidates = [
      base.endsWith(".d.ts") ? base : null,
      /\.[cm]?js$/u.test(base)
        ? base.replace(/\.([cm]?)js$/u, ".d.$1ts")
        : `${base}.d.ts`,
      `${base}/index.d.ts`,
    ];
    for (const candidate of candidates) {
      if (candidate === null) continue;
      const source = readDeclaration(candidate);
      if (source !== null) return { file: candidate, source };
    }
    return null;
  };
  const sources = new Map();
  for (const entry of entries) {
    const source = readDeclaration(entry);
    if (source !== null) sources.set(entry, source);
  }
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = sources.get(file) ?? readDeclaration(file);
    if (source === null) continue;
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith(".")) {
        const target = resolveRelative(file, spec);
        if (target !== null && !seen.has(target.file)) {
          sources.set(target.file, target.source);
          queue.push(target.file);
        }
      } else if (isPackageSpecifier(spec)) {
        const mod = packageNameOf(spec);
        if (!imports.has(mod)) imports.set(mod, file);
      }
    }
  }
  return imports;
}

/**
 * Pairs FACULTATIFS atteints depuis les types du point d'entrée principal.
 *
 * @param {object} input
 * @param {{ peerDependenciesMeta?: Record<string, { optional?: boolean }> }} input.manifest
 * @param {Map<string, string>} input.imports - sortie de {@link reachableTypeImports}.
 * @returns {Array<{ module: string, file: string, reason: string }>}
 */
export function optionalPeersInMainTypes({ manifest, imports }) {
  const meta = manifest.peerDependenciesMeta ?? {};
  const optional = (name) => meta[name]?.optional === true;
  const problems = [];
  for (const [mod, file] of imports) {
    if (!optional(mod) && !optional(typesPackageName(mod))) continue;
    problems.push({
      module: mod,
      file,
      reason:
        "pair FACULTATIF atteint depuis les types du point d'entrée principal : une application qui ne l'installe pas prend TS2307 (skipLibCheck: false) — le déplacer dans un sous-chemin",
    });
  }
  return problems;
}

/**
 * Modules importés par les types publiés et que le paquet ne fournit pas.
 *
 * Fonction PURE : le disque est injecté (`hasOwnTypes`), pour éprouver chaque
 * branche sans installer quoi que ce soit.
 *
 * @param {object} input
 * @param {{ name: string, dependencies?: object, peerDependencies?: object, optionalDependencies?: object }} input.manifest
 * @param {Map<string, string>} input.imports - module → premier `.d.ts` qui l'importe.
 * @param {(moduleName: string) => boolean} input.hasOwnTypes - le module embarque-t-il ses types ?
 * @returns {Array<{ module: string, file: string, reason: string }>}
 */
export function unprovidedTypeImports({ manifest, imports, hasOwnTypes }) {
  const shipped = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  const peers = manifest.peerDependencies ?? {};
  const problems = [];
  for (const [mod, file] of imports) {
    if (mod === manifest.name) continue;
    const typesName = typesPackageName(mod);
    if (mod in peers || typesName in peers) continue;
    if (typesName in shipped) continue;
    if (mod in shipped) {
      if (hasOwnTypes(mod)) continue;
      problems.push({
        module: mod,
        file,
        reason: `${typesName} absent des dependencies (l'installeur reçoit ${mod} sans ses types)`,
      });
      continue;
    }
    if (mod in DELIBERATELY_UNDECLARED) continue;
    problems.push({
      module: mod,
      file,
      reason: "importé par les types publiés, déclaré nulle part",
    });
  }
  return problems;
}

/** Tous les `.d.ts` sous un dossier. */
function declarationFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) declarationFiles(p, out);
    else if (entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Fichiers JS d'entrée d'un manifeste : `main`, `module`, feuilles d'`exports`. */
export function entryPoints(manifest) {
  const out = ["index.js"];
  if (typeof manifest.main === "string") out.push(manifest.main);
  if (typeof manifest.module === "string") out.push(manifest.module);
  const walk = (node) => {
    if (typeof node === "string") {
      if (/\.[cm]?js$/u.test(node)) out.push(node);
    } else if (node !== null && typeof node === "object") {
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(manifest.exports);
  return out;
}

/** Déclarations qu'un `.js` d'entrée peut avoir à côté de lui. */
export function declarationSiblings(entry) {
  return [entry.replace(/\.([cm]?)js$/u, ".d.$1ts")];
}

/**
 * Le module embarque-t-il ses types ? Lu sur le `package.json` installé, en
 * remontant les `node_modules` depuis le paquet (résolution de Node).
 */
function ownTypesReader(fromDir, root) {
  return (moduleName) => {
    let dir = fromDir;
    for (;;) {
      const manifestPath = path.join(
        dir,
        "node_modules",
        moduleName,
        "package.json",
      );
      if (fs.existsSync(manifestPath)) {
        const pj = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (pj.types || pj.typings) return true;
        if (pj.exports && JSON.stringify(pj.exports).includes('"types"')) {
          return true;
        }
        // Sans champ `types`, TypeScript lit le `.d.ts` posé À CÔTÉ du `.js`
        // d'entrée (`cookie` : `dist/index.js` + `dist/index.d.ts`).
        const base = path.dirname(manifestPath);
        return entryPoints(pj).some((entry) =>
          declarationSiblings(entry).some((d) =>
            fs.existsSync(path.join(base, d)),
          ),
        );
      }
      if (dir === root || path.dirname(dir) === dir) return false;
      dir = path.dirname(dir);
    }
  };
}

/**
 * Contrôle tous les paquets publiables du dépôt, sur leur `dist` bâti.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ package: string, module: string, file: string, reason: string }>}
 */
export function checkRepository(root) {
  const problems = [];
  for (const ws of releasableWorkspaces(root)) {
    const pkgDir = path.join(root, ws.location);
    const imports = new Map();
    for (const file of declarationFiles(path.join(pkgDir, "dist"))) {
      for (const mod of bareImports(fs.readFileSync(file, "utf8"))) {
        if (!imports.has(mod)) {
          imports.set(
            mod,
            path.relative(pkgDir, file).split(path.sep).join("/"),
          );
        }
      }
    }
    for (const p of unprovidedTypeImports({
      manifest: ws,
      imports,
      hasOwnTypes: ownTypesReader(pkgDir, root),
    })) {
      problems.push({ package: ws.name, ...p });
    }
    const meta = ws.peerDependenciesMeta ?? {};
    if (!Object.values(meta).some((m) => m?.optional === true)) continue;
    const readDeclaration = (rel) => {
      const file = path.join(pkgDir, ...rel.split("/"));
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    };
    const entries = mainTypeEntries(ws);
    // Une entrée illisible rendrait une clôture VIDE, donc un vert qui n'a rien lu.
    const unread = entries.filter((e) => readDeclaration(e) === null);
    if (entries.length === 0 || unread.length > 0) {
      problems.push({
        package: ws.name,
        module: "(point d'entrée principal)",
        file: unread.join(", ") || 'exports["."]',
        reason:
          "types du point d'entrée principal introuvables — `npm run build` d'abord",
      });
      continue;
    }
    const mainImports = reachableTypeImports({ entries, readDeclaration });
    for (const p of optionalPeersInMainTypes({
      manifest: ws,
      imports: mainImports,
    })) {
      problems.push({ package: ws.name, ...p });
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const problems = checkRepository(root);
  for (const p of problems) {
    console.error(`✗ ${p.package} : ${p.module} — ${p.reason} [${p.file}]`);
  }
  if (problems.length > 0) process.exit(1);
  console.log(
    "✓ types publiés : chaque module importé est fourni à l'installeur",
  );
}
