import { frameworkConfigSchema } from "./schema";

// Config par défaut DÉRIVÉE du schéma Zod (source unique — jamais de défaut
// écrit à la main, cf `feedback_config_validation_zod`). `parse({})` matérialise
// les défauts (`watch: true`). `router`/`adminBroker` restent absents (optional)
// → les Services reçoivent `undefined`, comportement historique inchangé.
export default frameworkConfigSchema.parse({});
