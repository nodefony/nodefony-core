import { BootConfigurationError } from "nodefony";
import type { BridgeVerb } from "nodefony";
import { isRecord } from "../guards";

/**
 * Une route montée, vue par le contrôle des routes de contrat : son chemin
 * complet, les méthodes qu'elle accepte et les schémas qu'elle valide.
 */
export interface IMountedBridgeRoute {
  /** Chemin complet, préfixe du contrôleur compris (`/chat/send`). */
  readonly path: string;
  /** Méthodes acceptées, en capitales ; `undefined` = toutes. */
  readonly methods: ReadonlySet<string> | undefined;
  /** Schémas d'entrée de l'action (`schema` de la route), ou `null`. */
  readonly schema: { readonly body?: unknown; readonly query?: unknown } | null;
}

const BRIDGE_VERBS: ReadonlySet<string> = new Set<BridgeVerb>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
const ROUTE_PARTS = ["body", "query"] as const;

/** Chemin comparable : barres finales retirées, la racine reste `/`. */
function normalizePath(path: string): string {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return end === path.length ? path : path.slice(0, end);
}

/**
 * La route sert-elle CE verbe par le pont ? Le pont résout sur le transport
 * `WEBSOCKET` ; une écriture exige EN PLUS sa méthode logique
 * (`Router.resolve`, `methodOverride`).
 */
function servesByBridge(
  methods: ReadonlySet<string> | undefined,
  verb: string,
): boolean {
  if (methods === undefined) return true;
  if (!methods.has("WEBSOCKET")) return false;
  return verb === "GET" || methods.has(verb);
}

/**
 * Lit la table `serverRoutes` qu'une classe de contrôleur déclare en statique —
 * `null` quand elle n'en déclare pas (aucun contrôle).
 *
 * @param ctor - la classe du contrôleur.
 * @returns la table, ou `null`.
 * @throws BootConfigurationError si la table n'est pas un objet.
 */
export function readContractRoutes(
  ctor: object,
): Record<string, unknown> | null {
  const table: unknown = Reflect.get(ctor, "serverRoutes");
  if (table === undefined) return null;
  if (!isRecord(table)) {
    throw new BootConfigurationError(
      `${typeof ctor === "function" ? ctor.name : "(contrôleur)"} : « serverRoutes » ` +
        `doit être un objet { "<VERBE> <chemin>": { body?, query? } }.`,
    );
  }
  return table;
}

/**
 * Vérifie, au démarrage, que chaque route du contrat est SERVIE par le pont :
 * une route montée au même chemin, qui accepte le verbe par la socket, et dont
 * les schémas sont LES MÊMES OBJETS que ceux que la table déclare. Coût nul par
 * requête : la vérification n'a lieu qu'une fois.
 *
 * Sans elle, un contrat qui type `chat.post("/chat/send", …)` compilerait
 * contre une route absente, servie en HTTP seulement, ou validant un autre
 * schéma — et l'erreur n'apparaîtrait qu'au premier appel.
 *
 * @param owner - nom de la classe qui déclare la table (pour le message).
 * @param table - la table `serverRoutes` (`"<VERBE> <chemin>"` → `{ body?, query? }`).
 * @param mounted - les routes montées.
 * @throws BootConfigurationError à la première entrée qui n'est pas servie ;
 *   le message nomme la classe, l'entrée et la cause.
 */
export function assertContractRoutes(
  owner: string,
  table: Record<string, unknown>,
  mounted: readonly IMountedBridgeRoute[],
): void {
  for (const entry in table) {
    const where = `${owner}.serverRoutes « ${entry} »`;
    const space = entry.indexOf(" ");
    const verb = space === -1 ? "" : entry.slice(0, space);
    const rawPath = space === -1 ? "" : entry.slice(space + 1);
    if (!BRIDGE_VERBS.has(verb) || rawPath.charCodeAt(0) !== 47) {
      throw new BootConfigurationError(
        `${where} : la clé s'écrit "<VERBE> <chemin>", VERBE parmi ` +
          `${[...BRIDGE_VERBS].join(", ")}, chemin commençant par « / ».`,
      );
    }
    const declared = table[entry];
    if (!isRecord(declared)) {
      throw new BootConfigurationError(
        `${where} : la valeur s'écrit { body?, query? } (les schémas de la route).`,
      );
    }
    for (const key in declared) {
      if (key !== "body" && key !== "query") {
        throw new BootConfigurationError(
          `${where} : clé « ${key} » inconnue — seuls body et query se déclarent.`,
        );
      }
    }
    const path = normalizePath(rawPath);
    const atPath = mounted.filter((r) => normalizePath(r.path) === path);
    if (atPath.length === 0) {
      throw new BootConfigurationError(
        `${where} : aucune route montée au chemin ${path}.`,
      );
    }
    const route = atPath.find((r) => servesByBridge(r.methods, verb));
    if (route === undefined) {
      throw new BootConfigurationError(
        `${where} : la route ${path} ne sert pas ${verb} par la socket — ` +
          `ses méthodes doivent inclure ${verb === "GET" ? "" : `"${verb}" et `}"WEBSOCKET".`,
      );
    }
    for (const part of ROUTE_PARTS) {
      const expected = declared[part];
      const actual = route.schema?.[part];
      if (expected !== actual) {
        throw new BootConfigurationError(
          `${where} : le schéma « ${part} » ${
            expected === undefined
              ? "n'est pas déclaré, mais la route en valide un"
              : actual === undefined
                ? "est déclaré, mais la route n'en valide aucun"
                : "n'est pas celui que la route valide (même objet attendu)"
          }.`,
        );
      }
    }
  }
}
