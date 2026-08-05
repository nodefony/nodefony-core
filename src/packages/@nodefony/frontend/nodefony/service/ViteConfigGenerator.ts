import path from "node:path";
import { createRequire } from "node:module";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { FrontendPresetUnknownError } from "../src/errors/FrontendError";

/**
 * Génère le contenu d'un `vite.config.generated.mjs` pour le superviseur
 * child_process. Le fichier généré est autosuffisant : il importe Vite +
 * les plugins de chaque preset hardcodés selon les types détectés.
 *
 * Pourquoi pas appeler `IFrontBuilder.buildViteConfig()` directement et
 * passer la config en stdin ? Parce que Vite ne lit pas la config depuis
 * stdin, et que les plugins (instances JS) ne sont pas sérialisables JSON.
 */
export interface ViteConfigGeneratorOptions {
  /**
   * Origine du serveur Nodefony pour le proxy Vite (`server.proxy`).
   * Exemple : `"http://127.0.0.1:5151"`. En dev uniquement — ignoré en prod.
   */
  readonly backendOrigin?: string;
  /**
   * Origine publique du dev server Vite — ex `"http://127.0.0.1:5173"`.
   * Définie comme `base` dans Vite, ce qui force les imports internes du
   * source transformé (ex `/src/App.tsx`) à devenir absolus
   * (`http://host:port/src/App.tsx`). Sans ça, une page rendue par
   * Nodefony (5151) qui charge `/src/main.tsx` voit ses imports résolus
   * contre 5151 → 404. Active aussi `strictPort` pour garantir l'origine.
   */
  readonly viteOrigin?: string;
  /**
   * Certificats HTTPS — paths absolus vers les fichiers PEM. Quand fourni,
   * la config Vite générée inclut `server.https: { key, cert }` (lus via
   * `fs.readFileSync` au démarrage Vite).
   */
  readonly https?: {
    readonly keyPath: string;
    readonly certPath: string;
  };
  /**
   * Hôtes acceptés dans le header `Host` (`server.allowedHosts`, Vite ≥6).
   * `true` = tous. Un motif `.suffixe` couvre le domaine et ses sous-domaines.
   * Les IP et `localhost` sont toujours acceptés par Vite — cette liste ne
   * sert que les NOMS (vhosts, `host.docker.internal`, forwarders).
   */
  readonly allowedHosts?: true | ReadonlyArray<string>;
  /**
   * Config `server.hmr` CLIENTE — où le navigateur ouvre le WebSocket HMR
   * quand un intermédiaire (forwarder TLS, passerelle conteneur) sépare
   * l'origine publique de l'adresse d'écoute. Absent = fallback client Vite
   * (`location.hostname` + port d'écoute), correct en local.
   */
  readonly hmr?: {
    readonly host: string;
    readonly clientPort: number;
    readonly protocol: "ws" | "wss";
  };
}

/**
 * Normalise un chemin filesystem en séparateurs `/` avant sérialisation dans
 * le fichier `.mjs` généré. Le fichier généré est du JS/ESM : un backslash
 * (produit par `path.resolve` sur `win32`) y est un caractère d'échappement
 * de string — Windows accepte nativement `/` comme séparateur, donc on
 * normalise plutôt que de laisser fuir des `\` bruts dans la sortie.
 */
function toGeneratedPath(p: string): string {
  return p.replace(/\\/g, "/");
}

export class ViteConfigGenerator {
  /**
   * Construit le content `.mjs` à écrire à côté de `index.html` du module.
   *
   * Si `opts.backendOrigin` est fourni en mode `development`, agrège les
   * `apiProxyPaths` de toutes les entries et génère un `server.proxy` qui
   * forward chaque préfixe vers le backend Nodefony. Sans ça, les fetch
   * relatifs depuis l'app servie par Vite atterrissent sur Vite et reçoivent
   * un SPA-fallback HTML (cause classique de `Unexpected token '<'`).
   */
  toMjs(
    entries: ReadonlyArray<IResolvedFrontendEntry>,
    mode: "development" | "production",
    opts: ViteConfigGeneratorOptions = {},
  ): string {
    if (entries.length === 0) {
      throw new Error("ViteConfigGenerator: empty entries");
    }

    const usedTypes = new Set<string>();
    for (const e of entries) usedTypes.add(e.type);

    // Angular : le plugin a besoin du tsconfig de l'app (scoping du compilateur).
    // On résout un chemin ABSOLU depuis le root de l'entry angular — le cwd du
    // process Vite est `entries[0].root` (≠ root angular en multi-bundle).
    const angularEntry = entries.find((e) => e.type === "angular");

    const needFs = mode === "development" && !!opts.https;
    const imports: string[] = [
      `import { defineConfig } from "vite";`,
      ...(needFs ? [`import fs from "node:fs";`] : []),
    ];
    const pluginsExprs: string[] = [];
    const optimizeInclude: string[] = [];

    for (const type of usedTypes) {
      switch (type) {
        case "react19":
          imports.push(`import react from "@vitejs/plugin-react";`);
          pluginsExprs.push(`react({ jsxRuntime: "automatic" })`);
          optimizeInclude.push("react", "react-dom", "react-dom/client");
          break;
        case "vue3":
          imports.push(`import vue from "@vitejs/plugin-vue";`);
          pluginsExprs.push(`vue()`);
          optimizeInclude.push("vue");
          break;
        case "angular": {
          imports.push(`import angular from "@analogjs/vite-plugin-angular";`);
          const tsconfigPath = toGeneratedPath(
            path.resolve(angularEntry!.root, "tsconfig.app.json"),
          );
          pluginsExprs.push(
            `angular({ tsconfig: ${JSON.stringify(tsconfigPath)} })`,
          );
          optimizeInclude.push(
            "@angular/core",
            "@angular/common",
            "@angular/platform-browser",
          );
          break;
        }
        case "svelte5":
          // Export NOMMÉ (`{ svelte }`) — seul plugin de la liste sans default.
          imports.push(
            `import { svelte } from "@sveltejs/vite-plugin-svelte";`,
          );
          pluginsExprs.push(`svelte()`);
          optimizeInclude.push("svelte");
          break;
        case "vanilla":
          // Pas de plugin.
          break;
        default:
          throw new FrontendPresetUnknownError(type);
      }
    }

    const input: Record<string, string> = {};
    for (const e of entries) {
      input[e.entryName] = toGeneratedPath(path.resolve(e.root, e.entryFile));
    }

    const root = toGeneratedPath(entries[0]!.root);
    const outDir = toGeneratedPath(entries[0]!.outDir);

    // Multi-bundle fix (P14.6) : autorise `/@fs/<abs>` pour chaque entry root.
    // Sans ça, deux consumers qui partagent la même structure (ex `frontend/src/main.tsx`)
    // collisionnent sur le root Vite unique (= entries[0].root) et le browser
    // charge le main.tsx du premier consumer pour TOUTES les pages.
    // process.cwd() couvre le workspace root (node_modules hoistés inclus).
    const fsAllowSet = new Set<string>([toGeneratedPath(process.cwd())]);
    for (const e of entries) fsAllowSet.add(toGeneratedPath(e.root));
    // Debug bar : servie via `/@fs` depuis le PAQUET nodefony (même résolution
    // que TemplateHelper.debugBarTag). Dans une app `--link`, le realpath sort
    // du cwd (symlink vers le checkout du framework) → sans cette entrée, Vite
    // répond 403 sur le module de la debug bar (vécu app générée). On autorise
    // le dossier `dist/client` entier : les imports internes (preserveModules)
    // remontent entre chunks frères.
    try {
      const dbg = toGeneratedPath(
        createRequire(import.meta.url).resolve("nodefony/debugbar"),
      );
      const clientRoot = dbg.includes("/dist/client/")
        ? dbg.slice(0, dbg.indexOf("/dist/client/") + "/dist/client".length)
        : path.dirname(dbg);
      fsAllowSet.add(clientRoot);
    } catch {
      /* subpath debugbar irrésolu → pas de debug bar, rien à autoriser */
    }
    const fsAllowLines = Array.from(fsAllowSet)
      .map((p) => `      ${JSON.stringify(p)},`)
      .join("\n");

    const inputLines = Object.entries(input)
      .map(
        ([name, file]) =>
          `      ${JSON.stringify(name)}: ${JSON.stringify(file)},`,
      )
      .join("\n");

    const optimizeLines = optimizeInclude
      .map((d) => `    ${JSON.stringify(d)},`)
      .join("\n");

    // Agrège tous les apiProxyPaths déclarés par les entries.
    // Set pour dédupliquer si deux modules déclarent le même préfixe.
    const proxyPaths = new Set<string>();
    if (mode === "development" && opts.backendOrigin) {
      for (const e of entries) {
        for (const p of e.apiProxyPaths) proxyPaths.add(p);
      }
      // Data-plane admin/profiler TOUJOURS proxifié (convention
      // `/nodefony/<module>/api/*`) : la debug bar dev (auto-injectée) fetch
      // `/nodefony/profiler/api/{requestId}`, et Studio consomme `/nodefony/
      // <module>/api/*`. Sans ça, sur une page servie par Vite ces fetch
      // tombent sur le fallback SPA (HTML) → clic profiler « mort ». Regex
      // Vite (clé `^…`) → couvre tous les modules, présents et futurs.
      proxyPaths.add("^/nodefony/[^/]+/api");
    }
    const proxyLines =
      proxyPaths.size > 0
        ? Array.from(proxyPaths)
            .map(
              (p) =>
                `      ${JSON.stringify(p)}: { target: ${JSON.stringify(
                  opts.backendOrigin,
                )}, changeOrigin: false, secure: false, ws: true },`,
            )
            .join("\n")
        : "";
    // strictPort + base sont liés : on doit garantir l'origine pour que le
    // `base` reflète le vrai port. Si Vite saute sur un autre port à cause
    // d'un conflit, les imports absolus seraient cassés silencieusement.
    const useViteOrigin = mode === "development" && !!opts.viteOrigin;
    const strictPort = useViteOrigin ? "true" : "false";
    const useHttps = mode === "development" && !!opts.https;
    const httpsLines = useHttps
      ? `    https: {
      key: fs.readFileSync(${JSON.stringify(toGeneratedPath(opts.https!.keyPath))}),
      cert: fs.readFileSync(${JSON.stringify(toGeneratedPath(opts.https!.certPath))}),
    },\n`
      : "";
    const fsBlock = `    fs: {
      allow: [
${fsAllowLines}
      ],
    },
`;
    // P14.17 — dev déporté : hôtes nommés autorisés + WS HMR routé vers
    // l'origine PUBLIQUE. Émis seulement si fournis (défauts Vite sinon).
    const allowedHostsLine =
      opts.allowedHosts === true
        ? `    allowedHosts: true,\n`
        : opts.allowedHosts && opts.allowedHosts.length > 0
          ? `    allowedHosts: ${JSON.stringify(opts.allowedHosts)},\n`
          : "";
    const hmrLine = opts.hmr
      ? `    hmr: { host: ${JSON.stringify(opts.hmr.host)}, clientPort: ${
          opts.hmr.clientPort
        }, protocol: ${JSON.stringify(opts.hmr.protocol)} },\n`
      : "";
    const serverBlock =
      proxyPaths.size > 0
        ? `  server: {
    strictPort: ${strictPort},
    cors: true,
${allowedHostsLine}${hmrLine}${httpsLines}${fsBlock}    proxy: {
${proxyLines}
    },
  },`
        : `  server: {
    strictPort: ${strictPort},
    cors: true,
${allowedHostsLine}${hmrLine}${httpsLines}${fsBlock}  },`;

    // `base` est inclus seulement si l'origin Vite est fournie en dev. En prod,
    // Vite préfixe avec le `base` standard "/" (assets relatifs).
    const baseLine = useViteOrigin
      ? `  base: ${JSON.stringify(opts.viteOrigin + "/")},\n`
      : "";

    // UNE seule copie par runtime front — une app générée `--link` a DEUX
    // node_modules (app + checkout du framework) : une entry servie via /@fs
    // depuis le checkout (Studio) résolvait SON react pendant que react-dom
    // venait du prébundle de l'app → « Invalid hook call … more than one copy
    // of React » et page BLANCHE (vécu, diagnostiqué console navigateur).
    // `resolve.dedupe` force la résolution de ces paquets vers le root Vite.
    const dedupe: string[] = [];
    if (usedTypes.has("react19")) dedupe.push("react", "react-dom");
    if (usedTypes.has("vue3")) dedupe.push("vue");
    if (usedTypes.has("svelte5")) dedupe.push("svelte");
    if (usedTypes.has("angular"))
      dedupe.push(
        "@angular/core",
        "@angular/common",
        "@angular/platform-browser",
      );
    const dedupeLine = dedupe.length
      ? `  resolve: { dedupe: ${JSON.stringify(dedupe)} },\n`
      : "";

    return `// AUTO-GENERATED by @nodefony/frontend — DO NOT EDIT.
// Regenerated at every dev server start.
${imports.join("\n")}

export default defineConfig({
  mode: ${JSON.stringify(mode)},
${baseLine}${dedupeLine}  root: ${JSON.stringify(root)},
  plugins: [${pluginsExprs.join(", ")}],
  optimizeDeps: {
    include: [
${optimizeLines}
    ],
  },
  build: {
    outDir: ${JSON.stringify(outDir)},
    manifest: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
${inputLines}
      },
    },
  },
${serverBlock}
});
`;
  }
}

export default ViteConfigGenerator;
