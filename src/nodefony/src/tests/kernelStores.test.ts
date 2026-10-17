import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import Kernel from "../kernel/Kernel";
import { KernelStores } from "../kernel/kernelStores";
import type { InfraEnvSource, IStoreResolution } from "../config/infra";

/**
 * Caractérisation de la famille STORE du noyau (#488) : l'infra déclarée
 * (mémoïsée, lue dans `process.env` au premier accès) et le registre des
 * résolutions de stores (ce que `KernelAdminApi` et le module framework
 * relisent). Les tests posent les variables eux-mêmes et les restituent.
 */

const INFRA_KEYS = [
  "NF_DATABASE_URL",
  "DATABASE_URL",
  "NF_REDIS_URL",
  "REDIS_URL",
  "NF_LOKI_URL",
  "NF_OPENSEARCH_URL",
  "NF_STORE",
] as const;

let saved: Map<string, string | undefined>;

beforeEach(() => {
  saved = new Map();
  for (const key of INFRA_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of INFRA_KEYS) {
    const value = saved.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function kernel(): Kernel {
  return new Kernel("development", null, {});
}

function resolution(
  brick: string,
  configured: string,
  extra: Partial<Omit<IStoreResolution, "provenance">> = {},
): Omit<IStoreResolution, "provenance"> {
  return {
    brick,
    nature: "durable",
    configured,
    resolved: configured === "auto" ? "memory" : configured,
    available: ["memory", "drizzle", "redis"],
    reason: `banc ${brick}`,
    ...extra,
  };
}

describe("Kernel — infra déclarée", () => {
  it("n'est pas résolue à la construction : une URL invalide n'empêche pas `new Kernel`, elle échoue au PREMIER accès", () => {
    process.env.NF_DATABASE_URL = "bogus://x";
    const k = kernel();
    assert.throws(() => k.infra, /non supporté/);
    // L'échec ne poisonne pas la mémo : variable corrigée, la lecture suivante aboutit.
    process.env.NF_DATABASE_URL = "postgres://u:p@h:5432/db";
    assert.equal(k.infra.database?.dialect, "postgres");
  });

  it("lit process.env au premier accès, puis mémoïse : une variable changée ensuite n'est plus vue", () => {
    process.env.NF_DATABASE_URL = "sqlite::memory:";
    process.env.NF_REDIS_URL = "redis://cache:6379";
    const k = kernel();
    const first = k.infra;
    assert.equal(first.database?.scheme, "sqlite");
    assert.equal(first.database?.family, "sql");
    assert.equal(first.database?.dialect, "sqlite");
    assert.equal(first.cache?.url, "redis://cache:6379");
    assert.equal(first.logs, null);
    assert.equal(first.forceStore, null);

    process.env.NF_DATABASE_URL = "mysql://h/db";
    delete process.env.NF_REDIS_URL;
    assert.equal(k.infra, first);
    assert.equal(k.infra.database?.scheme, "sqlite");
    assert.equal(k.infra.cache?.url, "redis://cache:6379");
  });

  it("chaque noyau porte SA mémo : un second noyau voit l'environnement du moment", () => {
    process.env.NF_DATABASE_URL = "sqlite::memory:";
    const a = kernel();
    assert.equal(a.infra.database?.dialect, "sqlite");
    process.env.NF_DATABASE_URL = "mysql://h/db";
    const b = kernel();
    assert.equal(b.infra.database?.dialect, "mysql");
    assert.equal(a.infra.database?.dialect, "sqlite");
    assert.notEqual(a.infra, b.infra);
  });

  it("sans aucune variable : trois volets null, aucun store forcé", () => {
    const infra = kernel().infra;
    assert.deepEqual(infra, {
      database: null,
      cache: null,
      logs: null,
      forceStore: null,
    });
  });
});

describe("Kernel — registre des résolutions de stores", () => {
  it("vide tant qu'aucune brique n'a résolu, et rend un tableau NEUF à chaque lecture", () => {
    const k = kernel();
    const a = k.storeResolutions;
    const b = k.storeResolutions;
    assert.equal(a.length, 0);
    assert.notEqual(a, b);
    a.push({ ...resolution("x", "memory"), provenance: "explicit" });
    assert.equal(k.storeResolutions.length, 0);
  });

  it("dérive la provenance de `configured` : 'auto' ⇒ 'infra', un backend nommé ⇒ 'explicit'", () => {
    const k = kernel();
    k.registerStoreResolution(resolution("sessions", "auto"));
    k.registerStoreResolution(resolution("tokens", "drizzle"));
    assert.deepEqual(k.storeResolutions, [
      { ...resolution("sessions", "auto"), provenance: "infra" },
      { ...resolution("tokens", "drizzle"), provenance: "explicit" },
    ]);
  });

  it("garde l'ordre d'enregistrement", () => {
    const k = kernel();
    for (const brick of ["c", "a", "b"]) {
      k.registerStoreResolution(resolution(brick, "memory"));
    }
    assert.deepEqual(
      k.storeResolutions.map((r) => r.brick),
      ["c", "a", "b"],
    );
  });

  it("une brique ré-enregistrée REMPLACE son entrée à la MÊME position — la dernière gagne, champ par champ", () => {
    const k = kernel();
    k.registerStoreResolution(
      resolution("idempotency", "auto", {
        configPath: "framework.idempotency.store",
      }),
    );
    k.registerStoreResolution(resolution("sessions", "auto"));
    // Le geste du module framework à `onKernelReady` : relire l'entrée, lui
    // ajouter l'emplacement, la reposer.
    const current = k.storeResolutions.find((r) => r.brick === "idempotency");
    assert.ok(current);
    assert.equal(current.location, undefined);
    k.registerStoreResolution({ ...current, location: "/var/idem.db" });
    assert.deepEqual(
      k.storeResolutions.map((r) => r.brick),
      ["idempotency", "sessions"],
    );
    assert.equal(k.storeResolutions[0]?.location, "/var/idem.db");
    assert.equal(
      k.storeResolutions[0]?.configPath,
      "framework.idempotency.store",
    );
    // Un champ absent de la nouvelle résolution est PERDU (remplacement, pas fusion).
    k.registerStoreResolution(resolution("idempotency", "auto"));
    assert.equal(k.storeResolutions[0]?.location, undefined);
    assert.equal(k.storeResolutions[0]?.configPath, undefined);
    assert.equal(k.storeResolutions.length, 2);
  });

  it("la provenance est toujours RECALCULÉE, jamais reprise d'une entrée relue", () => {
    const k = kernel();
    k.registerStoreResolution(resolution("cache", "auto"));
    const current = k.storeResolutions[0];
    assert.ok(current);
    assert.equal(current.provenance, "infra");
    k.registerStoreResolution({
      ...current,
      configured: "redis",
      resolved: "redis",
    });
    assert.equal(k.storeResolutions[0]?.provenance, "explicit");
  });

  it("copie défensive : l'objet passé n'est ni muté ni retenu", () => {
    const k = kernel();
    const input = resolution("audit", "auto");
    k.registerStoreResolution(input);
    assert.equal("provenance" in input, false);
    input.reason = "modifié après coup";
    assert.equal(k.storeResolutions[0]?.reason, "banc audit");
  });

  it("les champs optionnels (configPath, location, connector) passent tels quels", () => {
    const k = kernel();
    k.registerStoreResolution(
      resolution("passkeys", "drizzle", {
        configPath: "security.passkeyStore.store",
        location: "/var/app.db",
        connector: "main",
      }),
    );
    assert.deepEqual(k.storeResolutions[0], {
      ...resolution("passkeys", "drizzle"),
      provenance: "explicit",
      configPath: "security.passkeyStore.store",
      location: "/var/app.db",
      connector: "main",
    });
  });
});

describe("KernelStores — la classe extraite", () => {
  it("lit la source injectée — pas process.env — et la mémoïse", () => {
    const env: InfraEnvSource = {
      NF_DATABASE_URL: "postgres://u:p@h/db",
      NF_STORE: "memory",
    };
    process.env.NF_DATABASE_URL = "sqlite::memory:";
    const stores = new KernelStores(env);
    assert.equal(stores.infra.database?.dialect, "postgres");
    assert.equal(stores.infra.forceStore, "memory");
    env.NF_DATABASE_URL = "mysql://h/db";
    assert.equal(stores.infra.database?.dialect, "postgres");
  });

  it("sans source injectée, lit process.env AU PREMIER ACCÈS — jamais capturé à la construction", () => {
    const stores = new KernelStores();
    process.env.NF_DATABASE_URL = "mysql://h/db";
    assert.equal(stores.infra.database?.dialect, "mysql");
  });

  it("un premier accès qui lève ne mémoïse rien", () => {
    const env: InfraEnvSource = { NF_DATABASE_URL: "bogus://x" };
    const stores = new KernelStores(env);
    assert.throws(() => stores.infra, /non supporté/);
    env.NF_DATABASE_URL = "sqlite::memory:";
    assert.equal(stores.infra.database?.dialect, "sqlite");
  });

  it("porte exactement le registre que le Kernel délègue — ordre, remplacement, provenance dérivée, tableau neuf", () => {
    const stores = new KernelStores({});
    stores.registerStoreResolution(resolution("b", "auto"));
    stores.registerStoreResolution(resolution("a", "redis"));
    stores.registerStoreResolution({
      ...resolution("b", "drizzle"),
      location: "/var/b.db",
    });
    assert.deepEqual(stores.storeResolutions, [
      {
        ...resolution("b", "drizzle"),
        location: "/var/b.db",
        provenance: "explicit",
      },
      { ...resolution("a", "redis"), provenance: "explicit" },
    ]);
    assert.notEqual(stores.storeResolutions, stores.storeResolutions);
  });
});
