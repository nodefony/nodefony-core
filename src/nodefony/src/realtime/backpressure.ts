/**
 * Règle UNIQUE de contre-pression de la socket Nodefony (ADR-0022 §5, ADR-0021
 * §S5) : décider d'une frame à partir d'un niveau, d'une borne et d'un SOLDE
 * de refus — rien d'autre. Pure et sans allocation : le serveur
 * (`@nodefony/http`, `decideSend`), le transport du hub et `NodefonySocket`
 * l'appellent chacun avec leur propre état et leur propre geste de fermeture
 * (`1013` côté serveur, `4007` côté navigateur, qui refuse `1013`).
 */

/** Action au dépassement de la borne : jeter la frame, ou fermer aussitôt. */
export type BackpressurePolicy = "drop" | "close";

/** Verdict pour une frame : la laisser passer, la jeter, ou fermer la connexion. */
export type BackpressureVerdict = "send" | "drop" | "close";

/**
 * Décide du sort d'une frame selon le niveau mesuré et le solde de refus courant.
 *
 * Le niveau est la quantité que la borne limite — octets en attente d'envoi
 * (`bufferedAmount`) pour la contre-pression, trames reçues dans la fenêtre
 * pour la borne de débit entrante. Au-delà de la borne, `"close"` en politique
 * `close` ; sinon `"drop"`, jusqu'à ce que le solde atteigne `closeAfterDrops`.
 * Le solde se met à jour par {@link nextDropBalance}, que l'appelant applique
 * au verdict rendu.
 *
 * @param level - niveau mesuré (octets en file, trames dans la fenêtre…)
 * @param bound - borne au-delà de laquelle on refuse ; `<= 0` = désactivée
 * @param policy - action au dépassement
 * @param closeAfterDrops - solde de refus qui ferme ; `0` = ne jamais fermer sur solde
 * @param balance - solde de refus AVANT cette frame
 * @returns le verdict : `"send"`, `"drop"` ou `"close"`
 */
export function decideBackpressure(
  level: number,
  bound: number,
  policy: BackpressurePolicy,
  closeAfterDrops: number,
  balance: number,
): BackpressureVerdict {
  if (bound <= 0 || level <= bound) return "send";
  if (policy === "close") return "close";
  // La file NE PEUT PAS croître au-delà de la borne une fois qu'on jette : un
  // second seuil de niveau serait INATTEIGNABLE (mesuré : 4000 frames poussées
  // à un client qui ne lit pas → 3 servies, aucune fermeture). D'où un SOLDE
  // de refus, qui distingue le pic passager du pair qui n'absorbe plus rien.
  if (closeAfterDrops > 0 && balance + 1 >= closeAfterDrops) return "close";
  return "drop";
}

/**
 * Solde de refus après un verdict : +1 par frame refusée, −1 (plancher 0) par frame passée.
 *
 * Le solde DÉCROÎT au lieu d'être remis à zéro : mesuré sur socket réelle, la
 * file d'un client bloqué OSCILLE autour de la borne (refus, drainage partiel,
 * envoi, refus…) — une remise à zéro empêchait toute fermeture. En décroissant,
 * un pair sain revient vite à 0, un pair qui refuse plus qu'il n'accepte monte.
 *
 * @param verdict - le verdict rendu par {@link decideBackpressure}
 * @param balance - solde AVANT ce verdict
 * @returns le solde APRÈS ce verdict
 */
export function nextDropBalance(
  verdict: BackpressureVerdict,
  balance: number,
): number {
  if (verdict !== "send") return balance + 1;
  return balance > 0 ? balance - 1 : 0;
}
