/**
 * Config du module consommateur de @nodefony/frontend.
 *
 * Aucune surcharge `module-frontend` : Vite reste en HTTP sur la boucle
 * locale, relayé par Nodefony sur l'origine de la page (`/_vite/<famille>/`) —
 * une page servie par server-https (5152) charge ses scripts en HTTPS, sur la
 * même origine, sans réglage.
 */
const config = {};

export default config;
