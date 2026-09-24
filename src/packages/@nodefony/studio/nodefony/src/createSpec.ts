import {
  getScaffoldContext,
  getScaffoldSpec,
  hydrateQuestion,
  scaffoldCaps,
} from "nodefony";
import type {
  IScaffoldCaps,
  IScaffoldConnector,
  IScaffoldContext,
  IScaffoldTypeSpec,
} from "nodefony";

/**
 * Types de scaffold servis par l'écran « Créer ».
 *
 * `app` en fait partie, avec une différence de nature : les quatre autres modifient le
 * projet COURANT (ils y écrivent et le recâblent), tandis qu'une app naît AILLEURS — dans
 * un espace de travail voisin. D'où sa destination, qui n'est pas une question de plus du
 * formulaire mais une **recomposition côté serveur** sous une racine autorisée (cf
 * `resolveScaffoldDestination` : le client choisit une racine par identifiant et un nom,
 * jamais un chemin).
 */
export const STUDIO_TYPES = [
  "app",
  "module",
  "controller",
  "front",
  "entity",
] as const;

/** Connecteurs de l'application qui tourne, lus dans son registre ORM. */
export interface ILiveConnectors {
  /** Connecteurs que le générateur sait écrire, dans l'ordre du registre. */
  connectors: IScaffoldConnector[];
  /** Celui qui porte les stores — présélectionné par le formulaire. */
  preferred?: string;
}

/** Ce que le formulaire reçoit du moteur, pour UN projet. */
export interface IStudioCreateSpec {
  /** Les types servis, questions `optionsFrom` HYDRATÉES par les choix réels du projet. */
  specs: IScaffoldTypeSpec[];
  /** Capacités constatées — pilotent les questions `askIf`. */
  caps: IScaffoldCaps;
  /** Connecteurs, entités, et ce que devient chaque type de champ sur chaque moteur. */
  context: IScaffoldContext | null;
}

/**
 * Compose la matière du formulaire « Créer » pour le projet `projectRoot` — la part
 * du data plane `create/spec` qui dépend du PROJET.
 *
 * Extraite du controller pour s'éprouver sur une application SQL ET une
 * application MongoDB, sans serveur : c'est l'ORM qui change la réponse
 * (connecteur, types, capacités).
 *
 * **Les connecteurs sont ceux de l'application qui TOURNE** quand l'appelant les
 * fournit : Studio est servi par elle, et son registre ORM est la vérité — la
 * même que montre la page ORM. Relire le texte de la configuration taisait un
 * connecteur chargé sous condition (`nodefony` sur une infra MongoDB) et
 * proposait `default` là où il n'existe pas. La règle suit le NIVEAU DE
 * DÉMARRAGE, pas le front : quiconque tourne avec l'ORM enregistré (Studio, une
 * commande qui boote jusque-là) lit la mémoire ; seul ce qui ne démarre pas
 * l'application (le scaffold en 0-boot) relit la configuration. Un data plane
 * n'a aucune raison de deviner ce qu'il peut constater.
 *
 * @param projectRoot - racine de l'application servie.
 * @param live - connecteurs du registre ORM en mémoire et celui qui porte les
 *   stores (cf {@link connectorsFromOrmSummaries}), qui font foi même vides ; `null` =
 *   aucun registre à interroger (rien n'a démarré) ⇒ lecture de la configuration.
 * @returns specs hydratées, capacités et contexte du projet.
 */
export function composeCreateSpec(
  projectRoot: string,
  live: ILiveConnectors | null = null,
): IStudioCreateSpec {
  const read = getScaffoldContext(projectRoot);
  const context =
    read && live !== null
      ? {
          ...read,
          // Le réglage `ddl` n'existe que dans la configuration écrite : on le
          // reprend pour le connecteur de même nom.
          connectors: live.connectors.map((c) => {
            const ddl = read.connectors.find((d) => d.name === c.name)?.ddl;
            return ddl === undefined ? c : { ...c, ddl };
          }),
        }
      : read;
  const specs = getScaffoldSpec()
    .filter((s) => (STUDIO_TYPES as readonly string[]).includes(s.type))
    // oxlint-disable-next-line no-map-spread -- la spec du moteur est PARTAGÉE : y écrire les questions hydratées la polluerait pour la requête suivante et pour le terminal
    .map((s) => ({
      ...s,
      questions: s.questions.map((q) => {
        const hydrated = hydrateQuestion(q, context);
        // Le connecteur PRÉSÉLECTIONNÉ est celui qui porte les stores — le
        // défaut est un rôle constaté, pas le nom `default`.
        return q.optionsFrom === "connectors" &&
          live?.preferred &&
          hydrated.choices?.some((c) => c.value === live.preferred)
          ? { ...hydrated, default: live.preferred }
          : hydrated;
      }),
    }));
  return { specs, caps: scaffoldCaps(projectRoot), context };
}

/** Moteurs que le générateur sait écrire, par `driver` publié du connecteur. */
const DRIVER_DIALECT: Readonly<Record<string, IScaffoldConnector["dialect"]>> =
  {
    sqlite: "sqlite",
    postgres: "postgres",
    mysql: "mysql",
    // MariaDB parle le dialecte MySQL : c'est celui qu'écrit le générateur.
    mariadb: "mysql",
    mongodb: "mongodb",
  };

/**
 * Traduit la réponse de `orm/orms` (registre ORM en mémoire) en connecteurs du
 * générateur.
 *
 * La forme est VÉRIFIÉE, pas supposée : Studio ne dépend pas d'`orm-core`, il
 * reçoit du JSON par le broker. Un connecteur dont le moteur n'est pas publié,
 * ou que le générateur ne sait pas écrire, est écarté — le proposer ferait
 * générer une entité dans un dialecte deviné.
 *
 * @param raw - réponse de l'endpoint (`IOrmSummary[]`), ou `null` s'il manque.
 * @returns les connecteurs dans l'ordre du registre, et celui que le registre
 *   marque par défaut (qui porte les stores) ; `null` si la réponse n'est pas
 *   exploitable.
 */
export function connectorsFromOrmSummaries(
  raw: unknown,
): ILiveConnectors | null {
  if (!Array.isArray(raw)) return null;
  const connectors: IScaffoldConnector[] = [];
  let preferred: string | undefined;
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const {
      name,
      connection,
      default: isDefault,
    } = item as {
      name?: unknown;
      connection?: { driver?: unknown };
      default?: unknown;
    };
    const driver = connection?.driver;
    if (typeof name !== "string" || typeof driver !== "string") continue;
    const dialect = DRIVER_DIALECT[driver.toLowerCase()];
    if (!dialect) continue;
    connectors.push({ name, dialect });
    if (isDefault === true) preferred = name;
  }
  return preferred === undefined ? { connectors } : { connectors, preferred };
}
