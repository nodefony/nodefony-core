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
 * Spécificateurs NUS importés par un `.d.ts` — lignes de commentaire ignorées
 * (un exemple de TSDoc n'est pas un import), chemins relatifs et modules
 * natifs exclus.
 *
 * @param {string} source - contenu du `.d.ts`.
 * @returns {Set<string>} noms de paquets.
 */
export function bareImports(source) {
  const found = new Set();
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
      if (spec === undefined || spec.startsWith(".") || spec.startsWith("/")) {
        continue;
      }
      if (spec.startsWith("node:") || BUILTINS.has(spec)) continue;
      found.add(packageNameOf(spec));
    }
  }
  return found;
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
