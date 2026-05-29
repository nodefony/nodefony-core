/// <reference types="node" />
import { expect } from "chai";
import { httpConfigSchema } from "../../config/schema.js";
import {
  defineHttpConfig,
  httpConfigJsonSchema,
} from "../../config/defineHttpConfig.js";

// Config Zod de @nodefony/http : défauts, sous-défauts (piège Zod 4), strip des
// sections strictes, passthrough des sections loose, retrait des clés mortes,
// défauts dérivés du kernel par le builder, et métadonnées de champ.

describe("@nodefony/http — httpConfigSchema (défauts)", () => {
  const c = httpConfigSchema.parse({});

  it("expose les défauts de premier niveau", () => {
    expect(c.watch).to.equal(true);
    expect(c.headerServer).to.equal("nodefony");
    expect(c.trustProxy).to.equal(false);
  });

  it("upload : uploadDir vide (résolu par le builder) + limites busboy", () => {
    expect(c.upload.uploadDir).to.equal("");
    expect(c.upload.maxFileSize).to.equal(524_288_000);
    expect(c.upload.maxFiles).to.equal(1000);
    expect(c.upload.hashAlgorithm).to.equal(false);
  });

  it("serveurs : timeouts http + http2 maxConcurrentStreams", () => {
    expect(c.http.requestTimeout).to.equal(30_000);
    expect(c.http.headers).to.equal(null);
    expect(c.https.rejectUnauthorized).to.equal(false);
    expect(c.http2.maxConcurrentStreams).to.equal(100);
  });

  it("websocket : maxPayload 1 MiB (secure-by-default)", () => {
    expect(c.websocket.maxPayload).to.equal(1024 * 1024);
    expect(c.websocketSecure.maxPayload).to.equal(1024 * 1024);
  });

  it("session : handler files + hash_function sha1 (harmonisé)", () => {
    expect(c.session.handler).to.equal("files");
    expect(c.session.hash_function).to.equal("sha1");
    expect(c.session.start).to.equal(false);
  });
});

describe("@nodefony/http — sous-défauts (piège Zod 4 .default({}))", () => {
  const c = httpConfigSchema.parse({});

  it("securityHeaders.strictTransportSecurity ré-applique ses sous-défauts", () => {
    expect(c.securityHeaders.contentTypeOptions).to.equal("nosniff");
    expect(c.securityHeaders.frameOptions).to.equal("DENY");
    expect(c.securityHeaders.strictTransportSecurity).to.not.equal(null);
    expect(c.securityHeaders.strictTransportSecurity?.maxAge).to.equal(
      31_536_000,
    );
    expect(
      c.securityHeaders.strictTransportSecurity?.includeSubDomains,
    ).to.equal(true);
  });

  it("session.cookie + certificates.openssl ré-appliquent leurs sous-défauts", () => {
    expect(c.session.cookie.httpOnly).to.equal(true);
    expect(c.session.cookie.secure).to.equal(true);
    expect(c.session.cookie.signed).to.equal(false);
    expect(c.certificates.openssl.size).to.equal(2048);
    expect(c.certificates.dev.useMkcert).to.equal(true);
    expect(c.statics.web.path).to.equal("public");
  });

  it("HSTS désactivable via null", () => {
    const d = httpConfigSchema.parse({
      securityHeaders: { strictTransportSecurity: null },
    });
    expect(d.securityHeaders.strictTransportSecurity).to.equal(null);
  });
});

describe("@nodefony/http — clés mortes retirées", () => {
  const c = httpConfigSchema.parse({}) as Record<string, unknown>;

  it("plus de sockjs / requestClient au niveau racine", () => {
    expect(c.sockjs).to.equal(undefined);
    expect(c.requestClient).to.equal(undefined);
  });

  it("plus de session.memcached ni http2.enablePush", () => {
    const full = httpConfigSchema.parse({});
    expect((full.session as Record<string, unknown>).memcached).to.equal(
      undefined,
    );
    expect((full.http2 as Record<string, unknown>).enablePush).to.equal(
      undefined,
    );
  });
});

describe("@nodefony/http — strict (strip) vs loose (passthrough)", () => {
  it("section stricte : strippe les clés inconnues (typo attrapée)", () => {
    const c = httpConfigSchema.parse({
      session: { name: "app", typoUnknown: 42 },
    });
    expect(c.session.name).to.equal("app");
    expect((c.session as Record<string, unknown>).typoUnknown).to.equal(
      undefined,
    );
  });

  it("racine stricte : clé top-level inconnue strippée", () => {
    const c = httpConfigSchema.parse({ wat: true }) as Record<string, unknown>;
    expect(c.wat).to.equal(undefined);
  });

  it("section loose : conserve une option lib non listée (http → node)", () => {
    const c = httpConfigSchema.parse({ http: { insecureHTTPParser: true } });
    expect((c.http as Record<string, unknown>).insecureHTTPParser).to.equal(
      true,
    );
  });

  it("section loose : conserve une entrée statique additionnelle", () => {
    const c = httpConfigSchema.parse({
      statics: { assets: { path: "public/assets" } },
    });
    expect((c.statics as Record<string, unknown>).assets).to.deep.equal({
      path: "public/assets",
    });
  });
});

describe("@nodefony/http — validation (plante propre)", () => {
  it("rejette un timeout non numérique", () => {
    expect(() =>
      httpConfigSchema.parse({ http: { timeout: "soon" } }),
    ).to.throw();
  });

  it("rejette un nom de session vide", () => {
    expect(() => httpConfigSchema.parse({ session: { name: "" } })).to.throw();
  });

  it("rejette un gc_divisor nul (doit être positif)", () => {
    expect(() =>
      httpConfigSchema.parse({ session: { gc_divisor: 0 } }),
    ).to.throw();
  });

  it("rejette un hash_function hors enum", () => {
    expect(() =>
      httpConfigSchema.parse({ session: { hash_function: "sha512" } }),
    ).to.throw();
  });
});

describe("@nodefony/http — defineHttpConfig (défauts kernel)", () => {
  it("uploadDir + commonName dérivés du kernel fourni", () => {
    const c = defineHttpConfig(
      {},
      {
        tmpDir: { path: "/var/tmp/app" },
        domain: "example.com",
        projectName: "App",
      },
    );
    expect(c.upload.uploadDir).to.equal("/var/tmp/app");
    const cn = c.certificates.openssl.attrs.find(
      (a) => a.name === "commonName",
    );
    expect(cn?.value).to.equal("example.com");
  });

  it("sans kernel : fallback /tmp + nodefony.com", () => {
    const c = defineHttpConfig({});
    expect(c.upload.uploadDir).to.equal("/tmp");
    const cn = c.certificates.openssl.attrs.find(
      (a) => a.name === "commonName",
    );
    expect(cn?.value).to.equal("nodefony.com");
  });

  it("uploadDir explicite NON écrasé par le kernel", () => {
    const c = defineHttpConfig(
      { upload: { uploadDir: "/custom" } },
      { tmpDir: { path: "/var/tmp/app" } },
    );
    expect(c.upload.uploadDir).to.equal("/custom");
  });

  it("config NON gelée (les services mutent module.options)", () => {
    const c = defineHttpConfig({});
    expect(Object.isFrozen(c)).to.equal(false);
  });

  it("propage une option lib loose à travers le builder", () => {
    const c = defineHttpConfig({ http: { maxRequestsPerSocket: 50 } });
    expect((c.http as Record<string, unknown>).maxRequestsPerSocket).to.equal(
      50,
    );
  });
});

describe("@nodefony/http — statics.enabled (toggle reverse-proxy)", () => {
  it("activé par défaut", () => {
    expect(httpConfigSchema.parse({}).statics.enabled).to.equal(true);
  });

  it("désactivable (nginx/CDN sert les statiques)", () => {
    const c = httpConfigSchema.parse({ statics: { enabled: false } });
    expect(c.statics.enabled).to.equal(false);
    // web reste présent dans la config (le gate runtime server-static skippe
    // initStaticFiles ; enabled n'est PAS une racine statique).
    expect(c.statics.web.path).to.equal("public");
  });

  it("enabled coexiste avec une entrée additionnelle (loose)", () => {
    const c = httpConfigSchema.parse({
      statics: { enabled: false, assets: { path: "dist/assets" } },
    });
    expect(c.statics.enabled).to.equal(false);
    expect((c.statics as Record<string, unknown>).assets).to.deep.equal({
      path: "dist/assets",
    });
  });
});

describe("@nodefony/http — métadonnées de champ (JSON Schema)", () => {
  it("schema.shape porte les flags Nodefony", () => {
    expect(httpConfigSchema.shape.watch.meta()?.reserved).to.equal(true);
    expect(httpConfigSchema.shape.http3.meta()?.reserved).to.equal(true);
    expect(httpConfigSchema.shape.headerServer.meta()?.runtimeMutable).to.equal(
      true,
    );
  });

  it("httpConfigJsonSchema() recopie les flags pour Studio", () => {
    const json = httpConfigJsonSchema() as {
      properties: Record<string, { reserved?: boolean }>;
    };
    expect(json.properties.watch.reserved).to.equal(true);
  });
});
