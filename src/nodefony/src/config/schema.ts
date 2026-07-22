/**
 * Schéma Zod de la config d'application — validé au resolve de `defineConfig` (D1).
 *
 * Vit dans le CORE (zod = peerDep core, back-only) : `import { defineConfig } from
 * "nodefony"` valide tout seul, sans que chaque app porte son propre schéma. But :
 * planter PROPREMENT au boot (message clair) sur une config malformée, plutôt qu'un
 * `Cannot read properties of undefined` plus tard en runtime.
 *
 * Le schéma DÉCRIT (il ne dérive pas les défauts — ceux-ci sont dans `./defaults`).
 * Tous les champs sont `.optional()` : il rejette les TYPES/valeurs invalides, pas
 * l'absence (le merge a déjà rempli les défauts ; le Kernel a des fallbacks
 * résiduels). Les clés inconnues — `module-<x>` (overrides validés par chaque
 * module), `App`, `cluster`… — sont ignorées (objet zod non-strict).
 */
import { z } from "zod";

const serverSchema = z.object({
  port: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Port d'écoute du serveur HTTP en clair. Défaut : 5151."),
});

const logSchema = z
  .object({
    active: z
      .boolean()
      .optional()
      .describe("Active le logger Syslog. Défaut : true."),
    debug: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        'Filtre de debug : `"*"` (tout), une liste de modules/scopes, ou `[]` ' +
          '(rien). Défaut prod : `[]` ; dev : `"*"`.',
      ),
    requestFormat: z
      .enum(["auto", "default", "pretty", "json"])
      .optional()
      .describe(
        "Format de log des requêtes HTTP. `auto` = pretty en dev / json en prod. " +
          "Défaut : `auto`.",
      ),
    buffered: z
      .union([z.boolean(), z.literal("auto")])
      .optional()
      .describe(
        "Bufferise les écritures de log (perf). `auto` décide selon l'env. " +
          "Défaut : `auto`.",
      ),
    driver: z
      .enum(["stdout", "file", "null"])
      .optional()
      .describe(
        "Transport de log principal. `stdout` (cloud-native, collecteur externe), " +
          "`file`, ou `null` (jeté). Override env : `NF_LOG_DRIVER`. Défaut : `stdout`.",
      ),
    dir: z
      .string()
      .optional()
      .describe(
        "Répertoire des logs (`.log` + JSONL queryable + viewer Studio), sous " +
          "cwd. Défaut : `logs`.",
      ),
    file: z
      .object({
        path: z
          .string()
          .optional()
          .describe(
            "Chemin explicite du fichier de log. Défaut : " +
              "`<dir>/nodefony-<pid>.log`.",
          ),
        sync: z
          .boolean()
          .optional()
          .describe(
            "Écriture fichier synchrone (sûre mais lente). Défaut : false.",
          ),
      })
      .optional()
      .describe("Options du driver `file`."),
    maxStack: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Profondeur du ring de relecture du backplane (driver `memory`). Non " +
          "défini : 2000 en dev, repli prod-safe sinon.",
      ),
    queryFile: z
      .object({
        path: z
          .string()
          .optional()
          .describe("Chemin du JSONL relu par le driver de query `file`."),
        maxScanBytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Plafond d'octets scannés en fin de fichier par query."),
      })
      .optional()
      .describe("Options du driver de relecture `file` (query plane JSONL)."),
    queryDriver: z
      .string()
      .optional()
      .describe(
        "Driver de relecture du backplane de log (query plane). Défaut `auto` : " +
          "s'adapte au mode de lancement (mono → `memory`, worker de cluster → " +
          "`cluster-file`, vue unifiée). Valeur explicite (memory/file/loki/…) = surcharge.",
      ),
    loki: z
      .object({
        url: z.string().describe("URL d'ingestion Grafana Loki."),
      })
      .optional()
      .describe("Cible Grafana Loki (si driver/superposition Loki actif)."),
    opensearch: z
      .object({
        url: z.string().describe("URL du cluster OpenSearch."),
      })
      .optional()
      .describe("Cible OpenSearch (si superposition active)."),
  })
  .describe("Observabilité : logger Syslog et ses transports.");

const serversSchema = z
  .object({
    statics: z
      .boolean()
      .optional()
      .describe("Monte le service de fichiers statiques. Défaut : true."),
    http: z
      .union([serverSchema, z.literal(false)])
      .optional()
      .describe(
        "Serveur HTTP/1.1 en clair (port 5151 par défaut). `false` = désactivé " +
          "(déploiement TLS-only) — le WS en clair tombe avec.",
      ),
    https: z
      .union([
        z.object({
          port: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Port d'écoute HTTPS. Défaut : 5152."),
          protocol: z
            .enum(["1.1", "2.0"])
            .optional()
            .describe(
              "Version HTTP servie sur le port TLS. `2.0` = HTTP/2 (h2). Défaut : `2.0`.",
            ),
        }),
        z.literal(false),
      ])
      .optional()
      .describe(
        "Serveur HTTPS (TLS), HTTP/2 par défaut (port 5152). `false` = désactivé " +
          "— cas NOMINAL cloud-native (TLS terminé à l'ingress/LB, le pod sert en " +
          "clair) ; le WSS tombe avec.",
      ),
    ws: z
      .object({})
      .optional()
      .describe("Serveur WebSocket en clair (adossé au serveur HTTP)."),
    wss: z
      .object({})
      .optional()
      .describe("Serveur WebSocket sécurisé (adossé au serveur HTTPS)."),
    portPolicy: z
      .enum(["auto", "strict"])
      .optional()
      .describe(
        "Que faire si le port désiré est DÉJÀ OCCUPÉ. `auto` = prendre le " +
          "prochain port libre (l'app boote quand même, le décalage est ANNONCÉ) — " +
          "confort de dev : plusieurs apps côte à côte. `strict` = échec fatal " +
          "(EADDRINUSE). Défaut : `auto` en développement, `strict` en production " +
          "ET en test. En production le port est un CONTRAT (service k8s, ingress, " +
          "sonde de santé) : écouter ailleurs en silence donnerait un pod « sain » " +
          "que personne n'atteint. En test, un port occupé signale un serveur " +
          "resté debout — le banc doit s'arrêter, pas viser un autre port.",
      ),
    portRetryAttempts: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "En `portPolicy: auto`, nombre de ports essayés APRÈS le port désiré " +
          "avant d'abandonner. Défaut : 20.",
      ),
  })
  .describe("Serveurs réseau activés au boot (HTTP/HTTPS/WS/WSS + statics).");

/**
 * Schéma de la config app résolue. Exposé pour l'introspection (Studio :
 * `z.toJSONSchema(appConfigSchema)` → panneau de config + formulaire éditable).
 *
 * Chaque champ porte un `.describe()` FR (rôle + défaut) → consommé par le
 * panneau de config Studio (`/nodefony/config`, carte de l'app).
 */
export const appConfigSchema = z.object({
  // Manifeste des modules : forme détaillée validée à la résolution (loadModulesFromManifest).
  modules: z
    .array(z.unknown())
    .optional()
    .describe(
      "Manifeste ORDONNÉ des modules chargés (`use(name, config, opts)` ou nom). " +
        "L'ordre = ordre de boot (dépendances inter-modules). Défaut : `[]` (l'app déclare).",
    ),
  locale: z
    .string()
    .optional()
    .describe("Locale par défaut de l'application (i18n). Défaut : `en_en`."),
  templating: z
    .string()
    .optional()
    .describe("Moteur de templates par défaut. Défaut : `eta`."),
  orm: z
    .string()
    .optional()
    .describe(
      "ORM par défaut (clé du driver multi-ORM). Sans défaut framework — piloté " +
        "par l'app / le chantier ORM.",
    ),
  packageManager: z
    .enum(["npm", "yarn", "pnpm", "bun"])
    .optional()
    .describe(
      "Gestionnaire de paquets utilisé par les commandes (install/outdated). " +
        "Défaut : `npm`.",
    ),
  domain: z
    .string()
    .optional()
    .describe(
      "Adresse d'écoute du serveur (`Kernel.setDomain`). Dev : `127.0.0.1` ; " +
        "prod : `0.0.0.0`. Défaut : `localhost`.",
    ),
  domainAlias: z
    .array(z.string())
    .optional()
    .describe(
      "Hôtes alternatifs acceptés par la validation Host (opt-in, croise " +
        "`http.trustedHosts`). Défaut : aucun.",
    ),
  domainCheck: z
    .boolean()
    .optional()
    .describe(
      "Active la validation de l'en-tête Host (anti rebinding/spoofing). Opt-in " +
        "app/sécu. Défaut : false.",
    ),
  servers: serversSchema.optional(),
  // Topologie cluster : forme détaillée portée par resolveTopology.
  cluster: z
    .unknown()
    .optional()
    .describe(
      "Topologie cluster (workers, backplane). Forme détaillée résolue par " +
        "`resolveTopology` ; lue standalone par le master AVANT le boot.",
    ),
  timing: z
    .object({
      enabled: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          "Sonde de phases du pipeline (parse/resolve/firewall/initialize/action/" +
            "render/send) : la matière du waterfall (Studio, debug bar, profiler). " +
            "`null` (défaut) = PAS D'AVIS → active hors production, éteinte en " +
            "production. Un booléen EXPLICITE gagne : `true` allume la sonde en " +
            "production (diagnostic à chaud — coût mesuré, cf docs) ; `false` " +
            "l'éteint partout. Surchargeable sans redéployer : " +
            "`NF__APP__TIMING__ENABLED=true`.",
        ),
      verbose: z
        .boolean()
        .optional()
        .describe(
          "Trace DEBUG détaillant chaque phase au teardown (1 log par requête). " +
            "Implique `enabled`. Défaut : false — à n'allumer que le temps d'un " +
            "diagnostic (le volume nominal n'est pas un signal).",
        ),
    })
    .optional()
    .describe(
      "Instrumentation du pipeline (timing des phases). Éteinte en production " +
        "par défaut : allumée, elle alloue le tableau des phases + une Map par " +
        "requête et appelle `performance.now()` à chaque borne.",
    ),
  shutdownDeadline: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Deadline GLOBALE du shutdown (ms) : au-delà, sortie forcée code 1 même " +
        "si un listener onTerminate pend. Filet cloud-native — garder < grace " +
        "period de l'orchestrateur (30 s k8s, 10 s Docker). 0 = désactivé. " +
        "Défaut : 15000.",
    ),
  log: logSchema.optional(),
});

/** Type inféré de la config app (source unique TS ↔ runtime). */
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * JSON Schema introspectable de la config d'application — destiné au panneau de
 * config Studio (`/nodefony/config`, carte de l'app). Documenté via les
 * `.describe()` du schéma (rôle + défaut de chaque champ).
 */
export function appConfigJsonSchema(): unknown {
  return z.toJSONSchema(appConfigSchema);
}

/**
 * Aplati les issues Zod en libellés `chemin.complet: message`, en DESCENDANT
 * dans les unions : une `invalid_union` (ex. `servers.https` = objet | `false`)
 * masquerait le champ fautif (`servers.http: Invalid input`) — on reprend les
 * issues de la branche la plus informative (celle qui pointe un champ interne)
 * pour garder le diagnostic précis (`servers.http.port: …`).
 */
function flattenZodIssues(
  issues: readonly z.core.$ZodIssue[],
  base: PropertyKey[] = [],
): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const path = [...base, ...issue.path];
    const branches = (issue as { errors?: z.core.$ZodIssue[][] }).errors;
    if (issue.code === "invalid_union" && branches?.length) {
      const best =
        branches.find((b) => b.some((i) => i.path.length > 0)) ?? branches[0];
      out.push(...flattenZodIssues(best, path));
      continue;
    }
    out.push(`${path.join(".") || "(root)"}: ${issue.message}`);
  }
  return out;
}

/**
 * Valide la config app résolue ; lève une erreur au message agrégé si invalide.
 *
 * Appelée par `defineConfig().resolve()` après le deep-merge avec les défauts.
 *
 * @param options - config app résolue à valider.
 * @throws Error si la config ne respecte pas {@link appConfigSchema}.
 */
export function validateAppConfig(options: unknown): void {
  const result = appConfigSchema.safeParse(options);
  if (!result.success) {
    const issues = flattenZodIssues(result.error.issues).join(" · ");
    throw new Error(
      `[nodefony] Configuration d'application invalide : ${issues}`,
    );
  }
}
