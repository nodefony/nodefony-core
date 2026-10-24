/**
 * Destinations de journaux distantes — la MÊME règle pour Loki et OpenSearch :
 * identifiants portés par l'URL ou déclarés, index déclaré ou historique, et ce
 * qui part réellement sur le réseau.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveEndpoint } from "../syslog/drivers/endpoint";
import { createLokiLogDriver } from "../syslog/drivers/LokiLogDriver";
import { createOpenSearchLogDriver } from "../syslog/drivers/OpenSearchLogDriver";
import {
  getLogDriverFactory,
  type ILogDriverContext,
} from "../syslog/drivers/logDriverRegistry";
import { registerBuiltinLogDrivers } from "../syslog/drivers/builtinLogDrivers";
import type { FetchLike } from "../syslog/httpFetch";
import { OpenSearchTransport } from "../syslog/transports/OpenSearchTransport";
import Pdu from "../syslog/Pdu";

const basic = (u: string, p: string): string =>
  `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

/** `fetch` qui note chaque appel et répond vide. */
function recorder(): {
  calls: Array<{ url: string; headers: Record<string, string> }>;
  fetchImpl: FetchLike;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ data: { result: [] }, hits: { hits: [] } }),
    };
  };
  return { calls, fetchImpl };
}

describe("resolveEndpoint", () => {
  it("retire les identifiants de l'URL et en fait un en-tête Basic", () => {
    const r = resolveEndpoint("https://inst%40id:t%3Aok@logs.example.com/");
    expect(r.base).toBe("https://logs.example.com");
    expect(r.auth).toEqual({ authorization: basic("inst@id", "t:ok") });
  });

  it("laisse une URL sans identifiants telle quelle, sans en-tête", () => {
    expect(resolveEndpoint("http://loki:3100/")).toEqual({
      base: "http://loki:3100",
      auth: {},
    });
  });

  it("donne la priorité aux identifiants déclarés sur ceux de l'URL", () => {
    const r = resolveEndpoint("https://a:b@os:9200", "admin", "s3cret");
    expect(r.base).toBe("https://os:9200");
    expect(r.auth).toEqual({ authorization: basic("admin", "s3cret") });
  });
});

describe("relecture — les deux pilotes joignent l'adresse SANS identifiants, authentifiés", () => {
  it("Loki", async () => {
    const { calls, fetchImpl } = recorder();
    await createLokiLogDriver({
      url: "https://123:jeton@loki.example.com",
      write: false,
      fetchImpl,
    }).query?.({});
    expect(calls[0]?.url.startsWith("https://loki.example.com/loki/")).toBe(
      true,
    );
    expect(calls[0]?.headers.authorization).toBe(basic("123", "jeton"));
  });

  it("OpenSearch", async () => {
    const { calls, fetchImpl } = recorder();
    await createOpenSearchLogDriver({
      url: "https://admin:s3cret@os.example.com",
      index: "shop-logs",
      fetchImpl,
    }).query?.({});
    expect(calls[0]?.url).toBe("https://os.example.com/shop-logs/_search");
    expect(calls[0]?.headers.authorization).toBe(basic("admin", "s3cret"));
  });
});

describe("fabrique OpenSearch — l'index, inchangé par défaut et déclarable", () => {
  async function readsFrom(index?: string): Promise<string | undefined> {
    registerBuiltinLogDrivers();
    const { calls, fetchImpl } = recorder();
    // La fabrique ne transmet pas de `fetch` : on observe le global.
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const ctx: ILogDriverContext = {
        logCfg: {
          opensearch: {
            url: "http://os:9200",
            ...(index === undefined ? {} : { index }),
          },
        },
        environment: "production",
        logDir: "/nowhere",
        pid: 1,
        appName: "@acme/shop",
        getRingStack: () => [],
      };
      await getLogDriverFactory("opensearch")?.(ctx)?.driver.query?.({});
      return calls[0]?.url;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("sans index déclaré, relit l'index historique — rien ne casse", async () => {
    expect(await readsFrom()).toBe("http://os:9200/nodefony-logs/_search");
  });

  it("un index déclaré sépare l'application des autres", async () => {
    expect(await readsFrom("shop-logs")).toBe(
      "http://os:9200/shop-logs/_search",
    );
  });
});

describe("transport OpenSearch — le modèle ne désigne le pipeline que s'il est posé", () => {
  async function templateAfter(pipelineStatus: number): Promise<unknown> {
    const bodies: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      if (init?.body !== undefined) bodies[url] = init.body;
      const ok = !url.includes("/_ingest/") || pipelineStatus < 300;
      return {
        ok,
        status: url.includes("/_ingest/") ? pipelineStatus : 200,
        text: async () => "",
        json: async () => ({ items: [] }),
      };
    };
    const transport = new OpenSearchTransport({
      url: "http://os:9200",
      fetchImpl,
    });
    await transport.send(new Pdu("x", "INFO", "T", "audit", ""));
    await transport.close();
    const raw = bodies["http://os:9200/_index_template/nodefony-logs"];
    return raw === undefined ? undefined : JSON.parse(raw);
  }

  it("pipeline posé → l'index le prend par défaut", async () => {
    expect(await templateAfter(200)).toMatchObject({
      template: {
        settings: { "index.default_pipeline": "nodefony-logs-audit" },
      },
    });
  });

  it("pipeline refusé → le modèle n'en désigne aucun : les documents passent", async () => {
    const tpl = (await templateAfter(403)) as {
      template: Record<string, unknown>;
    };
    expect(tpl.template.settings).toBeUndefined();
  });
});
