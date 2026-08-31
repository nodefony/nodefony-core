import { expect } from "chai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { pidListeningOn } from "../helpers/pidListening.js";
import { ViteProcessSupervisor } from "../../service/ViteProcessSupervisor.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures/minimal-frontend");

const silentLogger = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

function makeEntry(): IResolvedFrontendEntry {
  return {
    moduleName: "fixture",
    entryName: "fixture",
    type: "vanilla",
    root: FIXTURE_ROOT,
    entryFile: "src/main.ts",
    outDir: path.resolve(FIXTURE_ROOT, "dist"),
    publicPath: "/_assets/fixture/",
    apiProxyPaths: [],
  };
}

// Trouve un port libre — Vite en cherche un autre si occupé, mais on veut
// éviter les flakes en tests parallèles.
/**
 * Un port RÉELLEMENT libre, constaté et non tiré au sort.
 *
 * L'ancienne version rendait `6000 + random(1000)` : un port ESPÉRÉ libre. Sur
 * un poste chargé — une forge, surtout — le tirage tombe tôt ou tard sur un
 * port qu'un tiers occupe déjà, et le cas ne mesure plus ce qu'il croit : le
 * superviseur se décale dès la PREMIÈRE instance, et tout ce qui suit raisonne
 * sur une prémisse fausse. On laisse donc le noyau attribuer le port, ce qui
 * est le seul moyen de savoir qu'il est libre.
 */
async function freePort(): Promise<number> {
  const srv = net.createServer();
  return new Promise<number>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const adresse = srv.address();
      const port = typeof adresse === "object" && adresse ? adresse.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

async function httpPing(host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: host, port, path: "/", timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

describe("ViteProcessSupervisor — intégration (real spawn)", () => {
  it("start + stop golden path", async () => {
    const port = await freePort();
    const sup = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0, // disabled pour éviter pollution test
      autoRestart: false,
    });
    try {
      await sup.start([makeEntry()], {});
      const status = sup.status();
      expect(status.state).to.equal("ready");
      expect(status.pid).to.be.a("number");
      expect(status.port).to.be.a("number");
      // HTTP ping confirme que Vite répond.
      const code = await httpPing("127.0.0.1", status.port!);
      expect(code).to.be.greaterThan(0);
    } finally {
      await sup.stop();
    }
    expect(sup.status().state).to.equal("stopped");
    expect(sup.status().pid).to.equal(null);
  });

  it("idempotence start : 2e appel ne re-spawn pas", async () => {
    const port = await freePort();
    const sup = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: false,
    });
    try {
      await sup.start([makeEntry()], {});
      const pid1 = sup.status().pid;
      await sup.start([makeEntry()], {});
      const pid2 = sup.status().pid;
      expect(pid2).to.equal(pid1); // même process
    } finally {
      await sup.stop();
    }
  });

  it("port de base OCCUPÉ → la 2ᵉ instance se décale et annonce son port réel", async () => {
    // Le cas d'une SECONDE application Nodefony lancée sur le même poste : le
    // serveur HTTP se décale tout seul (`portPolicy: "auto"`), et le schéma de
    // `devPort` promet le même repli côté Vite. Une promesse de configuration
    // qui ne s'exécute pas est pire qu'un silence — le frontend de la 2ᵉ app
    // reste mort et l'on cherche la panne ailleurs. Le config généré porte
    // TOUJOURS `strictPort: true` (il est lié à l'origine publique) : Vite ne
    // se décalera donc jamais de lui-même, c'est le superviseur qui doit relancer.
    const port = await freePort();
    const first = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: false,
    });
    const second = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port, // MÊME port de base : le conflit est le sujet du test
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: false,
    });
    try {
      await first.start([makeEntry()], {});
      expect(first.status().port).to.equal(port);

      // PRÉMISSE, vérifiée AVANT de juger : la 1ʳᵉ instance tient TOUJOURS le
      // port. Si elle est morte entre-temps, le port est redevenu libre et la
      // 2ᵉ le prend légitimement — le cas rendrait alors « pas de décalage »
      // pour une raison qui n'a rien à voir avec ce qu'il mesure. C'est
      // exactement ce qu'a rendu la forge : `expected 6511 to be above 6511`,
      // un verdict sur une prémisse tombée. Une condition composite qui échoue
      // se DÉCOMPOSE.
      expect(
        await httpPing("127.0.0.1", port),
        "prémisse : la 1ʳᵉ instance tient encore le port de base",
      ).to.be.greaterThan(0);

      await second.start([makeEntry()], {});
      const status = second.status();
      expect(status.state).to.equal("ready");
      // Décalé — et le port annoncé est le port RÉEL, pas celui demandé : c'est
      // lui que le HTML servira au navigateur.
      expect(status.port).to.be.greaterThan(port);
      expect(await httpPing("127.0.0.1", status.port!)).to.be.greaterThan(0);
      // Les deux répondent : la 1ʳᵉ app n'a pas été délogée au passage.
      expect(await httpPing("127.0.0.1", port)).to.be.greaterThan(0);
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  it("auto-restart sur crash inattendu (SIGKILL)", async () => {
    const port = await freePort();
    const sup = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: true,
      maxRestarts: 2,
      restartBackoffBaseMs: 100,
    });
    try {
      await sup.start([makeEntry()], {});
      const nodefonyPidBefore = sup.status().pid; // PID npx parent
      // Le vrai child Vite écoute sur le port — c'est lui qu'on doit tuer
      // (sinon on tue juste npx et Vite survit, bloquant le port pour le retry).
      const realVitePid = pidListeningOn(sup.status().port!);
      expect(realVitePid, "vite PID found").to.be.a("number");
      process.kill(realVitePid!, "SIGKILL");

      // Attendre que l'auto-restart termine.
      const start = Date.now();
      while (Date.now() - start < 25_000) {
        await new Promise((r) => setTimeout(r, 200));
        const s = sup.status();
        if (
          s.state === "ready" &&
          s.pid !== null &&
          s.pid !== nodefonyPidBefore
        ) {
          break;
        }
      }
      const status = sup.status();
      expect(status.state).to.equal("ready");
      expect(status.pid).to.not.equal(nodefonyPidBefore);
      expect(status.restartCount).to.equal(1);
    } finally {
      await sup.stop();
    }
  });

  // ── P14.17 — dev déporté : le banc se prouve LUI-MÊME en deux faces.
  // Face A (témoin) : SANS allowedHosts, Vite refuse un Host nommé inconnu
  // (403, barrière CVE) — prouve que la barrière existe et que le test mord.
  // Face B : AVEC le câblage (template {port} → allowedHosts + origin résolu),
  // le même Host passe, et status().origin suit le port RÉEL du spawn.
  it("Host étranger refusé SANS allowedHosts (témoin — la barrière existe)", async () => {
    const port = await freePort();
    const sup = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: false,
    });
    try {
      await sup.start([makeEntry()], {});
      const code = await httpPingHost(
        "127.0.0.1",
        sup.status().port!,
        "host.docker.internal",
      );
      expect(code).to.equal(403);
    } finally {
      await sup.stop();
    }
  });

  it("publicOrigin {port} : origin suit le port réel, allowedHosts ouvre le Host étranger", async () => {
    const port = await freePort();
    const sup = new ViteProcessSupervisor({
      devHost: "127.0.0.1",
      devPort: port,
      publicOriginTemplate: "http://host.docker.internal:{port}",
      allowedHosts: ["host.docker.internal"],
      startupTimeoutMs: 20_000,
      pipeLogs: false,
      cwd: FIXTURE_ROOT,
      logger: silentLogger,
      healthCheckIntervalMs: 0,
      autoRestart: false,
    });
    try {
      await sup.start([makeEntry()], {});
      const status = sup.status();
      expect(status.state).to.equal("ready");
      // L'origine publique est RÉSOLUE contre le port réel du spawn.
      expect(status.origin).to.equal(
        `http://host.docker.internal:${status.port}`,
      );
      // Et Vite ACCEPTE désormais ce Host nommé (allowedHosts émis).
      const code = await httpPingHost(
        "127.0.0.1",
        status.port!,
        "host.docker.internal",
      );
      expect(code).to.be.greaterThan(0);
      expect(code).to.not.equal(403);
    } finally {
      await sup.stop();
    }
  });
});

/** Ping avec un header `Host` imposé (simule l'accès par nom via passerelle). */
async function httpPingHost(
  connectHost: string,
  port: number,
  hostHeader: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: connectHost,
        port,
        path: "/",
        timeout: 3000,
        headers: { Host: hostHeader },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}
