/// <reference types="node" />
import { expect } from "chai";
import net from "node:net";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  bindWithFallback,
  buildBindPlan,
  resolvePortPolicy,
  DEFAULT_PORT_RETRY_ATTEMPTS,
  type Listenable,
} from "../../src/servers/portBinder.js";

/**
 * Banc du repli de port.
 *
 * Ce fichier ne simule RIEN du réseau : il ouvre de vrais sockets et occupe de
 * vrais ports. Un mock de `listen` prouverait seulement que le mock fait ce que
 * je crois — or tout le sujet est le comportement du noyau (`EADDRINUSE`).
 */

const HOST = "127.0.0.1";

/** Serveurs ouverts par un test — fermés inconditionnellement après. */
let opened: net.Server[] = [];

/** Occupe un port réel et le renvoie (port 0 = le noyau en choisit un libre). */
function occupy(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    opened.push(srv);
    srv.once("error", reject);
    srv.listen(port, HOST, () => {
      resolve((srv.address() as AddressInfo).port);
    });
  });
}

/** Un serveur HTTP neuf, prêt à binder (jamais écouté). */
function fresh(): http.Server {
  const srv = http.createServer();
  opened.push(srv);
  return srv;
}

afterEach(async () => {
  await Promise.all(
    opened.map(
      (s) =>
        new Promise<void>((r) => {
          if (!s.listening) return r();
          s.close(() => r());
        }),
    ),
  );
  opened = [];
});

describe("resolvePortPolicy — le défaut dépend de l'environnement", () => {
  it("développement → `auto` : un port pris est une nuisance, pas un contrat", () => {
    expect(resolvePortPolicy("development")).to.equal("auto");
  });

  it("production → `strict` : le port y est un CONTRAT (service, ingress, sonde)", () => {
    // Un bind silencieux ailleurs donnerait un pod « sain » que personne
    // n'atteint : la panne invisible. On veut que ça pète.
    expect(resolvePortPolicy("production")).to.equal("strict");
  });

  it("test → `strict` : un port occupé = un serveur resté debout, le banc doit s'arrêter", () => {
    // Sinon la suite viserait un autre port… et taperait le serveur du voisin.
    expect(resolvePortPolicy("test")).to.equal("strict");
  });

  it("environnement inconnu / absent → `strict` (fail-closed)", () => {
    expect(resolvePortPolicy(undefined)).to.equal("strict");
    expect(resolvePortPolicy("staging")).to.equal("strict");
  });

  it("la config EXPLICITE gagne toujours sur le défaut d'environnement", () => {
    expect(resolvePortPolicy("production", "auto")).to.equal("auto");
    expect(resolvePortPolicy("development", "strict")).to.equal("strict");
  });
});

describe("buildBindPlan — ce que chaque serveur a le droit de prendre", () => {
  it("réserve le port de l'AUTRE serveur (HTTP ne vole pas 5152 à HTTPS)", () => {
    const plan = buildBindPlan(
      "http",
      { http: { port: 5151 }, https: { port: 5152 } },
      "development",
    );
    expect(plan.desired).to.equal(5151);
    expect(plan.reserved).to.deep.equal([5152]);
    expect(plan.attempts).to.equal(DEFAULT_PORT_RETRY_ATTEMPTS);
  });

  it("symétrique côté HTTPS", () => {
    const plan = buildBindPlan(
      "https",
      { http: { port: 5151 }, https: { port: 5152 } },
      "development",
    );
    expect(plan.desired).to.equal(5152);
    expect(plan.reserved).to.deep.equal([5151]);
  });

  it("`strict` ⇒ 0 essai : le repli est désactivé, pas juste raccourci", () => {
    const plan = buildBindPlan(
      "http",
      { http: { port: 5151 }, https: { port: 5152 }, portPolicy: "strict" },
      "development",
    );
    expect(plan.attempts).to.equal(0);
  });

  it("production sans config explicite ⇒ 0 essai (défaut strict)", () => {
    const plan = buildBindPlan("http", { http: { port: 5151 } }, "production");
    expect(plan.attempts).to.equal(0);
  });

  it("l'autre serveur désactivé (`false`) n'a rien à réserver", () => {
    const plan = buildBindPlan(
      "http",
      { http: { port: 5151 }, https: false },
      "development",
    );
    expect(plan.reserved).to.deep.equal([]);
  });

  it("`portRetryAttempts` de l'app est respecté", () => {
    const plan = buildBindPlan(
      "http",
      { http: { port: 5151 }, portRetryAttempts: 3 },
      "development",
    );
    expect(plan.attempts).to.equal(3);
  });
});

describe("bindWithFallback — sur de VRAIS ports occupés", () => {
  it("port libre : on prend celui qu'on voulait, sans décalage", async () => {
    const port = await occupy(0); // réserve un port…
    await new Promise<void>((r) => opened[0].close(() => r()));
    opened = [];

    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: port,
      reserved: [],
      attempts: 5,
    });
    expect(res.address.port).to.equal(port);
    expect(res.shiftedFrom).to.be.null; // aucun décalage à annoncer
  });

  it("port OCCUPÉ : glisse au suivant et DIT d'où il vient", async () => {
    const taken = await occupy(0);

    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: taken,
      reserved: [],
      attempts: 10,
    });
    expect(res.address.port).to.not.equal(taken);
    expect(res.address.port).to.be.greaterThan(taken);
    // Fail-loud : le décalage est REMONTÉ (l'appelant loggue un WARNING).
    expect(res.shiftedFrom).to.equal(taken);
  });

  it("SAUTE un port réservé même s'il est libre (ne vole pas l'autre serveur)", async () => {
    const taken = await occupy(0);
    const reserved = taken + 1; // libre, mais promis à l'autre serveur

    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: taken,
      reserved: [reserved],
      attempts: 10,
    });
    expect(res.address.port).to.not.equal(reserved);
    expect(res.address.port).to.be.greaterThan(reserved);
  });

  it("enjambe PLUSIEURS ports occupés d'affilée", async () => {
    const p1 = await occupy(0);
    // Les deux suivants aussi (best-effort : si l'un est déjà pris, tant mieux).
    await occupy(p1 + 1).catch(() => undefined);
    await occupy(p1 + 2).catch(() => undefined);

    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: p1,
      reserved: [],
      attempts: 10,
    });
    expect(res.address.port).to.be.greaterThan(p1 + 2);
    expect(res.shiftedFrom).to.equal(p1);
  });

  it("`attempts: 0` (STRICT) : port pris ⇒ EADDRINUSE, jamais de glissement", async () => {
    const taken = await occupy(0);

    const srv = fresh();
    let code: string | undefined;
    try {
      await bindWithFallback(srv as unknown as Listenable, HOST, {
        desired: taken,
        reserved: [],
        attempts: 0,
      });
      expect.fail("strict aurait dû rejeter : le port est occupé");
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    expect(code).to.equal("EADDRINUSE");
    expect(srv.listening).to.equal(false); // et rien n'écoute
  });

  it("essais ÉPUISÉS : rejette (le repli n'est pas infini)", async () => {
    const base = await occupy(0);
    // Occupe la fenêtre entière que le binder va explorer : base, base+1, base+2.
    await occupy(base + 1).catch(() => undefined);
    await occupy(base + 2).catch(() => undefined);

    const srv = fresh();
    let code: string | undefined;
    try {
      await bindWithFallback(srv as unknown as Listenable, HOST, {
        desired: base,
        reserved: [],
        attempts: 2, // base, +1, +2 → tous pris
      });
      expect.fail("aurait dû rejeter après épuisement des essais");
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    expect(code).to.equal("EADDRINUSE");
  });

  it("port 0 : le noyau alloue — aucun repli n'a de sens, et aucun n'est tenté", async () => {
    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: 0,
      reserved: [],
      attempts: 0,
    });
    expect(res.address.port).to.be.greaterThan(0);
    expect(res.shiftedFrom).to.be.null;
  });

  it("une erreur qui N'EST PAS un conflit de port ne déclenche AUCUN repli", async () => {
    // EACCES (port privilégié) : glisser serait absurde — l'appelant doit voir
    // la vraie cause, pas se retrouver sur un port au hasard.
    const srv = fresh();
    let code: string | undefined;
    try {
      await bindWithFallback(srv as unknown as Listenable, HOST, {
        desired: 1, // < 1024 → EACCES (non-root)
        reserved: [],
        attempts: 10,
      });
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    // Root en CI pourrait réussir à binder 1 : on n'assert que le cas non-root.
    if (code !== undefined) {
      expect(code).to.not.equal("EADDRINUSE");
      expect(srv.listening).to.equal(false);
    }
  });

  it("n'accumule AUCUN écouteur, même après plusieurs replis", async () => {
    // Ligne de base : un `http.Server` naît avec des écouteurs INTERNES (Node en
    // pose un sur `listening`). L'invariant n'est donc pas « zéro » dans l'absolu,
    // c'est « rien de plus qu'un serveur neuf » — sinon chaque repli (et chaque
    // restart du superviseur) laisserait un écouteur derrière lui.
    const ref = http.createServer();
    const baseError = ref.listenerCount("error");
    const baseListening = ref.listenerCount("listening");

    const p1 = await occupy(0);
    await occupy(p1 + 1).catch(() => undefined);
    await occupy(p1 + 2).catch(() => undefined);

    const srv = fresh();
    const res = await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: p1,
      reserved: [],
      attempts: 10,
    });
    expect(res.shiftedFrom).to.equal(p1); // on a bien rebondi plusieurs fois

    // Un `error` oublié ferait taire les vraies pannes du serveur ensuite ; un
    // `listening` oublié fuirait à chaque relance.
    expect(srv.listenerCount("error")).to.equal(baseError);
    expect(srv.listenerCount("listening")).to.equal(baseListening);
  });

  it("après un rejet STRICT non plus, rien ne traîne", async () => {
    const ref = http.createServer();
    const baseError = ref.listenerCount("error");
    const baseListening = ref.listenerCount("listening");

    const taken = await occupy(0);
    const srv = fresh();
    await bindWithFallback(srv as unknown as Listenable, HOST, {
      desired: taken,
      reserved: [],
      attempts: 0,
    }).catch(() => undefined);

    expect(srv.listenerCount("error")).to.equal(baseError);
    expect(srv.listenerCount("listening")).to.equal(baseListening);
  });

  it("deux serveurs qui se disputent le même départ finissent sur des ports DISTINCTS", async () => {
    // Le cas réel : 5151 et 5152 pris par une autre app → http glisse, puis https
    // glisse à son tour et tombe sur le port que http vient de prendre → il
    // reglisse. Le bind atomique le résout tout seul, sans coordination.
    const a = await occupy(0);
    const b = await occupy(0);

    const s1 = fresh();
    const r1 = await bindWithFallback(s1 as unknown as Listenable, HOST, {
      desired: a,
      reserved: [b],
      attempts: 20,
    });
    const s2 = fresh();
    const r2 = await bindWithFallback(s2 as unknown as Listenable, HOST, {
      desired: b,
      reserved: [a],
      attempts: 20,
    });

    expect(r1.address.port).to.not.equal(r2.address.port);
    expect(s1.listening).to.equal(true);
    expect(s2.listening).to.equal(true);
  });
});
