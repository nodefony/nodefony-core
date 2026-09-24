import { defineConfig } from "vitest/config";

/**
 * Les INVARIANTS DE DÉCOR — joués par la matrice de la CI sur chaque base
 * (PostgreSQL, MariaDB, MongoDB), contre l'application réelle démarrée.
 *
 * Pourquoi une passe à part : les défauts de cette famille ne se montrent que
 * dans UN décor — un connecteur ouvert pour rien sur MongoDB, des entités sans
 * connecteur en production sous dérogation. La suite d'intégration complète,
 * elle, ne tourne qu'en SQLite ; la rejouer par base exigerait d'y prouver
 * chaque cas propre au mode, pour ce qui ne dépend pas de la base.
 *
 * Prérequis : serveur UP sur 5151/5152 (action `nodefony-server`), comptes de
 * développement semés (`admin`).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/integration/stores-location.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
