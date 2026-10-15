/**
 * Codes TLS d'une chaîne de certificats qu'aucune autorité CONNUE ne signe.
 *
 * Leur remède est le même : faire reconnaître l'autorité. Un certificat expiré
 * (`CERT_HAS_EXPIRED`) ou émis pour un autre nom (`ERR_TLS_CERT_ALTNAME_INVALID`)
 * n'en fait pas partie : ajouter une autorité n'y changerait rien.
 */
const UNTRUSTED_AUTHORITY_CODES: ReadonlySet<string> = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
]);

/** Le code porté par la `cause` d'un échec de `fetch`, s'il y en a un. */
function causeCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause: unknown = error.cause;
  if (!(cause instanceof Error)) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Rend un échec de transport LISIBLE : `fetch` (undici) ne dit que
 * `fetch failed` et range la vraie raison dans `cause` — certificat refusé,
 * connexion refusée, nom introuvable.
 *
 * @param error - ce que `fetch` (ou une bibliothèque qui l'appelle) a levé
 * @returns `message (CODE : raison)`, ou le message seul faute de cause
 */
export function describeTransportFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const code = causeCode(error);
  return code !== null
    ? `${error.message} (${code} : ${cause.message})`
    : `${error.message} (${cause.message})`;
}

/**
 * Le remède d'un certificat signé par une autorité que le processus ne
 * reconnaît pas — `null` pour tout autre échec.
 *
 * En développement, Nodefony reconnaît d'office l'autorité qu'il a générée ; en
 * production jamais, et c'est voulu. Sans ce remède, le journal ne montrait que
 * `SELF_SIGNED_CERT_IN_CHAIN` : la variable qui le règle n'était écrite que dans
 * un commentaire du `.env`, fichier qu'un serveur de production n'a pas.
 *
 * @param error - ce que `fetch` (ou une bibliothèque qui l'appelle) a levé
 * @returns une phrase d'action, ou `null`
 */
export function untrustedAuthorityHint(error: unknown): string | null {
  const code = causeCode(error);
  if (code === null || !UNTRUSTED_AUTHORITY_CODES.has(code)) return null;
  return (
    "le certificat de ce serveur est signé par une autorité que l'application " +
    "ne reconnaît pas : déclare-la dans NF_TLS_CA_FILE (fichier PEM, " +
    "`http.certificates.extraCaFiles`)"
  );
}
