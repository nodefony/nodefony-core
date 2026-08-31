/**
 * Sentinelle d'ADOPTION du noyau client par la console d'administration.
 *
 * Le défaut que ce test ferme n'est pas un bogue : c'est un RETOUR EN ARRIÈRE.
 * La règle de sécurité de l'ADR-0007 D9 — ne re-négocier la socket que sur un
 * VRAI changement de compte, et la rouvrir hors de cette garde — est née d'une
 * fuite vécue en production, et elle a vécu des mois dans un magasin MobX de
 * cette seule application. Tant qu'elle y était, toute autre application
 * Nodefony devait la recopier pour ne pas reproduire la fuite. Elle vit
 * désormais dans le framework (`ClientKernel.setIdentity`).
 *
 * Ce que ce test surveille, c'est qu'elle n'y revienne pas : un magasin qui
 * rappellerait `disconnect()` de lui-même reprendrait la responsabilité au
 * framework, en silence, et le prochain portage repartirait du copier-coller.
 *
 * Pourquoi une analyse STATIQUE : le COMPORTEMENT des deux gardes est déjà
 * prouvé, à l'exécution, par `src/nodefony/src/tests/clientKernel.test.ts` —
 * cinq mutations, chacune fait tomber son propre cas. Le rejouer ici mesurerait
 * le framework une seconde fois. Ce qui n'est prouvé nulle part ailleurs, c'est
 * que CETTE application passe bien par là plutôt que de refaire le geste.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, "..", "..", "..", "frontend", "src");
const ROOT_STORE = path.join(FRONT, "stores", "RootStore.ts");
const APP = path.join(FRONT, "App.tsx");

/**
 * Garde les seules lignes de CODE — un mot cité en prose n'est pas un appel.
 *
 * Découpage ligne à ligne, et non par expression régulière sur le fichier
 * entier : une regex `/\*…\*/ ` s'ouvre sur le `; /*` d'un chemin cité dans un
 * commentaire (`/auth/*`) et ne se referme que des dizaines de lignes plus bas,
 * avalant le code au passage. Constaté ici même — le premier jet de ce test
 * lisait un fichier amputé de 4,6 Ko et rendait un rouge qui ne disait rien du
 * code. Un filtre approximatif sur du TypeScript est un lexeur qu'on n'a pas
 * écrit ; celui-ci ne prétend qu'à ce qu'il fait.
 */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        t !== "" &&
        !t.startsWith("//") &&
        !t.startsWith("/*") &&
        !t.startsWith("*") &&
        !t.startsWith("{/*")
      );
    })
    .join("\n");

describe("adoption du noyau client (ADR-0007 D11.4)", () => {
  it("le magasin racine compose par le noyau, pas par la socket nue", () => {
    const src = code(ROOT_STORE);
    expect(src).toContain("createClientKernel(");
    // `RealtimeClient.shared` reste dessous — mais c'est le noyau qui l'appelle.
    expect(src).not.toContain("RealtimeClient.shared(");
  });

  it("la règle de sécurité D9 n'est PLUS dans le magasin", () => {
    const src = code(ROOT_STORE);
    // Les deux gestes que le noyau porte maintenant. Les revoir ici signifie
    // qu'une application a repris au framework une règle de sécurité.
    expect(src).not.toMatch(/\brealtime\.disconnect\(/);
    expect(src).not.toMatch(/\brealtime\.connect\(/);
  });

  it("l'identité est DÉCLARÉE au noyau, et la purge des caches en découle", () => {
    const src = code(ROOT_STORE);
    expect(src).toContain("kernel.setIdentity(");
    expect(src).toContain('kernel.on("onIdentityChange"');
  });

  it("le fournisseur React est nourri par le REGISTRE du noyau", () => {
    // Sans conversion de type forcée : c'était le premier défaut du contrat,
    // qui typait la socket sur une interface que ce fournisseur n'accepte pas.
    // Le compilateur en est le juge ; ce cas empêche le retour d'un raccourci.
    const src = code(APP);
    expect(src).toMatch(
      /<NodefonyProvider\s+client=\{rootStore\.kernel\.get\("realtime"\)\}/,
    );
    expect(src).not.toMatch(/client=\{[^}]*\bas\b[^}]*\}/);
  });

  it("le noyau est démarré par l'application", () => {
    expect(code(ROOT_STORE)).toMatch(/kernel\.boot\(\)/);
  });
});
