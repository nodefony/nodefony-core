import { describe, it, expect } from "vitest";
import { assertNoConflictingRuntime } from "../kernel/commands/runtimeLauncher";
import { SysExit } from "../cli/sysexits";
import type { DevProcessInfo, PortState } from "../service/dev/devProcess";
import type { Severity } from "../syslog/Pdu";

/**
 * Un superviseur de développement observé par `ps` — le process qui, orphelin,
 * interdisait tout démarrage `production` alors qu'il ne détenait aucun port.
 */
const supervisor = (pid = 4242): DevProcessInfo => ({
  pid,
  ppid: 1,
  mode: "dev",
  role: "supervisor",
  label: "supervisor",
  rssKb: 67_000,
  cpu: 0,
  uptimeSec: 4_740,
});

/** Sonde de ports factice : `held` = les ports que quelqu'un tient réellement. */
const probeHolding =
  (held: readonly number[]) =>
  async (ports: readonly number[]): Promise<PortState[]> =>
    ports.map((port) => ({ port, listening: held.includes(port) }));

interface Run {
  exits: number[];
  logs: { msg: string; sev: Severity }[];
}

async function runGuard(
  held: readonly number[],
  procs: DevProcessInfo[] = [supervisor()],
): Promise<Run> {
  const cwd = process.cwd();
  const out: Run = { exits: [], logs: [] };
  await assertNoConflictingRuntime(
    "prod",
    (msg: string, sev?: Severity) => {
      out.logs.push({ msg, sev: sev ?? "INFO" });
    },
    {
      cwd,
      discover: () => procs,
      getCwd: () => cwd,
      probe: probeHolding(held),
      exit: (code: number) => {
        out.exits.push(code);
      },
    },
  );
  return out;
}

describe("garde anti-collision runtime — la collision se CONSTATE", () => {
  it("un runtime dev enregistré qui ne tient AUCUN port ne bloque pas la production", async () => {
    const { exits, logs } = await runGuard([]);

    // Le cœur du défaut : le démarrage doit se poursuivre.
    expect(exits).toEqual([]);

    // …et le résidu doit être NOMMÉ, sinon le fantôme reste invisible.
    expect(logs).toHaveLength(1);
    expect(logs[0]?.sev).toBe("WARNING");
    expect(logs[0]?.msg).toContain("AUCUN port");
    expect(logs[0]?.msg).toContain("MAINTENU");
    expect(logs[0]?.msg).toContain("4242");
  });

  it("un runtime dev qui TIENT un port refuse la production, et nomme le port", async () => {
    const { exits, logs } = await runGuard([5151]);

    expect(exits).toEqual([SysExit.UNAVAILABLE]);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.sev).toBe("CRITIC");
    expect(logs[0]?.msg).toContain("5151");
    expect(logs[0]?.msg).toContain("refusé");
  });

  it("aucun runtime concurrent : ni log, ni refus", async () => {
    const { exits, logs } = await runGuard([5151], []);
    expect(exits).toEqual([]);
    expect(logs).toEqual([]);
  });
});
