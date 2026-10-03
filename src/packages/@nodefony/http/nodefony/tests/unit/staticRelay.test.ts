/// <reference types="node" />
/**
 * Unit — relais de préfixe du service statique (#526).
 *
 * `@nodefony/frontend` y déclare `/_vite/<famille>/` en développement : les
 * URLs d'assets que Vite fabrique sont relatives au DOCUMENT, donc demandées à
 * Nodefony, qui les renvoie vers Vite. Ce banc verrouille le contrat côté http :
 * coût nul sans relais, normalisation commune avec `addMount`, cible toujours
 * construite sur l'origine résolue — jamais sur un hôte venu du client.
 * Le branchement dans le pipeline (avant le routage) est éprouvé sur le serveur
 * réel : `tests/http/vite-relay.test.ts`.
 */
import { describe, it, expect } from "vitest";
import Statics from "../../service/servers/server-static";

/** Statics sans module ni kernel : seul l'état des relais est en jeu. */
function bareStatics(): Statics {
  const s = Object.create(Statics.prototype) as Statics;
  s.relays = null;
  s.log = (() => undefined) as unknown as Statics["log"];
  return s;
}

describe("Statics — relais de préfixe", () => {
  it("sans relais : `relays` reste null (le pipeline ne paie qu'une lecture)", () => {
    const s = bareStatics();
    expect(s.relays).to.equal(null);
    expect(s.relayTarget("/_vite/default/x.png", "localhost")).to.equal(
      undefined,
    );
  });

  it("relaie une URL couverte vers l'origine résolue, chemin et requête intacts", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => "https://127.0.0.1:5173");
    expect(
      s.relayTarget("/_vite/default/src/logo.png?import", "localhost"),
    ).to.equal("https://127.0.0.1:5173/_vite/default/src/logo.png?import");
  });

  it("transmet le nom d'hôte du client au résolveur", () => {
    const s = bareStatics();
    const seen: string[] = [];
    s.addRelay("/_vite/default/", (domain) => {
      seen.push(domain);
      return `https://${domain}:5173`;
    });
    expect(
      s.relayTarget("/_vite/default/a.css", "host.docker.internal"),
    ).to.equal("https://host.docker.internal:5173/_vite/default/a.css");
    expect(seen).to.deep.equal(["host.docker.internal"]);
  });

  it("URL hors préfixe → rien (la requête suit son chemin)", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => "https://127.0.0.1:5173");
    expect(s.relayTarget("/src/logo.png", "localhost")).to.equal(undefined);
    expect(s.relayTarget("/_vite/vue/x.png", "localhost")).to.equal(undefined);
    expect(s.relayTarget(undefined, "localhost")).to.equal(undefined);
  });

  it("résolveur sans origine (Vite pas prêt) → rien", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => undefined);
    expect(s.relayTarget("/_vite/default/x.png", "localhost")).to.equal(
      undefined,
    );
  });

  it("un chemin piégé reste sur l'origine résolue (pas d'open redirect)", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => "https://127.0.0.1:5173");
    const target = s.relayTarget("/_vite/default//evil.test/x", "localhost");
    expect(new URL(target ?? "").host).to.equal("127.0.0.1:5173");
  });

  it("même normalisation que addMount — deux écritures, une entrée", () => {
    const s = bareStatics();
    s.addRelay("_vite/default", () => "https://a:1");
    s.addRelay("/_vite//default/", () => "https://b:2");
    expect(s.relays?.map((r) => r.prefix)).to.deep.equal(["/_vite/default/"]);
    expect(s.relayTarget("/_vite/default/x", "h")).to.equal(
      "https://b:2/_vite/default/x",
    );
  });

  it("une famille par préfixe : deux relais coexistent", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => "https://127.0.0.1:5173");
    s.addRelay("/_vite/vue/", () => "https://127.0.0.1:5177");
    expect(s.relayTarget("/_vite/vue/App.vue", "h")).to.equal(
      "https://127.0.0.1:5177/_vite/vue/App.vue",
    );
  });

  it("retirer le dernier relais rend `relays` à null", () => {
    const s = bareStatics();
    s.addRelay("/_vite/default/", () => "https://127.0.0.1:5173");
    s.addRelay("/_vite/vue/", () => "https://127.0.0.1:5177");
    s.removeRelay("/_vite/default/");
    expect(s.relays?.length).to.equal(1);
    s.removeRelay("_vite/vue");
    expect(s.relays).to.equal(null);
    s.removeRelay("/_vite/vue/"); // idempotent
    expect(s.relays).to.equal(null);
  });
});
