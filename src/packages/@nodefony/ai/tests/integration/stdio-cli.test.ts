import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * `nodefony ai:stdio` lancé pour de VRAI, depuis l'application de
 * développement du dépôt — comme le lance un client MCP qui démarre lui-même
 * son serveur (agent de CI, agent cloud).
 *
 * Décor : l'application BÂTIE (`dist/` des modules), AUCUN serveur. Rien ne se
 * saute : la commande ne dépend d'aucune infrastructure.
 *
 * Deux clients : un process piloté à la main, qui prouve le protocole à la
 * lettre (chaque ligne de la sortie standard, boot compris, est du JSON-RPC),
 * et le client OFFICIEL de la spec, qui prouve qu'un agent réel se connecte et
 * annule.
 */

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
);
const BIN = path.join(ROOT, "src", "nodefony", "bin", "nodefony");

interface IRun {
  code: number | null;
  lines: string[];
  stderr: string;
}

/** Lance la commande, écrit `input` sur son entrée, la ferme, attend la fin. */
function runStdio(
  input: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<IRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, "ai:stdio"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ code, lines: stdout.split("\n").filter(Boolean), stderr }),
    );
    child.stdin.end(input.map((line) => `${line}\n`).join(""));
  });
}

const message = (value: unknown): string => JSON.stringify(value);

const INITIALIZE = message({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "banc", version: "0" },
  },
});

describe("nodefony ai:stdio — le protocole à la lettre", () => {
  it("sert la porte stdio : outils listés, appel, -32700, notification muette, code 0", async () => {
    const run = await runStdio([
      INITIALIZE,
      message({ jsonrpc: "2.0", method: "notifications/initialized" }),
      message({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      "pas du json",
      message({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "nodefony_card", arguments: {} },
      }),
      // L'outil témoin écrit sur la sortie standard : sa ligne doit partir
      // sur la sortie d'erreur, jamais au milieu du protocole.
      message({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "test_noise", arguments: {} },
      }),
      // La lecture d'administration — refusée sans la posture de l'opérateur
      // local, alors que `nodefony inspect` la rend dans le même terminal.
      message({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "nodefony_inspect", arguments: { subject: "routes" } },
      }),
    ]);
    expect(run.code, run.stderr).toBe(0);

    // 🔴 Spec MCP, stdio : rien d'autre que des messages sur stdout — boot
    // compris. Une seule ligne étrangère et le client déclare l'échec.
    const parsed = run.lines.map((line) => {
      const value: unknown = JSON.parse(line);
      expect(value, line).toMatchObject({ jsonrpc: "2.0" });
      return value as Record<string, unknown>;
    });
    expect(run.stderr).toContain("test_noise — bruit sur la sortie standard");

    // La notification ne reçoit rien : 1 à 5 et le refus `-32700`.
    expect(parsed.map((m) => m.id).sort()).toEqual(
      [1, 2, 3, 4, 5, null].sort(),
    );
    expect(parsed.find((m) => m.id === null)).toMatchObject({
      error: { code: -32700 },
    });

    const list = parsed.find((m) => m.id === 2)?.result as {
      tools: { name: string }[];
    };
    const names = list.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "nodefony_card",
        "nodefony_inspect",
        "test_probe",
      ]),
    );
    // L'opérateur local n'ouvre que l'administration du framework : un outil
    // à scope APPLICATIF reste retenu — il exige un jeton.
    expect(names).not.toContain("test_probe_secret");
    // Et l'annonce ne renvoie à aucun document RFC 9728 qu'une porte stdio
    // ne publie pas.
    const handshake = parsed.find((m) => m.id === 1)?.result as
      { instructions?: string } | undefined;
    const instructions = handshake?.instructions;
    expect(instructions).toContain("porte HTTP protégée");
    expect(instructions).not.toContain("RFC 9728");

    const card = parsed.find((m) => m.id === 3);
    expect(card).toMatchObject({
      result: { content: [{ type: "text" }] },
    });
    expect(card?.result).not.toMatchObject({ isError: true });

    const routes = parsed.find((m) => m.id === 5);
    expect(routes, JSON.stringify(routes)).toMatchObject({
      result: { content: [{ type: "text" }] },
    });
    expect(routes?.result).not.toMatchObject({ isError: true });
  }, 60_000);

  it("les outils de MESURE disent qu'il n'y a pas de trafic ici", async () => {
    const run = await runStdio([
      message({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "nodefony_observe", arguments: { durationSec: 1 } },
      }),
    ]);
    expect(run.code, run.stderr).toBe(0);
    const reply = JSON.parse(run.lines[0] ?? "null") as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]?.text).toContain("nodefony ai:stdio");
  }, 60_000);

  it("hors développement : servie, avec les seuls outils des modules chargés", async () => {
    const run = await runStdio(
      [message({ jsonrpc: "2.0", id: 1, method: "tools/list" })],
      // La CI pose `NF_WITH_DEV_MODULES=1` pour son serveur : hérité, il
      // rechargerait devkit et `test` en production et le cas ne prouverait rien.
      { NODE_ENV: "production", NF_WITH_DEV_MODULES: undefined },
    );
    expect(run.code, run.stderr).toBe(0);
    const reply = JSON.parse(run.lines[0] ?? "null") as {
      result: { tools: { name: string }[] };
    };
    // devkit et le module `test` n'existent qu'en développement.
    expect(
      reply.result.tools.filter(
        (t) => t.name.startsWith("nodefony_") || t.name.startsWith("test_"),
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("nodefony ai:stdio — le client officiel du SDK", () => {
  it("se connecte, liste, appelle, et annule un outil long", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, "ai:stdio"],
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development" } as Record<
        string,
        string
      >,
      stderr: "pipe",
    });
    const client = new Client({ name: "banc-stdio", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("test_progress");

      const probe = await client.callTool({
        name: "test_probe",
        arguments: { message: "bonjour" },
      });
      expect(JSON.stringify(probe.content)).toContain("bonjour");

      // Le SDK annule par `notifications/cancelled` : c'est LA voie stdio.
      const abort = new AbortController();
      const call = client.callTool(
        { name: "test_progress", arguments: { steps: 30, delayMs: 100 } },
        undefined,
        {
          signal: abort.signal,
          onprogress: () => abort.abort("assez"),
        },
      );
      await expect(call).rejects.toThrow();
      // Le temps que la notification traverse et que l'outil constate.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const last = await client.callTool({
        name: "test_progress_last",
        arguments: {},
      });
      const state = JSON.parse(
        (last.content as { text: string }[])[0]?.text ?? "null",
      ) as { aborted: boolean; done: number };
      expect(state.aborted).toBe(true);
      expect(state.done).toBeLessThan(30);
    } finally {
      await client.close();
    }
  }, 60_000);
});
