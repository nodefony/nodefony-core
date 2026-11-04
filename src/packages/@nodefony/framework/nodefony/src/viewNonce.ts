/**
 * Signature CSP des vues : chaque `<script>` et `<style>` ÉCRIT dans un
 * gabarit reçoit le nonce de la requête, sans geste de l'auteur.
 *
 * La politique par défaut exige un nonce sur les scripts (`'strict-dynamic'`)
 * et sur les styles (ADR-0024 §C1, §C2). Une page écrite vite, par quelqu'un
 * qui ignore tout de la CSP, ne doit pas être bloquée (§C0) : la signature se
 * pose donc au rendu, par le framework.
 *
 * Elle porte sur le TEXTE DU GABARIT, avant que les données y soient insérées :
 * une balise que les données apporteraient (une valeur insérée brute par
 * `<%~ %>`) n'est jamais signée — c'est ce qui garde au nonce sa valeur contre
 * l'injection. Même principe que l'`index.html` d'un front bâti
 * (`prebuiltUi.ts#splitAroundNonce`).
 */

/** Variable de vue qui porte le nonce CSP de la requête (`<%= cspNonce %>`). */
export const VIEW_NONCE_LOCAL = "cspNonce";

/** Ouverture d'une balise `<script` ou `<style` qui ne porte pas de `nonce`. */
const UNSIGNED_TAG_OPEN = /<(script|style)\b(?![^>]*\bnonce\s*=)/giu;

/** Une balise Eta (`<% %>`, `<%= %>`, `<%~ %>`) : du code, jamais du balisage. */
const ETA_TAG = /<%[\s\S]*?%>/gu;

/** Attribut inséré : le nonce, lu dans les variables de la vue à chaque rendu. */
const NONCE_ATTRIBUTE = ` nonce="<%= it.${VIEW_NONCE_LOCAL} %>"`;

/**
 * Ajoute le nonce de la requête à chaque `<script>` et `<style>` littéral du
 * gabarit qui n'en porte pas.
 *
 * Une balise déjà signée par l'auteur est laissée telle quelle ; un `<script`
 * écrit À L'INTÉRIEUR d'une balise Eta (une chaîne de code) n'est jamais
 * touché. Un `<script>` dont un attribut vient des données
 * (`src="<%= it.url %>"`) n'est pas signé non plus : le signer exécuterait
 * l'URL qu'elles apportent. L'auteur qui la tient pour sûre signe lui-même
 * (`nonce="<%= it.cspNonce %>"`). Le rendu doit fournir la variable
 * {@link VIEW_NONCE_LOCAL}.
 *
 * @param source - texte du gabarit Eta, tel que lu sur le disque.
 * @returns le gabarit signé — la MÊME chaîne quand il n'y a rien à signer.
 */
export function signTemplateTags(source: string): string {
  UNSIGNED_TAG_OPEN.lastIndex = 0;
  if (!UNSIGNED_TAG_OPEN.test(source)) return source;
  // Plages occupées par les balises Eta : on n'insère rien dedans.
  let etaRanges: number[] | null = null;
  ETA_TAG.lastIndex = 0;
  for (let m = ETA_TAG.exec(source); m !== null; m = ETA_TAG.exec(source)) {
    (etaRanges ??= []).push(m.index, m.index + m[0].length);
  }
  return source.replace(
    UNSIGNED_TAG_OPEN,
    (tag: string, name: string, offset: number) => {
      if (etaRanges !== null) {
        for (let i = 0; i < etaRanges.length; i += 2) {
          const start = etaRanges[i] ?? 0;
          if (start > offset) {
            // Première balise Eta APRÈS l'ouverture : si elle tombe avant le
            // `>` qui la ferme, un attribut du `<script>` vient des DONNÉES
            // (`src="<%= it.url %>"`) — signer exécuterait ce qu'elles apportent.
            if (
              name.toLowerCase() === "script" &&
              start < source.indexOf(">", offset)
            ) {
              return tag;
            }
            break;
          }
          if (offset < (etaRanges[i + 1] ?? 0)) return tag;
        }
      }
      return tag + NONCE_ATTRIBUTE;
    },
  );
}
