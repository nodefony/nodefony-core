import fs from "node:fs/promises";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import {
  generateNginxConfig,
  generateHaproxyConfig,
  defaultIntrospection,
  type ProxyIntrospection,
} from "../src/proxy/generateProxyConfig";
import {
  resolveTrustedHostNames,
  type ITrustedHostsConfig,
} from "../src/context/domainMatcher";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
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
      "engendre une configuration nginx ou haproxy",
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
      // LEVER, pas journaliser : une cible inconnue est un échec d'usage, et une
      // commande qui se plaint en rendant 0 laisse un script d'intégration
      // continuer sur une configuration qui n'existe pas.
      throw new Error(`Cible inconnue '${target}' — attendu: nginx | haproxy.`);
    }
    const intro = this.buildIntrospection(opts);
    const conf =
      target === "nginx"
        ? generateNginxConfig(intro)
        : generateHaproxyConfig(intro);

    if (opts.out) {
      await fs.writeFile(opts.out, conf, "utf8");
      // Sur la sortie standard, pas dans le journal : une commande de module
      // boote en mode silencieux (`CliKernel.dispatchModuleCommand` pose
      // `quietBoot`), qui coupe tout ce qui est au-dessus d'ERROR. La
      // confirmation d'écriture partait donc dans le vide — le fichier
      // apparaissait sans qu'un mot ne le dise. La sortie standard est libre
      // ici, puisque la configuration est allée dans le fichier.
      process.stdout.write(`Configuration ${target} écrite → ${opts.out}\n`);
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
    // Deux réglages du SERVEUR que le proxy doit refléter, sans quoi il impose
    // les siens en silence : la taille de corps acceptée (nginx coupe à 1 Mo par
    // défaut) et le battement du heartbeat WebSocket (d'où se dérive le délai
    // d'inactivité, faute de quoi le proxy tranche des sockets vivantes).
    // 🔴 `trustedHosts` n'est PAS une liste : son type est
    // `boolean | string | string[]`, et son DÉFAUT est `false` — la valeur que
    // porte toute application générée. Le lire comme un tableau faisait lever
    // `domains.filter is not a function` au premier appel chez un utilisateur.
    const httpOpts = (module?.options ?? {}) as {
      trustedHosts?: ITrustedHostsConfig;
      maxBodySize?: number;
      websocket?: { keepaliveInterval?: number };
    };
    const servers = (
      this.kernel?.options as {
        servers?: Record<string, { port?: string | number }>;
      }
    )?.servers;
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
      // La barrière accepte TOUJOURS le domaine canonique, en plus des hôtes
      // déclarés : le `server_name` généré doit donc dire la même chose qu'elle,
      // sous peine de décrire un déploiement que le serveur refuserait.
      domains: resolveTrustedHostNames(
        this.kernel?.domain ?? "",
        httpOpts.trustedHosts,
      ),
      backendHost: opts.backend ?? "127.0.0.1",
      httpPort: Number(servers?.http?.port) || defaultIntrospection.httpPort,
      httpsPort: Number(servers?.https?.port) || defaultIntrospection.httpsPort,
      staticRoots,
      mounts,
      listen: opts.listen ? Number(opts.listen) : defaultIntrospection.listen,
      reencrypt: Boolean(opts.reencrypt),
      maxBodyBytes: Number(httpOpts.maxBodySize) || 0,
      keepaliveIntervalMs: Number(httpOpts.websocket?.keepaliveInterval) || 0,
    };
  }
}

export default ProxyGenerate;
