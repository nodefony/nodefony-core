import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tout geste PRESCRIT par un refus doit exister chez celui qui le lit.
 *
 * Un verdict de migration porte `nextActions` — la commande à taper pour sortir
 * du refus. Elle est écrite ici, dans le dépôt du framework, et elle est lue
 * là-bas, dans l'application de quelqu'un. Rien ne rapproche les deux, et c'est
 * exactement par là qu'un défaut est passé : deux refus prescrivaient
 * `npm run generate:migrations`, le script du dépôt (`package.json` de
 * `@nodefony/drizzle`), absent des vingt-cinq scripts d'une application
 * générée.
 *
 * Ce n'est pas une coquille, c'est un changement de destinataire non fait. Et
 * le coût est le pire qui soit pour un message d'erreur : l'agent qui l'a reçu
 * a épuisé le geste impossible, puis a supprimé la base — la seule chose qui
 * lui restait. Un refus sans issue praticable enseigne la destruction.
 */
describe("Gestes prescrits — atteignables depuis une APPLICATION", () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const moduleDir = path.join(ici, "..", "..");
  const depotDir = path.join(moduleDir, "..", "..", "..", "..");
  const gabaritApp = path.join(
    depotDir,
    "src",
    "nodefony",
    "templates",
    "app",
    "base",
    "package.json.tpl",
  );

  /** Les fichiers de source du module, `dist` et dépendances exclus. */
  const sources = (): string[] => {
    const racines = [
      path.join(moduleDir, "nodefony", "src"),
      path.join(moduleDir, "nodefony", "command"),
    ];
    const trouves: string[] = [];
    for (const racine of racines) {
      for (const entree of readdirSync(racine, {
        recursive: true,
        encoding: "utf8",
      })) {
        // Normaliser AVANT de filtrer : `readdirSync` rend `a\b` sous Windows,
        // et un filtre écrit en `/` n'y mordrait pas.
        const rel = entree.split(path.sep).join("/");
        if (!rel.endsWith(".ts") || rel.includes("/dist/")) {
          continue;
        }
        trouves.push(path.join(racine, entree));
      }
    }
    return trouves;
  };

  /** Chaque `command:` d'un `nextActions`, avec son fichier. */
  const gestes = (): { fichier: string; commande: string }[] => {
    const releves: { fichier: string; commande: string }[] = [];
    for (const fichier of sources()) {
      const texte = readFileSync(fichier, "utf8");
      // Les deux écritures : littéral et gabarit interpolé.
      for (const m of texte.matchAll(/command:\s*["`]([^"`]+)["`]/g)) {
        releves.push({ fichier, commande: m[1] as string });
      }
    }
    return releves;
  };

  it("relève des gestes — sans quoi ce test serait vert sans rien lire", () => {
    // La garde anti-suite creuse : un balayage qui ne trouve rien passe tous
    // les cas suivants sans les exercer.
    assert.ok(
      gestes().length >= 3,
      `aucun geste relevé — le balayage ne lit plus les sources`,
    );
  });

  it("ne prescrit aucun script npm que le gabarit d'application ne déclare", () => {
    const gabarit = readFileSync(gabaritApp, "utf8");
    const fautifs = gestes()
      .filter(({ commande }) => commande.startsWith("npm run "))
      .filter(({ commande }) => {
        const script = commande.slice("npm run ".length).split(" ")[0] ?? "";
        return !gabarit.includes(`"${script}"`);
      });
    assert.deepEqual(
      fautifs.map((f) => `${path.basename(f.fichier)} → ${f.commande}`),
      [],
      "un refus prescrit un script npm qui n'existe pas dans une application " +
        "générée — c'est le script du DÉPÔT, lu par quelqu'un qui ne l'a pas",
    );
  });

  it("ne prescrit aucune commande `nodefony` que ce module n'enregistre", () => {
    const commandes = new Set<string>();
    const dirCmd = path.join(moduleDir, "nodefony", "command");
    for (const f of readdirSync(dirCmd)) {
      if (!f.endsWith(".ts")) {
        continue;
      }
      const texte = readFileSync(path.join(dirCmd, f), "utf8");
      for (const m of texte.matchAll(/"(orm:[a-z:]+)"/g)) {
        commandes.add(m[1] as string);
      }
    }
    const fautifs = gestes()
      .filter(({ commande }) => commande.startsWith("nodefony "))
      .filter(({ commande }) => {
        const nom = commande.slice("nodefony ".length).split(" ")[0] ?? "";
        return !commandes.has(nom);
      });
    assert.deepEqual(
      fautifs.map((f) => `${path.basename(f.fichier)} → ${f.commande}`),
      [],
      "un refus prescrit une commande `nodefony` que ce module n'enregistre pas",
    );
  });
});
