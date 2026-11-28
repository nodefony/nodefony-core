import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, it, vi } from "vitest";
import CliKernel from "../kernel/CliKernel";
import { findPromptCommand } from "../service/dev/promptAction";
import type { IReadStateContext } from "../command/readState";
import type { IAdminApi, IAdminEndpoint } from "../types/IAdminApi";
import type { RpcPart } from "../realtime/JsonRpcPeer";

const ROUTES = [
  { path: "/a", name: "route-a", methods: ["GET"] },
  { path: "/b", name: "route-b", methods: ["POST"] },
  // Plus large que l'onglet : sans la largeur reçue, le tableau déborde.
  {
    path: "/une/route/au/chemin/assez/long/pour/deborder/de/soixante/colonnes",
    name: "route-au-nom-lui-aussi-tres-long-pour-forcer-le-repli",
    methods: ["GET", "POST"],
  },
];

/** Le producteur `framework/routes` réduit à ce que la lecture en attend. */
const routesApi: IAdminApi = {
  adminNamespace: "framework",
  adminDescriptor: () => ({ label: "framework" }),
  adminEndpoints: (): IAdminEndpoint[] => [
    { path: "routes", method: "GET", handler: () => ROUTES },
  ],
};

/**
 * L'instance `inspect` telle que le serveur vivant la tient : son noyau porte
 * le plan d'administration (`adminBroker`).
 */
function inspectOnServer() {
  const cli = new CliKernel("development");
  // Le noyau du serveur, réduit à ce que la commande lit — posé AVANT
  // l'enregistrement, comme `CliKernel.start` le fait.
  cli.container?.set("kernel", {
    environment: "development",
    isTTY: false,
    container: {
      get: (name: string) =>
        name === "adminBroker" ? { list: () => [routesApi] } : undefined,
    },
  });
  cli.registerBuiltinCommands();
  const inspect = cli.getCommand("inspect");
  assert.ok(inspect?.readState !== undefined);
  return { inspect, readState: inspect.readState.bind(inspect) };
}

const ctx = (columns = 80): IReadStateContext => ({
  columns,
  signal: new AbortController().signal,
  progress: () => false,
});

const texts = (parts: readonly RpcPart[]) =>
  parts.map((p) => ("text" in p ? p.text : ""));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nodefony inspect en direct — le plan d'administration du SERVEUR vivant", () => {
  it("rendu humain : un tableau borné à la largeur de l'onglet, le mode à côté du total", async () => {
    const { readState } = inspectOnServer();
    const result = await readState(["routes"], ctx(60));
    assert.ok(result !== null);
    assert.equal(result.code, 0);
    assert.equal(result.parts.length, 1);
    const part = result.parts[0];
    assert.ok(part !== undefined && "text" in part && !("mediaType" in part));
    assert.match(part.text, /^  \/a$/m);
    assert.match(part.text, /3 routes \(environnement : development\)/);
    const over = part.text
      .split("\n")
      .map(stripVTControlCharacters)
      .filter((l) => l.length > 59);
    assert.deepEqual(over, []);
  });

  it("--json : le contexte dans sa part, la donnée seule et typée JSON", async () => {
    const { readState } = inspectOnServer();
    const result = await readState(["routes", "--json"], ctx());
    assert.ok(result !== null);
    assert.equal(result.code, 0);
    const [context, data] = result.parts;
    assert.ok(context !== undefined && "text" in context);
    assert.equal(context.text, "environnement : development\n");
    assert.ok(data !== undefined && "text" in data);
    assert.equal(data.mediaType, "application/json");
    assert.deepEqual(JSON.parse(data.text), ROUTES);
  });

  it("une lecture qui échoue rend son code sysexits et le message, la forme d'appel comprise", async () => {
    const { readState } = inspectOnServer();
    const unknown = await readState(["nope"], ctx());
    assert.equal(unknown?.code, 64);
    const missing = await readState(["module"], ctx());
    assert.equal(missing?.code, 64);
    assert.match(
      texts(missing?.parts ?? []).join(""),
      /nodefony inspect module <name>/,
    );
    // Un échec n'est jamais typé JSON, même demandé en --json.
    const failedJson = await readState(["module", "--json"], ctx());
    assert.ok(failedJson !== null);
    assert.ok(failedJson.parts.every((p) => !("mediaType" in p)));
  });

  it("sans sujet, l'aide, une option inconnue ou un argument de trop : sous-processus", async () => {
    const { readState } = inspectOnServer();
    for (const args of [
      [],
      ["--json"],
      ["--help"],
      ["-h"],
      ["routes", "--nope"],
      ["routes", "auth", "de-trop"],
    ]) {
      assert.equal(await readState(args, ctx()), null, args.join(" "));
    }
  });

  it("readState ne touche ni la sortie standard, ni le code de sortie, ni terminate", async () => {
    const { inspect, readState } = inspectOnServer();
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    const terminate = vi.spyOn(inspect, "terminate");
    const exitCode = process.exitCode;
    await readState(["routes"], ctx());
    await readState(["routes", "--json"], ctx());
    await readState(["nope"], ctx());
    assert.equal(stdout.mock.calls.length, 0);
    assert.equal(stderr.mock.calls.length, 0);
    assert.equal(terminate.mock.calls.length, 0);
    assert.equal(process.exitCode, exitCode);
  });

  it("un producteur : la CLI écrit exactement les parts que l'invite reçoit", async () => {
    const { inspect, readState } = inspectOnServer();
    const live = await readState(["routes", "--json"], ctx());
    assert.ok(live !== null);
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
    const codes: number[] = [];
    vi.spyOn(inspect, "terminate").mockImplementation(async (code) => {
      codes.push(Number(code));
    });
    await inspect.generate("routes", undefined, { json: true });
    assert.deepEqual([...err, ...out], texts(live.parts));
    assert.deepEqual(codes, [live.code]);
  });

  it("CLI : un échec part au journal en ERROR, jamais sur la sortie standard", async () => {
    const { inspect } = inspectOnServer();
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    // Le vrai journal : seul ce qu'il reçoit compte, pas où il l'écrit.
    const log = vi.spyOn(inspect, "log");
    const codes: number[] = [];
    vi.spyOn(inspect, "terminate").mockImplementation(async (code) => {
      codes.push(Number(code));
    });
    await inspect.generate("module", undefined, {});
    assert.equal(stdout.mock.calls.length, 0);
    assert.ok(
      log.mock.calls.some(
        ([msg, severity]) =>
          severity === "ERROR" &&
          String(msg).includes("nodefony inspect module <name>"),
      ),
      JSON.stringify(log.mock.calls),
    );
    assert.deepEqual(codes, [64]);
  });

  it("le manifeste publie le besoin de l'application : un serveur en crash ne la rebootera pas", () => {
    const cli = new CliKernel("development");
    cli.registerBuiltinCommands();
    const manifest = cli.buildBuiltinManifest();
    assert.equal(
      findPromptCommand(manifest, "inspect")?.prompt,
      "requires-app",
    );
    // Les commandes qui répondent SANS l'application ne déclarent rien.
    for (const name of ["env", "doctor", "card"]) {
      assert.equal(findPromptCommand(manifest, name)?.prompt, undefined, name);
    }
  });
});
