/*
 *   Fraîcheur du CLI à `create app` — la règle de comparaison, la désactivation,
 *   et l'interrogation du registre, TOUT sans réseau (`fetch` injecté).
 */

import assert from "node:assert";
import {
  newerPublishedRelease,
  freshnessCheckDisabled,
  fetchDistTags,
  startFreshnessCheck,
} from "../cli/cliFreshness";

/** Les `dist-tags` réels de `nodefony` : `latest` est l'ANCIEN framework. */
const REAL_TAGS = {
  "beta.0": "4.0.0-beta.0",
  latest: "7.0.2",
  alpha: "10.0.0-alpha.9",
  beta: "10.0.0-beta.3",
};

/** Un `fetch` factice qui rend `body` (ou échoue selon `mode`). */
const fakeFetch =
  (body: unknown, mode: "ok" | "404" | "throw" | "hang" = "ok"): typeof fetch =>
  (_input, init) => {
    if (mode === "throw") return Promise.reject(new Error("ENOTFOUND"));
    if (mode === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: mode === "404" ? 404 : 200,
      }),
    );
  };

describe("newerPublishedRelease — la version du même canal", () => {
  it("une bêta plus récente sous `beta`, jamais `latest` qui pointe la 7", () => {
    assert.deepStrictEqual(newerPublishedRelease("10.0.0-beta.2", REAL_TAGS), {
      version: "10.0.0-beta.3",
      tag: "beta",
    });
  });

  it("rien quand le CLI est déjà à la dernière du canal", () => {
    assert.strictEqual(newerPublishedRelease("10.0.0-beta.3", REAL_TAGS), null);
  });

  it("une alpha est poussée vers la bêta de la même majeure", () => {
    assert.deepStrictEqual(newerPublishedRelease("10.0.0-alpha.9", REAL_TAGS), {
      version: "10.0.0-beta.3",
      tag: "beta",
    });
  });

  it("une préversion est poussée vers la stable qui la remplace", () => {
    assert.deepStrictEqual(
      newerPublishedRelease("10.0.0-beta.3", { latest: "10.0.0" }),
      { version: "10.0.0", tag: "latest" },
    );
  });

  it("une stable n'est jamais poussée vers une préversion", () => {
    assert.strictEqual(
      newerPublishedRelease("10.0.0", {
        latest: "10.0.0",
        next: "11.0.0-alpha.1",
      }),
      null,
    );
  });

  it("une préversion n'est pas poussée vers la préversion d'une autre majeure", () => {
    assert.strictEqual(
      newerPublishedRelease("10.0.0-beta.3", { next: "11.0.0-alpha.1" }),
      null,
    );
  });

  it("une stable plus récente est retenue", () => {
    assert.deepStrictEqual(
      newerPublishedRelease("10.0.0", { latest: "10.1.0" }),
      { version: "10.1.0", tag: "latest" },
    );
  });

  it("une version illisible ou un tag non textuel ne lèvent pas", () => {
    assert.strictEqual(
      newerPublishedRelease("pas-une-version", REAL_TAGS),
      null,
    );
    assert.strictEqual(newerPublishedRelease("10.0.0", { latest: 12 }), null);
  });
});

describe("freshnessCheckDisabled — se tait en CI et sur demande", () => {
  it("active par défaut", () => {
    assert.strictEqual(freshnessCheckDisabled({}), false);
  });

  it("coupée en intégration continue", () => {
    assert.strictEqual(freshnessCheckDisabled({ CI: "true" }), true);
  });

  it("coupée par NF_NO_UPDATE_CHECK, sauf « 0 » ou vide", () => {
    assert.strictEqual(
      freshnessCheckDisabled({ NF_NO_UPDATE_CHECK: "1" }),
      true,
    );
    assert.strictEqual(
      freshnessCheckDisabled({ NF_NO_UPDATE_CHECK: "0" }),
      false,
    );
    assert.strictEqual(
      freshnessCheckDisabled({ NF_NO_UPDATE_CHECK: "" }),
      false,
    );
  });
});

describe("fetchDistTags — ne lève jamais", () => {
  it("rend les dist-tags du document abrégé", async () => {
    const tags = await fetchDistTags("nodefony", {
      fetchImpl: fakeFetch({ "dist-tags": REAL_TAGS, versions: {} }),
    });
    assert.deepStrictEqual(tags, REAL_TAGS);
  });

  it("rend null sur une réponse en erreur, une panne ou un document inattendu", async () => {
    for (const fetchImpl of [
      fakeFetch({}, "404"),
      fakeFetch({}, "throw"),
      fakeFetch(["pas", "un", "objet"]),
      fakeFetch({ "dist-tags": "texte" }),
    ]) {
      assert.strictEqual(await fetchDistTags("nodefony", { fetchImpl }), null);
    }
  });

  it("borne le registre lent : rend null passé le délai", async () => {
    const t0 = performance.now();
    const tags = await fetchDistTags("nodefony", {
      fetchImpl: fakeFetch({}, "hang"),
      timeoutMs: 50,
    });
    assert.strictEqual(tags, null);
    assert.ok(performance.now() - t0 < 2000, "le délai doit couper la requête");
  });

  it("interroge le registre configuré, nom scopé encodé", async () => {
    let seen = "";
    await fetchDistTags("@nodefony/http", {
      registry: "https://npm.example.org/",
      fetchImpl: (input) => {
        seen =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return Promise.resolve(new Response("{}"));
      },
    });
    assert.strictEqual(seen, "https://npm.example.org/@nodefony%2Fhttp");
  });
});

describe("startFreshnessCheck — l'annonce et son geste", () => {
  it("annonce la version plus récente avec le TAG qui la sert", async () => {
    const notice = await startFreshnessCheck(
      "10.0.0-beta.2",
      {},
      fakeFetch({ "dist-tags": REAL_TAGS }),
    );
    assert.ok(notice !== null);
    assert.match(notice, /10\.0\.0-beta\.3 est publiée/);
    assert.match(notice, /npm i -g nodefony@beta/);
    assert.doesNotMatch(notice, /@latest/);
  });

  it("n'interroge rien quand elle est coupée", async () => {
    let called = false;
    const notice = await startFreshnessCheck(
      "10.0.0-beta.2",
      { CI: "1" },
      () => {
        called = true;
        return Promise.resolve(new Response("{}"));
      },
    );
    assert.strictEqual(notice, null);
    assert.strictEqual(called, false);
  });

  it("se tait hors ligne", async () => {
    assert.strictEqual(
      await startFreshnessCheck("10.0.0-beta.2", {}, fakeFetch({}, "throw")),
      null,
    );
  });
});
