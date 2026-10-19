/**
 * Unit — les préférences relues du stockage navigateur, et la charge du canal
 * de création, ne passent plus par une conversion `as T`.
 *
 * Ce qu'on relit n'est pas ce qu'on a écrit : une version antérieure de la
 * console, une édition à la main, une extension. Avant, chaque lecteur faisait
 * `JSON.parse(raw) as T` : un `null` relu faisait tomber l'explorateur de logs
 * à chaque montage, un tri d'une autre forme cassait la grille, un poids en
 * chaîne rendait un score de santé `NaN` sans un mot. Chaque cas ci-dessous
 * reproduit une de ces formes et vérifie que le lecteur en garde ce qu'il
 * reconnaît, et rien d'autre.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredJson } from "../../../frontend/src/utils/storedJson";
import {
  arrayOf,
  recordOf,
  isString,
} from "../../../frontend/src/utils/guards";
import { parsePersistedState } from "../../../frontend/src/components/ui/dataGridPersist";
import { parseSavedFilters } from "../../../frontend/src/routes/logs/logsTypes";
import {
  DEFAULT_WEIGHTS,
  HEALTH_WEIGHTS_KEY,
  loadHealthWeights,
} from "../../../frontend/src/utils/health";
import { UiStore } from "../../../frontend/src/stores/UiStore";
import { WorkspaceStore } from "../../../frontend/src/workspace/WorkspaceStore";
import { toScaffoldEvent } from "../../../frontend/src/routes/create/createModel";

/** Un stockage navigateur en mémoire, prérempli. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

/** Pose un `localStorage` et un `sessionStorage` comme le ferait le navigateur. */
function stubBrowser(local: Record<string, string>, session = {}): void {
  const localStorage = memoryStorage(local);
  const sessionStorage = memoryStorage(session);
  vi.stubGlobal("window", { localStorage, sessionStorage });
  vi.stubGlobal("localStorage", localStorage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readStoredJson — lecteur unique du stockage", () => {
  it("rend undefined hors navigateur, clé absente ou JSON cassé", () => {
    expect(readStoredJson("local", "k")).toBeUndefined();
    stubBrowser({ broken: "{oups" });
    expect(readStoredJson("local", "absent")).toBeUndefined();
    expect(readStoredJson("local", "broken")).toBeUndefined();
  });

  it("rend undefined quand le simple accès au stockage lève (navigation privée)", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(readStoredJson("local", "k")).toBeUndefined();
  });

  it("rend la valeur décodée, sans en présumer la forme", () => {
    stubBrowser({}, { k: "null" });
    expect(readStoredJson("session", "k")).toBeNull();
  });
});

describe("gardes de forme", () => {
  it("recordOf : une clé __proto__ relue reste une donnée", () => {
    const out = recordOf(
      JSON.parse('{"__proto__":true,"a":true,"b":1}'),
      (v): v is boolean => typeof v === "boolean",
    );
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out).sort()).toEqual(["__proto__", "a"]);
  });

  it("recordOf / arrayOf : une autre forme rend le vide", () => {
    expect(recordOf([true], isString)).toEqual({});
    expect(recordOf(null, isString)).toEqual({});
    expect(arrayOf({ 0: "x" }, isString)).toEqual([]);
    expect(arrayOf(["x", 1, null], isString)).toEqual(["x"]);
  });
});

describe("DataGrid — état persisté", () => {
  it("une valeur qui n'est pas un objet ne donne aucun état", () => {
    for (const v of [null, 42, "x", [], undefined]) {
      expect(parsePersistedState(v)).toBeNull();
    }
  });

  it("garde un état bien formé tel quel", () => {
    const state = {
      sorting: [{ id: "name", desc: true }],
      columnFilters: [{ id: "role", value: ["admin"] }],
      globalFilter: "abc",
      columnVisibility: { email: false },
      columnSizing: { name: 120 },
      pageIndex: 2,
      pageSize: 50,
    };
    expect(parsePersistedState(JSON.parse(JSON.stringify(state)))).toEqual(
      state,
    );
  });

  it("abandonne champ par champ ce qui n'a pas la bonne forme", () => {
    const out = parsePersistedState({
      sorting: "name",
      columnFilters: [{ id: "a", value: 1 }, { value: 2 }, null],
      globalFilter: 3,
      columnVisibility: { a: true, b: "no" },
      columnSizing: { a: "120", b: 80 },
      pageIndex: -1,
      pageSize: 0,
    });
    expect(out).toEqual({
      columnFilters: [{ id: "a", value: 1 }],
      columnVisibility: { a: true },
      columnSizing: { b: 80 },
    });
  });

  it("refuse une pagination non entière", () => {
    expect(parsePersistedState({ pageIndex: 1.5, pageSize: 2.5 })).toEqual({});
  });
});

describe("Explorateur de logs — filtres persistés", () => {
  it("un null relu donne des filtres vides au lieu de faire tomber l'écran", () => {
    expect(parseSavedFilters(null)).toEqual({});
    expect(parseSavedFilters("x")).toEqual({});
  });

  it("garde les filtres reconnus, abandonne les autres", () => {
    const out = parseSavedFilters({
      requestId: "r-1",
      order: "up",
      protocol: "ws",
      flows: ["request-in", "étape-retirée", 3],
      severities: ["ERROR", "BOGUS"],
      moduleF: 1,
      msgidF: "HTTP",
    });
    expect(out).toEqual({
      requestId: "r-1",
      protocol: "ws",
      flows: ["request-in"],
      severities: ["ERROR"],
      msgidF: "HTTP",
    });
  });
});

describe("Santé — poids réglés", () => {
  it("un poids d'une autre forme reprend son défaut au lieu de rendre NaN", () => {
    const [probe] = Object.keys(DEFAULT_WEIGHTS);
    expect(probe).toBeDefined();
    stubBrowser({
      [HEALTH_WEIGHTS_KEY]: JSON.stringify({
        [probe as string]: "3",
        negatif: -1,
        reglee: 2,
      }),
    });
    const w = loadHealthWeights();
    expect(w[probe as string]).toBe(DEFAULT_WEIGHTS[probe as string]);
    expect(w.negatif).toBeUndefined();
    expect(w.reglee).toBe(2);
  });

  it("une valeur qui n'est pas un objet rend les défauts", () => {
    stubBrowser({ [HEALTH_WEIGHTS_KEY]: "[1,2]" });
    expect(loadHealthWeights()).toEqual(DEFAULT_WEIGHTS);
  });
});

describe("Préférences d'interface", () => {
  it("groupes pliés et épingles : seules les valeurs de la bonne forme restent", () => {
    stubBrowser({
      "nodefony.studio.sidebar.groups.v3": JSON.stringify({
        a: true,
        b: "yes",
      }),
      "nodefony.studio.sidebar.pinned": JSON.stringify([
        "/nodefony/logs",
        4,
        null,
      ]),
    });
    const ui = new UiStore();
    expect({ ...ui.collapsedGroups }).toEqual({ a: true });
    expect([...ui.pinned]).toEqual(["/nodefony/logs"]);
  });
});

describe("Bureau composable — bureaux persistés", () => {
  it("un bureau d'une autre forme est ignoré, un libellé non textuel retombe sur l'id", () => {
    stubBrowser({
      "nf.workspace.layouts.v3": JSON.stringify({
        cassé: null,
        scalaire: 3,
        bon: { label: 7, items: [] },
      }),
      "nf.workspace.active.v3": "bon",
    });
    const ws = new WorkspaceStore();
    expect(Object.keys(ws.layouts)).toEqual(["bon"]);
    expect(ws.layouts.bon?.label).toBe("bon");
    expect(ws.activeId).toBe("bon");
  });
});

describe("Créer — charge du canal de job", () => {
  const line = { seq: 1, ts: 10, stream: "out", text: "npm install" };
  const state = {
    id: "j1",
    type: "app",
    status: "running",
    startedAt: 5,
    endedAt: null,
    files: ["a.ts", 3],
    notes: [],
    lines: [line, { seq: "2" }],
  };

  it("reconnaît une ligne et un état bien formés", () => {
    expect(toScaffoldEvent({ kind: "line", line })).toEqual({
      kind: "line",
      line,
    });
    expect(toScaffoldEvent({ kind: "state", state })).toEqual({
      kind: "state",
      state: { ...state, files: ["a.ts"], lines: [line] },
    });
  });

  it("ignore une charge d'une autre forme", () => {
    expect(toScaffoldEvent(null)).toBeNull();
    expect(toScaffoldEvent({ kind: "autre" })).toBeNull();
    expect(
      toScaffoldEvent({ kind: "line", line: { ...line, stream: "x" } }),
    ).toBeNull();
    expect(
      toScaffoldEvent({
        kind: "state",
        state: { ...state, status: undefined },
      }),
    ).toBeNull();
  });
});
