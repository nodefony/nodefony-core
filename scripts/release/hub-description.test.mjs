/**
 * Le contrôle de la page Docker Hub, éprouvé SANS réseau.
 *
 * Ce qui se teste ici est le refus AVANT envoi : Docker Hub ne renvoie pas
 * d'erreur claire au-delà de ses limites — il tronque ou refuse selon le champ,
 * et une page coupée au milieu d'une phrase ressemble à un succès. Les deux
 * bornes viennent de la spec officielle
 * (`https://docs.docker.com/reference/api/hub/latest.yaml`, schéma de dépôt :
 * `description` maxLength 100, `full_description` maxLength 25000).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  controlerCourte,
  controlerPage,
  MAX_COURTE,
  MAX_LONGUE,
  SOURCE,
  SOURCE_COURTE,
} from "./hub-description.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("controlerPage", () => {
  it("accepte une page ordinaire", () => {
    expect(controlerPage("# Titre\n\nUn paragraphe.\n")).toEqual([]);
  });

  it("refuse une page vide — c'est l'état « INCOMPLETE » de Docker Hub", () => {
    expect(controlerPage("")).toHaveLength(1);
    expect(controlerPage("   \n\t\n")[0]).toContain("INCOMPLETE");
  });

  it("refuse au-delà de la limite de la spec, plutôt que de laisser tronquer", () => {
    const refus = controlerPage("x".repeat(MAX_LONGUE + 1));
    expect(refus).toHaveLength(1);
    expect(refus[0]).toContain("refusée");
  });

  it("accepte tout juste la limite", () => {
    expect(controlerPage("x".repeat(MAX_LONGUE))).toEqual([]);
  });

  it("compte la page en OCTETS UTF-8 — une page française dépasse avant ses caractères", () => {
    // 12 500 « é » : 12 500 caractères, 25 000 octets — accepté tout juste ;
    // un de plus, et l'API refuse, alors qu'un compte en caractères le laisserait partir.
    expect(controlerPage("é".repeat(MAX_LONGUE / 2))).toEqual([]);
    expect(controlerPage("é".repeat(MAX_LONGUE / 2) + "x")).toHaveLength(1);
  });

  it("porte les bornes de la spec officielle, pas des valeurs devinées", () => {
    expect(MAX_LONGUE).toBe(25_000);
    expect(MAX_COURTE).toBe(100);
  });
});

describe("controlerCourte", () => {
  it("accepte une ligne ordinaire", () => {
    expect(controlerCourte("Une ligne.")).toEqual([]);
  });

  it("refuse une ligne vide", () => {
    expect(controlerCourte("")).toHaveLength(1);
  });

  it("refuse plusieurs lignes — la recherche n'en affiche qu'une", () => {
    expect(controlerCourte("un\ndeux")[0]).toContain("plusieurs lignes");
  });

  it("compte en OCTETS UTF-8, comme l'API — pas en caractères", () => {
    // Constaté à la 10.0.0-beta.9 : 98 caractères refusés par Docker Hub,
    // « Exceeded max number of bytes 100 - actual 103 ». `—` pèse 3 octets.
    expect(controlerCourte("x".repeat(MAX_COURTE))).toEqual([]);
    expect(controlerCourte("x".repeat(MAX_COURTE + 1))).toHaveLength(1);
    expect(controlerCourte("—".repeat(34))).toHaveLength(1); // 34 car., 102 octets
    expect(controlerCourte("—".repeat(33) + "x")).toEqual([]); // 100 octets
    expect(controlerCourte("🐳".repeat(25))).toEqual([]); // 25 car., 100 octets
    expect(controlerCourte("🐳".repeat(26))[0]).toContain("104 octets");
  });
});

describe("la description courte versionnée", () => {
  const lire = () =>
    fs
      .readFileSync(path.join(ROOT, ...SOURCE_COURTE.split("/")), "utf8")
      .replace(/\r?\n$/, "");

  it("existe et passe son propre contrôle", () => {
    expect(controlerCourte(lire())).toEqual([]);
  });

  it("dit ce qu'est Nodefony — la recherche n'affiche que cette ligne", () => {
    // L'ancienne ligne, « Application Nodefony de démonstration, générée par
    // le scaffold du framework », ne disait pas ce qu'est Nodefony à qui le
    // découvre dans une liste de résultats.
    expect(lire()).toMatch(/framework Node\.js/);
  });
});

describe("la page versionnée du dépôt", () => {
  it("existe et passe son propre contrôle", () => {
    // Un contrôle qui ne s'applique pas à la page RÉELLE ne garde rien : c'est
    // celle-ci qui part sur Docker Hub, pas un cas de test.
    const abs = path.join(ROOT, ...SOURCE.split("/"));
    expect(fs.existsSync(abs), `${SOURCE} doit exister`).toBe(true);
    expect(controlerPage(fs.readFileSync(abs, "utf8"))).toEqual([]);
  });

  it("dit ce que l'image N'EST PAS — la confusion la plus probable", () => {
    // L'image est une application de démonstration générée, pas le framework.
    // Quelqu'un qui la tire en croyant installer Nodefony se trompe d'objet, et
    // c'est la première phrase qui doit l'en empêcher.
    const page = fs.readFileSync(path.join(ROOT, ...SOURCE.split("/")), "utf8");
    expect(page).toMatch(/n'est pas le framework/i);
  });

  it("documente le mécanisme de configuration par variable", () => {
    // Une image dont on ne peut rien régler ne sert qu'à une démonstration ;
    // sans ce chapitre, le mécanisme existe et personne ne le trouve.
    const page = fs.readFileSync(path.join(ROOT, ...SOURCE.split("/")), "utf8");
    expect(page).toContain("NF__");
    expect(page).toContain("NF_DATABASE_URL");
  });

  it("ne date pas une étiquette d'IMAGE d'une version de canal npm", () => {
    // `accueil-gate.mjs` juge chaque version citée contre le canal npm de même
    // nom. Les étiquettes d'image et les canaux npm ont divergé : l'image
    // `alpha` est restée sur la dernière alpha, quand le canal npm `alpha` sert
    // une bêta. Une version littérale sur cette ligne serait donc refusée — et
    // `--basculer` la réécrirait en mensonge.
    const page = fs.readFileSync(path.join(ROOT, ...SOURCE.split("/")), "utf8");
    const ligneAlpha = page.split("\n").find((l) => /^\|[^|]*`alpha`/.test(l));
    expect(ligneAlpha, "la ligne de l'étiquette `alpha`").toBeDefined();
    expect(ligneAlpha).not.toMatch(/\d+\.\d+\.\d+-/);
  });
});
