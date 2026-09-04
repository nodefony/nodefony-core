/**
 * `doctor --live` — l'étage 2 : ce que seule l'application DÉMARRÉE peut dire.
 *
 * La lecture pure fait la force de `doctor` : elle répond sur une application
 * qui ne démarre plus. Mais elle est **structurellement incapable** de voir
 * trois choses où l'on tombe en panne — l'état de la base et de ses migrations,
 * la validation d'une zone de firewall par son authentificateur, et ce que le
 * gating de production retire. Aucune de ces vérités n'est dans un fichier :
 * elles naissent au boot.
 *
 * 🔴 **RIEN n'est calculé ici.** Ces vérités ont déjà des producteurs — les
 * mêmes que la console d'administration et que `nodefony inspect` — et le dépôt
 * interdit d'en écrire une seconde version (« 1 RÈGLE = 1 implémentation ») : un
 * verdict recalculé en statique divergerait en silence, et c'est la porte
 * secondaire qu'on croirait sur parole. Ce module APPELLE, traduit un refus en
 * état d'exécution, et rend les phrases du producteur telles quelles.
 *
 * ⚠️ Le core ne peut importer ni l'ORM ni la sécurité (le graphe de dépendances
 * va dans l'autre sens). C'est précisément ce que le plan d'administration
 * permet : on désigne un producteur par son nom (`orm`, `security`), et son
 * absence est une RÉPONSE — « ce module n'est pas chargé » — pas une erreur.
 */
import {
  callAdminEndpoint,
  type IAdminBrokerLike,
} from "../inspect/adminSubjects";
import type { IAdminCaller } from "../adminPlane/adminCaller";
import type { IExecution } from "./report";

/** Les familles que seul un boot peut renseigner. */
export type LiveFamily = "migrations" | "firewall";

/** Un manquement constaté sur l'application VIVANTE. */
export interface ILiveFinding {
  kind: "migrations-not-ok" | "firewall-config-invalid";
  /**
   * La phrase du PRODUCTEUR, telle qu'il l'a écrite.
   *
   * Ni reformulée ni résumée : c'est lui qui sait pourquoi il refuse, et la
   * même phrase s'affiche déjà dans la console d'administration. Deux
   * rédactions du même fait finiraient par se contredire.
   */
  message: string;
  /** Le geste que le producteur propose (`nextActions[0]`), prêt à taper. */
  action?: string;
  /** L'endpoint qui l'a dit — pour aller vérifier à la source. */
  source: string;
}

/** Ce que l'étage 2 a constaté, et ce qu'il n'a PAS pu regarder. */
export interface ILiveResult {
  findings: ILiveFinding[];
  execution: Record<LiveFamily, IExecution>;
}

/** Un objet indexable, sans rien affirmer de son contenu. */
type Bag = Record<string, unknown>;

/** `true` si la valeur est un objet non nul — la seule garde avant d'indexer. */
function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null;
}

/** Lit une chaîne à une clé, ou `undefined` — jamais de `as` aveugle. */
function readString(bag: unknown, key: string): string | undefined {
  if (!isBag(bag)) return undefined;
  const value = bag[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * La première commande proposée par un producteur, telle qu'il l'a écrite.
 *
 * Le contrat est partagé par l'ORM (`IOrmMigrationAction`) et par le pilote SQL
 * (`IMigrationAction`) : `{ command, args }`. On ne lit que `command` — les
 * arguments servent à qui exécute, pas à qui affiche.
 */
function firstAction(payload: unknown): string | undefined {
  if (!isBag(payload)) return undefined;
  const actions = payload.nextActions;
  if (!Array.isArray(actions) || actions.length === 0) return undefined;
  return readString(actions[0], "command");
}

/**
 * L'état des migrations du connecteur par défaut.
 *
 * Trois issues, et chacune se DIT : le module n'est pas là, la base ne migre
 * pas par fichiers (ce n'est pas une panne — une base NoSQL résorbe l'écart
 * autrement), ou le verdict est rendu tel quel.
 */
async function checkMigrations(
  broker: IAdminBrokerLike | undefined,
  caller: IAdminCaller,
): Promise<{ findings: ILiveFinding[]; execution: IExecution }> {
  const read = await callAdminEndpoint(
    broker,
    { namespace: "orm", path: "migrations", label: "état des migrations" },
    caller,
  );

  if (!read.ok) {
    if (read.reason === "producer-missing")
      return {
        findings: [],
        execution: {
          ran: false,
          reason:
            "aucun ORM chargé dans cette application — il n'y a pas de base " +
            "dont l'état pourrait être constaté",
          short: "aucun ORM",
          unlock: 'déclare un module ORM (`use("@nodefony/drizzle")`)',
        },
      };
    // 501 : la base ne se met PAS à jour par migrations versionnées. Le
    // producteur le dit dans son corps ; le répéter en manquement ferait
    // passer une architecture pour une panne.
    const code = readString(
      isBag(read.body) ? read.body.error : undefined,
      "code",
    );
    if (code === "NF_MIGRATE_NO_MIGRATIONS")
      return {
        findings: [],
        execution: {
          ran: false,
          reason:
            readString(
              isBag(read.body) ? read.body.error : undefined,
              "summary",
            ) ?? "cette base ne se met pas à jour par des migrations de schéma",
          short: "sans migrations",
        },
      };
    return {
      findings: [],
      execution: {
        ran: false,
        reason: read.message,
        short: "non lisible",
        ...(read.reason === "endpoint-missing"
          ? { unlock: "vérifie la version du module ORM" }
          : {}),
      },
    };
  }

  const verdict = readString(read.data, "verdict");
  // Un verdict absent n'est PAS un quitus : le producteur a répondu, mais pas
  // ce qu'on lit — le dire vaut mieux que compter zéro manquement.
  if (verdict === undefined)
    return {
      findings: [],
      execution: {
        ran: false,
        reason:
          "le module ORM a répondu sans verdict de migration — format " +
          "inattendu, rien ne peut en être conclu",
        short: "format inattendu",
      },
    };

  if (verdict === "ok") return { findings: [], execution: { ran: true } };

  const summary = readString(read.data, "summary");
  return {
    execution: { ran: true },
    findings: [
      {
        kind: "migrations-not-ok",
        message: summary ?? `migrations : verdict « ${verdict} »`,
        ...(firstAction(read.data) ? { action: firstAction(read.data) } : {}),
        source: "orm/migrations",
      },
    ],
  };
}

/**
 * La cohérence de la configuration du firewall, telle que LUI la voit.
 *
 * Le firewall pose son erreur de configuration au boot et loggue en CRITIC
 * **pendant que le boot continue** : la contradiction est donc connue de
 * l'application, et personne ne va la lire. C'est exactement le genre de fait
 * qu'un diagnostic doit remonter — il ne se voit dans aucun fichier, puisqu'il
 * naît de la confrontation d'une zone et de son authentificateur.
 */
async function checkFirewall(
  broker: IAdminBrokerLike | undefined,
  caller: IAdminCaller,
): Promise<{ findings: ILiveFinding[]; execution: IExecution }> {
  const read = await callAdminEndpoint(
    broker,
    { namespace: "security", path: "firewall", label: "firewall" },
    caller,
  );

  if (!read.ok) {
    if (read.reason === "producer-missing")
      return {
        findings: [],
        execution: {
          ran: false,
          reason:
            "aucun module de sécurité chargé — il n'y a pas de zone dont la " +
            "cohérence pourrait être constatée",
          short: "sans firewall",
          unlock: 'déclare `use("@nodefony/security")`',
        },
      };
    return {
      findings: [],
      execution: { ran: false, reason: read.message, short: "non lisible" },
    };
  }

  // `configValid` est le champ du contrat (`IFirewallDescription`). Son
  // ABSENCE se dit, elle ne se lit pas comme « valide » : c'est la même règle
  // qu'un contrôle sauté — un silence ne vaut pas quitus.
  const description = read.data;
  const valid = isBag(description) ? description.configValid : undefined;
  if (typeof valid !== "boolean")
    return {
      findings: [],
      execution: {
        ran: false,
        reason:
          "le module de sécurité a répondu sans dire si sa configuration est " +
          "valide — format inattendu",
        short: "format inattendu",
      },
    };

  if (valid) return { findings: [], execution: { ran: true } };

  const cause = readString(description, "configError");
  return {
    execution: { ran: true },
    findings: [
      {
        kind: "firewall-config-invalid",
        message:
          "la configuration du firewall est INVALIDE — le pare-feu est en " +
          "repli fermé, toute requête est capturée" +
          (cause ? ` : ${cause}` : ""),
        source: "security/firewall",
      },
    ],
  };
}

/**
 * Interroge l'application démarrée, et rend ce qu'elle SAIT d'elle-même.
 *
 * Les deux familles sont indépendantes : l'absence d'un module en saute une
 * sans rien dire de l'autre. Aucune ne lève — un producteur en panne devient un
 * état d'exécution lisible, jamais une exception qui emporterait le rapport
 * statique, qui est justement celui dont on a besoin quand tout va mal.
 *
 * @param broker - le service `adminBroker` du conteneur, s'il existe
 * @param caller - l'identité annoncée (l'opérateur local possède le processus)
 * @returns les manquements constatés, et l'état d'exécution de chaque famille
 */
export async function collectLiveReport(
  broker: IAdminBrokerLike | undefined,
  caller: IAdminCaller,
): Promise<ILiveResult> {
  const [migrations, firewall] = await Promise.all([
    checkMigrations(broker, caller),
    checkFirewall(broker, caller),
  ]);
  return {
    findings: [...migrations.findings, ...firewall.findings],
    execution: {
      migrations: migrations.execution,
      firewall: firewall.execution,
    },
  };
}

/**
 * L'état d'exécution des deux familles quand l'étage 2 n'a PAS eu lieu.
 *
 * Le cas nominal : `doctor` sans `--live` ne boote pas, donc il ne sait rien de
 * la base ni du firewall — et c'est une abstention à ÉNONCER, pas un silence.
 * Sans cela, un rapport « aucun manquement » se lirait comme un quitus sur des
 * domaines que personne n'a ouverts.
 *
 * @param reason - ce qui a empêché le boot, ou l'absence de demande
 * @param unlock - le geste qui rendrait l'étage 2 possible
 * @returns les deux familles marquées non exécutées, pour la même cause
 */
export function liveNotRun(reason: string, unlock?: string): ILiveResult {
  const execution: IExecution = {
    ran: false,
    reason,
    short: "non demandé",
    ...(unlock ? { unlock } : {}),
  };
  return {
    findings: [],
    execution: { migrations: execution, firewall: execution },
  };
}
