/**
 * Les paramètres d'une action temps réel arrivent du réseau : chaque action de
 * Studio les valide contre son schéma, et une charge invalide est refusée en
 * `-32602` en nommant le champ fautif — jamais servie à moitié.
 */
import { describe, expect, it } from "vitest";
import { JsonRpcError, RpcError } from "nodefony";
import {
  parseActionParams,
  scaffoldCancelParamsSchema,
  scaffoldPreviewParamsSchema,
  scaffoldRunParamsSchema,
} from "../../src/actionParams";

/** Lance `fn` et rend l'erreur levée (échoue si rien n'est levé). */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("aucune erreur levée");
}

describe("parseActionParams", () => {
  it("rend la charge validée", () => {
    expect(
      parseActionParams(scaffoldRunParamsSchema, {
        type: "module",
        answers: { name: "blog", force: true, tags: ["a", "b"] },
        steps: ["install"],
      }),
    ).toEqual({
      type: "module",
      answers: { name: "blog", force: true, tags: ["a", "b"] },
      steps: ["install"],
    });
    expect(parseActionParams(scaffoldCancelParamsSchema, { id: "j1" })).toEqual(
      { id: "j1" },
    );
  });

  it("refuse une charge invalide en -32602, champ fautif nommé", () => {
    const e = thrown(() =>
      parseActionParams(scaffoldPreviewParamsSchema, {
        type: "module",
        answers: { n: 3 },
      }),
    );
    expect(e).toBeInstanceOf(RpcError);
    if (!(e instanceof RpcError)) return;
    expect(e.code).toBe(JsonRpcError.INVALID_PARAMS);
    expect(e.message).toContain("params.answers.n");
  });

  it("refuse une charge absente, scalaire ou à clé inconnue", () => {
    for (const params of [undefined, null, "module", { id: "j1", extra: 1 }]) {
      const e = thrown(() =>
        parseActionParams(scaffoldCancelParamsSchema, params),
      );
      expect(e).toBeInstanceOf(RpcError);
    }
  });

  it("refuse une liste de réponses qui mélange les types", () => {
    const e = thrown(() =>
      parseActionParams(scaffoldRunParamsSchema, {
        type: "app",
        answers: { tags: ["a", 2] },
      }),
    );
    expect(e).toBeInstanceOf(RpcError);
  });

  it("n'accepte pas un type vide", () => {
    expect(
      thrown(() => parseActionParams(scaffoldRunParamsSchema, { type: "" })),
    ).toBeInstanceOf(RpcError);
  });
});
