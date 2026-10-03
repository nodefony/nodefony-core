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
  readonly backendOrigin?: string | undefined;
  /**
   * Chemin de base Vite en développement — `/_vite/<famille>/`
   * (`devBasePath`). Émis comme `base` : Vite préfixe alors TOUTES ses URLs
   * (modules, assets, `url()` CSS, socket HMR), et Nodefony relaie ce préfixe
   * vers le serveur Vite.
   */
  readonly devBase?: string | undefined;
  /**
   * @deprecated Utiliser {@link ViteConfigGeneratorOptions.devBase}. Vite
   * réduit un `base` absolu à son seul chemin en développement
   * (`resolveBaseUrl`) : cette origine n'a jamais rendu aucune URL absolue.
   * Sans effet : `strictPort`, qu'elle activait, est désormais toujours posé
   * en développement.
   */
  readonly viteOrigin?: string | undefined;
  /**
   * Certificats HTTPS — paths absolus vers les fichiers PEM. Quand fourni,
   * la config Vite générée inclut `server.https: { key, cert }` (lus via
   * `fs.readFileSync` au démarrage Vite).
   */
  readonly https?:
    | {
        readonly keyPath: string;
        readonly certPath: string;
      }
    | undefined;
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
    const [first] = entries;
    if (first === undefined) {
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
          // `usedTypes` dérive de `entries` : une entrée angular existe forcément ici.
          if (!angularEntry) {
            throw new Error(
              "vite config: aucune entrée angular pour le type « angular »",
            );
          }
          const tsconfigPath = toGeneratedPath(
            path.resolve(angularEntry.root, "tsconfig.app.json"),
          );
          // analogjs coupe le typecheck des templates par défaut
          // (`disableTypeChecking ?? true`) : sans ce drapeau, `strictTemplates`
          // et `strictUnclaimedEventNames` du tsconfig.app.json ne mordent
          // jamais, et une faute de template passe le build.
          pluginsExprs.push(
            `angular({ disableTypeChecking: false, tsconfig: ${JSON.stringify(tsconfigPath)} })`,
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

    const root = toGeneratedPath(first.root);
    const outDir = toGeneratedPath(first.outDir);

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
    // strictPort : le superviseur choisit le port (repli, bloc par famille) et
    // annonce ce port dans les URLs et le CSP. Un Vite qui sauterait de lui-même
    // sur un autre port servirait des URLs fausses, en silence.
    // Toujours en développement : la config n'est générée QUE pour le
    // superviseur — dépendre d'une option ici a déjà laissé Vite se décaler seul.
    const devBase =
      mode === "development" && opts.devBase ? opts.devBase : undefined;
    const strictPort = mode === "development" ? "true" : "false";
    const useHttps = mode === "development" && !!opts.https;
    const httpsLines = useHttps
      ? `    https: {
      key: fs.readFileSync(${JSON.stringify(toGeneratedPath(opts.https.keyPath))}),
      cert: fs.readFileSync(${JSON.stringify(toGeneratedPath(opts.https.certPath))}),
    },\n`
      : "";
    const fsBlock = `    fs: {
      allow: [
${fsAllowLines}
      ],
    },
`;
    // Ni `allowedHosts` ni `cors` : le proxy inverse de Nodefony réécrit `Host`
    // sur `127.0.0.1:<port>`, que Vite accepte d'office, et la page partage
    // l'origine de ses scripts — aucune requête n'est inter-origines. Les deux
    // barrières de Vite (DNS-rebinding, CORS restreint depuis CVE-2025-24010)
    // restent donc à leur réglage le plus strict (#528).
    // 🔴 AUCUNE ligne `hmr` n'est émise, JAMAIS — et c'est délibéré.
    // Le client Vite déduit l'adresse de son socket de l'URL par laquelle IL a
    // été chargé (`client.mjs` : `__HMR_HOSTNAME__ || importMetaUrl.hostname`,
    // `hmrPort || importMetaUrl.port`, protocole déduit de `https:`). Or c'est
    // précisément ce que le rendu fait varier par requête. Le socket suit donc
    // le même chemin que les ressources, sans qu'on ait à le dire — y compris
    // quand une même instance sert en même temps l'origine publique d'une
    // plateforme et un tunnel local, cas où une valeur écrite ici serait juste
    // pour l'un et fausse pour l'autre.
    // Deux raisons de plus de ne rien écrire : côté serveur, `host`/`protocol`/
    // `clientPort` omis valent `null` (donc la déduction s'active), et côté
    // client un `hmrPort` absent ARME un repli direct en cas d'échec de
    // connexion — le fixer désarme ce filet.
    const serverBlock =
      proxyPaths.size > 0
        ? `  server: {
    strictPort: ${strictPort},
${httpsLines}${fsBlock}    proxy: {
${proxyLines}
    },
  },`
        : `  server: {
    strictPort: ${strictPort},
${httpsLines}${fsBlock}  },`;

    // `base` = chemin réservé de la famille, en dev seulement (#526). Jamais une
    // origine : Vite en dev n'en garde que le chemin, et une URL d'asset reste
    // relative au DOCUMENT (servi par Nodefony) — c'est le préfixe qui la rend
    // relayable. En prod, le build pose sa propre `base` (publicPath).
    const baseLine = devBase ? `  base: ${JSON.stringify(devBase)},\n` : "";

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
