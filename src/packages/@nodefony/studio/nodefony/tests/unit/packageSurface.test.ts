/// <reference types="node" />
/**
 * Unit — la surface INSTALLÉE du paquet : ce qu'un consommateur npm télécharge.
 *
 * Studio est une application admin dont l'interface est construite AVANT la
 * publication (`prepack` → `build:ui` → `dist/frontend/`) et dont les sources
 * ne sont pas publiées (`files` ne porte pas `frontend/`). Vite a donc inliné
 * React, Mantine et le reste dans les assets livrés : le code publié ne résout
 * plus aucun de ces noms à l'exécution, et `resolveUiDelivery` ne peut même pas
 * choisir le chemin Vite chez le consommateur, faute de sources à compiler.
 *
 * Conséquence, et c'est ce que ce fichier tient : une entrée de `dependencies`
 * est une contrainte d'installation RÉELLE — npm la télécharge chez tous ceux
 * qui installent le paquet. Y laisser la chaîne front faisait tirer 190 Mo de
 * paquets directs pour du code que personne n'exécute jamais.
 *
 * La faute ne se paie nulle part pendant le développement : dans le dépôt, les
 * deux champs sont installés à l'identique, le typecheck passe, l'interface se
 * construit, les tests sont verts. Elle ne se constate que sur le tarball — et
 * elle s'est produite deux fois en deux jours, ici et dans les gabarits de
 * `create app`. D'où un contrôle plutôt qu'une consigne.
 *
 * La règle est écrite comme une IMPLICATION, pas comme « la liste doit être
 * vide » : le jour où Studio aura besoin d'une vraie dépendance d'exécution,
 * elle passera — à condition que le code publié l'importe.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Dossiers sans intérêt pour la question : ni publiés, ni sources back. */
const SKIP = new Set(["node_modules", "dist", "frontend", "public", ".git"]);

/**
 * Toutes les sources qui composent le code PUBLIÉ du paquet.
 *
 * `frontend/` est exclu délibérément : c'est précisément le code qui n'est pas
 * publié, et donc celui dont les imports ne justifient aucune dépendance
 * d'exécution.
 */
function backendSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      backendSources(full, acc);
    } else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("surface npm du paquet", () => {
  it("ne déclare en dépendance d'exécution que ce que le code publié importe", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    const declared = Object.keys(pkg.dependencies ?? {});
    if (declared.length === 0) return;

    const sources = backendSources(PKG_ROOT)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const unused = declared.filter((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(
        `from\\s+["']${escaped}(/[^"']*)?["']|require\\(["']${escaped}`,
      ).test(sources);
    });

    expect(
      unused,
      `déclaré(s) en "dependencies" mais importé(s) par aucun fichier publié : ` +
        `${unused.join(", ")}. Une dépendance que le code publié n'importe pas ` +
        `est téléchargée par tous les consommateurs pour rien — si elle ne sert ` +
        `qu'à construire l'interface, sa place est en "devDependencies".`,
    ).to.deep.equal([]);
  });

  it("publie l'interface déjà construite, faute de quoi le mode statique n'a rien à servir", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
    ) as { files?: string[] };

    // `dist` couvre `dist/frontend/index.html`, que `resolveUiDelivery` exige
    // pour choisir le mode statique — le seul atteignable chez un consommateur.
    expect(pkg.files ?? []).to.include("dist");
  });
});
