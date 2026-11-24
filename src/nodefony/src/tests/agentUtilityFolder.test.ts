/**
 * #882 — AGENTS.md envoie le code sans générateur (fonctions pures, protocole
 * d'un appareil) dans `nodefony/src/`, en promettant qu'il n'y a « rien à
 * déclarer ». La promesse tient à deux réglages du gabarit d'application : le
 * motif d'inclusion du tsconfig et le motif d'entrée par défaut du bundler. Un
 * seul des deux rétréci, et le dossier conseillé compile sans être bâti — ou
 * l'inverse.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodefonyInput } from "../bundler/index";

const APP_TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/app",
);
const UTILITY = "nodefony/src/wol.ts";

describe("le dossier des utilitaires prescrit par AGENTS.md est bâti sans réglage (#882)", () => {
  it("AGENTS.md nomme `nodefony/src/` pour le code sans générateur", () => {
    const guide = readFileSync(
      path.join(APP_TEMPLATES, "agent-instructions", "AGENTS.md.tpl"),
      "utf8",
    );
    expect(guide).toContain("(fonctions pures) → `nodefony/src/`");
  });

  it("le tsconfig du gabarit type ce dossier", () => {
    const tsconfig = readFileSync(
      path.join(APP_TEMPLATES, "base", "tsconfig.json.tpl"),
      "utf8",
    );
    const included = [...tsconfig.matchAll(/"([^"]+\*[^"]*)"/gu)].map(
      (m) => m[1] ?? "",
    );
    expect(included.some((glob) => path.matchesGlob(UTILITY, glob))).toBe(true);
  });

  it("le bundler, avec ses motifs PAR DÉFAUT, en fait une entrée", () => {
    const input = nodefonyInput(undefined, {
      glob: (pattern) =>
        [UTILITY].filter((file) => path.matchesGlob(file, pattern)),
    });
    expect(input["nodefony/src/wol"]).toBe(`./${UTILITY}`);
  });

  it("le gabarit ne restreint pas ces motifs (témoin)", () => {
    const config = readFileSync(
      path.join(APP_TEMPLATES, "base", "rolldown.config.ts.tpl"),
      "utf8",
    );
    expect(config).not.toMatch(/globPatterns|input\s*:/u);
  });
});
