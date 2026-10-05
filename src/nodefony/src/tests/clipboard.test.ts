/**
 * Le presse-papiers du plein écran (`service/dev/clipboard.ts`) : la route
 * se choisit sur le contexte, chaque outil est ESSAYÉ, et « copié » n'est dit
 * que sur une preuve.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  OSC52_MAX_BYTES,
  chooseClipboardRoutes,
  copyToClipboard,
  describeCopy,
  osc52Sequence,
  type ClipboardRoute,
  type ClipboardSpawn,
  type IClipboardChild,
} from "../service/dev/clipboard";

const labels = (routes: readonly ClipboardRoute[]): string[] =>
  routes.map((r) => (r.kind === "osc52" ? "osc52" : r.label));

/** Ce que fait chaque outil factice. */
type Behavior = "ok" | "absent" | "fails" | "hangs";

/** Un `spawn` factice : chaque commande suit son comportement, les appels sont notés. */
function fakeSpawn(behaviors: Record<string, Behavior>) {
  const calls: Array<{
    command: string;
    args: readonly string[];
    input: string;
  }> = [];
  let killed = 0;
  const spawn: ClipboardSpawn = (command, args) => {
    const child = new EventEmitter() as EventEmitter & IClipboardChild;
    const call = { command, args, input: "" };
    calls.push(call);
    const behavior = behaviors[command] ?? "absent";
    Object.assign(child, {
      stdin: {
        on: () => {},
        end: (chunk: string) => {
          call.input = chunk;
        },
      },
      kill: () => {
        killed++;
      },
    });
    setImmediate(() => {
      if (behavior === "absent") {
        child.emit(
          "error",
          Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
        );
      } else if (behavior === "ok") child.emit("close", 0);
      else if (behavior === "fails") child.emit("close", 1);
    });
    return child;
  };
  return { spawn, calls, killed: () => killed };
}

describe("presse-papiers — la route se choisit sur le CONTEXTE", () => {
  it("session distante : OSC 52 d'abord, et aucun outil local (il copierait sur la mauvaise machine)", () => {
    for (const key of ["SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT"]) {
      expect(
        labels(chooseClipboardRoutes({ [key]: "x", DISPLAY: ":0" })),
        key,
      ).to.deep.equal(["osc52"]);
    }
  });

  it("tmux : son tampon AVANT les outils locaux ; tmux sous SSH : tmux puis OSC 52", () => {
    expect(labels(chooseClipboardRoutes({ TMUX: "x" }))[0]).to.equal(
      "tampon tmux",
    );
    expect(
      labels(chooseClipboardRoutes({ TMUX: "x", SSH_TTY: "/dev/pts/1" })),
    ).to.deep.equal(["tampon tmux", "osc52"]);
  });

  it("poste : pbcopy, Wayland puis X11 s'ils sont là, PowerShell, OSC 52 en dernier", () => {
    expect(labels(chooseClipboardRoutes({}))).to.deep.equal([
      "pbcopy",
      "PowerShell",
      "osc52",
    ]);
    expect(
      labels(
        chooseClipboardRoutes({ WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }),
      ),
    ).to.deep.equal([
      "pbcopy",
      "wl-copy",
      "xclip",
      "xsel",
      "PowerShell",
      "osc52",
    ]);
  });

  it("jamais clip.exe : il casse l'Unicode", () => {
    const routes = chooseClipboardRoutes({
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "w",
    });
    for (const r of routes) {
      if (r.kind === "command") expect(r.command).to.not.match(/clip\.exe/i);
    }
  });
});

describe("presse-papiers — chaque outil est essayé, « copié » sur preuve seulement", () => {
  const routes = chooseClipboardRoutes({ DISPLAY: ":0" });

  it("absent puis en échec : le suivant ; le premier code 0 gagne et reçoit le texte", async () => {
    const fake = fakeSpawn({ pbcopy: "absent", xclip: "fails", xsel: "ok" });
    const written: string[] = [];
    const outcome = await copyToClipboard("héllo 漢", routes, {
      spawn: fake.spawn,
      writeTerminal: (s) => written.push(s),
    });
    expect(outcome).to.deep.equal({ status: "copied", via: "xsel" });
    const xsel = fake.calls.find((c) => c.command === "xsel");
    expect(xsel?.input).to.equal("héllo 漢");
    expect(written).to.deep.equal([]); // pas d'OSC 52 après un succès
    await new Promise((r) => setImmediate(r));
    // La sélection primaire est écrite aussi, en plus du presse-papiers.
    expect(
      fake.calls.filter((c) => c.command === "xsel").map((c) => c.args[0]),
    ).to.deep.equal(["--clipboard", "--primary"]);
  });

  it("un outil qui ne rend pas la main est tué au délai, et le suivant essayé", async () => {
    const fake = fakeSpawn({ pbcopy: "hangs", xclip: "ok" });
    const outcome = await copyToClipboard("x", routes, {
      spawn: fake.spawn,
      writeTerminal: () => {},
      timeoutMs: 20,
    });
    expect(outcome).to.deep.equal({ status: "copied", via: "xclip" });
    expect(fake.killed()).to.equal(1);
  });

  it("aucun outil : OSC 52 ENVOYÉE, dite non confirmée — UTF-8 avant base64", async () => {
    const written: string[] = [];
    const outcome = await copyToClipboard("é", routes, {
      spawn: fakeSpawn({}).spawn,
      writeTerminal: (s) => written.push(s),
    });
    expect(outcome).to.deep.equal({ status: "sent" });
    expect(written).to.deep.equal([
      `\x1b]52;c;${Buffer.from("é").toString("base64")}\x07`,
    ]);
    expect(describeCopy(outcome)).to.include("non confirmé");
    expect(describeCopy(outcome)).to.not.match(/^copié/);
  });

  it("trop long pour OSC 52 : rien n'est écrit, et la barre le dit", async () => {
    const big = "x".repeat(OSC52_MAX_BYTES); // base64 : 4/3 plus long
    expect(osc52Sequence(big)).to.equal(null);
    const written: string[] = [];
    const outcome = await copyToClipboard(big, [{ kind: "osc52" }], {
      writeTerminal: (s) => written.push(s),
    });
    expect(outcome).to.deep.equal({ status: "too-long" });
    expect(written).to.deep.equal([]);
  });

  it("le message ne dit « copié » que pour un outil au code 0", () => {
    expect(describeCopy({ status: "copied", via: "pbcopy" })).to.equal(
      "copié (pbcopy)",
    );
    expect(describeCopy({ status: "failed" })).to.not.match(/^copié/);
    expect(describeCopy({ status: "too-long" })).to.not.match(/^copié/);
  });
});
