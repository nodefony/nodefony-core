// index.ts
import nodefony, { kernel } from "./Nodefony";

// Vérifie si module.exports est défini (module CommonJS)
if (typeof module !== "undefined" && module.exports) {
  // Exporte directement l'objet nodefony
  module.exports = nodefony;
}
export default nodefony;
export { kernel, nodefony };
