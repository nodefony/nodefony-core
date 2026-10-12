/**
 * Garde — `UserService` est le SEUL émetteur du cycle de vie d'un compte (#589).
 *
 * Avant, chaque transport (plan d'administration, CLI) réécrivait son émission
 * de `onUserRevoked`, et les deux portes HTTP de changement de mot de passe
 * l'avaient oubliée : la session volée survivait au reset. La règle « le
 * service émet, le kernel transporte » ne tient que si personne d'autre
 * n'émet — un transport qui recommence double la cascade, ou se croit
 * dispensé du service. Cette garde lit TOUT le code de production du dépôt.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/unit → user → @nodefony → packages → src → racine du dépôt.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
);
const ROOTS = [
  path.join(REPO_ROOT, "src", "packages"),
  path.join(REPO_ROOT, "src", "nodefony", "src"),
  path.join(REPO_ROOT, "src", "nodefony", "templates"),
  path.join(REPO_ROOT, "src", "modules"),
  path.join(REPO_ROOT, "nodefony"),
];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "tests", "frontend"]);

/** Une émission DIRECTE d'un événement de cycle de vie, par constante ou par nom. */
const DIRECT_EMISSION =
  /\.(?:fire|emit|fireAsync|emitAsync|emitAsyncGuarded)\(\s*(?:USER_CREATED_EVENT|USER_REVOKED_EVENT|IDENTITY_CHANGED_EVENT|["'`]on(?:UserCreated|UserRevoked|IdentityChanged)["'`])/u;

interface ISourceFile {
  /** Chemin relatif à la racine, séparateurs `/` (il voyage dans un message). */
  file: string;
  source: string;
}

/**
 * Les lignes qui émettent un événement de cycle de vie de compte hors de la
 * porte unique (`UserService.#emit`) — vide quand la règle tient.
 */
function findLifecycleEmitters(files: ISourceFile[]): string[] {
  const found: string[] = [];
  for (const { file, source } of files) {
    source.split("\n").forEach((line, index) => {
      if (DIRECT_EMISSION.test(line)) found.push(`${file}:${index + 1}`);
    });
  }
  return found;
}

/** Sources de production sous une racine (tests, dist, fronts exclus). */
function collectSources(root: string, into: ISourceFile[]): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return; // racine absente (application sans module local) : rien à lire.
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collectSources(full, into);
      continue;
    }
    if (!/\.(?:ts|tpl)$/u.test(entry.name) || entry.name.endsWith(".test.ts")) {
      continue;
    }
    into.push({
      // Normaliser AVANT de comparer ou d'afficher (Windows : `\`).
      file: path.relative(REPO_ROOT, full).split(path.sep).join("/"),
      source: readFileSync(full, "utf8"),
    });
  }
}

describe("Cycle de vie du compte — un SEUL émetteur (#589)", () => {
  it("la garde mord : un transport qui émet lui-même est nommé, fichier et ligne", () => {
    const found = findLifecycleEmitters([
      {
        file: "security/command/x.ts",
        source:
          "const a = 1;\n" +
          "await this.kernel?.fireAsync(USER_REVOKED_EVENT, { id });\n" +
          'kernel.emit("onUserCreated", e);\n' +
          "kernel.fire(IDENTITY_CHANGED_EVENT, { identifier });",
      },
      { file: "ok.ts", source: "await this.#emit(USER_REVOKED_EVENT, e);" },
    ]);
    assert.deepEqual(found, [
      "security/command/x.ts:2",
      "security/command/x.ts:3",
      "security/command/x.ts:4",
    ]);
  });

  it("🔴 aucun code de production n'émet onUserCreated/onUserRevoked/onIdentityChanged en direct", () => {
    const files: ISourceFile[] = [];
    for (const root of ROOTS) collectSources(root, files);
    // Garde anti-suite creuse : un chemin devenu faux lirait zéro fichier.
    assert.ok(
      files.some((f) => f.file.endsWith("service/UserService.ts")),
      "le service lui-même doit faire partie des fichiers lus",
    );
    assert.deepEqual(
      findLifecycleEmitters(files),
      [],
      "émettre passe par UserService (#emit, gardé) — un transport n'émet pas",
    );
  });

  it("la porte unique émet GARDÉ : un abonné en panne ne saute pas les suivants", () => {
    const service = readFileSync(
      path.join(
        REPO_ROOT,
        "src",
        "packages",
        "@nodefony",
        "user",
        "nodefony",
        "service",
        "UserService.ts",
      ),
      "utf8",
    );
    const emit = service.slice(service.indexOf("async #emit("));
    assert.match(emit.slice(0, 400), /\.emitAsyncGuarded\(/u);
  });
});
