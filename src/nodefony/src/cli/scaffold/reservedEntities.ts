/**
 * Noms d'entités que les modules du framework occupent déjà dans le registre ORM.
 *
 * Le registre d'entités est PLAT et partagé par toute l'application : deux entités
 * du même nom ne cohabitent pas. Une application qui déclare la sienne écrase
 * silencieusement celle d'un module, et l'échec ne se voit qu'au démarrage suivant,
 * sous la forme d'une colonne inconnue dans une requête du module dépossédé — un
 * message qui ne nomme ni le doublon, ni le fichier fautif. D'où le refus AVANT
 * d'écrire, avec le nom du propriétaire et une porte de sortie.
 *
 * ⚠️ Cette table décrit le FRAMEWORK, pas les modules tiers : un module applicatif
 * inconnu d'ici peut réserver un nom qu'elle ignore. Elle est tenue honnête par le
 * gate `NF_RUN_CLI_BOOT=1` de `CliIntegration.test.ts`, qui la confronte à ce que
 * `nodefony inspect entities --json` rapporte réellement sur ce dépôt.
 */

/** Entité du framework : le nom occupé et le module qui le porte. */
export interface IReservedEntity {
  /** Nom tel qu'il est enregistré au registre ORM. */
  readonly name: string;
  /** Module propriétaire (nom court, tel que rapporté par `inspect entities`). */
  readonly module: string;
  /** Ce que l'utilisateur devrait faire à la place. */
  readonly advice: string;
  /**
   * `true` quand l'entité appartient à l'APPLICATION et non au framework.
   *
   * Le nom reste connu d'ici — un module le lit, et le registre reste plat —
   * mais il n'est plus INTERDIT : le générateur écrit l'entité au lieu de la
   * refuser, et le contrôle de câblage ne la dénonce plus. Sans cette
   * distinction, les deux lieux qui consultent cette table auraient chacun leur
   * exception, et elles auraient divergé.
   */
  readonly appOwned?: true;
}

export const RESERVED_ENTITY_NAMES: readonly IReservedEntity[] = [
  {
    name: "User",
    module: "user",
    // L'identité est du DOMAINE : la table appartient à l'application, qui y
    // ajoute ses champs et en porte les migrations. Le framework ne la livre
    // plus dans ses migrations — la déclarer est donc le chemin NORMAL, et non
    // plus une reprise « experte » qui marchait en développement et n'atteignait
    // jamais la production.
    appOwned: true,
    advice:
      "l'entité `User` appartient à ton application : `nodefony create entity User " +
      "firstName:string(100)` l'écrit avec les colonnes du contrat, plus les tiennes. " +
      "Sans schéma, la colonne JSON `metadata` reste disponible (aucune migration) ; " +
      "pour une donnée volumineuse ou rarement lue, préfère une entité LIÉE " +
      "(`nodefony create entity Profile bio:text ref:User`) — l'utilisateur est relu " +
      "à chaque requête portant une session",
  },
  {
    name: "session",
    module: "http",
    advice:
      "le stockage de session appartient au pipeline HTTP — choisis un autre nom",
  },
  {
    name: "idempotency_key",
    module: "framework",
    advice: "table interne du décorateur @Idempotent — choisis un autre nom",
  },
  {
    name: "access_token",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "denied_jti",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "subject_revocation",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "audit_event",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "webauthn_credential",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "totp_secret",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
  {
    name: "webhook_endpoint",
    module: "security",
    advice: "table interne du module de sécurité — choisis un autre nom",
  },
];

/**
 * Cherche une collision de nom d'entité avec le framework.
 *
 * Comparaison INSENSIBLE À LA CASSE et aux séparateurs : `AccessToken`,
 * `access_token` et `accesstoken` désignent la même table pour un humain comme
 * pour la plupart des moteurs (MySQL et SQLite comparent les noms de table sans
 * égard à la casse sur les systèmes de fichiers courants). Laisser passer
 * `AccessToken` parce que le registre écrit `access_token` reviendrait à autoriser
 * exactement la panne qu'on cherche à éviter.
 *
 * @param name - nom d'entité demandé (`create entity <Nom>`).
 * @returns l'entrée réservée qui entre en conflit, ou `null` si le nom est libre.
 */
export function findReservedEntity(name: string): IReservedEntity | null {
  const normalize = (s: string): string =>
    s.replace(/[-_]/gu, "").toLowerCase();
  const wanted = normalize(name);
  return (
    RESERVED_ENTITY_NAMES.find((e) => normalize(e.name) === wanted) ?? null
  );
}
