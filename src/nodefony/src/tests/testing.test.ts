import { describe, it } from "vitest";
import { assert } from "vitest";
import { Inject, injectable } from "../kernel/decorators/kernelDecorator";
import Service from "../Service";
import Container from "../Container";
import type Module from "../kernel/Module";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  createTestModule,
  csrfHeaders,
  E2E_USER_IDENTIFIER,
  E2E_USER_PASSWORD,
  navigate,
  userLogin,
} from "../testing/index";
import { AUTH_LOGIN_PATH, AUTH_ME_PATH } from "../runtime/authRoutes";

/**
 * La porte de test publiée (`nodefony/testing`).
 *
 * Ce qui est éprouvé ici n'est pas « la fonction rend un objet », mais la seule
 * chose qui justifie de publier ce sous-chemin : **un service se construit
 * dessus et sa logique s'éprouve, sans démarrer quoi que ce soit**. Sans cette
 * porte, un développeur écrit un test de bout en bout — il lance le serveur et
 * tape en HTTP — pour vérifier un calcul.
 */

/** Un service comme en écrirait un utilisateur (ce que `create service` rend). */
@injectable()
class TaxService extends Service {
  constructor(module: Module) {
    super("tax", module.container as Container, module.notificationsCenter);
  }
  rate(): number {
    return 0.2;
  }
  on100(): number {
    return 100 * this.rate();
  }
}

/** Un second service qui dépend du premier — le cas de la tâche mesurée. */
@injectable()
class InvoiceService extends Service {
  constructor(
    module: Module,
    // La forme que `create service --inject` écrit : le décorateur nomme la
    // CLASSE, le conteneur la réconcilie avec la clé d'instance.
    @Inject("TaxService") private readonly tax: TaxService,
  ) {
    super("invoice", module.container as Container, module.notificationsCenter);
  }
  total(ht: number): number {
    return ht + ht * this.tax.rate();
  }
}

/**
 * Le conteneur d'un module de test, sans cast.
 *
 * `Module.container` est déclaré nullable — un module peut exister avant que le
 * conteneur soit posé. Ici il ne l'est jamais ; on le CONSTATE plutôt que de
 * l'affirmer par un `!`, et un jour où ce ne serait plus vrai, le test le dira.
 */
const containerOf = (m: Module): Container => {
  const c = m.container;
  if (!c) throw new Error("module de test sans conteneur");
  return c;
};

describe("nodefony/testing — éprouver un service SEUL", () => {
  it("un service se construit et sa logique répond, sans kernel ni port", () => {
    const service = new TaxService(createTestModule());
    assert.equal(service.rate(), 0.2);
    assert.equal(service.on100(), 20);
  });

  it("une dépendance s'INJECTE à la main — c'est le propre d'un test unitaire", () => {
    // Le cas mesuré au banc : « une responsabilité s'appuie sur l'autre ».
    // On ne passe PAS par le conteneur — on donne la dépendance soi-même,
    // exactement ce que l'injection par constructeur permet. C'est aussi ce
    // qui autorise à y glisser un double pour éprouver un cas limite.
    const app = createTestModule();
    const invoice = new InvoiceService(app, new TaxService(app));
    assert.equal(invoice.total(200), 240);
  });

  it("un service posé par `addService` entre au conteneur", async () => {
    // L'autre voie, quand c'est le MONTAGE qu'on éprouve et non un calcul.
    // `addService` sait se passer de kernel (`Module.ts:389` : « pas de kernel
    // (test isolé) → init direct non gardé »).
    const app = createTestModule();
    const tax = (await app.addService(TaxService)) as TaxService;
    assert.strictEqual(containerOf(app).get("tax"), tax);
  });

  it("un service construit au `new` n'entre PAS au conteneur", () => {
    // À dire explicitement : c'est la confusion qui coûte une heure. Le `new`
    // éprouve une logique ; `addService` monte un service.
    const app = createTestModule();
    const tax = new TaxService(app);
    assert.equal(tax.rate(), 0.2);
    assert.isNotOk(containerOf(app).get("tax"));
  });

  it("deux modules de test sont ISOLÉS l'un de l'autre", async () => {
    // Sans quoi un test polluerait le suivant : c'est la première chose qu'on
    // attend d'un décor jetable, et rien d'autre ne le vérifie.
    const a = createTestModule();
    const b = createTestModule();
    await a.addService(TaxService);
    assert.isOk(containerOf(a).get("tax"));
    assert.isNotOk(containerOf(b).get("tax"));
  });

  it("accepte un conteneur préparé — pour y poser un service simulé", () => {
    const container = new Container();
    container.set("clock", { now: () => 42 });
    const app = createTestModule({ container });
    assert.strictEqual(containerOf(app), container);
    assert.equal(
      (containerOf(app).get("clock") as { now: () => number }).now(),
      42,
    );
  });
});

/**
 * Un serveur qui renvoie, en JSON, les en-têtes qu'il a REÇUS — et répond `302`
 * sur `/page`, comme une zone à `entryPoint` devant un anonyme.
 */
async function echoServer(): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    // Ce que le serveur a REÇU, renvoyé en en-têtes : lisible même sans corps.
    res.setHeader("x-echo-mode", String(req.headers["sec-fetch-mode"]));
    res.setHeader("x-echo-accept", String(req.headers.accept));
    res.setHeader("x-echo-cookie", String(req.headers.cookie));
    if (req.url === "/page") {
      res.writeHead(302, { location: "/login?from=%2Fpage" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.headers));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("nodefony/testing — navigate(), une navigation que fetch() ne sait pas jouer", () => {
  it("le PRÉMISSE : fetch() réécrit Sec-Fetch-Mode en « cors » sur le fil", async () => {
    // Si Node cesse un jour de le faire, ce test le dira — et navigate()
    // deviendra une commodité plutôt qu'une nécessité.
    const echo = await echoServer();
    try {
      const res = await fetch(`${echo.base}/echo`, {
        headers: { "sec-fetch-mode": "navigate" },
      });
      const received = (await res.json()) as Record<string, string>;
      assert.strictEqual(received["sec-fetch-mode"], "cors");
    } finally {
      await echo.close();
    }
  });

  it("envoie Accept: text/html et Sec-Fetch-Mode: navigate tels quels", async () => {
    const echo = await echoServer();
    try {
      const res = await navigate(`${echo.base}/echo`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["x-echo-mode"], "navigate");
      assert.strictEqual(res.headers["x-echo-accept"], "text/html");
    } finally {
      await echo.close();
    }
  });

  it("les en-têtes passés s'AJOUTENT aux défauts (cookie d'une session)", async () => {
    const echo = await echoServer();
    try {
      const res = await navigate(`${echo.base}/echo`, { cookie: "sid=abc" });
      assert.strictEqual(res.headers["x-echo-cookie"], "sid=abc");
      assert.strictEqual(res.headers["x-echo-mode"], "navigate");
    } finally {
      await echo.close();
    }
  });

  it("rend le 302 et sa Location SANS suivre la redirection", async () => {
    const echo = await echoServer();
    try {
      const res = await navigate(`${echo.base}/page`);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.location, "/login?from=%2Fpage");
    } finally {
      await echo.close();
    }
  });
});

/**
 * Un faux serveur d'identité : `login` rend une session pour le seul compte
 * attendu, `me` sème le jeton anti-CSRF et REPOSE la session (comme une
 * session prolongée) — le cas où deux valeurs d'un même cookie se
 * contrediraient si le client les juxtaposait.
 */
async function identityServer(opts: { csrf: boolean; meStatus?: number }) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (req.url === AUTH_LOGIN_PATH && req.method === "POST") {
        const { username, password } = JSON.parse(body) as Record<
          string,
          string
        >;
        const ok =
          username === E2E_USER_IDENTIFIER && password === E2E_USER_PASSWORD;
        res.writeHead(ok ? 200 : 401, {
          "set-cookie": ok ? ["sid=initial; Path=/; HttpOnly"] : [],
        });
        res.end();
        return;
      }
      if (req.url === AUTH_ME_PATH) {
        res.setHeader("x-echo-cookie", String(req.headers.cookie));
        const cookies = ["sid=prolonge; Path=/; HttpOnly"];
        if (opts.csrf) cookies.push("csrf-token=abc.sig%3D; Path=/");
        res.writeHead(opts.meStatus ?? 200, { "set-cookie": cookies });
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("nodefony/testing — userLogin() et csrfHeaders(), l'identité d'une suite e2e", () => {
  it("userLogin ouvre la session du compte SANS privilège du décor", async () => {
    const srv = await identityServer({ csrf: true });
    try {
      assert.strictEqual(await userLogin(srv.base), "sid=initial");
    } finally {
      await srv.close();
    }
  });

  it("userLogin refusé → lève en NOMMANT le compte (le décor, pas la garde)", async () => {
    const srv = await identityServer({ csrf: true });
    try {
      await userLogin(srv.base, "mauvais-mot-de-passe").then(
        () => assert.fail("aurait dû lever"),
        (e: unknown) => assert.match(String(e), /e2e-member.*401.*décor/u),
      );
    } finally {
      await srv.close();
    }
  });

  it("csrfHeaders rend le jeton en en-tête ET en cookie, la session reposée remplace l'ancienne", async () => {
    const srv = await identityServer({ csrf: true });
    try {
      const headers = await csrfHeaders(srv.base, "sid=initial");
      assert.strictEqual(headers["x-csrf-token"], "abc.sig=");
      assert.strictEqual(headers.cookie, "sid=prolonge; csrf-token=abc.sig%3D");
    } finally {
      await srv.close();
    }
  });

  it("csrfHeaders présente la session à `me` (le jeton sert CETTE identité)", async () => {
    const srv = await identityServer({ csrf: true });
    try {
      const res = await fetch(`${srv.base}${AUTH_ME_PATH}`, {
        headers: await csrfHeaders(srv.base, "sid=initial"),
      });
      assert.strictEqual(
        res.headers.get("x-echo-cookie"),
        "sid=prolonge; csrf-token=abc.sig%3D",
      );
    } finally {
      await srv.close();
    }
  });

  it("défense désactivée (aucun cookie csrf-token) → pas d'en-tête x-csrf-token", async () => {
    const srv = await identityServer({ csrf: false });
    try {
      const headers = await csrfHeaders(srv.base, "");
      assert.strictEqual(headers["x-csrf-token"], undefined);
      assert.strictEqual(headers.cookie, "sid=prolonge");
    } finally {
      await srv.close();
    }
  });

  it("`me` absent (pas de @nodefony/security) → lève au lieu de rendre une identité sans jeton", async () => {
    const srv = await identityServer({ csrf: true, meStatus: 404 });
    try {
      await csrfHeaders(srv.base, "sid=initial").then(
        () => assert.fail("aurait dû lever"),
        (e: unknown) => assert.match(String(e), /404.*@nodefony\/security/u),
      );
    } finally {
      await srv.close();
    }
  });
});
