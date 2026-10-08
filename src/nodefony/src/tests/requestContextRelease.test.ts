import { expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Container, RequestContext } from "../index";
import type { RequestContextPayload } from "../index";

/**
 * #571 — `RequestContext.release()` vide le magasin d'une unité de travail
 * finie. La liste des clés vidées est ÉCRITE (coût nul sur le chemin chaud),
 * donc elle peut dériver du type : ce banc lit les clés DÉCLARÉES dans
 * `RequestContextPayload` et exige que chacune, hors corrélation et scope,
 * soit vidée. Ajouter une clé au type sans l'ajouter à `release()` le fait
 * tomber.
 */

/** Clés que le vidage GARDE : la corrélation des journaux, et le scope refermé. */
const KEPT = new Set(["requestId", "scheme", "traceparent", "scope"]);

/** Clés déclarées dans l'interface, lues dans la source — jamais recopiées. */
function declaredKeys(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../runtime/RequestContext.ts", import.meta.url)),
    "utf8",
  );
  const start = source.indexOf("export interface RequestContextPayload {");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] ?? "");
}

describe("RequestContext.release() — le magasin d'une unité de travail finie (#571)", () => {
  it("lit au moins les clés d'identité dans le type (le banc lit ce qu'il croit lire)", () => {
    const keys = declaredKeys();
    expect(keys).to.include.members(["requestId", "user", "userId", "scope"]);
  });

  it("vide chaque clé déclarée hors corrélation et scope, plus le jeton du pare-feu", () => {
    const toClear = [
      ...declaredKeys().filter((k) => !KEPT.has(k)),
      // Posé par le pare-feu par la signature d'index ouverte, pas déclaré.
      "token",
    ];
    const store: RequestContextPayload = { requestId: "rid" };
    for (const key of toClear) store[key] = { value: key };
    RequestContext.release(store);
    for (const key of toClear) {
      expect(store[key], `clé « ${key} » non vidée`).to.equal(undefined);
    }
  });

  it("garde requestId, scheme, traceparent et scope", () => {
    const root = new Container();
    root.addScope("request");
    const scope = root.enterScope("request");
    const store: RequestContextPayload = {
      requestId: "rid",
      scheme: "https",
      traceparent: "00-a-b-01",
      scope,
      user: { id: "u" },
    };
    RequestContext.release(store);
    expect(store.requestId).to.equal("rid");
    expect(store.scheme).to.equal("https");
    expect(store.traceparent).to.equal("00-a-b-01");
    expect(store.scope).to.equal(scope);
  });

  it("n'ajoute aucune clé absente : la forme de l'objet ne change pas", () => {
    const store: RequestContextPayload = {
      requestId: "rid",
      user: { id: "u" },
    };
    RequestContext.release(store);
    expect(Object.keys(store)).to.deep.equal(["requestId", "user"]);
  });

  it("une minuterie armée dans la bulle relit un magasin vidé après release()", async () => {
    const store: RequestContextPayload = { requestId: "rid" };
    const later = RequestContext.run(store, () => {
      RequestContext.set("user", { id: "u" });
      RequestContext.set("token", { secret: 1 });
      return new Promise<unknown[]>((done) =>
        setTimeout(
          () =>
            done([
              RequestContext.getUser(),
              RequestContext.get()?.token,
              RequestContext.getRequestId(),
            ]),
          5,
        ),
      );
    });
    RequestContext.release(store);
    expect(await later).to.deep.equal([undefined, undefined, "rid"]);
  });
});
