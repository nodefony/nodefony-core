/**
 * Le moteur de question unique (#538 lot 2b-1), éprouvé PAR OCTETS : chaque
 * frappe traverse le vrai `InputDecoder` avant d'atteindre `handleQuestion`.
 * Un évènement fabriqué à la main a déjà menti (l'Espace nu arrive en `text`,
 * jamais en `key`) — aucun test ici n'en fabrique.
 */
import { describe, it, expect } from "vitest";
import { InputDecoder } from "../service/dev/inputDecoder";
import {
  QuestionState,
  checkAnswer,
  handleQuestion,
  questionFlag,
  renderQuestion,
  summarizeQuestion,
  type IQuestion,
} from "../cli/question";
import { visibleWidth } from "../runtime/textWidth";

const ENTER = "\r";
const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const END = "\x1b[F";
const BACKSPACE = "\x7f";
const CTRL_C = "\x03";

/** Fait passer des octets par le décodeur puis la question. */
function type(state: QuestionState, ...chunks: string[]): QuestionState {
  const decoder = new InputDecoder();
  for (const bytes of chunks) {
    for (const event of decoder.feed(bytes)) handleQuestion(state, event);
  }
  for (const event of decoder.flush()) handleQuestion(state, event);
  return state;
}

function ask(question: IQuestion, ...chunks: string[]): QuestionState {
  return type(new QuestionState(question), ...chunks);
}

const roles: IQuestion = {
  kind: "checkbox",
  key: "roles",
  message: "Rôles",
  choices: [
    { value: "ROLE_USER", label: "Utilisateur", checked: true },
    { value: "ROLE_ADMIN", label: "Administrateur" },
    { value: "ROLE_AUDIT", label: "Audit", disabled: true },
  ],
};

describe("question — input", () => {
  it("rend la saisie, blancs de bord retirés", () => {
    const s = ask(
      { kind: "input", key: "name", message: "Nom" },
      "  bob ",
      ENTER,
    );
    expect(s.outcome).toEqual({ action: "accept", value: "bob" });
  });

  it("Entrée sur une saisie vide rend le défaut", () => {
    const s = ask(
      { kind: "input", key: "name", message: "Nom", default: "app" },
      ENTER,
    );
    expect(s.outcome).toEqual({ action: "accept", value: "app" });
  });

  it("refuse ce que le motif refuse, sans régler la question, puis accepte la correction", () => {
    const q: IQuestion = {
      kind: "input",
      key: "name",
      message: "Nom",
      pattern: "^[a-z]+$",
      patternHint: "minuscules seulement",
    };
    const s = ask(q, "Bob", ENTER);
    expect(s.outcome).toBeNull();
    expect(s.error).toBe("minuscules seulement");
    type(s, BACKSPACE, BACKSPACE, BACKSPACE, "bob", ENTER);
    expect(s.outcome).toEqual({ action: "accept", value: "bob" });
    expect(s.error).toBeNull();
  });

  it("required : une saisie vide est refusée", () => {
    const s = ask(
      { kind: "input", key: "name", message: "Nom", required: true },
      ENTER,
    );
    expect(s.outcome).toBeNull();
    expect(s.error).toBe("une réponse est requise");
  });

  it("un collage de plusieurs lignes n'en garde que la première et ne valide rien", () => {
    const s = ask(
      { kind: "input", key: "name", message: "Nom" },
      "\x1b[200~un\ndeux\x1b[201~",
    );
    expect(s.outcome).toBeNull();
    expect(s.editor?.text).toBe("un");
  });

  it("`?` en premier caractère est un caractère, pas l'aide de l'invite", () => {
    const s = ask({ kind: "input", key: "q", message: "Question" }, "?", ENTER);
    expect(s.outcome).toEqual({ action: "accept", value: "?" });
  });

  it("Échap et Ctrl+C annulent", () => {
    expect(
      ask({ kind: "input", key: "n", message: "Nom" }, "x", ESC).outcome,
    ).toEqual({
      action: "cancel",
    });
    expect(
      ask({ kind: "input", key: "n", message: "Nom" }, "x", CTRL_C).outcome,
    ).toEqual({
      action: "cancel",
    });
  });
});

describe("question — secret", () => {
  it("garde les blancs, ne montre que des points, et le résumé tait la valeur", () => {
    const s = ask(
      { kind: "secret", key: "password", message: "Mot de passe" },
      " s3cr3t ",
    );
    const view = renderQuestion(s, 80);
    expect(view.lines.join("\n")).not.toContain("s3cr3t");
    expect(view.lines[0]).toContain("••••••••");
    type(s, ENTER);
    expect(s.outcome).toEqual({ action: "accept", value: " s3cr3t " });
    expect(summarizeQuestion(s)).toBe("✔ Mot de passe (saisi)");
  });
});

describe("question — confirm", () => {
  const q: IQuestion = {
    kind: "confirm",
    key: "go",
    message: "Continuer ?",
    default: true,
  };

  it("o / y / n répondent sans Entrée", () => {
    expect(ask(q, "o").outcome).toEqual({ action: "accept", value: true });
    expect(ask(q, "Y").outcome).toEqual({ action: "accept", value: true });
    expect(ask(q, "n").outcome).toEqual({ action: "accept", value: false });
  });

  it("Entrée rend le défaut ; sans défaut, non", () => {
    expect(ask(q, ENTER).outcome).toEqual({ action: "accept", value: true });
    expect(
      ask({ kind: "confirm", key: "go", message: "?" }, ENTER).outcome,
    ).toEqual({
      action: "accept",
      value: false,
    });
  });

  it("Échap ANNULE — il ne répond pas « non »", () => {
    expect(ask(q, ESC).outcome).toEqual({ action: "cancel" });
  });

  it("une autre lettre est refusée en disant les touches", () => {
    const s = ask(q, "x");
    expect(s.outcome).toBeNull();
    expect(s.error).toContain("o pour oui");
  });
});

describe("question — select", () => {
  const q: IQuestion = {
    kind: "select",
    key: "type",
    message: "Type",
    default: "b",
    choices: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C", disabled: true },
      { value: "d", label: "D" },
    ],
  };

  it("s'ouvre sur le défaut", () => {
    expect(ask(q, ENTER).outcome).toEqual({ action: "accept", value: "b" });
  });

  it("↓ saute un choix indisponible", () => {
    expect(ask(q, DOWN, ENTER).outcome).toEqual({
      action: "accept",
      value: "d",
    });
  });

  it("↑ s'arrête au premier, Fin va au dernier atteignable", () => {
    expect(ask(q, UP, UP, UP, ENTER).outcome).toEqual({
      action: "accept",
      value: "a",
    });
    expect(ask(q, END, ENTER).outcome).toEqual({
      action: "accept",
      value: "d",
    });
  });

  it("la fenêtre suit le curseur et dit ce qui est caché", () => {
    const many: IQuestion = {
      kind: "select",
      key: "n",
      message: "Nombre",
      choices: Array.from({ length: 20 }, (_, i) => ({
        value: String(i),
        label: `n${i}`,
      })),
    };
    const s = ask(many);
    const first = renderQuestion(s, 40, 8).lines;
    expect(first.length).toBeLessThanOrEqual(8);
    expect(first.join("\n")).toContain("↓");
    type(s, ...Array.from({ length: 12 }, () => DOWN));
    const later = renderQuestion(s, 40, 8).lines.join("\n");
    expect(later).toContain("▸ n12");
    expect(later).toContain("↑");
  });
});

describe("question — checkbox", () => {
  it("l'Espace nu (reçu en `text`) coche, dans l'ordre des choix", () => {
    const s = ask(roles, DOWN, " ", ENTER);
    expect(s.outcome).toEqual({
      action: "accept",
      value: ["ROLE_USER", "ROLE_ADMIN"],
    });
  });

  it("décocher le choix coché d'origine", () => {
    expect(ask(roles, " ", ENTER).outcome).toEqual({
      action: "accept",
      value: [],
    });
  });

  it("required : aucune case est refusé", () => {
    const s = ask({ ...roles, required: true } as IQuestion, " ", ENTER);
    expect(s.outcome).toBeNull();
    expect(s.error).toBe("coche au moins une case");
  });

  it("le résumé nomme les libellés", () => {
    const s = ask(roles, DOWN, " ", ENTER);
    expect(summarizeQuestion(s)).toBe("✔ Rôles Utilisateur, Administrateur");
  });
});

describe("question — list", () => {
  const q: IQuestion = {
    kind: "list",
    key: "index",
    message: "Index",
    pattern: "^[a-zA-Z,]+$",
  };

  it("chaque valeur reste ENTIÈRE ; Entrée sur une ligne vide termine", () => {
    const s = ask(q, "siteId,createdAt", ENTER, "visitId", ENTER, ENTER);
    expect(s.outcome).toEqual({
      action: "accept",
      value: ["siteId,createdAt", "visitId"],
    });
  });

  it("une valeur refusée n'est pas ajoutée", () => {
    const s = ask(q, "a b", ENTER);
    expect(s.values).toEqual([]);
    expect(s.error).toContain("doit satisfaire");
  });

  it("↑ sur une ligne vide reprend la dernière valeur pour la corriger", () => {
    const s = ask(q, "siteI", ENTER, UP, "d", ENTER, ENTER);
    expect(s.outcome).toEqual({ action: "accept", value: ["siteId"] });
  });

  it("part du défaut", () => {
    const s = ask({ ...q, default: ["a"] } as IQuestion, ENTER);
    expect(s.outcome).toEqual({ action: "accept", value: ["a"] });
  });
});

describe("question — rendu", () => {
  it("aucune ligne ne dépasse la largeur, curseur compris", () => {
    const s = ask(
      {
        kind: "input",
        key: "n",
        message: "Une question au libellé assez long",
      },
      "une réponse bien plus longue que la largeur disponible",
    );
    for (const width of [12, 20, 40]) {
      const view = renderQuestion(s, width);
      for (const line of view.lines)
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(view.cursor?.column).toBeLessThan(width);
    }
  });

  it("les tons passent par le peintre de l'hôte", () => {
    const s = ask(
      { kind: "input", key: "n", message: "Nom", pattern: "^x$" },
      "y",
      ENTER,
    );
    const view = renderQuestion(
      s,
      80,
      Infinity,
      (tone, text) => `<${tone}>${text}</>`,
    );
    expect(view.lines[0]).toContain("<accent>?</>");
    expect(view.lines.at(-1)).toContain("<error>");
  });
});

describe("checkAnswer — la même validation pour toute provenance", () => {
  it("valide une réponse venue d'un drapeau", () => {
    expect(checkAnswer(roles, ["ROLE_ADMIN"])).toBeNull();
    expect(checkAnswer(roles, ["ROLE_X"])).toContain("choix inconnu : ROLE_X");
    expect(checkAnswer(roles, ["ROLE_AUDIT"])).toBe(
      "choix indisponible : ROLE_AUDIT",
    );
    expect(checkAnswer({ kind: "confirm", key: "x", message: "" }, "yes")).toBe(
      "réponds oui ou non",
    );
  });

  it("le drapeau par défaut est --<key>", () => {
    expect(questionFlag(roles)).toBe("--roles");
    expect(questionFlag({ ...roles, flag: "--role" } as IQuestion)).toBe(
      "--role",
    );
  });
});
