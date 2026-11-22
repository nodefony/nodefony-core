import { describe, expect, it } from "vitest";
import { servedPort } from "../testing/servedPort";

/**
 * Le port qu'un exemplaire jetable SERT. Le cas qui a fait naître ce banc : un
 * port demandé, repris par un autre processus avant le démarrage — l'exemplaire
 * glisse au suivant et le publie, et l'attente restait sur le port demandé
 * jusqu'au délai.
 */
describe("servedPort — suivre le port que l'exemplaire publie", () => {
  const CHILD = 4242;

  it("port demandé PRIS, l'exemplaire a glissé et publié le voisin → le voisin", () => {
    expect(
      servedPort(46629, { pid: CHILD, ports: [46630, 46631] }, CHILD),
    ).toBe(46630);
  });

  it("port 0 (attribué par le noyau) → celui qu'il publie", () => {
    expect(servedPort(0, { pid: CHILD, ports: [51234] }, CHILD)).toBe(51234);
  });

  it("rien de publié encore → le port demandé, tel quel", () => {
    expect(servedPort(46629, null, CHILD)).toBe(46629);
    expect(servedPort(0, null, CHILD)).toBe(0);
  });

  it("état publié par UN AUTRE processus (la suite, un run précédent) → ignoré", () => {
    expect(servedPort(46629, { pid: 1111, ports: [5151] }, CHILD)).toBe(46629);
  });

  it("pid de l'enfant inconnu (spawn raté) → jamais l'état d'un autre", () => {
    expect(servedPort(46629, { pid: 1111, ports: [5151] }, undefined)).toBe(
      46629,
    );
  });

  it("état publié sans port → le port demandé", () => {
    expect(servedPort(46629, { pid: CHILD, ports: [] }, CHILD)).toBe(46629);
  });
});
