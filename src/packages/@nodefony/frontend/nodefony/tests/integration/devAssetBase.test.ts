/// <reference types="node" />
/**
 * Intégration — #526 sur un VRAI Vite : une image importée, une image
 * référencée en CSS et une image de gabarit Vue reçoivent une URL préfixée par
 * le chemin réservé de leur famille (`/_vite/<famille>/`), servie par Vite.
 *
 * Pourquoi ce banc existe : en dev, Vite fabrique ces URLs RELATIVES AU
 * DOCUMENT. La page étant servie par Nodefony, une URL racine (`/src/x.png`)
 * tombait en 404 — et rien ne le voyait avant qu'un développeur importe sa
 * première image. Le préfixe rend l'URL relayable par Nodefony (proxy inverse,
 * #528 — `@nodefony/http` `tests/unit/reverseProxy.test.ts`).
 *
 * Ce qu'il éprouve, par le superviseur réel et la config GÉNÉRÉE (pas une
 * config écrite à la main) :
 *  - module d'asset (`?import`) → `export default "/_vite/<famille>/…"` ;
 *  - CSS (`?direct`) → `url(/_vite/<famille>/…)` ;
 *  - gabarit Vue → chaîne préfixée dans le rendu compilé ;
 *  - l'URL émise répond 200 sur Vite, octets de l'image intacts.
 * Débrancher `devBase` (générateur ou superviseur) le fait tomber : les URLs
 * redeviennent racines.
 */
import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { ViteProcessSupervisor } from "../../service/ViteProcessSupervisor.js";
import { devBasePath } from "../../src/isolationGroups.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";
import type { FrontPresetType } from "../../interfaces/IFrontPreset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../fixtures/asset-frontend");
const PIXEL = fs.readFileSync(path.join(ROOT, "src/pixel.png"));

const silentLogger = { info: () => {}, error: () => {}, debug: () => {} };

async function freePort(): Promise<number> {
  const srv = net.createServer();
  return new Promise<number>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a ? a.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

/** GET brut — corps en Buffer, pour comparer les octets de l'image. */
function get(
  port: number,
  urlPath: string,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, timeout: 15_000 },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function entry(
  type: FrontPresetType,
  entryFile: string,
): IResolvedFrontendEntry {
  return {
    moduleName: "fixture-526",
    entryName: `fixture-526-${type}`,
    type,
    root: ROOT,
    entryFile,
    outDir: path.join(ROOT, "dist"),
    publicPath: "/_assets/fixture-526/",
    apiProxyPaths: [],
  };
}

const running: ViteProcessSupervisor[] = [];

async function startFamily(
  family: string,
  e: IResolvedFrontendEntry,
): Promise<{ port: number; base: string }> {
  const base = devBasePath(family);
  const sup = new ViteProcessSupervisor({
    devHost: "127.0.0.1",
    devPort: await freePort(),
    devBase: base,
    startupTimeoutMs: 30_000,
    pipeLogs: false,
    cwd: ROOT,
    logger: silentLogger,
    healthCheckIntervalMs: 0,
    autoRestart: false,
  });
  running.push(sup);
  await sup.start([e], {});
  const status = sup.status();
  expect(status.base, "le status annonce le chemin de base").to.equal(base);
  return { port: status.port ?? 0, base };
}

afterAll(async () => {
  await Promise.allSettled(running.map((s) => s.stop()));
});

describe("Vite réel — URLs d'assets sous le chemin de la famille (#526)", () => {
  it("image importée + url() CSS (famille default)", async () => {
    const { port, base } = await startFamily(
      "default",
      entry("vanilla", "src/main.ts"),
    );

    const asset = await get(port, `${base}src/pixel.png?import`);
    expect(asset.status).to.equal(200);
    const assetUrl = /export default "([^"]+)"/.exec(
      asset.body.toString(),
    )?.[1];
    // Le cœur du défaut : sans `base`, cette URL valait `/src/pixel.png`.
    expect(assetUrl).to.equal(`${base}src/pixel.png`);

    const css = await get(port, `${base}src/style.css?direct`);
    expect(css.status).to.equal(200);
    expect(css.body.toString()).to.match(
      new RegExp(`url\\("?${base}src/pixel\\.png"?\\)`),
    );

    // L'URL émise est servie par Vite, octets intacts.
    const file = await get(port, assetUrl ?? "");
    expect(file.status).to.equal(200);
    expect(file.body.equals(PIXEL)).to.equal(true);

    // Hors du chemin de base, Vite ne sert plus rien : TOUTE URL émise doit
    // donc porter le préfixe (balises de la page comprises).
    expect((await get(port, "/src/pixel.png?import")).status).to.not.equal(200);
  });

  it("gabarit + <style> d'un composant Vue (famille vue)", async () => {
    const { port, base } = await startFamily(
      "vue",
      entry("vue3", "src/vue-main.ts"),
    );

    const sfc = await get(port, `${base}src/App.vue`);
    expect(sfc.status).to.equal(200);
    // `<img src="./pixel.png">` : plugin-vue réécrit la source du gabarit
    // à partir de `base`.
    expect(sfc.body.toString()).to.include(`${base}src/pixel.png`);

    const style = await get(
      port,
      `${base}src/App.vue?vue&type=style&index=0&lang.css`,
    );
    expect(style.status).to.equal(200);
    expect(style.body.toString()).to.include(`${base}src/pixel.png`);
  });
});
