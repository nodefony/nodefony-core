/**
 * Unit — le formulaire « Créer » tait les MÊMES questions que le terminal.
 *
 * Le front ne peut pas importer le moteur (frontière isomorphe) : sa règle de
 * visibilité est une COPIE de `capAllows`. Deux copies divergent en silence —
 * vécu : Studio exigeait une capacité `true` quand le moteur ne tait qu'une
 * capacité `false`, et cachait sur une application sans ORM une question que
 * le terminal posait. Ce test les confronte sur toutes les combinaisons.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { capAllows, type TScaffoldCap } from "nodefony";
import { isQuestionVisible } from "../../../frontend/src/routes/create/createModel";

describe("Créer — visibilité d'une question : Studio = moteur", () => {
  const askIfs: Array<TScaffoldCap | undefined> = [
    undefined,
    "hasCheckout",
    "hasSqlOrm",
  ];
  const checkout = [true, false];
  const sqlOrm = [true, false, undefined];

  it("toutes les combinaisons capacité × askIf donnent le même verdict", () => {
    let compared = 0;
    for (const askIf of askIfs) {
      for (const hasCheckout of checkout) {
        for (const hasSqlOrm of sqlOrm) {
          const caps =
            hasSqlOrm === undefined
              ? { hasCheckout }
              : { hasCheckout, hasSqlOrm };
          const question = {
            key: "q",
            label: "q",
            type: "string" as const,
            default: "",
            ...(askIf ? { askIf } : {}),
          };
          expect(
            isQuestionVisible(question, caps),
            JSON.stringify({ askIf, caps }),
          ).to.equal(capAllows(question, caps));
          compared += 1;
        }
      }
    }
    expect(compared).to.equal(18);
  });

  it("application MongoDB : la clé primaire est tue des DEUX côtés", () => {
    const question = {
      key: "id",
      label: "Clé primaire",
      type: "choice" as const,
      default: "uuid7",
      askIf: "hasSqlOrm" as const,
    };
    const caps = { hasCheckout: false, hasSqlOrm: false };
    expect(isQuestionVisible(question, caps)).to.equal(false);
    expect(capAllows(question, caps)).to.equal(false);
  });
});
