/**
 * Retrait des balises HTML — **une seule implémentation pour tout le dépôt**.
 *
 * Deux scripts extraient du texte depuis du HTML rendu (le sommaire du site de
 * documentation, les titres du README). Chacun portait sa copie ; l'une bouclait
 * jusqu'au point fixe, l'autre non — et c'est celle-là que CodeQL a signalée
 * (`js/incomplete-multi-character-sanitization`, alerte #205). Deux copies d'une
 * même règle divergent en silence : chacune passe ses propres contrôles.
 *
 * ⚠️ Ce module ne peut PAS vivre dans l'un des deux scripts : les importer les
 * EXÉCUTE (ils travaillent au top-level), et lire un titre déclencherait une
 * construction de site.
 */

/**
 * Retire toutes les balises, en **répétant jusqu'au point fixe**.
 *
 * Une passe unique n'est pas idempotente : elle laisse repasser ce qu'elle vient
 * de reformer — `<<b>b>` rend `<b>`, et `<<script>script>` rend `<script>`. La
 * boucle coûte une passe de plus qui ne trouve rien, sur des titres de quelques mots.
 *
 * ⚠️ Ce n'est PAS un assainisseur : la sortie n'est sûre en HTML que si elle est
 * ÉCHAPPÉE au rendu. Un appelant qui décode les entités après coup (`&lt;img
 * onerror=…&gt;`) reforme du HTML actif — c'est l'échappement qui le rend inoffensif.
 *
 * @param html - le fragment dont on veut le texte.
 * @returns le même fragment, sans aucune balise.
 */
export const sansBalises = (html) => {
  let avant;
  let apres = html;
  do {
    avant = apres;
    apres = avant.replace(/<[^>]*>/gu, "");
  } while (apres !== avant);
  return apres;
};
