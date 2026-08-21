/*
 *   Une sortie volumineuse ne doit pas être TRONQUÉE par la sortie du process.
 *
 *   Le défaut gravé ici : `process.exit()` part sans attendre le vidage de
 *   `stdout`. Vers un fichier ou un terminal l'écriture est synchrone et rien
 *   ne se voit ; vers un TUYAU elle ne l'est pas, et tout ce qui dépasse le
 *   tampon du système (64 Ko) est perdu — silencieusement.
 *
 *   Mesuré sur `nodefony inspect routes --json` : 97 825 octets vers un
 *   fichier, très exactement 65 536 vers un `| jq`, qui casse alors sur un
 *   JSON incomplet. C'était l'usage que le TSDoc de la commande DOCUMENTE.
 *
 *   Le test écrit vers un TUYAU (`stdio: "pipe"`), seule condition où le
 *   défaut existe : le reproduire vers un fichier rendrait un vert qui ne
 *   prouve rien.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIST = path.resolve(ICI, "../../dist/node/Cli.js");

/** Nettement au-dessus du tampon de tuyau (64 Ko) : le défaut ne se voit qu'au-delà. */
const OCTETS = 200_000;

/**
 * Écrit `OCTETS` caractères sur la sortie standard, puis quitte par le point de
 * sortie du framework — celui qu'emprunte toute commande.
 */
const ENFANT = `
  const { default: Cli } = await import(process.argv[1]);
  process.stdout.write("x".repeat(${OCTETS}));
  Cli.quit(0);
`;

describe("sortie du process — vidage avant exit", () => {
  it("n'ampute pas une sortie volumineuse écrite vers un tuyau", () => {
    const run = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", ENFANT, pathToFileURL(CLI_DIST).href],
      { encoding: "utf8", stdio: "pipe", timeout: 20_000 },
    );

    expect(run.error, `spawn : ${run.error?.message}`).toBeUndefined();
    // L'assertion qui MORD : avec `process.exit()` nu, on reçoit exactement
    // 65 536 octets. Comparer à la taille attendue, jamais à « non vide ».
    expect(run.stdout.length).toBe(OCTETS);
  });
});
