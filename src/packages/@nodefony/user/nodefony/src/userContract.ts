import type { ISocialProvider } from "../contracts/IUser";

/**
 * Type **logique** d'une colonne de l'utilisateur — ce que la donnée EST, jamais
 * comment un moteur la range.
 *
 * Chaque adaptateur traduit ce vocabulaire dans le sien (`text`/`json`/`bool`
 * du colKit SQL, `String`/`Array`/`Object` d'un schéma Mongoose). Le contrat
 * reste donc lisible par un développeur qui n'a choisi aucune base, et un
 * troisième adaptateur ne demande pas de le rouvrir.
 */
export type UserColumnType =
  "uuid" | "string" | "string[]" | "boolean" | "object" | "object[]" | "date";

/**
 * D'où vient la valeur d'une colonne — ce qui décide si un adaptateur doit la
 * DÉCLARER ou peut la laisser au moteur.
 *
 * - `identity` : la clé primaire. Déclarée en SQL (`text` + UUID applicatif),
 *   fournie par le moteur en document (`_id` + virtuel `id`).
 * - `column` : une colonne ordinaire. **Tout adaptateur doit la déclarer** —
 *   c'est sur elle que porte le test de correspondance.
 * - `audit` : un horodatage. Déclaré en SQL, délégué au moteur en document
 *   (`timestamps: true`).
 */
export type UserColumnOrigin = "identity" | "column" | "audit";

/**
 * Une colonne du contrat utilisateur : son nom, ce qu'elle contient, et **qui la
 * lit**.
 *
 * `readers` n'est pas de la documentation d'agrément : c'est ce qui permet à un
 * refus de démarrage de nommer le lecteur en même temps que la colonne absente
 * (« `socialProviders` manque — `findBySocialProvider` la lit »), au lieu de
 * laisser chercher qui casse. N'y figurent donc que les lecteurs qui touchent la
 * BASE — requête, filtre, tri, projection du dépôt — pas tout code qui manipule
 * un utilisateur déjà chargé.
 */
export interface IUserColumn {
  /** Nom de la colonne, identique sur tous les moteurs (figé en v1). */
  readonly name: string;
  /** Ce que la colonne contient, indépendamment du moteur. */
  readonly type: UserColumnType;
  /** `true` si la colonne accepte l'absence de valeur. */
  readonly nullable: boolean;
  /** `true` si la valeur doit être unique dans l'annuaire (implique un index). */
  readonly unique?: boolean;
  /** Qui fournit la valeur — cf {@link UserColumnOrigin}. */
  readonly origin: UserColumnOrigin;
  /**
   * Fabrique du défaut, appelée à CHAQUE insertion.
   *
   * C'est une fabrique et non une valeur parce qu'un défaut structuré (`[]`,
   * `{}`) partagé par référence serait le MÊME objet pour tous les utilisateurs :
   * une modification en mémoire les contaminerait tous.
   */
  readonly makeDefault?: () => unknown;
  /**
   * `true` si la valeur est régénérée à CHAQUE écriture (horodatage de
   * modification). Déclaré ici plutôt que déduit du nom de la colonne : un
   * adaptateur qui reconnaîtrait `"updatedAt"` rendrait la règle invisible, et
   * fausse le jour où une seconde colonne se comporte pareil.
   */
  readonly refreshedOnWrite?: boolean;
  /** Les lecteurs qui cassent si la colonne manque — nommés dans les refus. */
  readonly readers: readonly string[];
  /** Rôle de la colonne, en une phrase. */
  readonly description: string;
}

/**
 * **Le contrat de colonnes de l'utilisateur** — la seule description de ce que
 * le framework LIT sur un utilisateur persisté.
 *
 * Il existe parce que cette liste était écrite en cinq endroits : la table SQL,
 * le schéma document, la documentation publiée, et bientôt un générateur
 * d'entité et un contrôle de démarrage. Cinq copies d'une même règle divergent
 * en silence, et l'écart ne se voit alors que sur l'installation d'un tiers —
 * même raison, même remède que {@link USER_SORTABLE_FIELDS} et `USER_FILTERS`.
 *
 * Les adaptateurs le DÉRIVENT (`userTable` en SQL, `userSchema` en document) au
 * lieu de le recopier ; un test par adaptateur refuse toute colonne du contrat
 * qui n'aurait pas de correspondance dans la définition produite.
 *
 * ⚠️ **Ces noms sont figés en v1.** Le SQL natif du listing les écrit en dur, et
 * surtout : desserrer un nom est additif, le resserrer est une rupture. Ajouter
 * une colonne ici engage donc toute application qui possède déjà sa table.
 */
export const USER_COLUMNS: readonly IUserColumn[] = [
  {
    name: "id",
    type: "uuid",
    nullable: false,
    origin: "identity",
    readers: ["IUserRepository.findById", "SessionAuthenticator"],
    description:
      "Identifiant interne, stable pour la vie du compte — c'est lui que porte une session.",
  },
  {
    name: "identifier",
    type: "string",
    nullable: false,
    unique: true,
    origin: "column",
    readers: [
      "IUserRepository.findByIdentifier",
      "UserService.authenticate",
      "listUserIdsPage (recherche ?q= et tri par défaut)",
    ],
    description:
      "Identifiant fonctionnel d'authentification (courriel, login) — unique dans l'annuaire.",
  },
  {
    name: "password",
    type: "string",
    nullable: true,
    origin: "column",
    readers: ["UserService.authenticate"],
    description:
      "Empreinte du mot de passe, ou absente pour un compte sans mot de passe local (100 % externe).",
  },
  {
    name: "roles",
    type: "string[]",
    nullable: false,
    makeDefault: () => [],
    origin: "column",
    readers: [
      "listUserIdsPage (filtre ?role=)",
      "IUserRepository.countActiveAdmins",
    ],
    description: "Rôles plats accordés, sans hiérarchie résolue.",
  },
  {
    name: "enabled",
    type: "boolean",
    nullable: false,
    makeDefault: () => true,
    origin: "column",
    readers: [
      "UserService.authenticate",
      "listUserIdsPage (filtre ?enabled=)",
      "IUserRepository.countActiveAdmins",
    ],
    description:
      "Compte utilisable, ou désactivé par décision d'administration.",
  },
  {
    name: "locked",
    type: "boolean",
    nullable: false,
    makeDefault: () => false,
    origin: "column",
    readers: ["UserService.authenticate", "listUserIdsPage (filtre ?locked=)"],
    description: "Compte verrouillé par la défense contre la force brute.",
  },
  {
    name: "currentRole",
    type: "string",
    nullable: true,
    origin: "column",
    readers: ["BaseUser.currentRole"],
    description:
      "Rôle endossé pour la session en cours, parmi ceux que le compte détient.",
  },
  {
    name: "socialProviders",
    type: "object[]",
    nullable: false,
    makeDefault: () => [],
    origin: "column",
    readers: [
      "IUserRepository.findBySocialProvider",
      "listUserIdsPage (filtre ?hasSocial=)",
    ],
    description:
      "Comptes externes liés — tableau libre, pour qu'un nouveau fournisseur ne demande aucune migration.",
  },
  {
    name: "metadata",
    type: "object",
    nullable: false,
    makeDefault: () => ({}),
    origin: "column",
    readers: ["projectProfile", "mergeProfileIntoMetadata"],
    description:
      "Dictionnaire libre du compte, dont le profil public — sans schéma, donc sans migration.",
  },
  {
    name: "createdAt",
    type: "date",
    nullable: false,
    origin: "audit",
    readers: ["listUserIdsPage (tri ?order=createdAt)", "toUserSummary"],
    description: "Date de création du compte.",
  },
  {
    name: "updatedAt",
    type: "date",
    nullable: false,
    origin: "audit",
    refreshedOnWrite: true,
    readers: ["listUserIdsPage (tri ?order=updatedAt)", "toUserSummary"],
    description: "Date de dernière modification du compte.",
  },
];

/**
 * Forme plate d'un utilisateur tel qu'un dépôt le rend, avant reconstruction en
 * `BaseUser` — pendant TypeScript de {@link USER_COLUMNS}.
 *
 * Déclarée ici, et non dans chaque adaptateur, pour la raison qui fonde tout ce
 * fichier : deux copies de la même forme divergent sans que rien ne le dise.
 * Les colonnes JSON arrivent déjà désérialisées, et les dates en `Date` — c'est
 * le travail du pilote, pas celui du dépôt.
 */
export interface IUserRow {
  id: string;
  identifier: string;
  password: string | null;
  roles: string[];
  enabled: boolean;
  locked: boolean;
  currentRole: string | null;
  socialProviders: ISocialProvider[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
