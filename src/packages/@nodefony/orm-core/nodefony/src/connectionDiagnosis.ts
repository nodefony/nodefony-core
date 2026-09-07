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

/** Lit le code que le driver a posé sur l'erreur, sans rien supposer de sa forme. */
function readCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const carrier = error as { code?: unknown; codeName?: unknown };
  // `codeName` est la forme MongoDB ; `code` celle de Node, `pg` et `mysql2`.
  for (const raw of [carrier.code, carrier.codeName]) {
    if (typeof raw === "string" && raw.length > 0) {
      return raw;
    }
    if (typeof raw === "number") {
      return String(raw);
    }
  }
  return null;
}

/**
 * Extrait l'hôte et le port d'une URL de connexion, sans son secret.
 *
 * @param url - URL de connexion (`postgres://…`, `mysql://…`, `mongodb://…`).
 * @returns l'adresse visée ; champs à `null` si l'URL est absente ou illisible.
 */
export function parseConnectionTarget(url?: string | null): IConnectionTarget {
  if (!url) {
    return { host: null, port: null };
  }
  try {
    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : null;
    return {
      host: parsed.hostname || null,
      port: Number.isFinite(port) ? port : null,
    };
  } catch {
    return { host: null, port: null };
  }
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

  return {
    verdict: "unknown",
    code,
    explanation:
      `échec de connexion à ${where}${code ? ` (${code})` : ""} — vérifier que ` +
      `l'infrastructure déclarée (NF_DATABASE_URL / connectors) désigne bien la ` +
      `base attendue, et qu'elle est démarrée.`,
  };
}
