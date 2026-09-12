/**
 * Tables dont la perte n'est PAS rattrapable — et le seuil à partir duquel elle
 * ne l'est plus.
 *
 * ## Pourquoi une liste, et pas « toutes les tables »
 *
 * Vider une base de développement est un geste normal et fréquent : une garde
 * qui crie à chaque fois s'apprend à être contournée, et le jour où elle aurait
 * raison, personne ne la lira. Elle ne doit donc se lever que sur ce qui ne se
 * reconstitue pas.
 *
 * ## Ce qui se reconstitue, et qui n'est donc PAS ici
 *
 * - une `session` se refait par un login ;
 * - un `access_token` (jeton personnel, jeton de rafraîchissement) se réémet de
 *   la même façon, et il est de toute façon révocable et daté ;
 * - un `audit_event` est une trace, un `idempotency_key` un cache.
 *
 * Une **passkey**, non : elle est liée à la puce de l'appareil, et personne ne
 * peut la réémettre à la place de son porteur. Un **second facteur** non plus :
 * il faut re-scanner un code. Un **compte**, cela dépend — voir ci-dessous.
 *
 * ## Le seuil : ce qu'un semis d'application repose tout seul
 *
 * Une application générée sème son compte d'administration à chaque démarrage
 * (`nodefony/security/provisionUsers.ts`). Ce compte-là n'est pas perdu quand on
 * vide la base : il revient au prochain boot. Compter `User` dès la première
 * ligne ferait donc crier la garde sur TOUTE application fraîche — exactement le
 * cas normal qu'il ne faut pas gêner. Au-delà, en revanche, quelqu'un a
 * travaillé : un compte créé à la main n'a aucune source qui le repose.
 *
 * Vécu, et c'est la mesure qui fixe le seuil : l'accident a emporté **trois**
 * comptes, dont deux créés à la main.
 *
 * ## Pourquoi une liste écrite ici
 *
 * Le cœur tient déjà la table des entités du framework
 * (`cli/scaffold/reservedEntities.ts`), mais elle n'est pas publiée par le
 * paquet `nodefony` et elle répond à une autre question — « ce nom est-il
 * libre ? », pas « cette table porte-t-elle de l'irremplaçable ? ». La frontière
 * de paquets rend la copie inévitable ; elle n'est pas laissée à la bonne
 * volonté : `identityTables.test.ts` confronte chaque nom à celui du cœur, et
 * tombe si l'un disparaît ou change d'orthographe.
 *
 * ⚠️ `User` appartient à l'APPLICATION (le cœur le marque `appOwned`) : c'est
 * elle qui en porte le schéma et les migrations. Son nom est néanmoins celui que
 * le framework lit partout, donc celui qu'on retrouve en base.
 */

/** Une table d'identité : son nom en base, ce qu'elle porte, et son seuil. */
export interface IIdentityTable {
  /** Nom tel qu'il apparaît dans le catalogue de la base. */
  readonly name: string;
  /** Ce qui disparaît avec elle, dit à l'utilisateur. */
  readonly holds: string;
  /**
   * Nombre de lignes qu'un semis d'application repose au prochain démarrage.
   *
   * En deçà ou à égalité, il n'y a rien à perdre et la garde se tait. `0` =
   * aucune ligne ne se repose, la première compte.
   */
  readonly reseededRows: number;
}

export const IDENTITY_TABLES: readonly IIdentityTable[] = [
  {
    name: "User",
    holds: "des comptes que rien ne repose — un semis ne recrée que l'admin",
    // Le compte d'administration que sème l'application ; au-delà, c'est du
    // travail humain.
    reseededRows: 1,
  },
  {
    name: "webauthn_credential",
    holds: "les passkeys — liées à l'appareil, personne ne peut les réémettre",
    reseededRows: 0,
  },
  {
    name: "totp_secret",
    holds: "les seconds facteurs — il faudra re-scanner un code",
    reseededRows: 0,
  },
];

/** Une table d'identité trouvée en base, avec son nom RÉEL et son seuil. */
export interface IIdentityTableFound {
  /** Nom tel qu'il est réellement écrit dans le catalogue. */
  readonly table: string;
  /** Ce qui disparaît avec elle. */
  readonly holds: string;
  /** Lignes qu'un semis repose (cf {@link IIdentityTable.reseededRows}). */
  readonly reseededRows: number;
}

/**
 * Les tables d'identité PRÉSENTES parmi celles qu'on s'apprête à supprimer.
 *
 * La comparaison ignore la casse : sqlite conserve `User` tel quel, d'autres
 * moteurs replient en minuscules, et une garde sensible à la casse serait
 * inopérante sur la moitié des dialectes — c'est-à-dire exactement là où l'on
 * croirait être protégé.
 *
 * @param tables - noms lus dans le catalogue de la base.
 * @returns les entrées d'identité correspondantes, avec le nom RÉEL de la table.
 */
export function identityTablesAmong(
  tables: readonly string[],
): IIdentityTableFound[] {
  const found: IIdentityTableFound[] = [];
  for (const known of IDENTITY_TABLES) {
    const match = tables.find(
      (t) => t.toLowerCase() === known.name.toLowerCase(),
    );
    if (match !== undefined) {
      found.push({
        table: match,
        holds: known.holds,
        reseededRows: known.reseededRows,
      });
    }
  }
  return found;
}

/**
 * Y a-t-il quelque chose à PERDRE dans cette table ?
 *
 * @param found - table d'identité présente en base.
 * @param rows - nombre de lignes constaté.
 * @returns `true` si la perte dépasse ce qu'un semis repose.
 */
export function rowsWorthKeeping(
  found: IIdentityTableFound,
  rows: number,
): boolean {
  return rows > found.reseededRows;
}
