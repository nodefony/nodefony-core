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

/**
 * Échéance que le cas du décalage de port s'impose à LUI-MÊME, avant celle de
 * vitest.
 *
 * Le superviseur peut dépenser `(portRetryAttempts + 1) × startupTimeoutMs`
 * avant d'abandonner — **80 s** avec les défauts employés ici, quand
 * `testTimeout` vaut 60 s. Le cas ne pouvait donc structurellement pas voir la
 * fin d'un repli qui s'éternise : le harnais le tuait d'abord, et TOUTE
 * l'instrumentation qui suit `second.start()` — compteur de replis, PID qui
 * tient réellement le port, dernière erreur retenue — restait inatteignable.
 * Vécu sur la forge : `60008ms` et pas un mot, là où les cinq autres cas du
 * fichier tiennent en 300 à 700 ms.
 *
 * On borne donc nous-mêmes, assez tôt pour PARLER. Un repli sain coûte moins de
 * deux secondes (le fichier entier tourne en ~5 s sur un poste) : cette marge
 * n'arbitre rien, elle garantit seulement que le verdict vienne du cas.
 */
const STARTUP_DEADLINE_MS = 30_000;

/**
 * Attend `promise`, mais rend la main AVANT l'échéance du harnais, en
 * remplaçant un timeout muet par le diagnostic que `buildDiagnostic` compose au
 * moment du dépassement.
 */
async function withDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  buildDiagnostic: () => string,
): Promise<T> {
  // Le rejet tardif d'une promesse abandonnée par la course n'a plus de
  // consommateur : sans ce puits, il remonterait en `unhandledRejection` et
  // ferait tomber un AUTRE cas, loin d'ici.
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(buildDiagnostic())),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      // Ce que le banc suppose de la plateforme, écrit noir sur blanc : on ne
      // compare PAS le PID qui écoute à `first.status().pid`. Les deux diffèrent
      // légitimement quand vite est lancé par le shim `npx` — c'est alors un
      // petit-fils qui tient le socket, ce que le cas d'auto-restart plus bas
      // exploite explicitement. Une prémisse écrite ainsi serait rouge sur les
      // agents où `resolveViteBin()` échoue, et ce rouge-là n'appartiendrait à
      // personne.
      //
      // Elle n'aurait rien gardé de plus, par ailleurs : `first` a RÉUSSI son
      // listen sur ce port (assertion ci-dessus), donc aucun tiers ne peut le
      // tenir en même temps. Et cette assertion, justement, ne prouvait rien
      // tant que `status().port` retombait sur le port DEMANDÉ : elle passait
      // même sans port résolu. Elle est probante depuis que le superviseur rend
      // `null` plutôt qu'une espérance.

      // Borné par le cas lui-même — cf `STARTUP_DEADLINE_MS`. Le diagnostic est
      // composé AU MOMENT du dépassement : c'est le seul instant où l'état du
      // superviseur dit encore où il en était.
      await withDeadline(
        second.start([makeEntry()], {}),
        STARTUP_DEADLINE_MS,
        () => {
          const st = second.status();
          return (
            `la 2ᵉ instance n'a pas rendu la main en ${STARTUP_DEADLINE_MS} ms ` +
            `(budget théorique du superviseur : (portRetryAttempts + 1) × 20000 ms).\n` +
            `  état=${st.state} port=${st.port ?? "aucun"} replis=${st.portRetries}\n` +
            `  dernière erreur : ${st.lastError ?? "aucune"}\n` +
            `  écoute réelle sur ${port} : PID ${pidListeningOn(port) ?? "aucun"} ` +
            `(1ʳᵉ = ${first.status().pid ?? "?"})\n` +
            `  replis à 0 → aucun conflit n'a été DÉNONCÉ sous une forme reconnue, ` +
            `ou vite a averti sans échouer (« in use on a wildcard address », ` +
            `« trying another one ») et l'échéance a été prise pour un conflit ; ` +
            `replis > 0 → chaque repli a repayé l'échéance de démarrage entière.`
          );
        },
      );
      const status = second.status();
      expect(status.state).to.equal("ready");
      // 🔴 LA CAUSE, avant le verdict. Ce cas est tombé par intermittence sur
      // les agents macOS partagés (`expected 49263 to be above 49263`) sans
      // qu'on puisse dire POURQUOI : le port seul n'accuse personne. Deux
      // explications s'affrontaient, et le compteur de replis les sépare —
      //
      //   `portRetries === 0` → Vite n'a jamais DÉNONCÉ le conflit sous une
      //     forme que le superviseur reconnaît (ou l'a fait après le délai
      //     accordé) : le repli n'est jamais parti. Le défaut est dans la
      //     DÉTECTION.
      //   `portRetries > 0`   → le repli a bien eu lieu et Vite a malgré tout
      //     fini sur le même numéro : `strictPort` n'a pas tenu, ou deux
      //     sockets coexistent sur ce port (familles d'adresses distinctes).
      //     Le défaut est dans la LIAISON.
      //
      // Un banc qui ne nomme pas sa cause se relance au lieu d'être instruit,
      // et son rouge finit par emporter le prochain vrai rouge avec lui.
      if (status.port === port) {
        // 🔴 QUI tient RÉELLEMENT le port, au moment où l'on juge. Le compteur
        // de replis dit d'où vient le défaut ; ce PID dit ce qui s'est passé,
        // et les deux ensemble épuisent le champ des explications. Sans lui,
        // `portRetries === 0` laissait encore deux lectures incompatibles —
        // « Vite n'a pas obtenu le port mais l'annonce » et « Vite l'a obtenu
        // alors qu'il était pris » — et l'on relançait le banc au lieu de
        // l'instruire.
        const tenantDuPort = pidListeningOn(port);
        const pidPremiere = first.status().pid;
        const pidSeconde = status.pid;
        const qui =
          tenantDuPort === null
            ? "PERSONNE n'écoute sur ce port au moment du verdict — la prémisse " +
              "est tombée ENTRE la vérification et ici, le cas ne juge rien"
            : tenantDuPort === pidPremiere
              ? "c'est la 1ʳᵉ instance qui tient le port : la 2ᵉ n'écoute NULLE PART " +
                "et annonce pourtant ce numéro — le défaut est dans ce que le " +
                "superviseur retient comme port RÉEL, pas dans la liaison"
              : tenantDuPort === pidSeconde
                ? "c'est la 2ᵉ instance qui tient le port : les deux coexistent sur " +
                  "ce numéro — familles d'adresses distinctes, ou `SO_REUSEADDR` " +
                  "accepté par le noyau ; le défaut est dans la LIAISON"
                : "un TIERS tient le port — ni la 1ʳᵉ ni la 2ᵉ instance : l'agent " +
                  "est partagé et le port a été pris entre-temps";
        expect.fail(
          `la 2ᵉ instance annonce le port de la 1ʳᵉ (${port}) — ` +
            `replis tentés : ${status.portRetries}. ` +
            (status.portRetries === 0
              ? "AUCUN repli : le conflit n'a pas été dénoncé sous une forme reconnue " +
                "(`isPortInUseMessage`), ou il l'a été après le délai de démarrage."
              : "le repli a eu lieu et Vite a fini sur le MÊME port : `strictPort` " +
                "n'a pas tenu, ou deux sockets coexistent sur ce numéro.") +
            `\n  écoute réelle : PID ${tenantDuPort ?? "aucun"} ` +
            `(1ʳᵉ = ${pidPremiere ?? "?"}, 2ᵉ = ${pidSeconde ?? "?"}) → ${qui}.` +
            `\n  dernière erreur retenue par la 2ᵉ : ${status.lastError ?? "aucune"}`,
        );
      }
      // Décalé — et le port annoncé est le port RÉEL, pas celui demandé : c'est
      // lui que le HTML servira au navigateur.
      expect(status.port).to.be.greaterThan(port);
      // Le décalage ne s'est pas fait tout seul : le superviseur a RELANCÉ.
      // Sans cette ligne, un Vite qui se décalerait de lui-même (strictPort
      // absent du config généré) rendrait ce cas vert en prouvant autre chose.
      expect(
        status.portRetries,
        "le port a changé sans qu'aucun repli n'ait été tenté — " +
          "ce n'est pas le superviseur qui a décalé, et ce cas ne prouve alors " +
          "rien de ce qu'il annonce",
      ).to.be.greaterThan(0);
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
