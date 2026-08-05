/// <reference types="node" />
/**
 * Garde zéro-listener de `fireRequestEnd` (Request) — lot C perf.
 *
 * `onRequestEnd` (l'ÉVÉNEMENT contexte, pas la méthode du kernel) est un hook
 * utilisateur : 0 listener dans le cas nominal. La garde évite l'appel async
 * (2 Promises/req) — mais elle ne doit JAMAIS éteindre un listener réel, et
 * son nom d'événement doit être EXACT (une typo rendrait le hook mort en
 * silence, sans qu'aucun autre test ne le voie).
 *
 * Montage minimal : `Object.create(HttpRequest.prototype)` + un vrai `Event`
 * du core en guise de contexte → `listenerCount`/`fireAsync` réels, zéro
 * serveur. On ne teste QUE la garde, pas le parsing.
 */
import { expect } from "chai";
import { Event } from "nodefony";
import HttpRequest from "../../src/context/http/Request.js";

type FireRequestEnd = {
  request: { body: unknown };
  queryPost: Record<string, unknown>;
  context: Event;
  fireRequestEnd(): Promise<unknown> | false;
};

function makeRequest(context: Event): FireRequestEnd {
  const req = Object.create(HttpRequest.prototype) as FireRequestEnd;
  req.request = { body: null };
  req.queryPost = { parsed: true };
  req.context = context;
  return req;
}

describe("Request.fireRequestEnd — garde zéro-listener (lot C)", () => {
  it("sans listener : retourne false (contrat emitAsync) et alias body quand même", () => {
    const context = new Event();
    const req = makeRequest(context);
    const result = req.fireRequestEnd();
    expect(result).to.equal(false);
    expect(req.request.body).to.equal(req.queryPost);
  });

  it("avec listener : le hook FIRE (le listener reçoit la request)", async () => {
    const context = new Event();
    const seen: unknown[] = [];
    context.on("onRequestEnd", (request: unknown) => {
      seen.push(request);
    });
    const req = makeRequest(context);
    const result = req.fireRequestEnd();
    expect(
      result,
      "la garde ne doit PAS court-circuiter un hook écouté",
    ).to.not.equal(false);
    await result;
    expect(seen).to.have.length(1);
    expect(seen[0]).to.equal(req);
    expect(req.request.body).to.equal(req.queryPost);
  });
});
