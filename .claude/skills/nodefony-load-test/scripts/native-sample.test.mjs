// Éprouve le lecteur de captures `sample` (native-sample.mjs) sur une capture
// miniature écrite à la main : temps propre, nommage par perf.map, imputation
// au premier ancêtre JS, moyenne par camp. Un changement du format de `sample`
// ou de la table perf doit faire tomber ce test, pas fausser un banc en silence.
//   npx vitest run .claude/skills/nodefony-load-test/scripts/native-sample.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  family,
  loadPerfMap,
  parseMainThread,
  summarizeCamp,
} from "./native-sample.mjs";

const CAPTURE = [
  "Call graph:",
  "    10 Thread_1   DispatchQueue_1: com.apple.main-thread  (serial)",
  "    + 10 start  (in dyld) + 1  [0x1]",
  "    + ! 6 ???  (in <unknown binary>)  [0x2010]",
  "    + ! : 4 Builtins_ArrayPrototypeJoinImpl  (in node) + 5,9  [0x3,0x4]",
  "    + ! 3 write  (in libsystem_kernel.dylib) + 10  [0x5]",
  "    10 Thread_2: node-V8Worker",
  "    + 10 ???  (in <unknown binary>)  [0x2010]",
  "",
].join("\n");
const PERF_MAP = "2000 100 JS:*'hotFn file:///home/u/app/src/app.js:1:1\n";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "native-sample-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Range une capture comme wait-compare.sh : <base>/<camp>-<n>/… */
function stage(base, camp, n, rps, withMap = true) {
  const dir = path.join(base, `${camp}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "native.sample.txt"), CAPTURE);
  fs.writeFileSync(path.join(dir, "wrk.txt"), `Requests/sec:  ${rps}\n`);
  if (withMap) fs.writeFileSync(path.join(dir, "perf.map"), PERF_MAP);
  return dir;
}

describe("native-sample", () => {
  const dir = stage(tmp, "a", 1, 1000);
  const resolve = loadPerfMap(path.join(dir, "perf.map"));

  it("nomme une adresse JIT par la table perf, sans marqueur de palier", () => {
    expect(resolve(0x2010)).toBe("JS: hotFn src/app.js:1:1");
    expect(resolve(0x2100)).toBeNull(); // fin exclue
    expect(loadPerfMap(path.join(tmp, "absente.map"))).toBeNull();
  });

  it("rend le temps PROPRE du seul fil principal", () => {
    const { self, total } = parseMainThread(
      path.join(dir, "native.sample.txt"),
      resolve,
    );
    expect(total).toBe(10);
    expect(Object.fromEntries(self)).toEqual({
      "start  (in dyld)": 1,
      "JS: hotFn src/app.js:1:1": 2,
      "Builtins_ArrayPrototypeJoinImpl  (in node)": 4,
      "write  (in libsystem_kernel.dylib)": 3,
    });
  });

  it("impute chaque échantillon natif à son premier ancêtre JS", () => {
    const { callers } = parseMainThread(
      path.join(dir, "native.sample.txt"),
      resolve,
    );
    expect(Object.fromEntries(callers.get("JS: hotFn src/app.js:1:1"))).toEqual(
      {
        "JS (nommé)": 2,
        "V8 builtins": 4,
      },
    );
    expect(Object.fromEntries(callers.get("(aucun JS au-dessus)"))).toEqual({
      autre: 1,
      "noyau (appels système)": 3,
    });
  });

  it("sans table perf, la frame JIT reste anonyme", () => {
    const { self } = parseMainThread(path.join(dir, "native.sample.txt"));
    expect(self.get("???  (in <unknown binary>)")).toBe(2);
    expect(family("???  (in <unknown binary>)")).toBe(
      "JS compilé (JIT, non nommé)",
    );
  });

  it("moyenne les runs d'un camp en µs/req", () => {
    const base = path.join(tmp, "camp");
    stage(base, "nodefony", 1, 1000);
    stage(base, "nodefony", 2, 500);
    const S = summarizeCamp(base, "nodefony");
    expect(S.runs).toBe(2);
    expect(S.usPerReq).toBeCloseTo((1000 + 2000) / 2);
    // hotFn = 6 échantillons sur 10 → 600 puis 1200 µs/req, moyenne 900
    expect(S.owner.get("JS: hotFn src/app.js:1:1")).toBeCloseTo(900);
    expect(S.named).toBe(true);
    expect(summarizeCamp(base, "absent").runs).toBe(0);
  });

  it("un run sans table perf rend le camp NON nommé", () => {
    const base = path.join(tmp, "mixte");
    stage(base, "x", 1, 1000);
    stage(base, "x", 2, 1000, false);
    expect(summarizeCamp(base, "x").named).toBe(false);
  });
});
