// ─────────────────────────────────────────────────────────────────────────────
// Chronométrage IN SITU des appels d'un étage du pipeline — préchargé dans le
// serveur COMPLET (`NODE_OPTIONS=--import=…/span-probe.mjs`), jamais dans le
// produit.
//
// Pourquoi pas une coupe (`cut-probe.mjs`) : couper au milieu d'une chaîne
// d'appels change le programme que V8 compile — mesuré sur #508, la coupe
// `pipeline` oscillait de 2,3 à 5,7 µs pendant que la somme pipeline+route
// restait à 10,2–10,6. Ici rien n'est retiré : chaque méthode de la table est
// enveloppée et chronométrée (`performance.now()`), le programme reste entier.
//
// Fenêtre : 1er SIGUSR2 = début, 2e = fin et écriture de
// `<NF_SPAN_PROBE_OUT>/<pid>.spans.json` (même protocole que `wait-probe.mjs`,
// les deux cohabitent). Le coût de l'enveloppe est ÉTALONNÉ à l'écriture (même
// enveloppe autour d'une fonction vide) et rendu à part : l'appelant le
// soustrait, il ne se devine pas.
//
// ⚠️ Temps INCLUSIF, partie SYNCHRONE seulement (une promesse rendue n'est pas
// suivie) — suffisant pour un GET servi sans promesse (#505).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const outDir = process.env.NF_SPAN_PROBE_OUT;
if (outDir) {
  const { HttpKernel, HttpContext, HttpRequest } =
    await import("@nodefony/http");
  const { Firewall } = await import("@nodefony/security");
  const { Nodefony } = await import("nodefony");
  const K = HttpKernel.prototype;
  // [prototype, méthode, libellé] — l'étage « gardes » de la bissection
  // (entre les coupes `route` et `action`), plus ses deux bornes.
  /** @type {Array<[Record<string, unknown>, string, string]>} */
  const targets = [
    [K, "serveHttpRequest", "serveHttpRequest (étage + action)"],
    [HttpContext.prototype, "handle", "HttpContext.handle (action)"],
    [HttpRequest.prototype, "initialize", "HttpRequest.initialize (corps)"],
    [K, "onRequestEnd", "onRequestEnd"],
    [K, "checkValidDomain", "checkValidDomain"],
    [K, "armAndGuard", "armAndGuard"],
    [K, "prepareFrontController", "prepareFrontController"],
    [Firewall.prototype, "isSecure", "Firewall.isSecure"],
    [Firewall.prototype, "enforceCsrf", "Firewall.enforceCsrf"],
    [K, "startSession", "startSession"],
    [HttpContext.prototype, "phaseStart", "phaseStart"],
    [HttpContext.prototype, "phaseEnd", "phaseEnd"],
  ];
  let active = false;
  let requests = 0;
  const stats = Object.create(null);
  const wrap = (fn, acc) =>
    function (...args) {
      if (!active) return fn.apply(this, args);
      const t0 = performance.now();
      try {
        return fn.apply(this, args);
      } finally {
        acc.ms += performance.now() - t0;
        acc.calls++;
      }
    };
  for (const [proto, name, label] of targets) {
    if (typeof proto[name] !== "function") {
      console.error(`span-probe : ${label} introuvable — sonde périmée`);
      process.exit(2);
    }
    const acc = (stats[label] = { calls: 0, ms: 0 });
    proto[name] = wrap(proto[name], acc);
  }
  // Requêtes de la fenêtre : un appel de `serveHttpRequest` par requête HTTP.
  const counter = stats["serveHttpRequest (étage + action)"];

  /** Coût d'une enveloppe active autour d'une fonction vide, en ns. */
  const calibrate = () => {
    const acc = { calls: 0, ms: 0 };
    const empty = wrap(function () {}, acc);
    const N = 2_000_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) empty(i);
    return ((performance.now() - t0) * 1e6) / N;
  };

  process.on("SIGUSR2", () => {
    if (!active) {
      for (const s of Object.values(stats)) {
        s.calls = 0;
        s.ms = 0;
      }
      active = true;
      return;
    }
    active = false;
    requests = counter.calls;
    active = true; // l'étalonnage passe par la même branche que la mesure
    const wrapperNs = calibrate();
    active = false;
    const spans = Object.fromEntries(
      Object.entries(stats).map(([label, s]) => [
        label,
        {
          callsPerReq: s.calls / requests,
          nsPerReq: (s.ms * 1e6) / requests,
        },
      ]),
    );
    // Le DÉCOR réel : les écouteurs posés sur le Kernel et sur HttpKernel. Un
    // hook du chemin de requête écouté par un module de banc rend la requête
    // asynchrone (`fireAsync`) là où une application ne le serait pas — vécu
    // deux fois (#508 : `onRequestScope`, `beforeResolve` du module test).
    const listeners = (emitter) =>
      emitter
        ? Object.fromEntries(
            emitter
              .eventNames()
              .map((e) => [String(e), emitter.listenerCount(e)]),
          )
        : null;
    const kernel = Nodefony.getKernel();
    const decor = {
      kernel: listeners(kernel),
      httpKernel: listeners(kernel?.get?.("HttpKernel")),
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${process.pid}.spans.json`),
      JSON.stringify({ requests, wrapperNs, spans, decor }, null, 2),
    );
  });
  process.stderr.write(`span-probe: ${targets.length} méthodes\n`);
}
