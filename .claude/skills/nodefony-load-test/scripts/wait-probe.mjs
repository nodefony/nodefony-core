// ─────────────────────────────────────────────────────────────────────────────
// Sonde « où part le temps HORS du JavaScript » — préchargée dans un serveur
// (`node --import …/wait-probe.mjs`), identique pour tous les camps.
//
// Un profil CPU dit ce que coûte le JavaScript ; il ne dit pas ce que le process
// ATTEND. Cette sonde encadre une fenêtre de charge (1er SIGUSR2 = début,
// 2e = fin, écriture du JSON) et rend, pour cette fenêtre :
//   - l'occupation RÉELLE de la boucle (ELU), mesurée — plus dérivée de µs × débit ;
//   - le CPU du FIL PRINCIPAL (`process.threadCpuUsage`) contre celui du PROCESS
//     entier (`process.cpuUsage`, tous fils : GC parallèle, pool libuv) ;
//   - le GC : nombre et durée par genre (PerformanceObserver) ;
//   - les tours de boucle libuv et les évènements servis (`uvMetricsInfo`) ;
//   - les écritures sur socket (`write` contre `writev`, octets) — le proxy des
//     appels système d'écriture, `dtruss` exigeant les droits root sous macOS ;
//   - les changements de contexte volontaires/involontaires (`resourceUsage`) ;
//   - le nombre EXACT de requêtes reçues (canal `http.server.request.start`).
//
// Le coût de la sonde (un compteur par écriture et par requête) est le même
// pour tous les camps : les ABSOLUS sont légèrement majorés, les ÉCARTS non.
//
// Env : NF_WAIT_PROBE_OUT — dossier de sortie (un `<pid>.json` par process).
// ─────────────────────────────────────────────────────────────────────────────
import diagnostics from "node:diagnostics_channel";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { PerformanceObserver, performance } from "node:perf_hooks";

const outDir = process.env.NF_WAIT_PROBE_OUT;
if (outDir) {
  const counters = {
    requests: 0,
    write: 0,
    writev: 0,
    writevChunks: 0,
    bytes: 0,
    gc: Object.create(null),
  };
  let active = false;

  diagnostics.subscribe("http.server.request.start", () => {
    if (active) counters.requests++;
  });

  // `_writeGeneric(writev, data, encoding, cb)` : point de passage unique de
  // `write` et `writev` vers libuv, pour http comme pour tls.
  const proto = net.Socket.prototype;
  const writeGeneric = proto._writeGeneric;
  proto._writeGeneric = function (writev, data, encoding, cb) {
    if (active) {
      if (writev) {
        counters.writev++;
        counters.writevChunks += data.length;
        for (const c of data)
          counters.bytes += Buffer.byteLength(c.chunk, c.encoding);
      } else {
        counters.write++;
        counters.bytes += Buffer.byteLength(data, encoding);
      }
    }
    return writeGeneric.call(this, writev, data, encoding, cb);
  };

  const GC_KINDS = {
    1: "scavenge",
    2: "markSweepCompact",
    4: "incremental",
    8: "weakcb",
    16: "minorMarkSweep",
  };
  const gcObserver = new PerformanceObserver((list) => {
    if (!active) return;
    for (const e of list.getEntries()) {
      const kind = GC_KINDS[e.detail?.kind] ?? `kind${e.detail?.kind}`;
      const slot = (counters.gc[kind] ??= { count: 0, ms: 0 });
      slot.count++;
      slot.ms += e.duration;
    }
  });
  gcObserver.observe({ entryTypes: ["gc"] });

  let start = null;
  const snapshot = () => ({
    t: performance.now(),
    elu: performance.eventLoopUtilization(),
    thread: process.threadCpuUsage(),
    proc: process.cpuUsage(),
    uv: { ...performance.nodeTiming.uvMetricsInfo },
    ru: process.resourceUsage(),
  });

  process.on("SIGUSR2", () => {
    if (!active) {
      counters.requests =
        counters.write =
        counters.writev =
        counters.writevChunks =
        counters.bytes =
          0;
      counters.gc = Object.create(null);
      start = snapshot();
      active = true;
      return;
    }
    active = false;
    const end = snapshot();
    const elu = performance.eventLoopUtilization(end.elu, start.elu);
    const wallMs = end.t - start.t;
    const us = (a, b) => (a.user - b.user + (a.system - b.system)) / 1000;
    const result = {
      pid: process.pid,
      wallMs,
      requests: counters.requests,
      elu: {
        utilization: elu.utilization,
        activeMs: elu.active,
        idleMs: elu.idle,
      },
      cpuMs: {
        threadUser: (end.thread.user - start.thread.user) / 1000,
        threadSystem: (end.thread.system - start.thread.system) / 1000,
        thread: us(end.thread, start.thread),
        processUser: (end.proc.user - start.proc.user) / 1000,
        processSystem: (end.proc.system - start.proc.system) / 1000,
        process: us(end.proc, start.proc),
      },
      uv: {
        loopCount: end.uv.loopCount - start.uv.loopCount,
        events: end.uv.events - start.uv.events,
      },
      ctxSwitches: {
        voluntary:
          end.ru.voluntaryContextSwitches - start.ru.voluntaryContextSwitches,
        involuntary:
          end.ru.involuntaryContextSwitches -
          start.ru.involuntaryContextSwitches,
      },
      writes: {
        write: counters.write,
        writev: counters.writev,
        writevChunks: counters.writevChunks,
        bytes: counters.bytes,
      },
      gc: counters.gc,
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${process.pid}.json`),
      JSON.stringify(result, null, 2),
    );
  });
}
