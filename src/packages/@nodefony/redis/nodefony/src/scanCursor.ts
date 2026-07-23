/**
 * Curseur de pagination `SCAN` — **règle unique** des trois stores Redis
 * (sessions, jetons, identifiants WebAuthn).
 *
 * Pourquoi un fichier partagé : ces trois stores portaient chacun leur copie de
 * `encodeCursor`/`decodeCursor`. La copie du store de session a été durcie (un
 * curseur venu de l'extérieur y est validé) ; les deux autres ne l'ont jamais
 * été — un `?cursor=` arbitraire y partait tel quel vers Redis et faisait
 * **échouer une simple consultation**. Deux implémentations d'une même règle
 * dérivent toujours : il n'y en a plus qu'une.
 */

/**
 * Plafond de sécurité d'un balayage administratif complet : au-delà, on s'arrête
 * et on **journalise** (listing partiel signalé, jamais tronqué en silence).
 *
 * `SCAN` est O(keyspace) — un index secondaire (`SET` d'ids) serait
 * l'optimisation v2 pour un très grand parc.
 */
export const MAX_SCAN = 10_000;

/**
 * Curseur de page **composite** : `"<skip>:<curseurRedis>"`.
 *
 * Pourquoi composer plutôt que passer le curseur Redis nu : `SCAN COUNT` est un
 * indice d'effort, pas un plafond — Redis peut rendre plus de clés que demandé
 * (petit keyspace encodé en listpack → tout arrive d'un coup). Sans précaution
 * la page dépasserait `limit` et violerait `IPage`. Le `skip` mémorise combien
 * de clés du batch courant ont déjà été rendues, pour que la page suivante
 * rejoue le même `SCAN` et reprenne à la bonne position. Rien n'est perdu, rien
 * ne déborde.
 */
export function encodeCursor(scanCursor: string, skip: number): string {
  return `${skip}:${scanCursor}`;
}

/**
 * Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé.
 *
 * Le jeton vient de l'extérieur (query string du data plane admin, client qui
 * rejoue une page) : il n'est donc PAS digne de confiance. Un curseur `SCAN`
 * Redis est toujours une suite de chiffres — tout le reste repart de `"0"`
 * plutôt que d'être transmis au serveur, qui répondrait par une erreur et ferait
 * échouer une simple consultation. Repartir du début est faux au pire d'une
 * page ; jeter serait faux à coup sûr.
 *
 * Le split se fait au PREMIER `:` : le curseur Redis est opaque et reste intact
 * même s'il contenait lui-même un `:`.
 */
export function decodeCursor(cursor?: string): {
  scanCursor: string;
  skip: number;
} {
  if (!cursor) return { scanCursor: "0", skip: 0 };
  const sep = cursor.indexOf(":");
  if (sep === -1) {
    // Curseur Redis nu (client externe, ancien format) → honoré s'il est valide.
    return { scanCursor: scanOrZero(cursor), skip: 0 };
  }
  const skip = Number.parseInt(cursor.slice(0, sep), 10);
  return {
    scanCursor: scanOrZero(cursor.slice(sep + 1)),
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

/** Un curseur `SCAN` exploitable (chiffres) ou `"0"` — jamais du texte libre. */
export function scanOrZero(value: string): string {
  return /^\d+$/.test(value) ? value : "0";
}
