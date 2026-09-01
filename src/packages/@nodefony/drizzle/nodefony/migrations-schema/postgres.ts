import {
  createAccessTokenTable,
  createDeniedJtiTable,
  createSubjectRevocationTable,
} from "../entity/tokenEntity";
import { createSessionTable } from "../entity/sessionEntity";
import { createIdempotencyTable } from "../entity/idempotencyEntity";
import { createAuditEventTable } from "../entity/auditEventEntity";
import { createTotpSecretTable } from "../entity/totpSecretEntity";
import { createWebAuthnCredentialTable } from "../entity/webAuthnCredentialEntity";
import { createWebhookEndpointTable } from "../entity/webhookEndpointEntity";

/**
 * Schéma **matérialisé** des tables du framework pour le dialecte `postgres` — la
 * seule entrée que `drizzle-kit` sait lire pour produire les migrations.
 *
 * ⚠️ **Trois contraintes de forme, mesurées, qu'une « factorisation » casserait
 * en silence** :
 *
 * 1. **Un fichier PAR dialecte.** Le dialecte est figé dans la configuration de
 *    `drizzle-kit`, pas passé en argument : il ne peut pas y avoir de fichier
 *    unique paramétré.
 * 2. **Des ré-exports PLATS.** `drizzle-kit` ne collecte que les tables exportées
 *    directement ; une table nichée dans un objet exporté est **ignorée sans un
 *    mot** (vérifié : un fichier exportant une table plate et une table nichée
 *    rend « 1 tables »). Regrouper ces dix constantes dans un objet ferait donc
 *    une migration VIDE, verte.
 * 3. **Rien d'autre que ces exports.** Toute constante supplémentaire de type
 *    table entrerait dans la migration.
 *
 * ⚠️ **`User` n'y figure pas, et c'est une décision.** L'identité est du DOMAINE :
 * la table appartient à l'APPLICATION, qui y ajoute ses champs et en porte les
 * migrations. La livrer ici la rendrait « table du framework » — donc exclue du
 * diff que l'application génère, en silence.
 *
 * Les trois fichiers sont volontairement identiques au dialecte près : ils ne
 * portent aucune décision, seulement l'application des fabriques du `colKit`.
 * La source de vérité reste la spécification de chaque entité — c'est elle qu'on
 * modifie, jamais ce fichier, et le contrôle de dérive le vérifie.
 */
const DIALECT = "postgres" as const;

export const accessToken = createAccessTokenTable(DIALECT);
export const deniedJti = createDeniedJtiTable(DIALECT);
export const subjectRevocation = createSubjectRevocationTable(DIALECT);
export const session = createSessionTable(DIALECT);
export const idempotencyKey = createIdempotencyTable(DIALECT);
export const auditEvent = createAuditEventTable(DIALECT);
export const totpSecret = createTotpSecretTable(DIALECT);
export const webAuthnCredential = createWebAuthnCredentialTable(DIALECT);
export const webhookEndpoint = createWebhookEndpointTable(DIALECT);
