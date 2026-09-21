import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * **Banc de contrat UNIQUE** de la PROMESSE de couverture d'un adaptateur de
 * persistance — celle que l'écran « Stores » de la console d'administration
 * affiche, et que la documentation publie.
 *
 * Elle vit à trois endroits qui n'ont aucun moyen de se contredire bruyamment :
 *
 * 1. le `package.json` de l'adaptateur (`nodefony.stores` / `nodefony.storeKind`),
 *    LU à chaud par `readAdapterManifest` de `KernelAdminApi` ;
 * 2. l'auto-enregistrement du module (`register…FrameworkStores`) ;
 * 3. les registres de `@nodefony/security`, `@nodefony/framework` et
 *    `@nodefony/user`, qui décident de ce que la sélection trouvera au boot.
 *
 * Sans ce banc, une brique retirée du code laisserait le manifeste l'annoncer :
 * la console afficherait une capacité que la sélection ferait échouer au
 * démarrage. L'écart ne crie pas — il se **tait**, et c'est précisément pour
 * cela qu'il faut un test.
 *
 * ⚠️ Le sens inverse compte autant : une brique **ajoutée** au code mais absente
 * du manifeste reste invisible dans la console, donc inutilisée. Les deux
 * directions sont donc vérifiées.
 */
export interface StoreManifestBrick {
  /** Nom de la brique tel qu'il s'écrit dans `nodefony.stores`. */
  brick: string;
  /**
   * Backends enregistrés pour cette brique (`listAuditStores`,
   * `listIdempotencyStores`…). `undefined` quand la brique n'a pas de registre
   * par backend — la session, par exemple, enregistre son STORAGE auprès du
   * service de sessions à l'import du module.
   */
  backends?: () => string[];
  /**
   * L'entité de cette brique est-elle déclarée pour ce connecteur ? Une fabrique
   * sans entité produit un store fabricable mais inopérant : le modèle ou la
   * table n'aura jamais été créé.
   */
  entityPresent?: () => boolean;
}

export interface StoreManifestHarness {
  /** Chemin absolu du `package.json` de l'adaptateur. */
  packageJsonPath: string;
  /** Nom du backend tel qu'il s'enregistre (`"drizzle"`, `"mongoose"`, `"redis"`). */
  engine: string;
  /**
   * Vocation déclarée. `durable` = vocation à TOUTES les briques durables ;
   * `cache` = un sous-ensemble par nature de la donnée, pas par manque.
   */
  storeKind: "durable" | "cache";
  /** Les briques que ce banc sait vérifier — doit couvrir le manifeste EXACTEMENT. */
  bricks: readonly StoreManifestBrick[];
  /**
   * Briques durables attendues d'un adaptateur `durable`. Passer la liste depuis
   * l'appelant plutôt que la figer ici : elle grandit avec le framework, et une
   * liste figée dans un banc se périmerait sans que personne ne le voie.
   */
  durableBricks?: readonly string[];
}

/** Lit le manifeste EXACTEMENT comme le fait la console d'administration. */
function manifest(path: string): {
  storeKind?: string;
  stores?: string[];
} {
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    nodefony?: { storeKind?: string; stores?: unknown };
  };
  const nf = pkg.nodefony ?? {};
  return {
    storeKind: nf.storeKind,
    stores: Array.isArray(nf.stores)
      ? nf.stores.filter((s): s is string => typeof s === "string")
      : undefined,
  };
}

/** Déroule le contrat de manifeste sur l'adaptateur branché. */
export function runStoreManifestContract(harness: StoreManifestHarness): void {
  const stores = () => manifest(harness.packageJsonPath).stores ?? [];

  describe(`manifeste ↔ registres (${harness.engine})`, () => {
    it("le manifeste déclare EXACTEMENT les briques connues du banc", () => {
      // Garde-fou du banc lui-même : une brique ajoutée au manifeste sans être
      // ajoutée ici passerait sinon sans être vérifiée du tout — un test qui ne
      // sait pas ce qu'il ne teste pas est pire qu'une absence de test.
      assert.deepEqual(
        [...stores()].sort(),
        harness.bricks.map((b) => b.brick).sort(),
      );
    });

    it(`se déclare "${harness.storeKind}"`, () => {
      // `storeKind` pilote la LECTURE de la couverture côté console : les
      // absences d'un adaptateur « cache » n'y sont pas des trous. Se déclarer
      // cache à tort masquerait donc tout manque réel.
      assert.equal(
        manifest(harness.packageJsonPath).storeKind,
        harness.storeKind,
      );
    });

    if (harness.storeKind === "durable" && harness.durableBricks) {
      it("porte la TOTALITÉ des briques durables — une app doit tenir sur ce seul backend", () => {
        // La propriété qui fait d'un backend durable un chemin complet : sans
        // elle, choisir cette base oblige à en rapatrier une autre pour une
        // seule brique.
        for (const brick of harness.durableBricks!) {
          assert.ok(
            stores().includes(brick),
            `brique "${brick}" absente du manifeste — la console l'annoncerait manquante`,
          );
        }
      });
    }

    for (const { brick, backends, entityPresent } of harness.bricks) {
      if (backends) {
        it(`brique "${brick}" : "${harness.engine}" est réellement enregistré`, () => {
          assert.ok(
            backends().includes(harness.engine),
            `"${harness.engine}" absent du registre de "${brick}" — le manifeste MENT : ` +
              `la console l'annonce, la sélection échouerait au boot ` +
              `(backends vus : [${backends().join(", ")}])`,
          );
        });
      }
      if (entityPresent) {
        it(`brique "${brick}" : son entité est déclarée`, () => {
          assert.ok(
            entityPresent(),
            `entité de "${brick}" non enregistrée — le store serait fabricable mais inopérant`,
          );
        });
      }
    }
  });
}
