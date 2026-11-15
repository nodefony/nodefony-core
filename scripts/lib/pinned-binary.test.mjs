import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSha256,
  ensurePinnedBinary,
  probeExecutable,
  sha256Hex,
} from "./pinned-binary.mjs";

let root = "";
let archiveBytes = new Uint8Array();
let archiveSum = "";
let cacheSeq = 0;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "nf-pinned-binary-"));
  const source = path.join(root, "source");
  mkdirSync(source);
  writeFileSync(path.join(source, "tool"), "outil d'origine\n");
  const archivePath = path.join(root, "tool.tar.gz");
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", source, "tool"]);
  if (tar.status !== 0) throw new Error("décor : tar indisponible");
  archiveBytes = new Uint8Array(readFileSync(archivePath));
  archiveSum = sha256Hex(archiveBytes);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Un cache neuf et un transport qui compte ses appels. */
function fixture(sha256 = archiveSum) {
  const cacheDir = path.join(root, `cache-${++cacheSeq}`);
  const calls = { count: 0 };
  const spec = {
    url: "https://exemple.invalid/tool.tar.gz",
    archive: "tool.tar.gz",
    sha256,
    bin: "tool",
    cacheDir,
    fetchBytes: async () => {
      calls.count++;
      return archiveBytes;
    },
  };
  return { spec, calls, cacheDir };
}

describe("assertSha256 — la somme FIGÉE fait foi", () => {
  it("laisse passer les octets dont l'empreinte est la bonne", () => {
    expect(() =>
      assertSha256(
        "a",
        new TextEncoder().encode("abc"),
        sha256Hex(new TextEncoder().encode("abc")),
      ),
    ).not.toThrow();
  });

  it("refuse un seul octet de différence, en nommant l'archive", () => {
    expect(() =>
      assertSha256(
        "a.tar.gz",
        new TextEncoder().encode("abd"),
        sha256Hex(new TextEncoder().encode("abc")),
      ),
    ).toThrow(/a\.tar\.gz : SHA-256 .* binaire refusé/);
  });
});

describe("ensurePinnedBinary — téléchargé, vérifié, extrait", () => {
  it("télécharge une fois, puis sert depuis le cache", async () => {
    const { spec, calls } = fixture();
    const bin = await ensurePinnedBinary(spec);
    expect(readFileSync(bin, "utf8")).toBe("outil d'origine\n");
    await ensurePinnedBinary(spec);
    expect(calls.count).toBe(1);
  });

  it("une somme altérée refuse le binaire, et rien n'entre au cache", async () => {
    const altered = `${archiveSum.slice(0, -1)}${archiveSum.endsWith("0") ? "1" : "0"}`;
    const { spec, cacheDir } = fixture(altered);
    await expect(ensurePinnedBinary(spec)).rejects.toThrow(/binaire refusé/);
    expect(existsSync(path.join(cacheDir, "tool.tar.gz"))).toBe(false);
    expect(existsSync(path.join(cacheDir, "tool"))).toBe(false);
  });

  it("une archive du cache modifiée est refusée, avec le geste qui répare", async () => {
    const { spec, cacheDir } = fixture();
    await ensurePinnedBinary(spec);
    writeFileSync(path.join(cacheDir, "tool.tar.gz"), "archive substituée");
    await expect(ensurePinnedBinary(spec)).rejects.toThrow(
      /binaire refusé .*la supprimer/,
    );
  });

  it("un binaire du cache modifié est remplacé par celui de l'archive vérifiée", async () => {
    const { spec, cacheDir } = fixture();
    await ensurePinnedBinary(spec);
    writeFileSync(path.join(cacheDir, "tool"), "binaire substitué\n");
    const bin = await ensurePinnedBinary(spec);
    expect(readFileSync(bin, "utf8")).toBe("outil d'origine\n");
  });

  it("un cache illisible (autre chose qu'une absence) est une faute, jamais un téléchargement", async () => {
    const { spec, calls, cacheDir } = fixture();
    // Un dossier à la place de l'archive : la lecture échoue sans ENOENT.
    mkdirSync(path.join(cacheDir, "tool.tar.gz"), { recursive: true });
    await expect(ensurePinnedBinary(spec)).rejects.toThrow();
    expect(calls.count).toBe(0);
  });

  it("une archive qui ne contient pas le binaire attendu est une faute nommée", async () => {
    const { spec } = fixture();
    await expect(
      ensurePinnedBinary({ ...spec, bin: "absent" }),
    ).rejects.toThrow(/extraction de tool\.tar\.gz impossible/);
  });
});

describe("probeExecutable — la capacité se CONSTATE en lançant", () => {
  it("un exécutable qui répond est déclaré capable, avec sa sortie", () => {
    const probe = probeExecutable(process.execPath, ["--version"]);
    expect(probe).toEqual({ supported: true, output: process.version });
  });

  it("un fichier introuvable rend la raison système, pas un succès", () => {
    const probe = probeExecutable(path.join(root, "introuvable"), [
      "--version",
    ]);
    expect(probe).toEqual({ supported: false, reason: "ENOENT" });
  });

  it("un code de sortie non nul n'est pas une capacité", () => {
    const probe = probeExecutable(process.execPath, ["-e", "process.exit(3)"]);
    expect(probe).toEqual({ supported: false, reason: "code de sortie 3" });
  });
});
