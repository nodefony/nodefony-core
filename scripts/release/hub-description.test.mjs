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
  controlerPage,
  MAX_COURTE,
  MAX_LONGUE,
  SOURCE,
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
    expect(refus[0]).toContain("tronquée");
  });

  it("accepte tout juste la limite", () => {
    expect(controlerPage("x".repeat(MAX_LONGUE))).toEqual([]);
  });

  it("porte les bornes de la spec officielle, pas des valeurs devinées", () => {
    expect(MAX_LONGUE).toBe(25_000);
    expect(MAX_COURTE).toBe(100);
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
});
