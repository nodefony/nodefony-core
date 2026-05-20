// Stub @nodefony/sequelize pour les tests unit (résolu via tsconfig paths).
// Évite le crash `Nodefony.getKernel().path` au chargement de la config ORM
// hors kernel. Cf feedback_coverage_modules.
export class SessionStorage {}
export class Connector {}
export class Entity {}
export default { SessionStorage, Connector, Entity };
