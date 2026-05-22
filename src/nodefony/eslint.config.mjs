// Config ESLint du core déléguée à la config RACINE (source unique de vérité).
// Évite la divergence + le doublon `eslint-plugin-prettier` (style-comme-erreur
// = bruit). Le formatage est géré par Prettier (.prettierrc.json), pas par eslint.
export { default } from "../../eslint.config.mjs";
