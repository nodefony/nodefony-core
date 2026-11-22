import { randomUUID } from "node:crypto";
import { onTestFinished } from "vitest";

/**
 * En-tête qui désigne une requête au témoin des scopes du serveur de test
 * (`src/modules/test/nodefony/controller/scopeWitness.ts`) — même nom des deux
 * côtés.
 */
export const SCOPE_WITNESS_HEADER = "x-scope-witness";

/** Relevé du témoin : scopes inscrits pour la marque, et encore ouverts. */
export interface IScopeReading {
  seen: number;
  open: number;
}

/** Témoin des scopes d'UN banc, armé sur le serveur sous une marque neuve. */
export interface IScopeWitness {
  /** La marque, valeur de {@link SCOPE_WITNESS_HEADER}. */
  readonly mark: string;
  /** L'en-tête à poser sur chaque requête suivie. */
  readonly headers: Record<string, string>;
  /** Relève sans attendre. */
  read(): Promise<IScopeReading>;
  /**
   * Attend, bornée, que plus aucun scope suivi ne reste ouvert — sondage,
   * jamais un délai fixe. Rend le dernier relevé.
   */
  drain(timeoutMs?: number): Promise<IScopeReading>;
  /** Désarme la marque — fait d'office à la fin du test, échec compris. */
  close(): Promise<void>;
}

/** Une réponse JSON du témoin, lue sans conversion. */
function toReading(body: unknown): IScopeReading {
  if (
    typeof body === "object" &&
    body !== null &&
    "seen" in body &&
    "open" in body &&
    typeof body.seen === "number" &&
    typeof body.open === "number"
  ) {
    return { seen: body.seen, open: body.open };
  }
  throw new Error(
    `témoin des scopes : réponse illisible ${JSON.stringify(body)}`,
  );
}

/**
 * Arme le témoin des scopes pour CE banc : seules les requêtes qui portent
 * `witness.headers` entrent au compte.
 *
 * À préférer au compte global (`/scopes` + {@link drainTo}) dès qu'il s'agit
 * de prouver que SES requêtes rendent leur scope : les suites d'intégration de
 * plusieurs paquets tournent en parallèle contre le même serveur, et leurs
 * requêtes en vol s'ajoutent au compte global (#794). Affirmer `seen` en
 * prémisse : un en-tête qui ne serait pas parvenu rendrait `open: 0` sans rien
 * avoir mesuré.
 *
 * À appeler DANS un test : la marque est désarmée à sa fin (`onTestFinished`),
 * qu'il passe ou non — une marque oubliée laisserait les écouteurs du témoin
 * armés sur le serveur, et chaque requête suivante les paierait.
 *
 * @param getJson - GET de l'appelant vers le serveur de test, corps JSON décodé
 * @returns le témoin armé
 */
export async function watchScopes(
  getJson: (path: string) => Promise<unknown>,
): Promise<IScopeWitness> {
  const mark = randomUUID();
  const base = "/nodefony/test/als-test/scopes";
  await getJson(`${base}/watch?mark=${mark}`);
  onTestFinished(async () => {
    await getJson(`${base}/unwatch?mark=${mark}`);
  });
  const read = async (): Promise<IScopeReading> =>
    toReading(await getJson(`${base}/witness?mark=${mark}`));
  return {
    mark,
    headers: { [SCOPE_WITNESS_HEADER]: mark },
    read,
    async drain(timeoutMs = 8000) {
      const t0 = Date.now();
      let reading = await read();
      while (reading.open > 0 && Date.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
        reading = await read();
      }
      return reading;
    },
    async close() {
      await getJson(`${base}/unwatch?mark=${mark}`);
    },
  };
}

/**
 * Attente BORNÉE du drainage des scopes `request` sur le serveur de test.
 *
 * ⚠️ Compte GLOBAL du serveur : les requêtes en vol des AUTRES suites y entrent.
 * Pour prouver que ses propres requêtes rendent leur scope → {@link watchScopes}.
 *
 * Le kernel libère un scope quand IL traite la fin de l'échange — après que le
 * client a reçu la réponse, ou vu la fermeture. Un relevé pris juste après une
 * boucle compte donc encore les derniers scopes en cours de libération. Une
 * vraie fuite ne se draine JAMAIS ; un simple retard se draine en quelques
 * centaines de millisecondes. D'où un sondage borné, jamais un délai fixe, qui
 * mesurerait la machine et non le code.
 *
 * @param read - relève le nombre de scopes `request` ouverts (route
 * `/nodefony/test/als-test/scopes`, champ `requestScopes`)
 * @param base - relevé de référence, pris avant la boucle
 * @param target - l'attente s'arrête dès que l'écart passe SOUS ce seuil
 * @param timeoutMs - borne de l'attente
 * @returns le dernier écart observé par rapport à `base`
 */
export async function drainTo(
  read: () => Promise<number>,
  base: number,
  target = 5,
  timeoutMs = 8000,
): Promise<number> {
  const t0 = Date.now();
  let delta = (await read()) - base;
  while (delta >= target && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    delta = (await read()) - base;
  }
  return delta;
}
