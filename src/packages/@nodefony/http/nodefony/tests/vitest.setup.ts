// Setup vitest (tests unit). reflect-metadata pour les decorators + compat
// mocha : `before`/`after` (vitest ne fournit que beforeAll/afterAll).
import "reflect-metadata";
import { beforeAll, afterAll } from "vitest";
const g = globalThis as Record<string, unknown>;
g.before ??= beforeAll;
g.after ??= afterAll;
