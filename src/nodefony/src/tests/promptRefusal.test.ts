import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import CliKernel from "../kernel/CliKernel";
import {
  findPromptCommand,
  isPromptCommand,
} from "../service/dev/promptAction";

/**
 * 🔴 Une commande de cycle de vie lancée depuis l'invite tue le superviseur
 * qui la lance, ou lui dispute ses ports.
 *
 * Le refus se DÉCLARE (`prompt: "refuse"`) et voyage avec la commande jusqu'au
 * manifeste que lit l'invite. Une liste tenue à part par l'invite oubliait
 * `frontend:dev`, `ai:stdio` et `test:daemon` : elle ne connaissait pas les
 * commandes des modules. Ce gate dérive l'obligation des champs de cycle de
 * vie — `servesTraffic`, `lifetime: "longrunning"`, `runProfile.servers` —
 * sur les DEUX populations, comme `commandDescriptions.test.ts` : les
 * intégrées par leur instance et le manifeste qu'elles publient, celles des
 * modules par leur source.
 *
 * Une commande peut refuser sans être de cycle de vie (`menu` prend le
 * terminal, `ai:stdio` lit un protocole sur son entrée) : l'obligation est
 * nécessaire, pas suffisante.
 */

/** Racine du dépôt — `src/nodefony/src/tests` → quatre crans plus haut. */
const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Les champs qui disent « cette commande tient un runtime », dans une source. */
const LIFECYCLE =
  /^\s*(?:servesTraffic:\s*true|lifetime:\s*"longrunning"|servers:\s*true)\s*,?\s*$/m;

/** La déclaration du refus, dans une source. */
const REFUSE = /^\s*prompt:\s*"refuse"\s*,?\s*$/m;

/** Le nom d'une commande, lu dans son `super(nom, …)`. */
const SUPER_NAME = /super\(\s*(?:"([^"]+)"|`([^`$]+)`)/;

/** Les fichiers de commande des modules (`nodefony/command/`), parcourus en `fs`. */
function commandFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      commandFiles(full, acc);
    } else if (
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".test.ts") &&
      !e.name.endsWith(".d.ts") &&
      full.includes(path.join("nodefony", "command") + path.sep)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe("refus de l'invite — déclaré par la commande, publié au manifeste", () => {
  const cli = new CliKernel("development");
  cli.registerBuiltinCommands();
  const manifest = cli.buildBuiltinManifest();

  it("toute intégrée de cycle de vie déclare le refus, et le manifeste le publie", () => {
    const instances = manifest.commands
      .map((c) => cli.getCommand(c.name))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    expect(instances.length).toBeGreaterThan(20);
    const lifecycle = instances.filter(
      (c) =>
        c.servesTraffic ||
        c.lifetime === "longrunning" ||
        c.runProfile?.servers === true,
    );
    // Population amputée = faux vert.
    expect(lifecycle.length).toBeGreaterThanOrEqual(3);
    const faults = lifecycle
      .filter((c) => findPromptCommand(manifest, c.name)?.prompt !== "refuse")
      .map((c) => c.name)
      .sort();
    expect(faults, `sans prompt: "refuse" : ${faults.join(", ")}`).toEqual([]);
  });

  it("le refus porte sur ce que l'on tape : nom ET alias", () => {
    for (const typed of [
      "development",
      "dev",
      "debug",
      "production",
      "prod",
      "start",
      "cluster",
      "stop",
      "menu",
    ]) {
      const command = findPromptCommand(manifest, typed);
      expect(command?.prompt, typed).to.equal("refuse");
      expect(isPromptCommand(command!), typed).to.equal(false);
    }
    const build = findPromptCommand(manifest, "build");
    expect(build?.prompt).to.equal(undefined);
    expect(isPromptCommand(build!)).to.equal(true);
  });

  it("toute commande de module de cycle de vie déclare le refus", () => {
    const roots = [
      path.join(REPO, "src", "packages"),
      path.join(REPO, "src", "modules"),
    ];
    const read = roots
      .flatMap((r) => commandFiles(r))
      .map((file) => ({ file, code: fs.readFileSync(file, "utf8") }));
    expect(read.length).toBeGreaterThan(18);
    const lifecycle = read.filter((r) => LIFECYCLE.test(r.code));
    // `test:daemon` au moins : sans lui, le motif a cessé de mordre.
    expect(lifecycle.length).toBeGreaterThanOrEqual(1);
    const faults = lifecycle
      .filter((r) => !REFUSE.test(r.code))
      .map((r) => {
        const m = SUPER_NAME.exec(r.code);
        return `${m?.[1] ?? m?.[2] ?? "?"} (${path.relative(REPO, r.file)})`;
      })
      .sort();
    expect(faults, `sans prompt: "refuse" : ${faults.join(", ")}`).toEqual([]);
  });

  it("les trois commandes que la liste écrite à la main oubliait refusent", () => {
    const refusing = (rel: string): boolean =>
      REFUSE.test(fs.readFileSync(path.join(REPO, ...rel.split("/")), "utf8"));
    expect(
      refusing(
        "src/packages/@nodefony/frontend/nodefony/command/frontend-dev.ts",
      ),
    ).to.equal(true);
    expect(
      refusing("src/packages/@nodefony/ai/nodefony/command/StdioCommand.ts"),
    ).to.equal(true);
    expect(
      refusing("src/modules/test/nodefony/command/DaemonTestCommand.ts"),
    ).to.equal(true);
  });
});
