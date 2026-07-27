/// <reference types="node" />
/**
 * `unbiasedIndices` — le refus d'échantillon, rendu OBSERVABLE.
 *
 * Un tirage aléatoire ne se relit pas : c'est pourquoi la source d'octets est
 * injectable. Sans elle, on ne pourrait qu'espérer que le rejet fonctionne ; ici
 * on lui donne exactement les octets qui doivent être rejetés, et on vérifie ce
 * qui sort.
 */
import { expect } from "chai";
import { unbiasedIndices } from "../../nodefony/src/totp/totpCrypto";

/** Source déterministe : rend les octets fournis, en boucle. */
function bytesFrom(sequence: number[]): (n: number) => Buffer {
  let cursor = 0;
  return (n: number) => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      out[i] = sequence[cursor % sequence.length]!;
      cursor++;
    }
    return out;
  };
}

describe("unbiasedIndices — refus d'échantillon (tirage uniforme)", () => {
  it("REJETTE les octets de la zone qui replierait, au lieu de les modulo", () => {
    // Alphabet de 30 → limite 240. L'octet 245 est dans la zone de repli : le
    // modulo direct en aurait fait un 5 (245 % 30), ce qui sur-représente les
    // seize premiers symboles. Il doit être ignoré, et le 7 pris à sa place.
    const source = bytesFrom([245, 7]);
    expect(unbiasedIndices(1, 30, source)).to.deep.equal([7]);
  });

  it("240 et au-delà sont TOUS rejetés pour un alphabet de 30", () => {
    // Aucun des octets ≥ 240 ne doit produire d'indice ; seul le 29 final passe.
    const rejected = [240, 250, 255, 241, 29];
    expect(unbiasedIndices(1, 30, bytesFrom(rejected))).to.deep.equal([29]);
  });

  it("rend exactement le nombre demandé, tous dans les bornes", () => {
    const idx = unbiasedIndices(64, 30);
    expect(idx).to.have.length(64);
    for (const i of idx) {
      expect(i).to.be.at.least(0);
      expect(i).to.be.below(30);
    }
  });

  it("boucle jusqu'à obtenir son compte quand les rejets s'enchaînent", () => {
    // Une source qui ne rend que des octets rejetables sur sa première passe :
    // la boucle doit redemander, pas rendre une liste incomplète.
    let call = 0;
    const source = (n: number): Buffer => {
      call++;
      return Buffer.alloc(n, call === 1 ? 255 : 3);
    };
    expect(unbiasedIndices(2, 30, source)).to.deep.equal([3, 3]);
    expect(call, "une seconde passe était nécessaire").to.be.above(1);
  });

  it("un alphabet qui divise 256 ne rejette rien (255 reste valide)", () => {
    // Avec 16, `256 % 16 = 0` → limite 256, aucun octet n'est hors zone.
    expect(unbiasedIndices(1, 16, bytesFrom([255]))).to.deep.equal([15]);
  });

  it("refuse une taille d'alphabet hors bornes", () => {
    expect(() => unbiasedIndices(1, 1)).to.throw(RangeError);
    expect(() => unbiasedIndices(1, 257)).to.throw(RangeError);
  });
});
