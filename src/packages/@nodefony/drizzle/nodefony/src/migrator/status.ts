import type { Kernel } from "nodefony";
import type { IDrizzleConfig } from "../../interfaces/IDrizzleConfig";
import { buildReport, MIGRATION_FORMAT_VERSION } from "./explain";
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

/** Le rapport, ou le refus — jamais les deux, jamais rien. */
export type IMigrationStatusResult =
  | { ok: true; report: IMigrationReport }
  | { ok: false; failure: ICommandFailure };

/**
 * Habille un refus en charge utile publiée — la MÊME que celle de `--json`.
 *
 * @param connector - connecteur demandé.
 * @param refus - ce qu'il y a à en dire.
 * @returns la charge utile d'arrêt.
 */
export function failureFrom(
  connector: string,
  refus: IResolutionRefusal,
): ICommandFailure {
  return {
    formatVersion: MIGRATION_FORMAT_VERSION,
    connector,
    exitCode: refus.exitCode,
    error: {
      code: refus.code,
      summary: refus.summary,
      meaning: refus.meaning,
      nextActions: refus.nextActions,
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
  });
}

/**
 * Lit l'état des migrations d'un connecteur, sans rien appliquer.
 *
 * ⚠️ La variable de migration ({@link MIGRATE_URL_ENV}) n'est **pas** honorée
 * ici, et c'est délibéré : elle porte le compte qui a le droit de modifier le
 * schéma, réservé au travail de déploiement. Un serveur qui répond à une
 * requête d'administration n'a aucune raison de l'emprunter — l'emprunter
 * ferait de la console d'administration une porte vers un privilège que les
 * exemplaires en service n'ont pas.
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
  if (!config) {
    return { ok: false, failure: failureFrom(wanted, moduleAbsent()) };
  }
  const resolution = resolveConnector(
    wanted,
    config,
    readMigrationEnv(kernel),
    kernel,
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
  try {
    const migrator = await buildMigrator(resolution, config, kernel);
    const plan = await migrator.status();
    return {
      ok: true,
      report: await composeReport(plan, resolution, config, kernel),
    };
  } catch (e) {
    // Un refus de l'applicateur porte DÉJÀ son verdict et ses gestes : on les
    // rend tels quels. Tout le reste — base injoignable, droits manquants,
    // verrou impossible — est une panne, et l'écran doit la MONTRER : un
    // tableau vide qui ressemble à « tout va bien » est pire qu'une erreur.
    if (e instanceof MigrationVerdictError) {
      return {
        ok: false,
        failure: {
          formatVersion: MIGRATION_FORMAT_VERSION,
          connector: resolution.connector,
          exitCode: e.verdict.code === "NF_MIGRATE_LOCK_TIMEOUT" ? 2 : 1,
          error: {
            code: e.verdict.code,
            summary: e.message,
            meaning: "",
            nextActions: [...e.verdict.nextActions],
          },
        },
      };
    }
    return {
      ok: false,
      failure: {
        formatVersion: MIGRATION_FORMAT_VERSION,
        connector: resolution.connector,
        exitCode: 2,
        error: {
          code: "NF_MIGRATE_UNAVAILABLE",
          summary: `L'état du connecteur « ${resolution.connector} » n'a pas pu être lu : ${e instanceof Error ? e.message : String(e)}`,
          meaning:
            "La lecture d'un état touche la base : elle échoue quand celle-ci est injoignable, quand le compte n'a pas le droit de lire l'historique, ou quand le verrou est tenu par un autre travail. Rien n'a été modifié.",
          nextActions: [
            {
              command: `nodefony orm:migrate:status --connector ${resolution.connector}`,
              args: ["orm:migrate:status", "--connector", resolution.connector],
            },
          ],
        },
      },
    };
  }
}
