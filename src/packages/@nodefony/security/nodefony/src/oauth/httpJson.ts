/**
 * Lecture BORNÉE d'un corps JSON — la brique de transport commune aux trois
 * appels sortants du social login (découverte, point de jeton, API d'un
 * fournisseur non-OIDC).
 *
 * Elle existe parce qu'une borne posée APRÈS `response.text()` ne protège plus
 * rien : le corps est déjà entièrement en mémoire quand on mesure sa longueur.
 */

/**
 * Lit un corps JSON en refusant de dépasser une taille — la borne est vérifiée
 * PENDANT la lecture, pas après : un corps déjà entièrement en mémoire ne se
 * refuse plus.
 *
 * @param response - réponse dont le corps reste à lire.
 * @param maxBytes - plafond, en octets réels du flux.
 * @param subject - ce qu'on lisait, pour que l'erreur soit exploitable.
 * @returns la valeur JSON telle quelle — un objet OU un tableau (l'API d'un
 *   fournisseur rend les deux ; c'est à l'appelant d'exiger la forme qu'il attend).
 * @throws Error - corps trop gros ou illisible.
 */
export async function readJsonBounded(
  response: Response,
  maxBytes: number,
  subject: string,
): Promise<unknown> {
  const announced = response.headers.get("content-length");
  if (announced !== null && Number(announced) > maxBytes) {
    throw new Error(`${subject} → corps hors gabarit (${announced} octets)`);
  }
  const body = response.body;
  let text: string;
  if (body === null) {
    text = await response.text();
    if (text.length > maxBytes) {
      throw new Error(`${subject} → corps hors gabarit`);
    }
  } else {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel();
        throw new Error(
          `${subject} → corps hors gabarit (> ${maxBytes} octets)`,
        );
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${subject} → corps illisible (JSON attendu)`);
  }
}

/**
 * Comme {@link readJsonBounded}, mais exige un OBJET — la forme de toute réponse
 * normalisée par une RFC (document de métadonnées, réponse d'un point de jeton).
 *
 * @throws Error - corps trop gros, illisible, ou qui n'est pas un objet JSON.
 */
export async function readJsonObjectBounded(
  response: Response,
  maxBytes: number,
  subject: string,
): Promise<Record<string, unknown>> {
  const payload = await readJsonBounded(response, maxBytes, subject);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(`${subject} → corps inattendu (objet JSON attendu)`);
  }
  return payload as Record<string, unknown>;
}
