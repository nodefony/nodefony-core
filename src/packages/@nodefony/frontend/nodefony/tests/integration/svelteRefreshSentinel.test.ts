/**
 * SENTINELLE — Svelte PARTAGE l'instance Vite de React
 * (`isolationGroups.ts#isolationGroup`, famille `default`) ; ce test garde
 * que ce partage reste sans dommage.
 *
 * `@vitejs/plugin-react` pose `oxc.jsx.refresh: true` en GLOBAL. Vite le
 * neutralise sur tout fichier qui n'est pas du JSX, mais un greffon qui
 * appelle `transformWithOxc` avec la config brute, ou qui sert un bloc de
 * script sous un identifiant en `.ts`, le laisserait passer : c'est le défaut
 * qui oblige à isoler Vue (sentinelle `vueRefreshSentinel.test.ts`,
 * vitejs/vite-plugin-vue#798). `@sveltejs/vite-plugin-svelte` n'est pas
 * concerné aujourd'hui — constaté, et désormais gardé.
 *
 * Ce test est VERT TANT QUE SVELTE N'EST PAS ATTEINT. Le jour où il rougit,
 * un composant Svelte servi avec React meurt sur
 * `ReferenceError: $RefreshSig$ is not defined` : isoler Svelte (cas
 * `svelte5` dans `isolationGroup`) avant toute autre chose.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/svelte-refresh-sentinel",
);

/** L'APPEL injecté par le rafraîchissement React — pas une simple mention. */
const INJECTED = /\$RefreshSig\$\(\)/;

/**
 * Code servi au navigateur pour chaque fichier, sous Svelte ET React dans la
 * même instance — la composition réelle de la famille `default`.
 */
async function served(files: readonly string[]): Promise<string[]> {
  const { createServer } = await import("vite");
  const { svelte } = await import("@sveltejs/vite-plugin-svelte");
  const react = (await import("@vitejs/plugin-react")).default;
  // HMR ACTIF : le greffon React n'arme son Fast Refresh que sous `serve` avec
  // HMR — `hmr: false` rendrait la sentinelle verte pour une mauvaise raison.
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    plugins: [react(), svelte()],
    server: { middlewareMode: true, watch: null },
  });
  try {
    const out: string[] = [];
    for (const file of files) {
      const result = await server.transformRequest(file);
      out.push(result?.code ?? "");
    }
    return out;
  } finally {
    await server.close();
  }
}

describe("SENTINELLE Svelte + React — Svelte peut partager l'instance de React", () => {
  it("Svelte + React : le TypeScript du composant Svelte ne reçoit jamais `$RefreshSig$`, quand un composant React de la même instance le reçoit", async () => {
    const [react, svelte] = await served([
      "/Hooked.tsx",
      "/HookInScript.svelte",
    ]);
    // Témoin : le rafraîchissement React est ARMÉ dans cette instance, et le
    // détecteur le voit. Sans lui, un vert sur Svelte ne prouverait rien.
    expect(react, "témoin : React doit recevoir sa signature").toMatch(
      INJECTED,
    );
    expect(svelte, "le composant Svelte doit avoir été servi").toContain(
      "svelte",
    );
    expect(
      svelte,
      "Svelte reçoit le rafraîchissement React : isoler `svelte5` dans isolationGroup",
    ).not.toMatch(INJECTED);
  });
});
