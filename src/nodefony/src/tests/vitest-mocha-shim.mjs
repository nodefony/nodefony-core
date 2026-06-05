// Shim de `mocha` sous vitest. Deux usages dans les tests du core :
//   - `import "mocha"` (side-effect) → inerte (vitest fournit déjà les globals).
//   - `import { describe, it } from "mocha"` (nommé) → redirigé vers les équivalents
//     vitest, sans toucher aux fichiers concernés.
// `before`/`after` mocha n'ont pas d'équivalent direct → mappés sur beforeAll/afterAll
// (cohérent avec l'alias global de vitest.setup.ts).
import {
  describe,
  it,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";

export {
  describe,
  it,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  beforeAll as before,
  afterAll as after,
};
