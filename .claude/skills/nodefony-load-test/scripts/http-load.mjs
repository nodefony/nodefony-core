#!/usr/bin/env node
/**
 * Stress HTTP — N requêtes avec concurrence C sur une route Nodefony.
 * Mesure : RPS, latence p50/p90/p95/p99/max, distribution des codes, erreurs.
 *
 * Réutilise un Agent keep-alive (réaliste : connexions réutilisées, comme un LB).
 *
 * À lancer depuis la RACINE du repo :
 *   node .claude/skills/load-test/scripts/http-load.mjs
 *   N=5000 C=100 URL=https://127.0.0.1:5152/nodefony/test/index node .../http-load.mjs
 *
 * ENV :
 *   URL     cible            (défaut https://127.0.0.1:5152/nodefony/test/index)
 *   N       requêtes totales (défaut 1000)
 *   C       concurrence      (défaut 50)
 *   METHOD  verbe HTTP       (défaut GET)
 *   BODY    corps (POST/PUT) (défaut vide)
 */
import https from "node:https";
import http from "node:http";

const URL_STR = process.env.URL ?? "https://127.0.0.1:5152/nodefony/test/index";
const N = Number(process.env.N ?? 1000);
const C = Number(process.env.C ?? 50);
const METHOD = (process.env.METHOD ?? "GET").toUpperCase();
const BODY = process.env.BODY ?? "";

const url = new URL(URL_STR);
const lib = url.protocol === "https:" ? https : http;
const agent = new lib.Agent({
  keepAlive: true,
  maxSockets: C,
  rejectUnauthorized: false,
});

/** 1 requête → latence ms + statusCode (ou erreur). */
function once() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: METHOD,
        agent,
        rejectUnauthorized: false,
        headers: BODY
          ? { "content-length": Buffer.byteLength(BODY) }
          : undefined,
      },
      (res) => {
        res.on("data", () => {}); // drain
        res.on("end", () =>
          resolve({ ms: performance.now() - t0, status: res.statusCode }),
        );
      },
    );
    req.on("error", (e) =>
      resolve({ ms: performance.now() - t0, error: e.code ?? e.message }),
    );
    if (BODY) req.write(BODY);
    req.end();
  });
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

async function main() {
  console.log(
    `\n  HTTP LOAD\n  ${METHOD} ${URL_STR}\n  N=${N}  concurrence=${C}\n`,
  );
  const lat = []; // latences des requêtes SERVIES uniquement
  const failLat = []; // latences des échecs, tenues à part (jamais mélangées)
  const codes = {};
  const errors = {};
  let sent = 0,
    done = 0;
  const t0 = Date.now();

  await new Promise((resolve) => {
    const pump = () => {
      while (sent < N && sent - done < C) {
        sent++;
        once().then((r) => {
          // ⚠️ Une requête ÉCHOUÉE n'est pas une requête servie : ni dans le RPS,
          // ni dans les percentiles. Un ECONNREFUSED revient en ~0 ms — le compter
          // AMÉLIORERAIT le p50 tout en gonflant le débit. C'est ainsi qu'on publie
          // un débit sur du vent.
          if (r.error) {
            failLat.push(r.ms);
            errors[r.error] = (errors[r.error] ?? 0) + 1;
          } else {
            codes[r.status] = (codes[r.status] ?? 0) + 1;
            if (r.status >= 200 && r.status < 400) lat.push(r.ms);
            else failLat.push(r.ms);
          }
          done++;
          if (done % Math.max(1, Math.floor(N / 20)) === 0)
            process.stdout.write(`\r  ▶ ${done}/${N}   `);
          if (done >= N) resolve();
          else pump();
        });
      }
    };
    pump();
  });

  const dt = Date.now() - t0;
  lat.sort((a, b) => a - b);
  const served = lat.length; // 2xx/3xx réellement servies
  const failed = N - served;
  const okPct = (served / N) * 100;
  console.log(`\n\n  ── RÉSULTAT ──`);
  // Le RPS porte sur ce qui a été SERVI. Le débit brut (tentatives) est montré à
  // côté quand il diffère, pour qu'on voie l'écart au lieu de le subir.
  console.log(
    `  durée     : ${(dt / 1000).toFixed(2)}s   RPS servi : ${((served / dt) * 1000).toFixed(0)}` +
      (failed
        ? `   (brut, échecs inclus : ${((N / dt) * 1000).toFixed(0)})`
        : ""),
  );
  console.log(`  servies   : ${served}/${N} (${okPct.toFixed(1)} %)`);
  if (served)
    console.log(
      `  latence ms: p50 ${pct(lat, 50).toFixed(1)} · p90 ${pct(lat, 90).toFixed(1)} · p95 ${pct(lat, 95).toFixed(1)} · p99 ${pct(lat, 99).toFixed(1)} · max ${lat[lat.length - 1]?.toFixed(1)}`,
    );
  console.log(
    `  codes     : ${
      Object.entries(codes)
        .map(([k, v]) => `${k}×${v}`)
        .join(" · ") || "—"
    }`,
  );
  if (Object.keys(errors).length)
    console.log(
      `  erreurs   : ${Object.entries(errors)
        .map(([k, v]) => `${k}×${v}`)
        .join(" · ")}`,
    );

  // Garde-fou : un banc ne doit JAMAIS rendre un chiffre rassurant quand rien n'a
  // été servi. Zéro succès = échec du banc (exit 1), pas un résultat de 0 RPS.
  if (served === 0) {
    console.log(`\n  ✖ AUCUNE requête servie — ce run ne mesure RIEN.`);
    console.log(
      `    Vérifier que le serveur écoute sur ${URL_STR} (skill nodefony-start-server).\n`,
    );
    agent.destroy();
    process.exit(1);
  }
  if (okPct < 99) {
    console.log(
      `\n  ⚠ ${(100 - okPct).toFixed(1)} % d'échecs : le RPS ci-dessus ne porte que sur les ${served} servies.`,
    );
    console.log(
      `    Un débit mesuré sous erreurs n'est pas comparable à un run sain.`,
    );
  }
  console.log("");
  agent.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("\n  FATAL:", e?.message ?? e);
  process.exit(1);
});
