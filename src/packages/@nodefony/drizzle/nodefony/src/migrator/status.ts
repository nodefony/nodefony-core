import type { Kernel } from "nodefony";
import type { IDrizzleConfig } from "../../interfaces/IDrizzleConfig";
import { action, buildReport, MIGRATION_FORMAT_VERSION } from "./explain";
import type { IMigrationReport } from "./explain";
import { describeDivergence } from "./divergence";
import { MigrationVerdictError } from "./types";
import type { IMigrationPlan } from "./types";
import {
  buildMigrator,
  readMigrationEnv,
  resetAllowed,
  resolveConnector,
} from "./resolve";
import type { IConnectorResolution } from "./resolve";
import { describeTargetSafely } from "../safeTarget";
import { describeResolutionRefusal, moduleAbsent } from "./refusals";
import type { ICommandFailure, IResolutionRefusal } from "./refusals";

/**
 * L'état des migrations d'un connecteur, rendu en VALEUR — un producteur, deux
 * portes.
 *
 * La ligne de commande et le plan d'administration de la console posent la même
 * question et doivent recevoir le même objet. Le recalculer d'un côté — ne
 * serait-ce que « à jour ou non » — ferait coexister deux vérités : l'écran
 * dirait vert pendant que `orm:migrate:status` sortirait en 1, et c'est
 * précisément le jour d'un déploiement raté qu'on s'en apercevrait.
 *
 * Ce module ne rend donc AUCUN verdict propre : il assemble ce que
 * l'applicateur a calculé, et traduit les refus par la prose unique de
 * {@link describeResolutionRefusal}.
 */

/** Le plan avec son SQL, ou le refus. */
export type IMigrationPlanResult =
  | { ok: true; plan: IMigrationPlanPayload }
  | { ok: false; failure: ICommandFailure };

/** Ce qui s'appliquerait, avec le SQL de chaque migration en attente. */
export interface IMigrationPlanPayload {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  pending: { source: string; tag: string; statements: string[] }[];
}

/** Ce qu'une application a fait, ou le refus. */
export type IMigrationApplyResult =
  | { ok: true; run: IMigrationRunPayload }
  | { ok: false; failure: ICommandFailure };

/** Le compte rendu d'une application. */
export interface IMigrationRunPayload {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  runId: string;
  applied: { source: string; tag: string; executionMs: number }[];
}

/** Le rapport, ou le refus — jamais les deux, jamais rien. */
export type IMigrationStatusResult =
  | { ok: true; report: IMigrationReport }
  | { ok: false; failure: ICommandFailure };

/**
 * Habille un refus en charge utile publiée — la MÊME que celle de `--json`.
 *
 * @param connector - connecteur demandé.
 * @param refusal - ce qu'il y a à en dire.
 * @returns la charge utile d'arrêt.
 */
export function failureFrom(
  connector: string,
  refusal: IResolutionRefusal,
): ICommandFailure {
  return {
    formatVersion: MIGRATION_FORMAT_VERSION,
    connector,
    exitCode: refusal.exitCode,
    error: {
      code: refusal.code,
      summary: refusal.summary,
      meaning: refusal.meaning,
      nextActions: refusal.nextActions,
    },
  };
}

/**
 * Compose la charge utile d'un état — le SEUL endroit où le contexte du rendu
 * est assemblé.
 *
 * Les quatre commandes de migration ET le plan d'administration publient le
 * même objet ; recopier son assemblage les faisait déjà diverger d'un champ à
 * l'autre, et le prochain consommateur à naître aurait oublié celui du jour.
 * La troisième source ne se paie qu'ici, une fois : `describeDivergence`
 * s'abstient toute seule quand le verdict est déjà décidé.
 *
 * @param plan - plan calculé par l'applicateur, en lecture seule.
 * @param resolution - connecteur prêt (porte le mode de schéma effectif).
 * @param config - configuration validée du module.
 * @param kernel - kernel courant, pour constater l'environnement.
 * @returns la charge utile, prête pour `--json` comme pour l'écran.
 */
export async function composeReport(
  plan: IMigrationPlan,
  resolution: Extract<IConnectorResolution, { kind: "ready" }>,
  config: IDrizzleConfig,
  kernel: Kernel | null,
): Promise<IMigrationReport> {
  const mode = config.migrations.divergence;
  return buildReport(plan, {
    ddl: resolution.ddl,
    // `off` veut dire « rien » : on ne la CALCULE même pas. La comparer puis
    // taire le résultat coûterait une requête par table pour une réponse que
    // personne ne lira — et c'était le comportement, la clé n'ayant aucun
    // lecteur.
    divergence: mode === "off" ? null : await describeDivergence(plan),
    divergenceMode: mode,
    canReset: resetAllowed(readMigrationEnv(kernel)),
    // La base RÉELLEMENT visée, et d'où elle vient. La résolution le sait
    // depuis toujours ; personne ne le publiait, si bien qu'une variable de
    // migration oubliée détournait chaque commande en silence.
    target: describeTargetSafely(resolution.target),
    fromMigrateUrl: resolution.fromMigrateUrl,
  });
}

/**
 * Résout le connecteur pour les trois verbes — ou rend le refus.
 *
 * Les trois posent la même question dans le même ordre : le module est-il
 * chargé, le connecteur existe-t-il, est-il migrable. Trois copies auraient
 * fini par répondre trois choses différentes au même cas.
 *
 * @param wanted - connecteur demandé.
 * @param config - configuration validée, `null` si le module n'est pas chargé.
 * @param kernel - kernel courant.
 * @returns le connecteur prêt et sa configuration, ou le refus.
 */
function prepare(
  wanted: string,
  config: IDrizzleConfig | null,
  kernel: Kernel | null,
):
  | {
      ok: true;
      resolution: Extract<IConnectorResolution, { kind: "ready" }>;
      config: IDrizzleConfig;
    }
  | { ok: false; failure: ICommandFailure } {
  if (!config) {
    return { ok: false, failure: failureFrom(wanted, moduleAbsent()) };
  }
  const resolution = resolveConnector(
    wanted,
    config,
    readMigrationEnv(kernel),
    kernel,
    // ⚠️ La variable de migration n'est PAS honorée par le plan
    // d'administration, et c'est délibéré : elle porte le compte qui a le
    // droit de modifier le schéma, réservé au travail de déploiement. Un
    // serveur qui répond à une requête d'administration n'a aucune raison de
    // l'emprunter.
    { allowMigrateUrl: false },
  );
  if (resolution.kind !== "ready") {
    return {
      ok: false,
      failure: failureFrom(
        wanted,
        describeResolutionRefusal(wanted, resolution, config),
      ),
    };
  }
  return { ok: true, resolution, config };
}

/**
 * Traduit n'importe quel échec d'exécution en charge utile publiée.
 *
 * Un refus de l'applicateur porte DÉJÀ son verdict et ses gestes : on les rend
 * tels quels. Tout le reste — base injoignable, droits manquants, verrou
 * impossible — est une panne, et l'écran doit la MONTRER : un tableau vide qui
 * ressemble à « tout va bien » est pire qu'une erreur.
 *
 * @param connector - connecteur concerné.
 * @param e - ce qui a été levé.
 * @returns la charge utile d'arrêt.
 */
function failure(connector: string, e: unknown): ICommandFailure {
  if (e instanceof MigrationVerdictError) {
    return {
      formatVersion: MIGRATION_FORMAT_VERSION,
      connector,
      exitCode: e.verdict.code === "NF_MIGRATE_LOCK_TIMEOUT" ? 2 : 1,
      error: {
        code: e.verdict.code,
        summary: e.message,
        meaning: "",
        nextActions: [...e.verdict.nextActions],
      },
    };
  }
  return {
    formatVersion: MIGRATION_FORMAT_VERSION,
    connector,
    exitCode: 2,
    error: {
      code: "NF_MIGRATE_UNAVAILABLE",
      summary: `Le connecteur « ${connector} » n'a pas pu être lu : ${e instanceof Error ? e.message : String(e)}`,
      meaning:
        "Toucher une base échoue quand celle-ci est injoignable, quand le compte n'a pas le droit de lire l'historique, ou quand le verrou est tenu par un autre travail.",
      nextActions: [
        action(`nodefony orm:migrate:status --connector ${connector}`),
      ],
    },
  };
}

/**
 * Lit l'état des migrations d'un connecteur, sans rien appliquer.
 *
 * @param wanted - connecteur demandé (`default` quand rien n'est précisé).
 * @param config - configuration validée du module, `null` s'il n'est pas chargé.
 * @param kernel - kernel courant.
 * @returns l'état, ou le refus qui explique pourquoi il n'y en a pas.
 */
export async function migrationStatusFor(
  wanted: string,
  config: IDrizzleConfig | null,
  kernel: Kernel | null,
): Promise<IMigrationStatusResult> {
  const prepared = prepare(wanted, config, kernel);
  if (!prepared.ok) {
    return prepared;
  }
  try {
    const migrator = await buildMigrator(
      prepared.resolution,
      prepared.config,
      kernel,
    );
    const plan = await migrator.status();
    return {
      ok: true,
      report: await composeReport(
        plan,
        prepared.resolution,
        prepared.config,
        kernel,
      ),
    };
  } catch (e) {
    return { ok: false, failure: failure(prepared.resolution.connector, e) };
  }
}

/**
 * Ce qui S'APPLIQUERAIT, avec son SQL — lecture seule.
 *
 * Sert la confirmation d'un geste d'application : une modification de schéma
 * ne se confirme pas sur une promesse, elle se confirme sur les instructions
 * qui vont être exécutées.
 *
 * @param wanted - connecteur demandé.
 * @param config - configuration validée du module, `null` s'il n'est pas chargé.
 * @param kernel - kernel courant.
 * @returns le plan, ou le refus.
 */
export async function migrationPlanFor(
  wanted: string,
  config: IDrizzleConfig | null,
  kernel: Kernel | null,
): Promise<IMigrationPlanResult> {
  const prepared = prepare(wanted, config, kernel);
  if (!prepared.ok) {
    return prepared;
  }
  try {
    const migrator = await buildMigrator(
      prepared.resolution,
      prepared.config,
      kernel,
    );
    const plan = await migrator.status();
    return {
      ok: true,
      plan: {
        formatVersion: MIGRATION_FORMAT_VERSION,
        connector: plan.connector,
        pending: plan.pending.map((f) => ({
          source: f.source,
          tag: f.tag,
          statements: [...f.statements],
        })),
      },
    };
  } catch (e) {
    return { ok: false, failure: failure(prepared.resolution.connector, e) };
  }
}

/**
 * Applique les migrations en attente — **DÉVELOPPEMENT seulement**.
 *
 * 🔴 Le refus hors développement n'est pas une précaution d'interface, c'est la
 * doctrine : en production, les migrations s'appliquent dans un travail
 * d'orchestrateur qui se termine AVANT que le premier nouvel exemplaire ne
 * démarre. Les appliquer au clic de quelqu'un qui regarde une console pendant
 * que le trafic passe, c'est modifier un schéma sous les pieds des exemplaires
 * en service. La garde vit ICI, dans le produit — jamais dans l'écran, qui ne
 * protège que celui qui le regarde.
 *
 * @param wanted - connecteur demandé.
 * @param config - configuration validée du module, `null` s'il n'est pas chargé.
 * @param kernel - kernel courant.
 * @returns ce qui a été appliqué, ou le refus.
 */
export async function applyMigrationsFor(
  wanted: string,
  config: IDrizzleConfig | null,
  kernel: Kernel | null,
): Promise<IMigrationApplyResult> {
  const env = readMigrationEnv(kernel);
  if (!resetAllowed(env)) {
    return {
      ok: false,
      failure: failureFrom(wanted, {
        code: "NF_MIGRATE_NOT_DEVELOPMENT",
        summary:
          "Appliquer les migrations depuis la console d'administration est réservé au développement. Rien n'a été appliqué.",
        meaning:
          "En production, les migrations s'appliquent dans un travail dédié qui se termine AVANT que le premier nouvel exemplaire ne démarre — le fichier `deploy/migrate-job.yaml` d'une application générée en est la recette. Les appliquer depuis un serveur qui sert le trafic reviendrait à changer le schéma sous les pieds des exemplaires en service.",
        nextActions: [
          action(`nodefony orm:migrate --connector ${wanted}`),
          action(`nodefony orm:migrate:status --connector ${wanted}`),
        ],
        exitCode: 1,
      }),
    };
  }
  const prepared = prepare(wanted, config, kernel);
  if (!prepared.ok) {
    return prepared;
  }
  try {
    const migrator = await buildMigrator(
      prepared.resolution,
      prepared.config,
      kernel,
    );
    const run = await migrator.migrate();
    return {
      ok: true,
      run: {
        formatVersion: MIGRATION_FORMAT_VERSION,
        connector: prepared.resolution.connector,
        runId: run.runId,
        applied: run.applied.map((a) => ({
          source: a.source,
          tag: a.tag,
          executionMs: a.executionMs,
        })),
      },
    };
  } catch (e) {
    return { ok: false, failure: failure(prepared.resolution.connector, e) };
  }
}
