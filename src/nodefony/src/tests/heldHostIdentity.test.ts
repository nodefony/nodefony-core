/**
 * L'identité d'un hôte porté (ADR-0030, audit M8/M9) : son titre de process,
 * qui le rend visible à `nodefony status` / `stop` quel que soit le service ;
 * son indifférence au Ctrl-C, qui appartient au teneur ; son entrée de module,
 * qui ne compare plus de chemins ; et sa place de RACINE à l'arrêt, puisqu'il
 * dirige son propre groupe.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HeldHost } from "../service/dev/HeldHost";
import {
  HELD_CHANNEL,
  HELD_HOST_TITLE_PREFIX,
  MAX_HELD_KEY_LENGTH,
  heldHostTitle,
  isHeldHolderMessage,
  serveHeldService,
  serveHeldServiceIfMain,
  type IHeldHostEndpoint,
  type IHeldServiceImpl,
} from "../service/dev/heldChannel";
import {
  isPidAlive,
  parsePsRow,
  rootProcesses,
  splitByProject,
  type DevProcessInfo,
} from "../service/dev/devProcess";
import { hostProjects } from "../service/dev/devStop";

const HELD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "held",
);

const hosts: HeldHost[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeHost(key: string, module: string, startupTimeoutMs = 5_000) {
  const host = new HeldHost({
    key,
    module,
    spec: { mode: "ok" },
    cwd: HELD_DIR,
    env: { ...process.env },
    startupTimeoutMs,
    maxRestarts: 0,
  });
  hosts.push(host);
  return host;
}

/** Le titre que `ps` montre pour `pid` — `null` sans `ps`. */
function psTitle(pid: number): string | null {
  const r = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

const noopImpl: IHeldServiceImpl = {
  start: () => Promise.resolve({}),
  stop: () => Promise.resolve(),
};

/** Un faux process, qui consigne ses écouteurs et ses sorties. */
function fakeEndpoint(withSend = true) {
  const listeners = new Map<string, Array<(m?: unknown) => void>>();
  const exits: number[] = [];
  const sent: unknown[] = [];
  const endpoint: IHeldHostEndpoint = {
    connected: true,
    ...(withSend
      ? {
          send: (m: unknown) => {
            sent.push(m);
            return true;
          },
        }
      : {}),
    on: (event: string, listener: (m?: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return endpoint;
    },
    exit: (code?: number) => {
      exits.push(code ?? 0);
    },
  };
  const emit = (event: string, m?: unknown): void => {
    for (const l of listeners.get(event) ?? []) l(m);
  };
  return { endpoint, listeners, exits, sent, emit };
}

function info(
  pid: number,
  ppid: number,
  role: DevProcessInfo["role"],
): DevProcessInfo {
  return {
    pid,
    ppid,
    mode: "dev",
    role,
    label: role,
    detail: undefined,
    rssKb: 0,
    cpu: 0,
    uptimeSec: 0,
  };
}

describe("hôte porté — titre de process", () => {
  it("nodefony-held[<clé>], la clé réduite à l'ASCII imprimable (contrôles, accents, retour ligne)", () => {
    expect(heldHostTitle("ai:llm")).to.equal("nodefony-held[ai:llm]");
    expect(heldHostTitle("a\nb\u0007c")).to.equal("nodefony-held[a?b?c]");
    expect(heldHostTitle("vite:été")).to.equal("nodefony-held[vite:?t?]");
    expect(heldHostTitle("")).to.equal("nodefony-held[]");
  });

  it("le message start PORTE la clé : absente, vide, démesurée ou non textuelle → refusé", () => {
    const start = (key: unknown) => ({
      channel: HELD_CHANNEL,
      type: "start",
      key,
      spec: {},
    });
    expect(
      isHeldHolderMessage({ channel: HELD_CHANNEL, type: "start", spec: {} }),
    ).to.equal(false);
    expect(isHeldHolderMessage(start(""))).to.equal(false);
    expect(isHeldHolderMessage(start(42))).to.equal(false);
    expect(
      isHeldHolderMessage(start("k".repeat(MAX_HELD_KEY_LENGTH + 1))),
    ).to.equal(false);
    expect(
      isHeldHolderMessage(start("k".repeat(MAX_HELD_KEY_LENGTH))),
    ).to.equal(true);
    expect(isHeldHolderMessage(start("ai:llm"))).to.equal(true);
  });

  it("serveHeldService pose le préfixe dès l'appel, puis le titre de la clé au start — AVANT le service", async () => {
    const { endpoint, emit } = fakeEndpoint();
    let seenByService: string | undefined;
    serveHeldService(
      {
        start: () => {
          seenByService = endpoint.title;
          return Promise.resolve({});
        },
        stop: () => Promise.resolve(),
      },
      endpoint,
    );
    expect(endpoint.title).to.equal(HELD_HOST_TITLE_PREFIX);
    emit("message", {
      channel: HELD_CHANNEL,
      type: "start",
      key: "ai:llm",
      spec: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(seenByService).to.equal("nodefony-held[ai:llm]");
  });

  it("SIGINT est écouté et IGNORÉ : aucune sortie, le teneur décide", () => {
    const { endpoint, listeners, exits, emit } = fakeEndpoint();
    serveHeldService(noopImpl, endpoint);
    expect(listeners.get("SIGINT")?.length).to.equal(1);
    emit("SIGINT");
    expect(exits).to.deep.equal([]);
  });
});

describe("hôte porté — entrée de module (import.meta.main)", () => {
  it("ne sert que point d'entrée ET lancé par un teneur", () => {
    for (const [main, withSend, expected] of [
      [false, true, false],
      [undefined, true, false],
      [true, false, false],
      [true, true, true],
    ] as const) {
      const { endpoint, listeners } = fakeEndpoint(withSend);
      let created = 0;
      const served = serveHeldServiceIfMain(
        main === undefined ? {} : { main },
        () => {
          created++;
          return noopImpl;
        },
        endpoint,
      );
      expect(served, `main=${main} send=${withSend}`).to.equal(expected);
      expect(created).to.equal(expected ? 1 : 0);
      expect(listeners.has("message")).to.equal(expected);
    }
  });

  it("importé (pas point d'entrée), même avec un canal IPC : ne sert pas", async () => {
    const url = pathToFileURL(path.join(HELD_DIR, "main-host.mjs")).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(url)});
         process.send({ listeners: process.listenerCount("message") });
         process.disconnect();`,
      ],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    const reply = await new Promise<unknown>((resolve) =>
      child.once("message", resolve),
    );
    expect(reply).to.deep.equal({ listeners: 0 });
  });

  it.skipIf(process.platform === "win32")(
    "lancé par un LIEN SYMBOLIQUE : l'entrée import.meta.main sert ; l'ancienne garde argv[1] sortait sans servir",
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "nf-held-link-"));
      dirs.push(dir);
      const viaLink = (name: string): string => {
        const link = path.join(dir, name);
        symlinkSync(path.join(HELD_DIR, name), link);
        return link;
      };
      const ok = await makeHost("link:main", viaLink("main-host.mjs")).start();
      expect(ok.state).to.equal("ready");
      // Témoin du défaut corrigé : même lancement, ancienne garde — rien ne
      // retient le process (aucun écouteur sur le canal), il sort sans un mot.
      await expect(
        makeHost("link:argv", viaLink("argv-host.mjs"), 1_500).start(),
      ).rejects.toThrow(/exited before ready/);
    },
  );
});

describe.skipIf(process.platform === "win32")(
  "hôte porté — vrai process",
  () => {
    it("ps montre nodefony-held[<clé>] ; status le classe « held », clé en détail", async () => {
      const ready = await makeHost(
        "ai:llm",
        path.join(HELD_DIR, "host.mjs"),
      ).start();
      const pid = ready.pid as number;
      const title = psTitle(pid);
      if (title === null) return; // `ps` absent : rien à constater
      expect(title.startsWith("nodefony-held[ai:llm]")).to.equal(true);
      const row = parsePsRow(`${pid} 1 1000 0.0 00:01 ${title}`);
      expect(row?.role).to.equal("held");
      expect(row?.detail).to.equal("ai:llm");
    });

    it("un Ctrl-C (SIGINT) envoyé à l'hôte ne le tue pas : sa vie appartient au teneur", async () => {
      const host = makeHost("sigint:a", path.join(HELD_DIR, "host.mjs"));
      const { pid } = await host.start();
      process.kill(pid as number, "SIGINT");
      await new Promise((r) => setTimeout(r, 300));
      expect(isPidAlive(pid as number)).to.equal(true);
      expect(host.status().state).to.equal("ready");
    });
  },
);

describe("nodefony status / stop — l'hôte porté est reconnu et visé", () => {
  it("parsePsRow : le titre ANCRÉ en tête, jamais cherché dans la ligne", () => {
    const row = parsePsRow("4242 4000 5000 0,5 01:02 nodefony-held[ai:llm]");
    expect(row).to.include({
      role: "held",
      label: "held",
      detail: "ai:llm",
      mode: "dev",
    });
    expect(
      parsePsRow("4243 4000 100 0.0 00:01 tail -f nodefony-held[x].log"),
    ).to.equal(null);
  });

  it("racines : un hôte (held ou vite) en est une, même enfant d'un process de l'ensemble", () => {
    const sup = info(10, 1, "supervisor");
    const server = info(11, 10, "server");
    const held = info(12, 10, "held");
    const vite = info(13, 11, "vite");
    const roots = rootProcesses([sup, server, held, vite]).map((p) => p.pid);
    expect(roots).to.deep.equal([10, 12, 13]);
  });

  it("rattachement au projet : un hôte porté dans un SOUS-dossier est à ce projet ; ailleurs, étranger", () => {
    const root = path.join(os.tmpdir(), "nf-app");
    const inside = info(20, 1, "held");
    const outside = info(21, 1, "held");
    const server = info(22, 1, "server");
    const cwds = new Map<number, string>([
      [20, path.join(root, "modules", "ai")],
      [21, path.join(os.tmpdir(), "ailleurs")],
      [22, path.join(root, "modules", "ai")],
    ]);
    const { mine, foreign } = splitByProject(
      [inside, outside, server],
      root,
      (pid) => cwds.get(pid) ?? null,
    );
    expect(mine.map((p) => p.pid)).to.deep.equal([20]);
    expect(foreign.map((p) => p.pid)).to.deep.equal([21, 22]);
  });

  it("hostProjects : un hôte porté ne compte pas comme racine de projet (son parent la porte)", () => {
    const sup = info(30, 1, "supervisor");
    const held = info(31, 30, "held");
    const cwds = new Map([
      [30, "/app"],
      [31, "/app/modules/ai"],
    ]);
    expect(
      hostProjects([sup, held], (pid) => cwds.get(pid) ?? null),
    ).to.deep.equal([path.resolve("/app")]);
  });
});
