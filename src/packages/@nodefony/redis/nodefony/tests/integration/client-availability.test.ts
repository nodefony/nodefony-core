import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import type { SessionsService, ISerializedSession } from "@nodefony/http";
import RedisService from "../../service/redis";
import RedisSessionStorage from "../../src/SessionStorage";
import { defineRedisConfig } from "../../config/defineModuleConfig";
import type { IRedisConfigInput } from "../../interfaces/IRedisConfig";

/**
 * **Ce que `getClient()` promet quand l'infra ne répond pas.**
 *
 * Tous les consommateurs du service (stores de session, de jetons, de passkeys,
 * backplane realtime, idempotence) écrivent la même chose : `getClient(name) ??
 * null` puis « si null, je dégrade ». Leur TSDoc promettait donc un **no-op**
 * quand la connexion n'est pas (ou plus) ouverte.
 *
 * Cette promesse était fausse, et pour une raison qu'aucune lecture ne montre :
 * `createClient()` rend un objet AVANT `connect()` et la connexion reste
 * inscrite dans la map même quand son ouverture a échoué. Les consommateurs
 * recevaient donc un client **non nul et fermé** — et prenaient un
 * `ClientClosedError` à la première commande, exactement là où on leur avait
 * promis un repli.
 *
 * Ces tests exercent le chemin réel sur un **port mort** : aucune infra requise,
 * c'est justement l'absence de serveur qu'on veut. Le second volet vérifie que
 * le repli est **annoncé** (une ligne par transition, pas une par requête) — une
 * dégradation muette contredit le principe de résilience du framework.
 */

// La config applique l'environnement APRÈS le parse : une URL de cache posée
// dans le shell du développeur — ou par le gate d'infra — écraserait notre port
// mort et rendrait ces tests verts pour la mauvaise raison.
// `NF_REDIS_URL` est la forme PRIORITAIRE (resolveInfra la lit avant `REDIS_URL`) :
// l'omettre laissait la garde incomplète, donc inopérante dès que la forme
// préfixée est celle qui est posée.
delete process.env.NF_REDIS_URL;
delete process.env.REDIS_URL;
delete process.env.NF_REDIS_HOST;
delete process.env.NF_REDIS_PORT;
delete process.env.NF_REDIS_PASSWORD;

/** Port fermé : rien n'écoute, et surtout on ne veut rien y trouver. */
const DEAD_PORT = 6399;

/** Module minimal suffisant pour instancier le service (comme `connection.test.ts`). */
function fakeModule(redis: IRedisConfigInput): Module {
  const config = defineRedisConfig(redis);
  return {
    container: new Container(),
    kernel: null,
    options: config,
    config,
  } as unknown as Module;
}

/** Service pointant un port mort, avec abandon rapide (pas de retry infini). */
function deadService(): RedisService {
  return new RedisService(
    fakeModule({
      globalOptions: {
        socket: {
          host: "127.0.0.1",
          port: DEAD_PORT,
          connectTimeout: 300,
          reconnectStrategy: { baseMs: 10, maxMs: 10, maxRetries: 1 },
        },
      },
      connections: { main: { name: "main" } },
    }),
  );
}

/** Capture les lignes journalisées par le service (sévérité comprise). */
function captureLog(service: RedisService): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  service.log = ((pci: unknown, severity?: string) => {
    lines.push([String(pci), String(severity ?? "INFO")]);
    return true;
  }) as unknown as RedisService["log"];
  return lines;
}

describe("RedisService.getClient — connexion inscrite mais jamais ouverte", () => {
  it("rend null alors que la connexion EXISTE et porte un client", async () => {
    const service = deadService();
    await service.init(); // l'échec est journalisé, il ne jette pas

    // Le décor du bug : la connexion est bien inscrite, son client existe…
    const connection = service.getConnection("main");
    assert.ok(connection, "la connexion en échec reste inscrite dans la map");
    assert.ok(connection.client, "…et porte un client créé avant connect()");
    assert.equal(connection.client.isOpen, false, "…mais jamais ouvert");

    // …et c'est pourtant `null` que les consommateurs doivent recevoir.
    assert.equal(service.getClient("main"), null);
  });

  it("annonce la bascule UNE fois, pas une par appel", async () => {
    const service = deadService();
    await service.init();
    const lines = captureLog(service);

    for (let i = 0; i < 5; i += 1) service.getClient("main");

    const warnings = lines.filter(([, severity]) => severity === "WARNING");
    assert.equal(
      warnings.length,
      1,
      "une session écrit à chaque requête : journaliser à chaque appel " +
        "noierait le journal au lieu d'alerter",
    );
    assert.match(warnings[0][0], /indisponible/);
    assert.match(warnings[0][0], /main/);
  });

  it("annonce le rétablissement quand la connexion revient", async () => {
    const service = deadService();
    await service.init();
    const lines = captureLog(service);
    service.getClient("main"); // bascule en dégradé

    // On rouvre par le seul point qui compte pour le service : l'état du client.
    // (Un vrai retour d'infra passerait par la reconnexion de node-redis ; ce
    // qu'on vérifie ici, c'est la transition du service, pas celle du socket.)
    const connection = service.getConnection("main");
    (connection as unknown as { client: { isOpen: boolean } }).client = {
      isOpen: true,
    };

    assert.ok(service.getClient("main"), "le client redevient disponible");
    assert.ok(
      lines.some(
        ([message, severity]) =>
          severity === "INFO" && /rétablie/.test(message),
      ),
      "un retour à la normale se dit aussi — sinon le journal laisse " +
        "l'exploitant sur la dernière mauvaise nouvelle",
    );
  });

  it("connexion inconnue : null, sans inventer de connexion", () => {
    const service = deadService();
    assert.equal(service.getClient("fantome"), null);
  });
});

describe("RedisSessionStorage sur une connexion en échec — dégrade, ne jette pas", () => {
  /** Manager de session branché sur le VRAI service (pas un double). */
  function managerOn(service: RedisService): SessionsService {
    return {
      options: { idleTimeoutS: 120, absoluteTimeoutS: 0, store: "redis" },
      log: () => {},
      get: (name: string) => (name === "redis" ? service : null),
    } as unknown as SessionsService;
  }

  function body(user: string): ISerializedSession {
    return { user, Attributes: {}, metaBag: {}, flashBag: {} };
  }

  it("write rend la charge confiée au lieu de lever ClientClosedError", async () => {
    const service = deadService();
    await service.init();
    const storage = new RedisSessionStorage(managerOn(service));

    // Avant le correctif, cette ligne levait `ClientClosedError` : le store
    // recevait un client fermé et l'appelait. Une requête HTTP tombait parce que
    // Redis était absent — l'inverse exact du fail-soft annoncé.
    const out = await storage.write("s1", body("alice"));
    assert.equal(out.user, "alice");
  });

  it("read rend une session vide", async () => {
    const service = deadService();
    await service.init();
    const storage = new RedisSessionStorage(managerOn(service));
    assert.deepEqual(await storage.read("s1"), {});
  });

  it("destroy reste idempotent", async () => {
    const service = deadService();
    await service.init();
    const storage = new RedisSessionStorage(managerOn(service));
    assert.equal(await storage.destroy("s1"), true);
  });
});
