import { Badge, Group, Paper, Text } from "@mantine/core";
import { HintSheet, type DocSection } from "../../components/ui/DocHint";
import type { LinkDetail, RelationInfo } from "./erdModel";

/** Cardinalité d'un champ de relation, du côté qui la déclare. */
const CARDINALITY: Record<RelationInfo["type"], string> = {
  "one-to-one": "1—1",
  "one-to-many": "1—N",
  "many-to-one": "N—1",
  "many-to-many": "N—N",
};

const CARD_W = 340;

type Side = { table: string; column?: string | undefined };
const end = (side: Side) =>
  side.column === undefined ? side.table : `${side.table}.${side.column}`;

/**
 * Les deux bouts du lien en chips, avec leur cardinalité, puis la lecture dans
 * chaque sens (« un-à-plusieurs » depuis la cible, « plusieurs-à-un » depuis
 * la table qui porte la colonne).
 */
function CardinalityChips({
  detail,
  accent,
}: {
  detail: LinkDetail;
  accent: string;
}) {
  const { from, to, kind } = detail;
  const one = detail.optional ? "0..1" : "1";
  const [left, right, readings] =
    kind === "many-to-many"
      ? ["N", "N", ["plusieurs-à-plusieurs"]]
      : kind === "one-to-one"
        ? [one, "1", ["un-à-un"]]
        : [
            one,
            "N",
            [
              `${to.table} → ${from.table} : un-à-plusieurs`,
              `${from.table} → ${to.table} : plusieurs-à-un`,
            ],
          ];
  return (
    <div>
      <Group gap={6} wrap="wrap" align="center">
        <Badge variant="light" color={accent} tt="none" size="md">
          {left} · {to.table}
        </Badge>
        <Text component="span" size="sm" c="dimmed" aria-hidden>
          ⟷
        </Text>
        <Badge variant="light" color={accent} tt="none" size="md">
          {right} · {from.table}
          {detail.self ? " (autre ligne)" : ""}
        </Badge>
      </Group>
      <Group gap={4} wrap="wrap" mt={6}>
        {readings.map((r) => (
          <Badge key={r} variant="outline" color="gray" tt="none" size="xs">
            {r}
          </Badge>
        ))}
      </Group>
    </div>
  );
}

/**
 * Carte d'un lien du schéma, posée au survol d'une arête — une fiche de la
 * norme ⓘ (`HintSheet`), jamais un dessin à part : les deux bouts et leur
 * cardinalité en chips, les colonnes reliées, si le lien est obligatoire, et
 * ce que la base en GARANTIT — clé étrangère, ou référence logique avec la
 * raison que l'entité a déclarée. Elle ne capte pas le pointeur : l'arête
 * reste survolée.
 *
 * @param detail - rendu par `describeLink`.
 * @param x - abscisse du pointeur dans le conteneur du graphe.
 * @param width - largeur du conteneur, pour retourner la carte près du bord droit.
 * @param height - hauteur du conteneur, qui borne celle de la carte.
 *
 * La carte se pose dans un COIN haut du graphe, celui opposé au pointeur :
 * suivre le pointeur la faisait sortir du cadre (rognée en haut comme en bas),
 * et la poser sous lui masquait l'arête qu'on lit.
 */
export function LinkCard({
  detail,
  x,
  width,
  height,
}: {
  detail: LinkDetail;
  x: number;
  width: number;
  height: number;
}) {
  const { from, to } = detail;
  const left = x > width / 2 ? 12 : Math.max(12, width - CARD_W - 12);
  const accent = detail.enforced ? "blue" : "grape";
  const badge = detail.enforced
    ? "clé étrangère"
    : detail.reason !== null
      ? "référence logique"
      : detail.kind === "many-to-many"
        ? "jonction"
        : "relation déclarée";
  const sections: DocSection[] = [
    {
      label: "Colonnes",
      body:
        detail.kind === "many-to-many"
          ? `${from.table} ⟷ ${to.table}, par une table de jonction.`
          : `${end(from)} → ${end(to)}`,
    },
  ];
  if (detail.optional !== null) {
    sections.push({
      label: "Obligatoire ?",
      body: detail.optional
        ? `Non — la colonne admet NULL : un ${from.table} peut ne viser aucun ${to.table}.`
        : `Oui — la colonne est NOT NULL : chaque ${from.table} vise un ${to.table}.`,
    });
  }
  sections.push({
    label: "Ce que la base garantit",
    body: detail.enforced
      ? "Une clé étrangère : la base refuse une valeur qui ne vise aucune ligne."
      : detail.reason !== null
        ? `Rien — c'est une référence LOGIQUE : la colonne contient l'identifiant d'une ligne de ${to.table}, mais la base ne le sait pas, et n'empêche pas une valeur orpheline.`
        : detail.kind === "many-to-many"
          ? "La table de jonction porte les deux clés."
          : "Rien de connu : la relation est déclarée par l'entité, sans contrainte lue en base.",
  });
  if (detail.reason !== null) {
    sections.push({
      label: "Pourquoi pas de clé étrangère",
      body: detail.reason,
    });
  }
  if (detail.fields.length > 0) {
    sections.push({
      label: "Champs de relation",
      body: detail.fields
        .map((f) => `${f.entity}.${f.field} (${CARDINALITY[f.type]})`)
        .join(", "),
    });
  }
  return (
    <Paper
      role="tooltip"
      withBorder
      shadow="md"
      radius="md"
      p={0}
      style={{
        position: "absolute",
        left,
        top: 12,
        width: CARD_W,
        maxHeight: Math.max(0, height - 24),
        overflow: "hidden",
        zIndex: 10,
        pointerEvents: "none",
        // Translucide : le graphe reste lisible sous la carte.
        background:
          "color-mix(in srgb, var(--mantine-color-body) 88%, transparent)",
        backdropFilter: "blur(6px)",
      }}
    >
      <HintSheet
        kind="relation"
        title={
          detail.self
            ? `${from.table} → elle-même`
            : `${from.table} → ${to.table}`
        }
        badge={badge}
        accent={accent}
        sections={sections}
      >
        <CardinalityChips detail={detail} accent={accent} />
      </HintSheet>
    </Paper>
  );
}
