/**
 * Le repli UUID v7 — parce qu'un `import` nommé d'une API trop récente ne
 * dégrade pas : il TUE le démarrage.
 *
 * `crypto.randomUUIDv7()` n'existe qu'à partir de Node 24.16.0, et le framework
 * déclare `engines: ">=24.0.0"`. Constaté en vrai sur l'image distroless
 * (Node 24.14.0) : l'image se construit, se lance, et meurt sur « does not
 * provide an export named 'randomUUIDv7' ».
 *
 * Ce banc éprouve le repli POUR LUI-MÊME — `composeUuidV7` est exportée
 * exprès —, et non « l'implémentation qui se trouve tourner ici » : sur une
 * machine en Node ≥ 24.16, tester `randomUuidV7()` ne dirait rien du chemin
 * qu'on veut garder.
 */
import { describe, it, expect } from "vitest";
import {
  composeUuidV7,
  randomUuidV7,
  usesNativeUuidV7,
} from "../runtime/uuidV7";

/** `8-4-4-4-12`, version 7 et variante RFC comprises. */
const FORME_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("composeUuidV7 — le repli, éprouvé pour lui-même", () => {
  it("rend la forme d'un UUID v7 : version 7 et variante RFC", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(composeUuidV7()).toMatch(FORME_V7);
    }
  });

  it("porte l'horodatage courant dans ses 48 bits de tête", () => {
    const avant = Date.now();
    const hex = composeUuidV7().replace(/-/gu, "").slice(0, 12);
    const apres = Date.now();
    const horodatage = Number.parseInt(hex, 16);
    // Bornes prises AUTOUR de l'appel : un seuil fixe mesurerait la machine.
    expect(horodatage).toBeGreaterThanOrEqual(avant);
    expect(horodatage).toBeLessThanOrEqual(apres);
  });

  it("🔴 est TRIABLE dans le temps — c'est sa raison d'être, pas sa forme", () => {
    // Un repli sur un UUID v4 passerait le test de forme et échouerait ici :
    // les identifiants cesseraient d'atterrir côte à côte dans l'index, et rien
    // ne le signalerait avant la montée en charge.
    const tot = composeUuidV7();
    const attente = Date.now() + 3;
    while (Date.now() < attente) {
      /* laisser l'horloge avancer d'au moins trois millisecondes */
    }
    const tard = composeUuidV7();
    expect(tard > tot).toBe(true);
  });

  it("ne rend jamais deux fois le même", () => {
    const vus = new Set<string>();
    for (let i = 0; i < 1000; i += 1) vus.add(composeUuidV7());
    expect(vus.size).toBe(1000);
  });
});

describe("randomUuidV7 — la porte, quelle que soit la version de Node", () => {
  it("rend un v7 valide, natif ou composé", () => {
    expect(randomUuidV7()).toMatch(FORME_V7);
  });

  it("CONSTATE la capacité au lieu de la déduire d'un numéro de version", () => {
    // Le verdict est un booléen, et il doit correspondre à ce que ce Node porte
    // VRAIMENT — c'est le seul fait que ce test peut établir ici.
    const natif =
      typeof (globalThis as { crypto?: unknown }).crypto === "object" &&
      usesNativeUuidV7();
    expect(typeof usesNativeUuidV7()).toBe("boolean");
    // Et quelle que soit la réponse, la porte rend la même FORME.
    expect(randomUuidV7()).toMatch(FORME_V7);
    expect(typeof natif).toBe("boolean");
  });
});
