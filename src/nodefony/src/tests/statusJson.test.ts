/*
 *   `nodefony status --json` et le canal des points d'attention (#533).
 *
 *   Un agent n'a pas vu l'écran de démarrage : il lit `status --json`. Ces
 *   tests verrouillent ce qu'il y trouve — le bilan, et SURTOUT d'où il vient
 *   (le serveur qui tourne, ou le dernier démarrage d'un serveur arrêté) : un
 *   bilan périmé présenté comme courant fait chercher un défaut résolu.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  buildDevStatus,
  buildStatusJson,
} from "../service/dev/devStatusReport";
import type { DevProcessInfo } from "../service/dev/devProcess";
import type { ILastBoot } from "../kernel/checks/lastBoot";
import type { IBootReport } from "../kernel/bootReport";
import Kernel from "../kernel/Kernel";
import { Nodefony } from "../Nodefony";

const NOW = Date.parse("2026-10-04T12:00:00Z");

const lastBoot = (pid: number): ILastBoot => ({
  status: "ok",
  timestamp: "2026-10-04T11:00:00Z",
  environment: "development",
  pid,
  node: "v26.10.0",
  open: [{ id: "app", label: "Application", url: "https://localhost:5152/" }],
  notices: [
    { code: "DB_SQLITE_FALLBACK", level: "warning", message: "repli SQLite" },
  ],
});

const server = (pid: number): DevProcessInfo =>
  ({
    pid,
    ppid: 1,
    role: "server",
    label: "server",
    uptimeSec: 10,
    rssKb: 1000,
    cpu: 0,
    command: "node",
  }) as unknown as DevProcessInfo;

const status = (procs: DevProcessInfo[]) =>
  buildDevStatus("/app", null, false, procs, []);

describe("status --json — le bilan, et d'où il vient", () => {
  it("running : le bilan est celui du serveur qui tourne", () => {
    const json = buildStatusJson(status([server(42)]), lastBoot(42), NOW);
    expect(json.schema).to.equal(1);
    expect(json.boot.source).to.equal("running");
    expect(json.boot.open?.[0]?.url).to.equal("https://localhost:5152/");
    expect(json.boot.notices?.[0]?.code).to.equal("DB_SQLITE_FALLBACK");
    // Le rapport des processus reste là, intact : `status --json` l'ÉTEND.
    expect(json.running).to.equal(true);
    expect(json.processes).to.have.length(1);
  });

  it("previous : un serveur tourne, mais le bilan est d'un autre démarrage", () => {
    const json = buildStatusJson(status([server(43)]), lastBoot(42), NOW);
    expect(json.boot.source).to.equal("previous");
    expect(json.boot.note).to.contain("il y a 1 heure");
  });

  it("stopped : rien ne tourne — dernier bilan, en le DISANT", () => {
    const json = buildStatusJson(status([]), lastBoot(42), NOW);
    expect(json.boot.source).to.equal("stopped");
    expect(json.boot.note).to.contain("aucun serveur ne tourne");
  });

  it("absent : aucun démarrage consigné", () => {
    expect(buildStatusJson(status([]), null, NOW).boot.source).to.equal(
      "absent",
    );
  });
});

describe("canal des points d'attention du noyau", () => {
  let previous: Kernel | null;
  let dir: string;
  beforeAll(() => {
    previous = Nodefony.getKernel();
    dir = mkdtempSync(path.join(os.tmpdir(), "nf-boot-notice-"));
  });
  afterAll(() => {
    Nodefony.setKernel(previous as Kernel);
    rmSync(dir, { recursive: true, force: true });
  });

  const makeKernel = (): Kernel =>
    new Kernel("development", null, { log: { active: false } });

  it("range, dédoublonne et trie ce que les modules déclarent", () => {
    const kernel = makeKernel();
    kernel.reportBootNotice({ code: "A", level: "info", message: "a" });
    kernel.reportBootNotice({ code: "B", level: "error", message: "b" });
    kernel.reportBootNotice({ code: "A", level: "info", message: "a" });
    expect(kernel.getBootReport().notices.map((n) => n.code)).to.deep.equal([
      "B",
      "A",
    ]);
  });

  it("aucun serveur web : aucune adresse à ouvrir, même avec un lien déclaré", () => {
    const kernel = makeKernel();
    kernel.reportBootLink({ id: "studio", label: "Studio", path: "/nodefony" });
    expect(kernel.getBootReport().open).to.deep.equal([]);
  });

  it("un point déclaré APRÈS l'écriture du bilan le fait réécrire", () => {
    const kernel = makeKernel();
    kernel.path = dir;
    // Profil serveur : c'est son bilan qu'on réécrit (`var/last-boot.json`).
    kernel.runProfile = { ...kernel.runProfile, servers: true };
    // Écriture initiale, comme juste avant `onPostReady`.
    (
      kernel as unknown as { writeBootSummary(r: IBootReport): void }
    ).writeBootSummary(kernel.getBootReport());
    const file = path.join(dir, "var", "last-boot.json");
    const avant = JSON.parse(readFileSync(file, "utf8")) as ILastBoot;
    expect(avant.notices).to.equal(undefined);
    kernel.reportBootNotice({
      code: "FRONTEND_BUILD_FAILED",
      level: "error",
      message: "Vite a échoué",
    });
    const apres = JSON.parse(readFileSync(file, "utf8")) as ILastBoot;
    expect(apres.notices?.map((n) => n.code)).to.deep.equal([
      "FRONTEND_BUILD_FAILED",
    ]);
    expect(apres.durationMs).to.equal(avant.durationMs);
  });
});
