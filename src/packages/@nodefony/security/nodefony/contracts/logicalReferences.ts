import { USER_TABLE_NAME } from "@nodefony/user";

/**
 * Une colonne d'une table de sécurité qui désigne une autre ligne SANS clé
 * étrangère — la forme exacte d'`IEntityLogicalReference` (`@nodefony/orm-core`),
 * que les adaptateurs passent telle quelle à leurs entités. Recopiée ici plutôt
 * qu'importée : security ne dépend pas d'orm-core, et c'est le compilateur, à
 * l'affectation dans l'adaptateur, qui garde les deux formes identiques.
 */
export interface ISecurityLogicalReference {
  /** Colonne qui porte l'identifiant. */
  readonly column: string;
  /** Entité visée ; absente = référence polymorphe. */
  readonly target?: string;
  /** Colonne visée sur la cible (`id` par défaut). */
  readonly targetColumn?: string;
  /** Colonne qui dit, ligne par ligne, quel genre de cible est visé. */
  readonly discriminator?: string;
  /** Pourquoi la base ne porte pas de contrainte — affiché tel quel. */
  readonly reason: string;
}

const ACCOUNT_REASON =
  "Le porteur est un compte, mais pas forcément une ligne de la table " +
  `${USER_TABLE_NAME} : un compte Keycloak ou OIDC n'y existe pas, et la table ` +
  "des comptes peut vivre dans une autre base. Une clé étrangère refuserait ces porteurs.";

const SUBJECT_REASON =
  "Le porteur est un utilisateur OU un client machine : une clé étrangère ne " +
  "vise qu'une seule table.";

const SESSION_REASON =
  "Le principal de la session est l'IDENTIFIANT du compte (identifier), posé " +
  "à la connexion — vide pour une session anonyme. Sans contrainte : un compte " +
  "externe n'a pas de ligne locale, et une session survit à son compte jusqu'à " +
  "son expiration.";

const SUCCESSOR_REASON =
  "Le jeton qui a remplacé celui-ci à la rotation. Sans contrainte : la purge " +
  "des jetons expirés efface les lignes dans n'importe quel ordre.";

/**
 * Les références logiques des tables de sécurité, par nom d'entité — SEULE
 * déclaration, lue par les deux adaptateurs (Drizzle, Mongoose) au moment où ils
 * enregistrent leurs entités. Une colonne absente du schéma d'un adaptateur
 * (`subjectId` porté par `_id` sous MongoDB) n'est simplement pas dessinée.
 */
export const SECURITY_LOGICAL_REFERENCES = {
  webauthn_credential: [
    { column: "userId", target: USER_TABLE_NAME, reason: ACCOUNT_REASON },
  ],
  totp_secret: [
    { column: "userId", target: USER_TABLE_NAME, reason: ACCOUNT_REASON },
  ],
  access_token: [
    {
      column: "subjectId",
      discriminator: "subjectType",
      reason: SUBJECT_REASON,
    },
    { column: "replacedBy", target: "access_token", reason: SUCCESSOR_REASON },
  ],
  subject_revocation: [{ column: "subjectId", reason: SUBJECT_REASON }],
  session: [
    {
      column: "user",
      target: USER_TABLE_NAME,
      targetColumn: "identifier",
      reason: SESSION_REASON,
    },
  ],
} as const satisfies Readonly<
  Record<string, readonly ISecurityLogicalReference[]>
>;

/** Vue par nom quelconque : une table absente de la déclaration n'a rien. */
const BY_NAME: Readonly<
  Record<string, readonly ISecurityLogicalReference[] | undefined>
> = SECURITY_LOGICAL_REFERENCES;

/**
 * Joint à une entité de sécurité ses références logiques, si elle en a.
 *
 * @param entity - le descripteur que l'adaptateur s'apprête à enregistrer.
 * @returns le même descripteur, avec `logicalReferences` quand la table en déclare.
 */
export function withSecurityReferences<T extends { readonly name: string }>(
  entity: T,
): T & { readonly logicalReferences?: readonly ISecurityLogicalReference[] } {
  const references = BY_NAME[entity.name];
  return references === undefined
    ? entity
    : { ...entity, logicalReferences: references };
}
