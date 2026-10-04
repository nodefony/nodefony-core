/**
 * Verrou « un run long occupe l'arbre » — tenu, libéré, orphelin, et la CLI
 * qu'appelle le pre-commit.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquire,
  holder,
  release,
  refusal,
  LOCK_FILE,
  MAX_AGE_MS,
} from "./long-run-lock.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "nf-lock-"));
const file = path.join(dir, "long-run.lock");
const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "long-run-lock.mjs",
);

afterEach(() => rmSync(file, { force: true }));

describe("long-run-lock", () => {
  it("libre tant que personne ne l'a posé", () => {
    expect(holder(file)).toBe(null);
  });

  it("tenu par le processus courant, puis libéré", () => {
    acquire("test:all --mongo", file);
    expect(holder(file)).toMatchObject({
      pid: process.pid,
      label: "test:all --mongo",
    });
    release(file);
    expect(existsSync(file)).toBe(false);
  });

  it("un processus MORT ne bloque rien : le verrou orphelin est ignoré", () => {
    // Un pid qui a existé et n'existe plus — constaté, pas inventé.
    const child = spawnSync(process.execPath, ["-e", "0"]);
    writeFileSync(
      file,
      JSON.stringify({
        pid: child.pid,
        label: "x",
        since: new Date().toISOString(),
      }),
    );
    expect(holder(file)).toBe(null);
  });

  it("release ne retire PAS le verrou d'un autre processus", async () => {
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
    try {
      writeFileSync(
        file,
        JSON.stringify({
          pid: other.pid,
          label: "autre",
          since: new Date().toISOString(),
        }),
      );
      release(file);
      expect(holder(file)?.pid).toBe(other.pid);
    } finally {
      other.kill();
    }
  });

  it("un verrou TROP VIEUX ne bloque rien, même si le pid vit (pid recyclé)", () => {
    acquire("test:all", file);
    try {
      expect(holder(file)).not.toBe(null);
      expect(holder(file, Date.now() + MAX_AGE_MS + 1000)).toBe(null);
    } finally {
      release(file);
    }
  });

  it("CLI `clear` retire le verrou, quel qu'en soit le porteur", () => {
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
    let created = false;
    try {
      // Création EXCLUSIVE (`wx`) plutôt que « existe ? puis écrire » : entre
      // les deux, une vraie passe pouvait prendre le verrou, et le test
      // l'écrasait. Verrou déjà tenu → une vraie passe tourne : ne pas la
      // piétiner.
      try {
        writeFileSync(
          LOCK_FILE,
          JSON.stringify({
            pid: other.pid,
            label: "autre",
            since: new Date().toISOString(),
          }),
          { flag: "wx" },
        );
        created = true;
      } catch (/** @type {unknown} */ e) {
        if (/** @type {{ code?: unknown }} */ (e).code === "EEXIST") return;
        throw e;
      }
      expect(holder()).not.toBe(null);
      expect(spawnSync(process.execPath, [CLI, "clear"]).status).toBe(0);
      expect(holder()).toBe(null);
    } finally {
      other.kill();
      if (created) rmSync(LOCK_FILE, { force: true });
    }
  });

  it("le refus NOMME la sortie de secours", () => {
    expect(refusal({ pid: 1, label: "x", since: "y" })).toContain(
      "long-run-lock.mjs clear",
    );
  });

  it("un fichier illisible vaut libre, jamais une exception", () => {
    writeFileSync(file, "{pas du json");
    expect(holder(file)).toBe(null);
  });

  it("le refus nomme le run, son pid et l'issue", () => {
    const msg = refusal({
      pid: 42,
      label: "test:all",
      since: "2026-09-24T10:00:00Z",
    });
    expect(msg).toContain("test:all");
    expect(msg).toContain("42");
    expect(msg).toMatch(/Attendre sa fin/u);
  });

  it("CLI `check` : 0 libre, 1 tenu — ce que lit le pre-commit", () => {
    // La CLI lit l'emplacement RÉEL : on le pose pour un processus vivant (nous).
    const had = existsSync(LOCK_FILE);
    if (had) return; // une vraie passe tourne : ne pas la piétiner
    try {
      expect(spawnSync(process.execPath, [CLI, "check"]).status).toBe(0);
      acquire("test:all (banc)");
      const held = spawnSync(process.execPath, [CLI, "check"], {
        encoding: "utf8",
      });
      expect(held.status).toBe(1);
      expect(held.stderr).toContain("test:all (banc)");
    } finally {
      release();
    }
  });
});
