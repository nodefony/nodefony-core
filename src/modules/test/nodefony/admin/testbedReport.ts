import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Ce que l'onglet Décors exige sous la racine de l'application. Chemins qu'on
 * OUVRE : composés par `join`, jamais écrits en `/`.
 */
const REQUIRED: ReadonlyArray<readonly string[]> = [
  ["scripts", "test", "testbed-report.ts"],
  ["docker", "docker-compose.yml"],
  ["node_modules", "tsx", "dist", "cli.mjs"],
];

/** Plafond de la sortie du constat : au-delà, ce n'est plus un rapport. */
const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Verdict de capacité : l'onglet existe-t-il sur cette installation ? */
export type TestbedCapability =
  { supported: true } | { supported: false; reason: string };

/**
 * Constate que l'application tourne DANS le dépôt du framework.
 *
 * La capacité se constate, elle ne se déduit pas : ni `process.platform`, ni
 * un nom de paquet. Le script de constat, le compose et `tsx` vivent dans le
 * dépôt et nulle part ailleurs — une application générée n'a aucun des trois.
 *
 * @param root - racine de l'application (`kernel.path`), `null` si inconnue
 * @returns `supported: false` avec la raison, au premier fichier absent
 */
export async function probeTestbedCapability(
  root: string | null,
): Promise<TestbedCapability> {
  if (!root) {
    return { supported: false, reason: "racine de l'application inconnue" };
  }
  for (const parts of REQUIRED) {
    try {
      await access(join(root, ...parts));
    } catch {
      return {
        supported: false,
        reason: `hors du dépôt du framework : ${parts.join("/")} absent`,
      };
    }
  }
  return { supported: true };
}

/**
 * Lecteur du constat des décors, à un seul vol : deux rechargements simultanés
 * partagent le même process au lieu d'en lancer deux.
 *
 * @returns `read(root)` — le rapport JSON de `scripts/test/testbed-report.ts`, ou
 *   le verdict `supported: false` hors du dépôt
 */
export function createTestbedReader(): {
  read: (root: string | null) => Promise<unknown>;
} {
  let inFlight: Promise<unknown> | null = null;
  return {
    read(root) {
      inFlight ??= run(root).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

async function run(root: string | null): Promise<unknown> {
  const capability = await probeTestbedCapability(root);
  if (!capability.supported || !root) return capability;
  const output = await new Promise<string>((resolve, reject) => {
    // Process séparé : le serveur n'embarque ni les configs vitest ni
    // l'outillage du dépôt. L'environnement du SERVEUR est hérité — c'est lui
    // que le constat juge (variables du versant serveur, interrupteurs).
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        join(root, "scripts", "test", "testbed-report.ts"),
      ],
      // stderr IGNORÉ : il porte des piles et des chemins absolus du poste, qui
      // n'ont rien à faire dans une réponse du plan d'administration. Le
      // diagnostic se rejoue à la main, même commande.
      { cwd: root, env: process.env, stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    const failure = new Error(
      "constat des décors en échec — le rejouer : npx tsx scripts/test/testbed-report.ts",
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(failure);
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) child.kill();
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(failure);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.length <= MAX_OUTPUT) resolve(stdout);
      else reject(failure);
    });
  });
  return JSON.parse(output);
}
