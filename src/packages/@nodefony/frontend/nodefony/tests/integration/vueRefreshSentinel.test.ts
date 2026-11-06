/**
 * SENTINELLE — le défaut de `@vitejs/plugin-vue` qui oblige à isoler Vue dans
 * son propre process Vite (`isolationGroups.ts#isolationGroup`).
 *
 * `@vitejs/plugin-react` pose `oxc.jsx.refresh: true` en GLOBAL ; plugin-vue
 * le recopie dans `transformWithOxc` (`transformMain`) sans la garde que le
 * compilateur de Vite applique, et injecte `$RefreshSig$()` dans le composant —
 * page Vue morte (`ReferenceError`) quand React partage l'instance.
 * Amont : https://github.com/vitejs/vite-plugin-vue/issues/798, correctif
 * proposé par https://github.com/vitejs/vite-plugin-vue/pull/814.
 *
 * Ce test est VERT TANT QUE LE DÉFAUT EXISTE. Le jour où il rougit, plugin-vue
 * est corrigé : retirer le cas `vue3` d'`isolationGroup` (un process Vite de
 * moins), éprouver le HMR de Vue ET de React dans l'instance partagée, puis
 * supprimer cette sentinelle.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/vue-refresh-sentinel",
);

/** L'APPEL injecté par le rafraîchissement React — pas une simple mention. */
const INJECTED = /\$RefreshSig\$\(\)/;

/** Code servi au navigateur pour le composant, sous les greffons donnés. */
async function servedComponent(withReact: boolean): Promise<string> {
  const { createServer } = await import("vite");
  const vue = (await import("@vitejs/plugin-vue")).default;
  const plugins = [vue()];
  if (withReact)
    plugins.push(...[(await import("@vitejs/plugin-react")).default()].flat());
  // HMR ACTIF : le greffon React n'arme son Fast Refresh que sous `serve` avec
  // HMR — `hmr: false` rendrait la sentinelle verte pour une mauvaise raison.
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    plugins,
    server: { middlewareMode: true, watch: null },
  });
  try {
    const result = await server.transformRequest("/HookInSetup.vue");
    return result?.code ?? "";
  } finally {
    await server.close();
  }
}

describe("SENTINELLE plugin-vue #798 — Vue doit rester isolé de React", () => {
  it("témoin : Vue seul n'injecte rien", async () => {
    expect(await servedComponent(false)).not.toMatch(INJECTED);
  });

  it("Vue + React : `$RefreshSig$` toujours injecté — s'il ne l'est plus, lever l'isolation de Vue", async () => {
    const code = await servedComponent(true);
    expect(
      code,
      "plugin-vue semble CORRIGÉ (#798) : retirer le cas `vue3` de isolationGroup, éprouver le HMR, supprimer cette sentinelle",
    ).toMatch(INJECTED);
  });
});
