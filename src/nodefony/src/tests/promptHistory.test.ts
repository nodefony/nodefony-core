/**
 * L'historique de l'invite (`service/dev/promptHistory.ts`, #538 D11) : la
 * liste pure, puis son fichier dans un dossier jetable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import {
  PROMPT_HISTORY_CAPACITY,
  PROMPT_HISTORY_FILE,
  PROMPT_HISTORY_MAX_TEXT,
  PromptHistory,
  PromptHistoryEntry,
  PromptHistoryFile,
  serializeHistoryEntry,
} from "../service/dev/promptHistory";

const texts = (history: PromptHistory): string[] =>
  Array.from({ length: history.length }, (_, i) => history.at(i)?.text ?? "");

describe("PromptHistory — garder", () => {
  it("erasedups : la même saisie du même onglet remonte en queue, son compteur la suit", () => {
    const history = new PromptHistory();
    history.remember("status", "server", 1);
    history.remember("env", "server", 2);
    history.remember("status", "server", 3);
    expect(texts(history)).to.deep.equal(["env", "status"]);
    expect(history.at(1)?.count).to.equal(2);
    expect(history.at(1)?.at).to.equal(3);
  });

  it("la même saisie dans un AUTRE onglet est une autre entrée", () => {
    const history = new PromptHistory();
    history.remember("clear", "server", 1);
    history.remember("clear", "vite", 2);
    expect(history.length).to.equal(2);
  });

  it("ignorespace, secret, trop longue, vide : non gardées, la raison est rendue", () => {
    const history = new PromptHistory();
    expect(history.remember(" status", "server", 1)).to.deep.equal({
      kept: false,
      reason: "leading-space",
    });
    for (const secret of [
      "users:add --password hunter2",
      "env API_KEY=abc",
      "set token: xyz",
    ]) {
      expect(history.remember(secret, "server", 1)).to.deep.equal({
        kept: false,
        reason: "secret",
      });
    }
    expect(
      history.remember("a".repeat(PROMPT_HISTORY_MAX_TEXT + 1), "server", 1),
    ).to.deep.equal({ kept: false, reason: "too-long" });
    expect(history.remember("  ", "server", 1)).to.deep.equal({
      kept: false,
      reason: "empty",
    });
    expect(history.length).to.equal(0);
  });

  it("bornée : au-delà de la capacité, la plus ancienne sort", () => {
    const history = new PromptHistory(3);
    for (const text of ["a", "b", "c", "d"])
      history.remember(text, "server", 1);
    expect(texts(history)).to.deep.equal(["b", "c", "d"]);
  });
});

describe("PromptHistory — retrouver", () => {
  const history = new PromptHistory();
  history.remember("inspect routes", "server", 1);
  history.remember("inspect modules", "server", 2);
  history.remember("inspect env", "vite", 3);
  history.remember("status", "server", 4);

  it("matching : cet onglet, filtré par le préfixe, la plus ancienne d'abord", () => {
    expect(history.matching("server", "insp")).to.deep.equal([
      "inspect routes",
      "inspect modules",
    ]);
    expect(history.matching("server", "status")).to.deep.equal([]);
  });

  it("suggest : la plus récente de cet onglet d'abord, d'un autre sinon", () => {
    expect(history.suggest("server", "inspect ")).to.equal("modules");
    expect(history.suggest("vite", "inspect ")).to.equal("env");
    expect(history.suggest("vite", "sta")).to.equal("tus");
    expect(history.suggest("server", "")).to.equal("");
  });

  it("search : chaque mot, sans accents ni casse, fréquence et récence", () => {
    const h = new PromptHistory();
    h.remember("créer module", "server", 0);
    h.remember("inspect routes", "server", 0);
    h.remember("inspect routes", "server", 0);
    h.remember("inspect routes", "server", 0);
    h.remember("inspect modules", "server", 60_000 * 60);
    const now = 60_000 * 60;
    expect(h.search("CREER", now).map((e) => e.text)).to.deep.equal([
      "créer module",
    ]);
    // modules : 1 saisie à l'instant (1 + 30) ; routes : 3 saisies il y a
    // une heure (3 + 30/61).
    expect(h.search("inspect", now).map((e) => e.text)).to.deep.equal([
      "inspect modules",
      "inspect routes",
    ]);
    expect(h.search("mod ins", now)).to.have.length(1);
  });

  it("suggest ignore une saisie plus longue que la borne de l'éditeur", () => {
    const h = new PromptHistory();
    h.remember(`x${"a".repeat(2000)}`, "server", 1);
    expect(h.suggest("server", "x")).to.equal("");
  });

  it("source : une par onglet, gardée", () => {
    expect(history.source("server")).to.equal(history.source("server"));
    expect(history.source("server").matching("st")).to.deep.equal(["status"]);
  });
});

describe("PromptHistory — fichier", () => {
  const dirs: string[] = [];
  const project = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-prompt-history-"));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("absent : historique vide, aucune erreur ; puis une ligne par envoi, dossier créé", async () => {
    const root = project();
    const errors: unknown[] = [];
    const file = new PromptHistoryFile(root, (e) => errors.push(e));
    await file.load();
    expect(file.history.length).to.equal(0);
    for (const [text, at] of [
      ["status", 10],
      [" secret", 11],
      ["env", 12],
    ] as const) {
      const kept = file.remember(text, "server", at);
      if (kept.kept) file.settle(kept.entry, 0, 5);
    }
    await file.flush();
    const content = fs.readFileSync(
      path.join(root, PROMPT_HISTORY_FILE),
      "utf8",
    );
    expect(content.split("\n").filter(Boolean)).to.have.length(2);
    expect(errors).to.deep.equal([]);
  });

  it("relu : erasedups rejoué, compteur cumulé, ligne malformée ignorée", async () => {
    const root = project();
    fs.mkdirSync(path.join(root, "var"));
    fs.writeFileSync(
      path.join(root, PROMPT_HISTORY_FILE),
      '{"t":"status","v":"server","at":1,"code":0,"ms":1700}\n' +
        "{tronqué\n" +
        '{"t":"env","v":"server","at":2}\n' +
        '{"t":"status","v":"server","at":3}\n' +
        '{"t":42,"v":"server","at":4}\n',
    );
    const file = new PromptHistoryFile(root, () => {});
    await file.load();
    expect(texts(file.history)).to.deep.equal(["env", "status"]);
    expect(file.history.at(1)?.count).to.equal(2);
  });

  it("une saisie envoyée AVANT la fin de la lecture n'est comptée qu'une fois", async () => {
    const root = project();
    const first = new PromptHistoryFile(root, () => {});
    const status = first.remember("status", "server", 1);
    if (status.kept) first.settle(status.entry, 0, 1);
    await first.flush();
    const second = new PromptHistoryFile(root, () => {});
    // Envoyée avant toute lecture ; l'écriture finie, la lecture ne doit pas
    // relire la ligne qu'elle vient d'ajouter.
    const doctor = second.remember("doctor", "server", 2);
    if (doctor.kept) second.settle(doctor.entry, 0, 1);
    await second.flush();
    await second.load();
    const lines = fs
      .readFileSync(path.join(root, PROMPT_HISTORY_FILE), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(lines).to.have.length(2);
    expect(texts(second.history)).to.deep.equal(["status", "doctor"]);
    expect(second.history.at(1)?.count).to.equal(1);
  });

  it("au-delà du double de la capacité : compacté à la lecture", async () => {
    const root = project();
    fs.mkdirSync(path.join(root, "var"));
    let content = "";
    // 2 001 lignes, 1 500 saisies distinctes : plus que la capacité une fois
    // erasedups rejoué.
    for (let i = 0; i <= 2 * PROMPT_HISTORY_CAPACITY; i++) {
      content += serializeHistoryEntry(
        new PromptHistoryEntry(`cmd ${i % 1500}`, "server", i, 1, null, null),
      );
    }
    fs.writeFileSync(path.join(root, PROMPT_HISTORY_FILE), content);
    const file = new PromptHistoryFile(root, () => {});
    await file.load();
    await file.flush();
    const lines = fs
      .readFileSync(path.join(root, PROMPT_HISTORY_FILE), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(lines).to.have.length(PROMPT_HISTORY_CAPACITY);
    expect(file.history.length).to.equal(PROMPT_HISTORY_CAPACITY);
  });

  it("une écriture qui échoue ne casse rien : l'erreur est rendue UNE fois", async () => {
    const root = project();
    // `var` est un FICHIER : le dossier ne peut pas être créé.
    fs.writeFileSync(path.join(root, "var"), "");
    const errors: unknown[] = [];
    const file = new PromptHistoryFile(root, (e) => errors.push(e));
    for (const [text, at] of [
      ["a", 1],
      ["b", 2],
    ] as const) {
      const kept = file.remember(text, "server", at);
      if (kept.kept) file.settle(kept.entry, 0, 1);
    }
    await file.flush();
    expect(errors).to.have.length(1);
    expect(texts(file.history)).to.deep.equal(["a", "b"]);
  });

  it("settle écrit l'issue : code et durée relus du fichier", async () => {
    const root = project();
    const file = new PromptHistoryFile(root, () => {});
    const kept = file.remember("doctor", "server", 1);
    expect(kept.kept).to.equal(true);
    // Rien n'est écrit avant l'issue.
    await file.flush();
    expect(fs.existsSync(path.join(root, PROMPT_HISTORY_FILE))).to.equal(false);
    if (kept.kept) file.settle(kept.entry, 3, 4200);
    await file.flush();
    const again = new PromptHistoryFile(root, () => {});
    await again.load();
    expect(again.history.at(0)?.code).to.equal(3);
    expect(again.history.at(0)?.durationMs).to.equal(4200);
  });

  it("la compaction garde le compteur : le rang par fréquence survit", async () => {
    const root = project();
    fs.mkdirSync(path.join(root, "var"));
    let content = "";
    for (let i = 0; i <= 2 * PROMPT_HISTORY_CAPACITY; i++) {
      content += serializeHistoryEntry(
        new PromptHistoryEntry("status", "server", i, 1, null, null),
      );
    }
    fs.writeFileSync(path.join(root, PROMPT_HISTORY_FILE), content);
    const file = new PromptHistoryFile(root, () => {});
    await file.load();
    await file.flush();
    const total = 2 * PROMPT_HISTORY_CAPACITY + 1;
    expect(file.history.at(0)?.count).to.equal(total);
    const again = new PromptHistoryFile(root, () => {});
    await again.load();
    expect(again.history.length).to.equal(1);
    expect(again.history.at(0)?.count).to.equal(total);
  });
});
