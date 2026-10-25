/**
 * Unit — onglet « Coup d'œil » de la page Configuration
 * (`frontend/src/routes/config/configEssentialsModel.ts`).
 *
 * Les verdicts de sécurité disent vrai, les durées se lisent, les adresses
 * d'écoute se composent du domaine et des ports allumés, et une variable posée
 * qui coupe un verrou est signalée là où on la regarde.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import {
  buildConfigSearchIndex,
  type ISearchableField,
  type ISearchableModule,
} from "../../../frontend/src/routes/config/configSearchEngine";
import {
  buildGlance,
  formatDurationS,
} from "../../../frontend/src/routes/config/configEssentialsModel";

function mod(
  name: string,
  config: Record<string, unknown>,
  fields: ISearchableField[],
  isApp = false,
): ISearchableModule {
  return {
    entry: { key: name, name, isApp, config, envKeys: {} },
    sections: [{ fields }],
  };
}

const f = (key: string, extra: Partial<ISearchableField> = {}) => ({
  key,
  ...extra,
});

function glance(
  security: Record<string, unknown>,
  opts: { production?: boolean; h2c?: boolean; hstsMaxAge?: number } = {},
) {
  const modules = [
    mod(
      "app",
      {
        domain: "exemple.fr",
        servers: {
          http: { port: 80 },
          https: { port: 443 },
          h2c: { port: 8080, enabled: opts.h2c ?? false },
        },
      },
      [
        f("domain"),
        f("servers.http.port"),
        f("servers.https.port"),
        f("servers.h2c.port"),
        f("servers.h2c.enabled"),
      ],
      true,
    ),
    mod(
      "@nodefony/http",
      {
        session: { cookie: { secure: true } },
        securityHeaders: {
          strictTransportSecurity: { maxAge: opts.hstsMaxAge ?? 31536000 },
        },
      },
      [
        f("session.cookie.secure"),
        f("securityHeaders.strictTransportSecurity.maxAge"),
      ],
    ),
    mod(
      "@nodefony/security",
      security,
      Object.keys(flatten(security)).map((k) =>
        f(k, {
          ...(k === "rateLimit.enabled" || k === "headers.hsts"
            ? { source: "env" as const }
            : {}),
          // Comme dans le vrai schéma : la clé existe, mais elle est RÉSERVÉE.
          ...(k === "headers.hsts" ? { reserved: true } : {}),
        }),
      ),
    ),
  ];
  return buildGlance(buildConfigSearchIndex(modules), {
    production: opts.production ?? false,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function flatten(o: Record<string, unknown>, p = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (isRecord(v)) {
      Object.assign(out, flatten(v, key));
    } else out[key] = v;
  }
  return out;
}

const SAFE = {
  csrf: { enabled: true },
  cors: { origins: ["https://app.exemple.fr"] },
  jwt: { accessTtlS: 900 },
  rateLimit: { enabled: true },
};

describe("coup d'œil — durées lisibles", () => {
  it("prend la plus grande unité qui tombe juste", () => {
    expect(formatDurationS(900)).to.equal("15 min");
    expect(formatDurationS(1800)).to.equal("30 min");
    expect(formatDurationS(43200)).to.equal("12 h");
    expect(formatDurationS(604800)).to.equal("7 j");
    expect(formatDurationS(90)).to.equal("90 s");
    expect(formatDurationS(0)).to.equal("0 (désactivé)");
  });
});

describe("coup d'œil — verdicts de sécurité", () => {
  it("une configuration saine : tout en place, rien à vérifier", () => {
    const g = glance(SAFE);
    expect(g.summary.warn).to.equal(0);
    expect(g.summary.ok).to.be.greaterThan(4);
  });

  it("CSRF coupé, CORS ouvert à tous, jeton long : trois points à vérifier", () => {
    const g = glance({
      ...SAFE,
      csrf: { enabled: false },
      cors: { origins: ["*"] },
      jwt: { accessTtlS: 86400 },
    });
    expect(g.summary.warn).to.equal(3);
    const jwt = g.security.find((i) => i.doc.field.key === "jwt.accessTtlS");
    expect(jwt?.display).to.deep.equal({ kind: "text", text: "1 j" });
  });

  it("HSTS absent : information en développement, alerte en production", () => {
    const dev = glance(SAFE, { hstsMaxAge: 0 });
    const prod = glance(SAFE, { hstsMaxAge: 0, production: true });
    const level = (g: typeof dev) =>
      g.security.find((i) => i.label === "HTTPS imposé (HSTS)")?.verdict?.level;
    expect(level(dev)).to.equal("info");
    expect(level(prod)).to.equal("warn");
  });

  it("une variable posée qui coupe un verrou porte le même verdict, en tête", () => {
    const g = glance({ ...SAFE, rateLimit: { enabled: false } });
    expect(g.env).to.have.length(1);
    expect(g.env[0]?.verdict?.level).to.equal("warn");
    expect(g.env[0]?.label).to.equal("Anti force brute");
    expect(g.env[0]?.doc.field.key).to.equal("rateLimit.enabled");
  });
});

describe("coup d'œil — adresses d'écoute", () => {
  it("compose domaine et ports, et ignore un serveur éteint", () => {
    expect(glance(SAFE).endpoints.map((e) => e.url)).to.deep.equal([
      "http://exemple.fr:80",
      "https://exemple.fr:443",
    ]);
    expect(glance(SAFE, { h2c: true }).endpoints.map((e) => e.url)).to.include(
      "http://exemple.fr:8080",
    );
  });
});

describe("coup d'œil — clé réservée", () => {
  it("n'est jamais jugée « en place », même posée à true par l'environnement", () => {
    const g = glance({ ...SAFE, headers: { hsts: true } });
    // absente de la colonne Sécurité…
    expect(g.security.some((i) => i.doc.field.key === "headers.hsts")).to.equal(
      false,
    );
    // …et signalée sans effet là où on la voit : parmi les variables posées.
    const posee = g.env.find((i) => i.doc.field.key === "headers.hsts");
    expect(posee?.verdict).to.deep.equal({
      level: "info",
      text: "Clé réservée : posée, elle n'a aucun effet aujourd'hui.",
    });
  });
});
