/**
 * Unit — toute page que la console sert est reconnue comme OUTILLAGE par la
 * règle du cœur (`isConsolePath`), celle qui la masque dans la barre de
 * débogage, les Journaux et le profileur. La règle liste les pages profondes ;
 * ce test lit les replis déclarés par `StudioController` pour qu'une page
 * ajoutée ne s'échappe pas en silence vers « l'application ».
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isConsolePath } from "nodefony";

const controller = fs.readFileSync(
  path.join(import.meta.dirname, "../../controller/StudioController.ts"),
  "utf8",
);

/** Les chemins des replis SPA (`@Get("…", { fallback: true })`), variables remplies. */
const fallbacks = [
  ...controller.matchAll(/@Get\("([^"]+)",\s*\{\s*fallback:\s*true/g),
].map((m) => `/nodefony${(m[1] ?? "").replace(/\{[^}]+\}/g, "x1")}`);

describe("isConsolePath — les pages de la console", () => {
  it("le contrôleur déclare bien des replis (le relevé n'est pas vide)", () => {
    expect(fallbacks.length).toBeGreaterThan(3);
  });

  it("🔴 chaque page servie par un repli de la console est de l'outillage", () => {
    for (const p of fallbacks) expect(isConsolePath(p), p).toBe(true);
  });

  it("une route d'application et une connexion d'utilisateur n'en sont pas", () => {
    expect(isConsolePath("/nodefony/test/index")).toBe(false);
    // Vécu : le flux SSE de la vitrine Vue, masqué comme « données de la console ».
    expect(isConsolePath("/nodefony/test/api/syslog")).toBe(false);
    expect(isConsolePath("/nodefony/test/sse/stream")).toBe(false);
    expect(isConsolePath("/nodefony/testeur/api/x")).toBe(true);
    expect(isConsolePath("/nodefony/security/api/auth/login")).toBe(false);
  });
});
