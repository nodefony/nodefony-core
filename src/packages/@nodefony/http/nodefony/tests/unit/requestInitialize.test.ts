/// <reference types="node" />
/**
 * Contrat de RETOUR de `HttpRequest.initialize()` (#505, L2).
 *
 * `initialize()` rend `undefined` quand il n'y a rien à attendre — une méthode
 * sans corps (GET, HEAD, OPTIONS…) et aucun écouteur `onRequestEnd` —, et une
 * `Promise` sinon. Le pipeline n'attend que dans le second cas : un `await`
 * inconditionnel coûtait ~6 évènements asynchrones à chaque GET.
 *
 * Ce que ces cas fixent, c'est la FORME du retour (valeur ou promesse) ET les
 * effets qui doivent avoir eu lieu au retour : un `undefined` rendu avant que
 * `requestEnded` soit posé laisserait le pipeline continuer sur une requête
 * que rien n'a déclarée terminée.
 *
 * Montage minimal, comme `requestEndGuard.test.ts` :
 * `Object.create(HttpRequest.prototype)` + un vrai `Event` du core en guise de
 * contexte — `listenerCount`/`fireAsync` réels, zéro serveur.
 *
 * Débrancher : rendre `initialize()` de nouveau `async`, ou lui faire toujours
 * emprunter `parseRequest()` — les cas « undefined » rougissent.
 */
import { expect } from "vitest";
import { Event, isPromise } from "nodefony";
import HttpRequest from "../../src/context/http/Request.js";

type FakeContext = Event & {
  finished: boolean;
  requestEnded: boolean;
  httpKernel?: { onError: (error: Error, context: unknown) => unknown };
};

type Initializable = {
  method: string;
  request: { body: unknown };
  queryPost: Record<string, unknown>;
  context: FakeContext;
  parseRequest: () => Promise<unknown>;
  initialize(): Promise<unknown> | undefined;
};

function makeRequest(method: string): Initializable {
  const context = new Event() as FakeContext;
  context.finished = false;
  context.requestEnded = false;
  const req = Object.create(HttpRequest.prototype) as Initializable;
  req.method = method;
  req.request = { body: null };
  req.queryPost = { parsed: true };
  req.context = context;
  return req;
}

describe("HttpRequest.initialize — rien à attendre ⇒ `undefined`, synchrone", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    it(`${method} sans écouteur → undefined, requête DÉJÀ terminée au retour`, () => {
      const req = makeRequest(method);
      const result = req.initialize();
      expect(result).to.equal(undefined);
      expect(req.context.requestEnded, "requestEnded posé avant le retour").to
        .be.true;
      expect(req.request.body, "alias body posé").to.equal(req.queryPost);
    });
  }

  it("contexte déjà fini → undefined, et la requête n'est PAS marquée terminée", () => {
    const req = makeRequest("GET");
    req.context.finished = true;
    expect(req.initialize()).to.equal(undefined);
    expect(req.context.requestEnded).to.be.false;
  });
});

describe("HttpRequest.initialize — quelque chose à attendre ⇒ une Promise", () => {
  it("GET avec un écouteur `onRequestEnd` → Promise, et l'écouteur a reçu la requête", async () => {
    const req = makeRequest("GET");
    const seen: unknown[] = [];
    req.context.on("onRequestEnd", (request: unknown) => {
      seen.push(request);
    });
    const result = req.initialize();
    expect(isPromise(result), "un écouteur est à attendre").to.be.true;
    await result;
    expect(seen).to.deep.equal([req]);
    expect(req.context.requestEnded).to.be.true;
  });

  it("POST → Promise (le corps arrive du socket), la fin de requête suit la lecture", async () => {
    const req = makeRequest("POST");
    let parsed = false;
    // Lecture du corps simulée : sans parser (corps vide), la suite est la
    // même fin de requête que celle d'une méthode sans corps.
    req.parseRequest = () =>
      Promise.resolve(null).then((v) => {
        parsed = true;
        return v;
      });
    const result = req.initialize();
    expect(isPromise(result), "le corps doit être attendu").to.be.true;
    expect(parsed, "rien n'est lu de façon synchrone").to.be.false;
    await result;
    expect(parsed).to.be.true;
    expect(req.context.requestEnded).to.be.true;
  });

  it("l'émission de fin lève → la réponse d'`onError` est rendue (jamais une exception)", async () => {
    const req = makeRequest("GET");
    const boom = new Error("émission impossible");
    const handled: unknown[] = [];
    req.context.httpKernel = {
      onError: (error: Error) => {
        handled.push(error);
        return Promise.resolve("rendu par onError");
      },
    };
    req.context.listenerCount = () => {
      throw boom;
    };
    let result: Promise<unknown> | undefined;
    expect(() => (result = req.initialize())).to.not.throw();
    expect(await result).to.equal("rendu par onError");
    expect(handled).to.deep.equal([boom]);
  });
});
