// Les deux copies de la règle « où vont les sorties de banc » — bench-out.sh
// (bancs bash) et bench-out.mjs (rapports, soak) — rendent le même dossier.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { benchOut } from "./bench-out.mjs";

const SH = path.join(import.meta.dirname, "bench-out.sh");
const shell = (env) =>
  execFileSync("bash", ["-c", `. "${SH}" && printf %s "$NF_BENCH_OUT"`], {
    encoding: "utf8",
    env,
  });

describe("bench-out — une règle, deux langages", () => {
  it("rend le même défaut en shell et en JavaScript", () => {
    const env = { ...process.env };
    delete env.NF_BENCH_OUT;
    const saved = process.env.NF_BENCH_OUT;
    delete process.env.NF_BENCH_OUT;
    try {
      expect(path.resolve(shell(env))).toBe(path.resolve(benchOut()));
      expect(benchOut().split(path.sep).slice(-3)).toEqual([
        "tmp",
        "bench",
        "ab",
      ]);
    } finally {
      if (saved !== undefined) process.env.NF_BENCH_OUT = saved;
    }
  });

  it("laisse NF_BENCH_OUT l'emporter des deux côtés", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nf-bench-out-"));
    expect(shell({ ...process.env, NF_BENCH_OUT: dir })).toBe(dir);
    const saved = process.env.NF_BENCH_OUT;
    process.env.NF_BENCH_OUT = dir;
    try {
      expect(benchOut()).toBe(dir);
    } finally {
      if (saved === undefined) delete process.env.NF_BENCH_OUT;
      else process.env.NF_BENCH_OUT = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
