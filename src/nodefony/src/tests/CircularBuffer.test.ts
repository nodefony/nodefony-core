/**
 * L'anneau partagé (`runtime/CircularBuffer.ts`) : FIFO borné, lecture par
 * index et retrait en tête, tout en O(1) et sans copie.
 */
import { describe, it, expect } from "vitest";
import { CircularBuffer } from "../runtime/CircularBuffer";

function filled(capacity: number, values: number[]): CircularBuffer<number> {
  const ring = new CircularBuffer<number>(capacity);
  for (const v of values) ring.push(v);
  return ring;
}

describe("CircularBuffer", () => {
  it("plein, écrase la plus ancienne entrée", () => {
    const ring = filled(3, [1, 2, 3, 4, 5]);
    expect(ring.length).to.equal(3);
    expect(ring.toArray()).to.deep.equal([3, 4, 5]);
    expect(ring.last()).to.equal(5);
  });

  it("at(i) lit dans l'ordre FIFO, même après rotation, négatif depuis la fin", () => {
    const ring = filled(3, [1, 2, 3, 4]);
    expect([ring.at(0), ring.at(1), ring.at(2)]).to.deep.equal([2, 3, 4]);
    expect(ring.at(-1)).to.equal(4);
    expect(ring.at(-3)).to.equal(2);
    expect(ring.at(3)).to.equal(undefined);
    expect(ring.at(-4)).to.equal(undefined);
    expect(ring.at(0.5)).to.equal(undefined);
  });

  it("shift() retire la tête, puis l'anneau se remplit à nouveau sans perte", () => {
    const ring = filled(3, [1, 2, 3, 4]);
    expect(ring.shift()).to.equal(2);
    expect(ring.length).to.equal(2);
    ring.push(5);
    ring.push(6);
    expect(ring.toArray()).to.deep.equal([4, 5, 6]);
    expect(ring.shift()).to.equal(4);
    expect(ring.shift()).to.equal(5);
    expect(ring.shift()).to.equal(6);
    expect(ring.shift()).to.equal(undefined);
    expect(ring.length).to.equal(0);
    expect(ring.last()).to.equal(undefined);
  });

  it("clear() vide sans retenir le contenu", () => {
    const ring = filled(4, [1, 2, 3]);
    ring.clear();
    expect(ring.length).to.equal(0);
    expect(ring.at(0)).to.equal(undefined);
    ring.push(9);
    expect(ring.toArray()).to.deep.equal([9]);
  });
});
