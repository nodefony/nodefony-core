import fs from "node:fs/promises";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import {
  generateNginxConfig,
  generateHaproxyConfig,
  defaultIntrospection,
  type ProxyIntrospection,
} from "../src/proxy/generateProxyConfig";

const options: OptionsCommandInterface = {
  showBanner: false,
  // `onReady` : cross-wiring inter-modules terminé → les montages statiques
  // natifs `/<module>/` (server-static.mountModulePublics, posés à onReady) sont
  // dans `mounts`. `onBoot` serait trop tôt (mounts vides). `lifetime: oneshot`
  // → ne démarre pas les serveurs (introspection pure, pas de listen réseau).
  kernelEvent: "onReady",
};

interface StaticServiceShape {
  servers?: Record<string, unknown>;
  mounts?: { prefix: string; dir: string }[];
  mountModulePublics?: () => void;
}

/**
 * Commande CLI `proxy:generate <nginx|haproxy>` — génère une configuration
 * reverse-proxy DÉRIVÉE de l'introspection Nodefony (domaines de confiance,
 * dossiers statiques servis, ports). Évite d'écrire la conf à la main et de la
 * laisser diverger ; résout le « trou statiques multi-modules » côté nginx.
 */
class ProxyGenerate extends Command {
  constructor(cli: CliKernel) {
    super(
      "proxy:generate",
      "Generate a reverse-proxy config (nginx|haproxy) from introspection",
      cli,
      options,
    );
    this.addArgument("<target>", "nginx | haproxy");
    this.addOption("-o, --out <file>", "write to file instead of stdout");
    this.addOption(
      "-b, --backend <host>",
      "backend host the proxy connects to (default 127.0.0.1)",
    );
    this.addOption("-l, --listen <port>", "proxy listen port (default 80)");
    this.addOption(
      "--reencrypt",
      "re-encrypt to the HTTPS backend (TLS proxy↔backend) instead of clear",
    );
  }

  override async generate(
    target: string,
    opts: {
      out?: string;
      backend?: string;
      listen?: string;
      reencrypt?: boolean;
    },
  ): Promise<this> {
    if (target !== "nginx" && target !== "haproxy") {
      this.log(
        `Cible inconnue '${target}' — attendu: nginx | haproxy.`,
        "ERROR",
      );
      return this;
    }
    const intro = this.buildIntrospection(opts);
    const conf =
      target === "nginx"
        ? generateNginxConfig(intro)
        : generateHaproxyConfig(intro);

    if (opts.out) {
      await fs.writeFile(opts.out, conf, "utf8");
      this.log(`Configuration ${target} écrite → ${opts.out}`, "INFO");
    } else {
      process.stdout.write(conf);
    }
    return this;
  }

  /** Construit le modèle d'introspection depuis le kernel + le service statique. */
  private buildIntrospection(opts: {
    backend?: string;
    listen?: string;
    reencrypt?: boolean;
  }): ProxyIntrospection {
    const module = this.kernel?.getModules()?.["http"];
    const httpOpts = (module?.options ?? {}) as {
      trustedHosts?: string[];
    };
    const servers = (this.kernel?.options as { servers?: Record<string, any> })
      ?.servers;
    const staticSvc = module?.get<StaticServiceShape>("server-static");
    // Garantit la carte des montages natifs `/<module>/` indépendamment de
    // l'ordre des listeners `onReady` (le `generate()` de cette commande peut
    // fire AVANT le listener de montage du service). Idempotent (addMount
    // remplace par préfixe) → pas de double-montage côté runtime.
    staticSvc?.mountModulePublics?.();

    const staticRoots = staticSvc?.servers
      ? Object.keys(staticSvc.servers)
      : [];
    const mounts = (staticSvc?.mounts ?? []).map((m) => ({
      prefix: m.prefix,
      dir: m.dir,
    }));

    return {
      ...defaultIntrospection,
      domains: httpOpts.trustedHosts ?? [],
      backendHost: opts.backend ?? "127.0.0.1",
      httpPort: Number(servers?.http?.port) || defaultIntrospection.httpPort,
      httpsPort: Number(servers?.https?.port) || defaultIntrospection.httpsPort,
      staticRoots,
      mounts,
      listen: opts.listen ? Number(opts.listen) : defaultIntrospection.listen,
      reencrypt: Boolean(opts.reencrypt),
    };
  }
}

export default ProxyGenerate;
