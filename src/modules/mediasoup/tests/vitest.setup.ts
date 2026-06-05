// Setup vitest du banc mediasoup : reflect-metadata (entités ORM décorées) +
// compat mocha `before`/`after` → `beforeAll`/`afterAll` (vitest ne fournit que
// ces deux ; les tests d'intégration utilisent les hooks mocha before/after).
import "reflect-metadata";
import { beforeAll, afterAll } from "vitest";

const g = globalThis as Record<string, unknown>;
g.before ??= beforeAll;
g.after ??= afterAll;
