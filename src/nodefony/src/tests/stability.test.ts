/**
 * **Le statut expérimental d'un paquet a UNE source, et tout ce qui le dit la recopie fidèlement.**
 *
 * La source est la clé `nodefony.stability` du `package.json` de chaque paquet
 * publié — lisible au registre (`npm view <paquet> nodefony.stability`). Quatre
 * endroits le RÉPÈTENT pour quatre lecteurs différents, et ce contrôle refuse
 * tout écart, dans les deux sens :
 *
 * - la politique de compatibilité (`docs/guides/compatibilite.md`, § « Surfaces
 *   expérimentales ») — l'engagement public ;
 * - les pages de documentation du paquet (`status: experimental`) — le badge ;
 * - la notice `.d.ts` (`@experimental` dans l'`index.ts`) — ce que lisent
 *   l'éditeur et l'agent de l'utilisateur ;
 * - le README — ce qu'affiche npm.
 *
 * Une copie qui diverge ment en silence : un paquet déclaré expérimental que la
 * politique ne nomme pas n'a pas le droit de changer en mineure ; une page
 * restée `stable` promet ce que la politique retire.
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Valeurs admises de `nodefony.stability` ; l'absence vaut « stable ». */
const KNOWN_STABILITY = new Set(["experimental"]);

/** Statuts de page admis pour un paquet expérimental (un brouillon le reste). */
const EXPERIMENTAL_PAGE_STATUS = new Set(["experimental", "draft"]);

interface PackageInfo {
  name: string;
  dir: string;
  stability: string | null;
}

/** Rétrécit une valeur JSON à un objet à clés de chaîne. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Les paquets PUBLIÉS du framework : le cœur et `src/packages/@nodefony/*`. */
function publishedPackages(): PackageInfo[] {
  const scope = path.join(REPO_ROOT, "src", "packages", "@nodefony");
  const dirs = [
    path.join(REPO_ROOT, "src", "nodefony"),
    ...readdirSync(scope).map((entry) => path.join(scope, entry)),
  ];
  const out: PackageInfo[] = [];
  for (const dir of dirs) {
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) continue;
    const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(pkg) || pkg.private === true || typeof pkg.name !== "string")
      continue;
    const meta = pkg.nodefony;
    const stability =
      isRecord(meta) && "stability" in meta ? String(meta.stability) : null;
    out.push({ name: pkg.name, dir, stability });
  }
  return out;
}

/** Les paquets que nomme le tableau de la section « Surfaces expérimentales ». */
function policyList(): string[] {
  const text = readFileSync(
    path.join(REPO_ROOT, "docs", "guides", "compatibilite.md"),
    "utf8",
  );
  const start = text.indexOf("## Surfaces expérimentales");
  assert.isAtLeast(
    start,
    0,
    "section « Surfaces expérimentales » absente de la politique",
  );
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);
  const names: string[] = [];
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names.sort();
}

/** Le `status:` de chaque page de `docs/` d'un paquet. */
function pageStatuses(
  dir: string,
): Array<{ page: string; status: string | null }> {
  const docs = path.join(dir, "docs");
  if (!existsSync(docs)) return [];
  return readdirSync(docs)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => {
      const match = /^status:\s*(\S+)/m.exec(
        readFileSync(path.join(docs, entry), "utf8"),
      );
      return {
        page: path.join(path.basename(dir), "docs", entry),
        status: match?.[1] ?? null,
      };
    });
}

describe("statut expérimental — une source, quatre copies fidèles", () => {
  const packages = publishedPackages();
  const experimental = packages.filter(
    (pkg) => pkg.stability === "experimental",
  );

  it("nodefony.stability ne porte qu'une valeur connue", () => {
    const unknown = packages.filter(
      (pkg) => pkg.stability !== null && !KNOWN_STABILITY.has(pkg.stability),
    );
    assert.deepEqual(
      unknown.map((pkg) => `${pkg.name}: ${pkg.stability}`),
      [],
      `valeurs admises : ${[...KNOWN_STABILITY].join(", ")} (l'absence vaut « stable »)`,
    );
  });

  it("la politique nomme exactement les paquets déclarés expérimentaux", () => {
    assert.deepEqual(
      policyList(),
      experimental.map((pkg) => pkg.name).sort(),
      "docs/guides/compatibilite.md § « Surfaces expérimentales » ↔ clés nodefony.stability",
    );
  });

  it("les pages d'un paquet expérimental le disent, celles d'un stable ne le disent pas", () => {
    const faults: string[] = [];
    for (const pkg of packages) {
      for (const { page, status } of pageStatuses(pkg.dir)) {
        if (
          pkg.stability === "experimental" &&
          !EXPERIMENTAL_PAGE_STATUS.has(status ?? "")
        ) {
          faults.push(
            `${page} : « ${status} » — attendu experimental (ou draft)`,
          );
        }
        if (pkg.stability !== "experimental" && status === "experimental") {
          faults.push(
            `${page} : experimental, alors que ${pkg.name} est stable`,
          );
        }
      }
    }
    assert.deepEqual(faults, []);
  });

  it("la notice (.d.ts) et le README d'un paquet expérimental l'annoncent", () => {
    const faults: string[] = [];
    for (const pkg of experimental) {
      const index = path.join(pkg.dir, "index.ts");
      if (!readFileSync(index, "utf8").includes("@experimental")) {
        faults.push(
          `${pkg.name} : aucune étiquette @experimental dans index.ts`,
        );
      }
      const readme = path.join(pkg.dir, "README.md");
      if (
        !existsSync(readme) ||
        !readFileSync(readme, "utf8").includes("Paquet expérimental")
      ) {
        faults.push(
          `${pkg.name} : aucun bandeau « Paquet expérimental » dans le README`,
        );
      }
    }
    assert.deepEqual(faults, []);
  });
});
