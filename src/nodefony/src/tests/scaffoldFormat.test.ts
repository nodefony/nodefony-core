/**
 * Mise en forme de ce que le scaffold produit — {@link formatScaffoldOutput}.
 *
 * Ce que ces cas gardent : une application générée arrivait avec des fichiers
 * que son PROPRE `npm run format` réécrivait au premier passage. La cause n'est
 * pas corrigeable dans les gabarits — la forme canonique dépend d'un
 * identifiant que l'utilisateur choisit (`export type ReportingMensuelConfigInput
 * = z.input<…>` fait 87 colonnes ; nommé `blog`, il tient sous 80) — donc c'est
 * le RÉSULTAT qu'on met en forme, avec le prettier du projet.
 */

import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  formatFilesOnDisk,
  formatScaffoldOutput,
} from "../cli/scaffold/format";
import { ScaffoldWriter } from "../cli/scaffold/writer";

/** Racine du dépôt — c'est SON prettier qu'on prête au projet de test. */
const REPO = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Un projet jetable. `avecPrettier` décide de la seule chose qui compte ici :
 * le projet a-t-il un prettier à prêter ? Le paquet est LIÉ, jamais copié —
 * copier 10 Mo par cas de test coûterait plus que tout le reste de la suite.
 */
function projet(avecPrettier: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nf-scaffold-format-"));
  if (avecPrettier) {
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    symlinkSync(
      path.join(REPO, "node_modules", "prettier"),
      path.join(dir, "node_modules", "prettier"),
      "dir",
    );
  }
  return dir;
}

/** Du TypeScript valide, mais pas dans la forme que prettier impose. */
const MAL_FORME = `export const a = {b:1,   c:2};\n`;
const BIEN_FORME = `export const a = { b: 1, c: 2 };\n`;

describe("formatFilesOnDisk — la passe d'APRÈS l'installation", () => {
  it("met en forme les fichiers nommés", () => {
    const dir = projet(true);
    const cible = path.join(dir, "genere.ts");
    writeFileSync(cible, MAL_FORME);

    const bilan = formatFilesOnDisk([cible], dir);

    expect(bilan.formatted).toBe(1);
    expect(readFileSync(cible, "utf8")).toBe(BIEN_FORME);
  });

  it("NE TOUCHE PAS un fichier que le scaffold n'a pas écrit", () => {
    // 🔴 Le défaut que ce cas garde : la première version passait `--write .` au
    // binaire du projet, ce qui reformatait le dépôt ENTIER de l'utilisateur —
    // son code écrit à la main compris — sur un simple `create module`.
    const dir = projet(true);
    const aNous = path.join(dir, "genere.ts");
    const aLui = path.join(dir, "ecrit-a-la-main.ts");
    writeFileSync(aNous, MAL_FORME);
    writeFileSync(aLui, MAL_FORME);

    formatFilesOnDisk([aNous], dir);

    expect(readFileSync(aNous, "utf8")).toBe(BIEN_FORME);
    expect(readFileSync(aLui, "utf8")).toBe(MAL_FORME);
  });

  it("laisse tout INTACT quand le projet n'a pas de prettier", () => {
    const dir = projet(false);
    const cible = path.join(dir, "genere.ts");
    writeFileSync(cible, MAL_FORME);

    const bilan = formatFilesOnDisk([cible], dir);

    expect(bilan.formatted).toBe(0);
    expect(bilan.pending).toBe(1);
    expect(readFileSync(cible, "utf8")).toBe(MAL_FORME);
  });
});

describe("formatScaffoldOutput", () => {
  it("met en forme un fichier CRÉÉ, avec le prettier du projet", () => {
    const dir = projet(true);
    const writer = new ScaffoldWriter();
    const cible = path.join(dir, "cree.ts");
    writer.write(cible, MAL_FORME);

    const bilan = formatScaffoldOutput(writer, dir);

    expect(bilan.formatted).toBe(1);
    expect(bilan.pending).toBe(0);
    expect(writer.read(cible)).toBe(BIEN_FORME);
  });

  it("laisse le contenu INTACT quand le projet n'a pas de prettier", () => {
    const dir = projet(false);
    const writer = new ScaffoldWriter();
    const cible = path.join(dir, "cree.ts");
    writer.write(cible, MAL_FORME);

    const bilan = formatScaffoldOutput(writer, dir);

    // Une génération ne se perd JAMAIS pour une question de forme : le fichier
    // est écrit tel quel, et l'appelant apprend qu'il reste à mettre en forme.
    expect(bilan.formatted).toBe(0);
    expect(bilan.pending).toBe(1);
    expect(writer.read(cible)).toBe(MAL_FORME);
  });

  it("met en forme une RÉÉCRITURE quand le fichier suivait déjà prettier", () => {
    const dir = projet(true);
    const cible = path.join(dir, "existant.ts");
    writeFileSync(cible, BIEN_FORME);
    const writer = new ScaffoldWriter();
    writer.write(cible, `${BIEN_FORME}export const ajout = {d:3};\n`);

    const bilan = formatScaffoldOutput(writer, dir);

    expect(bilan.formatted).toBe(1);
    expect(writer.read(cible)).toContain("export const ajout = { d: 3 };");
  });

  it("NE reformate PAS une réécriture dont le fichier avait son propre style", () => {
    const dir = projet(true);
    const cible = path.join(dir, "maison.ts");
    // Le projet ne suit pas prettier : reformater lui imposerait notre
    // convention et produirait un diff qui déborde très loin de l'insertion.
    writeFileSync(cible, MAL_FORME);
    const writer = new ScaffoldWriter();
    const apres = `${MAL_FORME}export const ajout = {d:3};\n`;
    writer.write(cible, apres);

    const bilan = formatScaffoldOutput(writer, dir);

    expect(bilan.formatted).toBe(0);
    expect(writer.read(cible)).toBe(apres);
  });

  it("ignore les extensions qu'on ne confie pas à prettier", () => {
    const dir = projet(true);
    const writer = new ScaffoldWriter();
    // `.svelte` demanderait un plugin que le projet n'a pas forcément : le
    // confier ferait échouer prettier fichier par fichier, pour rien.
    const cible = path.join(dir, "Composant.svelte");
    writer.write(cible, MAL_FORME);

    const bilan = formatScaffoldOutput(writer, dir);

    expect(bilan.formatted).toBe(0);
    expect(bilan.pending).toBe(0);
    expect(writer.read(cible)).toBe(MAL_FORME);
  });
});
