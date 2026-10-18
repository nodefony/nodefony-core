/**
 * `doctor` juge l'application VISÉE avec SON environnement (#62).
 *
 * Le défaut réparé : le binaire charge le `.env` du dossier où la commande a
 * été tapée dans `process.env`, avant tout. Or le diagnostic peut viser une
 * AUTRE application — `check --cwd`, `check` lancé depuis un sous-dossier, le
 * rapport de fin de `create app` lancé depuis un projet existant. La sonde de
 * ports lisait alors `NF_PORT` dans l'environnement du processus : celui d'un
 * voisin. Vécu au banc : le serveur du dépôt tenait 5151, l'application témoin
 * tournait ailleurs, et la vérification rendait rouge sur un manquement qui
 * n'appartenait pas à l'application jugée.
 *
 * Le décor rejoue exactement ce chemin : `loadEnv` sur un projet A (comme le
 * binaire), puis `collectDoctorReport` sur un projet B.
 */
import { afterEach, describe, it } from "vitest";
import { assert } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";

import { collectDoctorReport } from "../kernel/checks/runDoctor";
import { appEnvironment } from "../kernel/checks/projectScope";
import { loadEnv } from "../runtime/loadEnv";

const VARS = [
  "NF_PORT",
  "NF_PORT_HTTPS",
  "NF_DEV_PORTS",
  "NF_DATABASE_URL",
  "DOCTOR62_SHELL_MARKER",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of VARS) saved[k] = process.env[k];

const dirs: string[] = [];
const servers: net.Server[] = [];

afterEach(async () => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))),
  );
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un serveur TCP qui TIENT un port libre — le « voisin ». */
async function holdPort(): Promise<number> {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as net.AddressInfo).port;
}

/** Un port libre à l'instant de l'appel. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((r) => server.close(() => r(null)));
  return port;
}

/** Une application minimale : manifeste (politique de ports) + `.env`. */
function app(
  prefix: string,
  dotenv: string,
  manifest = "export default {};",
): string {
  const dir = mkdtempSync(path.join(tmpdir(), `nf-${prefix}-`));
  dirs.push(dir);
  // `findProjectRoot` exige les DEUX fichiers ; sans eux, la famille « Prêt à
  // démarrer » sort « hors projet » et les assertions ne mesurent rien.
  writeFileSync(path.join(dir, "package.json"), `{ "name": "${prefix}" }`);
  writeFileSync(path.join(dir, "nodefony.config.ts"), manifest);
  writeFileSync(path.join(dir, ".env"), dotenv);
  return dir;
}

describe("doctor — l'environnement de l'application VISÉE (#62)", () => {
  it("sonde les ports déclarés par le .env de l'application, pas les ports par défaut", async () => {
    for (const k of VARS) delete process.env[k];
    const [http, https] = [await freePort(), await freePort()];
    const target = app("cible", `NF_PORT=${http}\nNF_PORT_HTTPS=${https}\n`);

    const report = await collectDoctorReport(target);

    assert.deepStrictEqual(report.readiness.portsProbed, [http, https]);
  });

  it("un voisin qui tient SES ports ne rend pas rouge une application qui écoute ailleurs", async () => {
    for (const k of VARS) delete process.env[k];
    // Le voisin : un projet dont le `.env` déclare un port que son serveur tient,
    // chargé par le binaire comme s'il avait été lancé dans son dossier.
    const held = await holdPort();
    const neighbour = app("voisin", `NF_PORT=${held}\n`);
    loadEnv({ cwd: neighbour });
    assert.strictEqual(
      process.env.NF_PORT,
      String(held),
      "décor : le .env voisin est chargé",
    );

    // La cible : politique STRICTE, donc un port tenu SERAIT un manquement.
    const [http, https] = [await freePort(), await freePort()];
    const target = app(
      "cible",
      `NF_PORT=${http}\nNF_PORT_HTTPS=${https}\n`,
      `export default { servers: { portPolicy: "strict" } };`,
    );

    const report = await collectDoctorReport(target);

    assert.deepStrictEqual(report.readiness.portsProbed, [http, https]);
    assert.deepStrictEqual(
      report.readiness.findings.filter((f) => f.kind === "port-busy"),
      [],
    );
  });

  it("ce que le SHELL a posé passe toujours, ce que le .env voisin a posé non", () => {
    for (const k of VARS) delete process.env[k];
    const neighbour = app("voisin", "NF_DATABASE_URL=postgres://voisin/db\n");
    loadEnv({ cwd: neighbour });
    process.env.DOCTOR62_SHELL_MARKER = "shell";
    const target = app("cible", "NF_DATABASE_URL=postgres://cible/db\n");

    const env = appEnvironment(target);

    assert.strictEqual(env.NF_DATABASE_URL, "postgres://cible/db");
    assert.strictEqual(env.DOCTOR62_SHELL_MARKER, "shell");
  });
});
