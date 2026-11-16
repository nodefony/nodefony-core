/// <reference types="node" />
/**
 * Unit — schéma complet regroupé par module (`routes/orm/groupLayout.ts`).
 *
 * Ce que la console promet en mode « Complet » : chaque table dans la boîte de
 * son module, aucune boîte sur une autre, et un schéma qui s'étale en largeur
 * comme l'écran — pas une tour que le cadrage réduirait jusqu'à l'illisible.
 */
import { describe, it, expect } from "vitest";
import {
  type EntityNode,
  canonicalLinks,
} from "../../../frontend/src/routes/orm/erdModel";
import {
  GROUP_HEADER,
  GROUP_PAD,
  layoutGroups,
} from "../../../frontend/src/routes/orm/groupLayout";

const table = (name: string, module: string, rows = 4): EntityNode => ({
  name,
  connector: "default",
  module,
  domain: "",
  columns: Array.from({ length: rows }, (_, i) => ({
    name: `c${i}`,
    type: "text",
    primaryKey: i === 0,
    nullable: false,
    unique: false,
  })),
  relations: [],
});

const W = 220;
const size = (e: EntityNode) => ({ w: W, h: 30 + e.columns.length * 20 });

const schema: EntityNode[] = [
  {
    ...table("passkey", "security"),
    relations: [
      {
        type: "many-to-one",
        target: "User",
        field: "userId",
        foreignKey: "userId",
      },
    ],
  },
  {
    ...table("token", "security", 24),
    relations: [
      {
        type: "many-to-one",
        target: "token",
        field: "replacedBy",
        foreignKey: "replacedBy",
      },
    ],
  },
  table("audit", "security"),
  table("revocation", "security"),
  table("User", "app", 12),
  table("session", "http"),
  table("idempotency", "framework"),
];

describe("layoutGroups — l'en-tête dit ce que la boîte regroupe", () => {
  it("une boîte de DOMAINE nomme les modules qu'elle contient ; une boîte de module, rien de plus", () => {
    const facture = { ...table("facture", "erp"), domain: "facturation" };
    const ligne = { ...table("ligne", "compta"), domain: "facturation" };
    const user = table("User", "app");
    const laid = layoutGroups([facture, ligne, user], [], size);
    const dom = laid.boxes.find((b) => b.key === "facturation");
    expect(dom).toMatchObject({ kind: "domain", also: ["compta", "erp"] });
    expect(laid.boxes.find((b) => b.key === "app")).toMatchObject({
      kind: "module",
      also: [],
    });
  });
});

describe("layoutGroups — une boîte par module", () => {
  const laid = layoutGroups(schema, canonicalLinks(schema), size);
  const box = (key: string) => {
    const b = laid.boxes.find((x) => x.key === key);
    if (!b) throw new Error(`boîte ${key} absente`);
    return b;
  };

  it("une boîte par module, chaque table dans la sienne", () => {
    expect(laid.boxes.map((b) => b.key).sort()).toEqual([
      "app",
      "framework",
      "http",
      "security",
    ]);
    expect(box("security").members.sort()).toEqual([
      "audit",
      "passkey",
      "revocation",
      "token",
    ]);
  });

  it("chaque table tient DANS sa boîte, sous le bandeau", () => {
    for (const e of schema) {
      const b = box(laid.boxOf.get(e.name) ?? "");
      const p = laid.positions.get(e.name);
      if (!p) throw new Error(`${e.name} non placée`);
      const s = size(e);
      expect(p.x).toBeGreaterThanOrEqual(GROUP_PAD);
      expect(p.y).toBeGreaterThanOrEqual(GROUP_HEADER);
      expect(p.x + s.w).toBeLessThanOrEqual(b.width);
      expect(p.y + s.h).toBeLessThanOrEqual(b.height);
    }
  });

  it("aucune boîte n'en chevauche une autre", () => {
    const boxes = laid.boxes;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${a.key} / ${b.key}`).toBe(true);
      }
    }
  });

  it("le schéma s'étale en largeur, jamais en tour", () => {
    const right = Math.max(...laid.boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...laid.boxes.map((b) => b.y + b.height));
    expect(right).toBeGreaterThan(bottom);
  });

  it("une auto-référence ne sort pas sa table de la grille", () => {
    // `token` ne se relie qu'à lui-même : il se range avec les tables sans
    // lien, sur la même rangée que l'une d'elles.
    const token = laid.positions.get("token");
    const rows = ["audit", "revocation"].map((n) => laid.positions.get(n)?.y);
    expect(rows).toContain(token?.y);
  });
});
