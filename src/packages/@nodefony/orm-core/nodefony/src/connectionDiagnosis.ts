/**
 * Diagnostic d'un échec de connexion à une base — **ce qui a été CONSTATÉ**,
 * jamais seulement ce qu'on en déduit.
 *
 * Le message d'échec énumérait trois causes (infrastructure déclarée, base
 * démarrée, entités portées) et aucune n'était la bonne dans un cas fréquent :
 * **un AUTRE serveur occupe déjà le port**. Vécu sur une application fraîchement
 * générée — son PostgreSQL n'était pas démarré, mais le conteneur d'un autre
 * projet écoutait sur `127.0.0.1:5432`. L'application s'y est connectée et a reçu
 * « password authentication failed ». Le message était EXACT, et c'est ce qui le
 * rendait trompeur : il est cru, et il envoie vérifier des identifiants justes.
 *
 * La distinction qui tranche tient en une question : **quelqu'un a-t-il
 * répondu ?** `ECONNREFUSED` dit que non — personne n'écoute, la base n'est pas
 * démarrée. Un refus d'authentification dit que si : un serveur a parlé, donc le
 * port est tenu, et la question devient « par QUI ? ».
 *
 * Vit dans `orm-core` parce que les deux adapters posent la même question : deux
 * implémentations parallèles diraient deux choses différentes du même symptôme.
 */

/** Ce que l'échec permet d'affirmer sur l'autre bout du socket. */
export type ConnectionVerdict =
  /** Personne n'a répondu — rien n'écoute à cette adresse. */
  | "unreachable"
  /** Un serveur a répondu, et il refuse — le port est bien tenu par quelqu'un. */
  | "answered"
  /**
   * La connexion a ABOUTI, puis le serveur a refusé une INSTRUCTION — une
   * table, une contrainte, un type. Ni l'adresse ni l'état de la base ne sont
   * en cause : c'est le schéma envoyé qu'il faut corriger.
   */
  | "rejected"
  /** L'erreur ne permet de trancher ni dans un sens ni dans l'autre. */
  | "unknown";

/** Diagnostic rendu à l'appelant, qui compose le message final. */
export interface IConnectionDiagnosis {
  verdict: ConnectionVerdict;
  /** Code CONSTATÉ, tel que le driver l'a rendu (`ECONNREFUSED`, `28P01`, …). */
  code: string | null;
  /** Ce qu'on peut affirmer, et le geste qui tranche. Déjà rédigé. */
  explanation: string;
}

/** Adresse visée, telle qu'on peut la dire sans divulguer de secret. */
export interface IConnectionTarget {
  host: string | null;
  port: number | null;
  /**
   * Nom de la base désignée par l'URL — de quoi NOMMER une base absente et
   * écrire la commande qui la crée. Absent : la phrase n'en parle pas.
   */
  database?: string | null;
  /** Compte de connexion (jamais son mot de passe) — propriétaire de la base à créer. */
  user?: string | null;
}

/**
 * Personne n'écoute : la couche transport a refusé ou n'a trouvé personne.
 * Ces codes viennent du système, pas du serveur de base de données.
 */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/**
 * Un serveur a répondu ET refusé. Chacun de ces codes est produit par le
 * serveur lui-même — donc il a parlé, donc quelque chose tient le port.
 *
 * PostgreSQL rend des SQLSTATE : classe `28` = autorisation invalide,
 * `3D000` = base inconnue, `53300` = trop de connexions. MySQL et MariaDB
 * rendent des noms `ER_*`. MongoDB nomme ses refus (`AuthenticationFailed`).
 */
const ANSWERED_CODES = new Set([
  // PostgreSQL (SQLSTATE)
  "28P01",
  "28000",
  "3D000",
  "53300",
  // MySQL / MariaDB
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_NOT_SUPPORTED_AUTH_MODE",
  "ER_HOST_NOT_PRIVILEGED",
  // MongoDB
  "AuthenticationFailed",
  "Unauthorized",
]);

/**
 * Classes SQLSTATE (PostgreSQL) qui décrivent la CONNEXION elle-même, pas une
 * instruction : `08` exception de connexion, `57` intervention de l'opérateur
 * (arrêt, base qui démarre). Tout autre SQLSTATE est rendu par un serveur à qui
 * l'on parlait déjà.
 */
const CONNECTION_SQLSTATE_CLASSES = new Set(["08", "57"]);

/**
 * Refus MySQL/MariaDB émis PENDANT l'établissement : le serveur n'a encore
 * exécuté aucune instruction. Tout autre `ER_*` vient d'un serveur connecté.
 */
const MYSQL_CONNECTION_PHASE = new Set([
  "ER_CON_COUNT_ERROR",
  "ER_TOO_MANY_USER_CONNECTIONS",
  "ER_HOST_IS_BLOCKED",
  "ER_SERVER_SHUTDOWN",
]);

/**
 * Le code prouve-t-il que la connexion avait ABOUTI quand le refus est tombé ?
 *
 * Ce n'est vrai que d'un code produit par le SERVEUR en réponse à une
 * instruction : un SQLSTATE PostgreSQL hors des classes de connexion, ou un
 * `ER_*` MySQL hors de la phase d'établissement. Les codes de refus connus
 * ({@link ANSWERED_CODES}) sont tranchés AVANT.
 */
function provesEstablished(code: string): boolean {
  // Un chiffre au moins : un code système de cinq lettres (`EPIPE`) n'est pas
  // un SQLSTATE, et il ne prouve rien d'autre qu'une coupure.
  if (/^[0-9A-Z]{5}$/.test(code) && /[0-9]/.test(code)) {
    return !CONNECTION_SQLSTATE_CLASSES.has(code.slice(0, 2));
  }
  return code.startsWith("ER_") && !MYSQL_CONNECTION_PHASE.has(code);
}

/** Lit le code que le driver a posé sur l'erreur, sans rien supposer de sa forme. */
function readCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const carrier = error as { code?: unknown; codeName?: unknown };
  // `code` chaîne : Node, `pg`, `mysql2`. `codeName` : MongoDB, qui pose AUSSI
  // un `code` NUMÉRIQUE (18 pour `AuthenticationFailed`) — lu en premier, ce
  // nombre masquait le nom, et aucun refus MongoDB n'était reconnu.
  for (const raw of [carrier.code, carrier.codeName]) {
    if (typeof raw === "string" && raw.length > 0) {
      return raw;
    }
  }
  return typeof carrier.code === "number" ? String(carrier.code) : null;
}

/**
 * Extrait l'hôte, le port, la base et le compte d'une URL de connexion, sans
 * son secret.
 *
 * @param url - URL de connexion (`postgres://…`, `mysql://…`, `mongodb://…`).
 * @returns l'adresse visée ; champs à `null` si l'URL est absente ou illisible.
 */
export function parseConnectionTarget(url?: string | null): IConnectionTarget {
  const none = { host: null, port: null, database: null, user: null };
  if (!url) {
    return none;
  }
  try {
    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : null;
    // `decodeURIComponent` lève sur un `%` orphelin : rattrapé ci-dessous, comme
    // une URL illisible — jamais un nom à moitié décodé.
    const database = decodeURIComponent(parsed.pathname.slice(1));
    const user = decodeURIComponent(parsed.username);
    return {
      host: parsed.hostname || null,
      port: Number.isFinite(port) ? port : null,
      database: database || null,
      user: user || null,
    };
  } catch {
    return none;
  }
}

/**
 * Identifiant PostgreSQL entre guillemets — un nom de base peut porter un
 * tiret ou une majuscule, que PostgreSQL plierait ou refuserait nu.
 */
function quotePgIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Identifiant MySQL/MariaDB entre accents graves. */
function quoteMysqlIdent(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

/** Chaîne SQL MySQL/MariaDB entre apostrophes (nom de compte d'un `GRANT`). */
function quoteMysqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * La base désignée manque — ou, sous MySQL/MariaDB, le compte n'y a aucun
 * droit, ce que le serveur ne distingue pas.
 *
 * Les trois codes ne sortent qu'APRÈS l'acceptation du mot de passe (constaté :
 * un mauvais mot de passe rend `28P01` ou `ER_ACCESS_DENIED_ERROR`, même sur
 * une base absente). Vérifier les identifiants n'est donc pas le geste : il
 * faut créer la base, avec un compte qui en a le droit — l'application ne la
 * crée jamais, un compte capable de créer des bases l'est aussi d'en supprimer.
 *
 * @returns l'explication rédigée, ou `null` si le code n'est pas celui d'une
 *   base absente ou si l'URL ne nomme pas la base.
 */
function describeMissingDatabase(
  code: string,
  target: IConnectionTarget,
  where: string,
  portHint: string,
): string | null {
  const database = target.database;
  if (!database) return null;
  const account = target.user ? ` « ${target.user} »` : "";
  const how =
    "La créer avec un compte qui en a le droit (administrateur du serveur, " +
    "ou celui du conteneur dans le décor docker), puis relancer : ";
  // Cette base devrait exister ? Le serveur n'est peut-être pas le bon — le
  // conteneur d'un autre projet, aux identifiants par défaut identiques.
  const elsewhere = portHint
    ? ` Si cette base devrait déjà exister, vérifier que ce port est bien ` +
      `tenu par VOTRE serveur.${portHint}`
    : "";

  if (code === "3D000") {
    const owner = target.user ? ` OWNER ${quotePgIdent(target.user)}` : "";
    return (
      `la base « ${database} » n'existe pas sur le serveur ${where} (${code}) — ` +
      `le serveur a répondu et accepté le compte${account}, mais l'application ` +
      `ne crée jamais sa base (CREATE DATABASE est un privilège ` +
      `d'administration). ${how}` +
      `CREATE DATABASE ${quotePgIdent(database)}${owner};${elsewhere}`
    );
  }

  if (code === "ER_BAD_DB_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") {
    const grant = target.user
      ? ` GRANT ALL PRIVILEGES ON ${quoteMysqlIdent(database)}.* TO ` +
        `${quoteMysqlString(target.user)}@'%';`
      : "";
    // 1044 : un compte sans privilège global ne sait pas si la base manque —
    // MySQL répond pareil pour une base existante qui lui est fermée.
    const doubt =
      code === "ER_DBACCESS_DENIED_ERROR"
        ? `le compte${account} n'a accès à aucune base « ${database} » sur le ` +
          `serveur ${where} (${code}) : soit elle n'existe pas, soit elle ` +
          `existe sans droit pour ce compte — MySQL ne dit pas lequel. `
        : `la base « ${database} » n'existe pas sur le serveur ${where} ` +
          `(${code}). `;
    return (
      `${doubt}Le mot de passe a été accepté, et l'application ne crée jamais ` +
      `sa base (privilège d'administration). ${how}` +
      `CREATE DATABASE IF NOT EXISTS ${quoteMysqlIdent(database)};${grant}` +
      elsewhere
    );
  }
  return null;
}

/**
 * La commande qui nomme QUI tient un port, sur la plateforme visée.
 *
 * La plateforme est un PARAMÈTRE et non une lecture de `process.platform` : la
 * règle se vérifie alors pour les trois systèmes depuis n'importe lequel, sans
 * machine Windows. `netstat` parce que `lsof` n'existe pas sous Windows, et
 * qu'une commande introuvable est un second mystère à résoudre.
 */
function whoHoldsPort(port: number, platform: string): string {
  return platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

/**
 * Explique un échec de connexion en distinguant « personne n'écoute » de
 * « quelqu'un a répondu et refuse ».
 *
 * @param error - l'erreur rendue par le driver.
 * @param target - hôte et port visés (cf {@link parseConnectionTarget}).
 * @param platform - plateforme pour laquelle rédiger le geste ; défaut : la courante.
 * @returns le verdict, le code constaté et une explication déjà rédigée.
 */
export function diagnoseConnectionFailure(
  error: unknown,
  target: IConnectionTarget = { host: null, port: null },
  platform: string = process.platform,
): IConnectionDiagnosis {
  const code = readCode(error);
  const where =
    target.host && target.port
      ? `${target.host}:${target.port}`
      : (target.host ?? "l'adresse configurée");

  if (code !== null && UNREACHABLE_CODES.has(code)) {
    return {
      verdict: "unreachable",
      code,
      explanation:
        `personne n'écoute sur ${where} (${code}) — la base n'est pas démarrée, ` +
        `ou l'adresse configurée n'est pas la sienne.`,
    };
  }

  if (code !== null && ANSWERED_CODES.has(code)) {
    const portHint =
      target.port !== null
        ? ` Pour savoir qui tient ce port : « docker ps --filter publish=${target.port} », ` +
          `ou « ${whoHoldsPort(target.port, platform)} ».`
        : "";
    const missing = describeMissingDatabase(code, target, where, portHint);
    if (missing !== null) {
      return { verdict: "answered", code, explanation: missing };
    }
    return {
      verdict: "answered",
      code,
      explanation:
        `un serveur a RÉPONDU sur ${where} puis a refusé (${code}) — donc quelque ` +
        `chose tient bien ce port. Ce peut être la base attendue avec de mauvais ` +
        `identifiants, mais aussi UN AUTRE SERVEUR (le conteneur d'un autre projet, ` +
        `par exemple) : le refus vient alors d'une base qui n'est pas la vôtre, et ` +
        `vérifier les identifiants ne mène nulle part.${portHint}`,
    };
  }

  if (code !== null && provesEstablished(code)) {
    return {
      verdict: "rejected",
      code,
      explanation:
        `la connexion à ${where} a ABOUTI, puis le serveur a refusé une ` +
        `instruction (${code}) — ce n'est ni l'adresse ni l'état de la base : ` +
        `c'est le schéma envoyé (une table, une contrainte, un type) qu'il faut ` +
        `corriger.`,
    };
  }

  return {
    verdict: "unknown",
    code,
    explanation:
      `échec de connexion à ${where}${code ? ` (${code})` : ""} — vérifier que ` +
      `l'infrastructure déclarée (NF_DATABASE_URL / connectors) désigne bien la ` +
      `base attendue, et qu'elle est démarrée.`,
  };
}

/**
 * Marqueur de la phrase « connecté, puis refusé » — lu par `create app`
 * (`migrationFailureCause`, cœur) pour NE PAS conclure à une base injoignable.
 * Le cœur ne peut pas importer ce paquet : sa copie est éprouvée contre
 * celle-ci par un test de parité.
 */
export const REJECTED_MARKER =
  "s'est connecté, mais le serveur a refusé une instruction — ";

/**
 * Compose le message d'échec au démarrage d'un connecteur — UNE rédaction pour
 * tous les adapters.
 *
 * 🔴 Un refus d'instruction (verdict `rejected`) ne commence JAMAIS par « n'a
 * pas pu se connecter » : c'était faux, et la phrase envoyait vérifier
 * l'adresse et l'état d'une base qui répondait très bien. La cause du pilote
 * passe alors EN TÊTE — c'est elle qui nomme la table ou la contrainte.
 *
 * @param subject - sujet de la phrase (`Drizzle : le connecteur "x" (…)`).
 * @param diagnosis - verdict de {@link diagnoseConnectionFailure}.
 * @param cause - message brut du pilote.
 * @param advice - conseil propre à l'adapter, pour un échec de CONNEXION.
 * @returns le message complet.
 */
export function describeConnectFailure(
  subject: string,
  diagnosis: IConnectionDiagnosis,
  cause: string,
  advice = "",
): string {
  if (diagnosis.verdict === "rejected") {
    const explanation =
      diagnosis.explanation.charAt(0).toUpperCase() +
      diagnosis.explanation.slice(1);
    return (
      `${subject} ${REJECTED_MARKER}${cause}` +
      `${diagnosis.code ? ` (${diagnosis.code})` : ""}. ${explanation}`
    );
  }
  return (
    `${subject} n'a pas pu se connecter — ${diagnosis.explanation}` +
    `${advice} Cause : ${cause}`
  );
}
