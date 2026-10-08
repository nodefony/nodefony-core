/// <reference types="node" />
import { expect } from "vitest";
import { acceptsEventStream } from "../../src/context/http/SseStream";

/**
 * Négociation JSON / flux d'une même route — la seule lecture de `Accept` qui
 * décide qu'une réponse part en `text/event-stream` (RFC 9110 §12.5.1).
 */
describe("acceptsEventStream — lecture de l'en-tête Accept", () => {
  it("accepte text/event-stream nommé, seul ou parmi d'autres", () => {
    expect(acceptsEventStream("text/event-stream")).to.equal(true);
    expect(acceptsEventStream("application/json, text/event-stream")).to.equal(
      true,
    );
    expect(acceptsEventStream("Text/Event-Stream; charset=utf-8")).to.equal(
      true,
    );
    expect(
      acceptsEventStream(["application/json", "text/event-stream;q=0.5"]),
    ).to.equal(true);
  });

  it("refuse l'absence, */* et un poids nul (RFC 9110 §12.4.2)", () => {
    expect(acceptsEventStream(undefined)).to.equal(false);
    expect(acceptsEventStream("*/*")).to.equal(false);
    expect(acceptsEventStream("text/*")).to.equal(false);
    expect(acceptsEventStream("text/event-stream;q=0")).to.equal(false);
    expect(acceptsEventStream("text/event-stream; q=0.0")).to.equal(false);
    expect(acceptsEventStream("application/json")).to.equal(false);
  });
});
