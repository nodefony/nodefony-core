/**
 * Suite de la réconciliation de versions — écrite pour faire ÉCHOUER la garde,
 * pas pour l'accompagner.
 *
 * Ce que ces cas gardent : le critère qui décide si une divergence de
 * spécifications est un défaut. Le mauvais critère — « les spécifications
 * sont-elles identiques ? » — aurait fait échouer la forge sur `zod`, déclaré de
 * trois façons dans ce dépôt alors qu'une application générée compile
 * parfaitement : 4.6.0 satisfait les trois. Un contrôle qui crie sur ce qui va
 * bien finit désarmé, et c'est le seul mode de panne qui compte pour une garde.
 *
 * Les cas marqués « PIÈGE » sont ceux où une implémentation plausible se trompe.
 */
import { describe, expect, it } from "vitest";
import { reconcilie } from "./lib/reconcile-versions.mjs";

describe("reconcilie — une seule version peut-elle satisfaire tout le monde ?", () => {
  it("PIÈGE — des spécifications DIFFÉRENTES mais conciliables ne sont pas un défaut", () => {
    // Le cas réel de `zod` : quatorze sites en `^4.4.3`, une dépendance de
    // développement à `4.6.0`, une dépendance de pair à `^4.4.0`. Trois
    // écritures, une seule version installée — npm dédoublonne.
    expect(reconcilie(["^4.4.3", "4.6.0", "^4.4.0"], ["4.6.0", "4.6.1"])).toBe(
      true,
    );
  });

  it("deux majeures qu'aucune version ne concilie → défaut", () => {
    expect(reconcilie(["^3.22.0", "^4.4.3"], ["4.6.0", "3.25.76"])).toBe(false);
  });

  it("deux versions exactes différentes → défaut (npm installe les deux)", () => {
    expect(reconcilie(["19.2.7", "19.3.0"], ["19.3.0"])).toBe(false);
  });

  it("un plancher large et un épinglage dedans se concilient — le patron JUSTE", () => {
    // `peerDependencies: ">=6.0.0"` face à `devDependencies: "6.1.1"` est le
    // fonctionnement normal d'un paquet publié, pas une anomalie.
    expect(reconcilie([">=6.0.0", "6.1.1"], ["6.1.1"])).toBe(true);
  });

  it("PIÈGE — une spécification que semver ne lit pas est ÉCARTÉE, pas comptée contre", () => {
    // `workspace:*`, une URL, un dépôt git : ils ne décrivent aucune version
    // publiée. Les traiter comme un refus rendrait « inconciliable » des paquets
    // locaux parfaitement sains.
    expect(reconcilie(["workspace:*", "^4.4.3"], ["4.6.0"])).toBe(true);
    expect(reconcilie(["file:../truc", "git+ssh://x/y.git"], ["4.6.0"])).toBe(
      true,
    );
  });

  it("PIÈGE — sans candidate, on ne conclut à RIEN", () => {
    // Un paquet privé que le registre ne résout pas et qui n'est pas au verrou :
    // accuser sans preuve ferait échouer la forge sur un incident de réseau.
    expect(reconcilie(["^3.0.0", "^4.0.0"], [])).toBe(true);
  });

  it("une seule spécification ne peut pas diverger d'elle-même", () => {
    expect(reconcilie(["^4.4.3"], ["4.6.0"])).toBe(true);
    expect(reconcilie([], ["4.6.0"])).toBe(true);
  });

  it("PIÈGE — la préversion ne satisfait pas une plage ordinaire", () => {
    // `^7.0.0` n'accepte pas `7.0.0-dev.x` (semver §9) : une garde qui l'ignore
    // déclarerait conciliable un arbre qui se dédouble.
    expect(
      reconcilie(["^7.0.0", "7.0.0-dev.20260707.2"], ["7.0.0-dev.20260707.2"]),
    ).toBe(false);
  });
});
