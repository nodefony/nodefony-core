import path from "node:path";
import { createRequire } from "node:module";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import type {
  FrontPresetType,
  IFrontPreset,
  IVitePluginSpec,
} from "../interfaces/IFrontPreset";
import { FrontendPresetNotDescribedError } from "../src/errors/FrontendError";
import { getBuiltinPreset } from "../src/presets";
import {
  composePresets,
  toPortablePath as toGeneratedPath,
} from "../src/presets/compose";

/**
 * Options de {@link ViteConfigGenerator.toMjs}.
 */
export interface ViteConfigGeneratorOptions {
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

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/**
 * Nom local d'un plugin dans le fichier généré : `<nom>Plugin`, où `<nom>`
 * est l'export nommé, ou — pour un export par défaut — le dernier segment du
 * paquet sans son préfixe `vite-plugin-` / `plugin-`
 * (`@vitejs/plugin-react` → `reactPlugin`). Suffixé d'un rang en cas de
 * collision. Déterministe : même description, même texte.
 */
function localNameOf(spec: IVitePluginSpec, taken: Set<string>): string {
  const raw =
    spec.exportName === "default"
      ? (spec.specifier.split("/").pop() ?? "").replace(
          /^(?:vite-plugin-|plugin-)/u,
          "",
        )
      : spec.exportName;
  const camel = raw.replace(/[^A-Za-z0-9_$]+(.)?/gu, (_m, c?: string) =>
    c === undefined ? "" : c.toUpperCase(),
  );
  const base = `${/^[0-9]/u.test(camel) ? "_" : ""}${camel}Plugin`;
  let name = base;
  for (let rank = 2; taken.has(name); rank++) name = `${base}${rank}`;
  taken.add(name);
  return name;
}

/**
 * Écrit les plugins décrits en `import` + appels de fabrique, pour le fichier
 * généré. Les options sont des données (`VitePluginOption`) : `JSON.stringify`
 * les rend telles qu'un littéral JavaScript les lirait.
 */
function renderPlugins(specs: ReadonlyArray<IVitePluginSpec>): {
  imports: string[];
  calls: string[];
} {
  const taken = new Set<string>();
  const imports: string[] = [];
  const calls: string[] = [];
  for (const spec of specs) {
    if (spec.exportName !== "default" && !IDENTIFIER.test(spec.exportName)) {
      throw new Error(
        `vite config: export de plugin invalide « ${spec.exportName} » (${spec.specifier})`,
      );
    }
    const local = localNameOf(spec, taken);
    const from = JSON.stringify(spec.specifier);
    imports.push(
      spec.exportName === "default"
        ? `import ${local} from ${from};`
        : `import { ${spec.exportName} as ${local} } from ${from};`,
    );
    calls.push(
      `${local}(${spec.options === undefined ? "" : JSON.stringify(spec.options)})`,
    );
  }
  return { imports, calls };
}

/**
 * Génère le contenu d'un `vite.config.generated.mjs` pour le superviseur
 * child_process. Le fichier généré est autosuffisant : il importe Vite + les
 * plugins des presets employés.
 *
 * Pourquoi pas appeler `IFrontBuilder.buildViteConfig()` et passer la config
 * au process Vite ? Parce que Vite ne lit pas sa config depuis stdin, et que
 * les plugins (instances JS) ne sont pas sérialisables. Les presets décrivent
 * donc leurs plugins en DONNÉES (`IFrontPreset.vitePlugins`), que ce générateur
 * écrit et que le build charge : une seule source, deux consommateurs
 * (`composePresets`).
 */
export class ViteConfigGenerator {
  /**
   * @param getPreset - registre des presets ; par défaut, les presets fournis
   *   par le module
   */
  constructor(
    private readonly getPreset: (
      type: FrontPresetType,
    ) => IFrontPreset | undefined = getBuiltinPreset,
  ) {}

  /**
   * Construit le content `.mjs` à écrire à côté de `index.html` du module.
   *
   * Aucun `server.proxy` : la page est rendue par Nodefony et ses appels d'API
   * partent sur sa propre origine ; Vite ne reçoit que ce que le relais
   * `/_vite/<famille>/` lui transmet (#528).
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

    const composed = composePresets(entries, this.getPreset);
    if (composed.undescribed.length > 0) {
      throw new FrontendPresetNotDescribedError(
        composed.undescribed.map((preset) => preset.type),
      );
    }
    const plugins = renderPlugins(composed.plugins);

    const needFs = mode === "development" && !!opts.https;
    const imports: string[] = [
      `import { defineConfig } from "vite";`,
      ...(needFs ? [`import fs from "node:fs";`] : []),
      ...plugins.imports,
    ];

    const input: Record<string, string> = {};
    for (const e of entries) {
      input[e.entryName] = toGeneratedPath(path.resolve(e.root, e.entryFile));
    }

    const root = toGeneratedPath(first.root);
    // Le cache de pré-compilation des dépendances, PROPRE à la racine. Par
    // défaut Vite le pose sous le `package.json` le plus proche : deux fronts
    // d'un même paquet (deux familles d'une application, deux fixtures de test)
    // partageaient alors `node_modules/.vite/deps`, et l'un le vidait pendant que
    // l'autre le lisait — sous Windows, un dossier ouvert ne se supprime pas
    // (ENOTEMPTY, axiome 7). Quand la racine porte son propre `package.json`,
    // c'est exactement le défaut de Vite : rien ne change.
    const cacheDir = toGeneratedPath(
      path.join(first.root, "node_modules", ".vite"),
    );
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

    const optimizeLines = composed.optimizeDepsInclude
      .map((d) => `    ${JSON.stringify(d)},`)
      .join("\n");

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
    const serverBlock = `  server: {
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
    const dedupe = composed.dedupe;
    const dedupeLine = dedupe.length
      ? `  resolve: { dedupe: ${JSON.stringify(dedupe)} },\n`
      : "";

    return `// AUTO-GENERATED by @nodefony/frontend — DO NOT EDIT.
// Regenerated at every dev server start.
${imports.join("\n")}

export default defineConfig({
  mode: ${JSON.stringify(mode)},
${baseLine}${dedupeLine}  root: ${JSON.stringify(root)},
  cacheDir: ${JSON.stringify(cacheDir)},
  plugins: [${plugins.calls.join(", ")}],
  optimizeDeps: {
    include: [
${optimizeLines}
    ],
  },
  build: {
    outDir: ${JSON.stringify(outDir)},
    manifest: true,
    emptyOutDir: true,
    rolldownOptions: {
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
