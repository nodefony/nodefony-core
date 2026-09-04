import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import {
  planAssetPublish,
  type AssetSource,
} from "../src/assets/collectAssets";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
  showBanner: false,
  // `onReady` : mounts natifs posés + entries frontend déclarées (comme
  // proxy:generate). `lifetime: oneshot` → pas de serveurs.
  kernelEvent: "onReady",
};

interface StaticServiceShape {
  mounts?: { prefix: string; dir: string }[];
  mountModulePublics?: () => void;
}
interface FrontendServiceShape {
  listEntries?: () => ReadonlyArray<{ publicPath: string; outDir: string }>;
}

/** Compte récursivement les fichiers d'un dossier (borné par le FS). */
async function countFiles(dir: string): Promise<number> {
  let n = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) n += await countFiles(join(dir, e.name));
    else n += 1;
  }
  return n;
}

/**
 * Commande CLI `assets:publish` — assemble TOUS les assets statiques servables
 * (publics de module montés sous `/<module>/` + bundles `@nodefony/frontend`
 * sous `/_assets/<name>/`) dans UN arbre `dist-assets/` miroir des préfixes
 * d'URL, plus un `manifest.json`.
 *
 * Provider-agnostic — Nodefony ASSEMBLE, l'orchestrateur PUBLIE (cloud-native) :
 * `aws s3 sync dist-assets s3://bucket`, `rsync`, upload CI… Pas de dépendance
 * cloud embarquée dans le framework. Combine avec `frontend.assetBaseUrl` pour
 * que les URLs émises pointent le CDN qui sert cet arbre.
 */
class AssetsPublish extends Command {
  constructor(cli: CliKernel) {
    super(
      "assets:publish",
      "rassemble les fichiers statiques pour un CDN",
      cli,
      options,
    );
    this.addOption(
      "-o, --out <dir>",
      "output directory (default ./dist-assets)",
    );
    this.addOption("--clean", "remove the output directory first");
    this.addOption("--json", "print a machine-readable summary");
  }

  override async generate(opts: {
    out?: string;
    clean?: boolean;
    json?: boolean;
  }): Promise<this> {
    const outDir = opts.out
      ? isAbsolute(opts.out)
        ? opts.out
        : resolve(process.cwd(), opts.out)
      : join(process.cwd(), "dist-assets");

    const sources = this.collectSources();
    if (sources.length === 0) {
      this.log(
        "Aucune source d'assets (0 mount natif, 0 bundle frontend) — rien à publier.",
        "WARNING",
      );
      return this;
    }

    if (opts.clean && existsSync(outDir)) {
      await fs.rm(outDir, { recursive: true, force: true });
    }
    const plan = planAssetPublish(sources, outDir);
    const manifest: {
      generatedAt: string;
      outDir: string;
      sources: { prefix: string; dir: string; files: number }[];
    } = { generatedAt: new Date().toISOString(), outDir, sources: [] };

    for (const p of plan) {
      if (!existsSync(p.dir)) {
        this.log(
          `Source absente, ignorée : ${p.prefix} → ${p.dir} (build manquant ?)`,
          "WARNING",
        );
        continue;
      }
      await fs.mkdir(p.target, { recursive: true });
      await fs.cp(p.dir, p.target, { recursive: true });
      const files = await countFiles(p.target);
      manifest.sources.push({ prefix: p.prefix, dir: p.dir, files });
      this.log(`publish ${p.prefix} → ${p.target} (${files} fichiers)`, "INFO");
    }

    await fs.writeFile(
      join(outDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    if (opts.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    } else {
      const total = manifest.sources.reduce((s, x) => s + x.files, 0);
      this.log(
        `${manifest.sources.length} source(s), ${total} fichiers → ${outDir}. Déployez avec votre outil (ex. \`aws s3 sync ${outDir} s3://bucket\`).`,
        "INFO",
      );
    }
    return this;
  }

  /** Sources = mounts natifs (`server-static`) + bundles `@nodefony/frontend`. */
  private collectSources(): AssetSource[] {
    const modules = this.kernel?.getModules?.() ?? {};
    const sources: AssetSource[] = [];

    const staticSvc = modules["http"]?.get<StaticServiceShape>("server-static");
    // Garantit les mounts natifs `/<module>/` (ordre listeners indifférent).
    staticSvc?.mountModulePublics?.();
    for (const m of staticSvc?.mounts ?? [])
      sources.push({ prefix: m.prefix, dir: m.dir });

    const frontendSvc =
      modules["frontend"]?.get<FrontendServiceShape>("frontend");
    for (const e of frontendSvc?.listEntries?.() ?? [])
      sources.push({ prefix: e.publicPath, dir: e.outDir });

    return sources;
  }
}

export default AssetsPublish;
