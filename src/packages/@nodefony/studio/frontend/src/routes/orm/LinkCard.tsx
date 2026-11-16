import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import type { LinkDetail, RelationInfo } from "./erdModel";

/** Cardinalité affichée, du côté qui porte la relation. */
const CARDINALITY: Record<RelationInfo["type"], string> = {
  "one-to-one": "1—1",
  "one-to-many": "1—N",
  "many-to-one": "N—1",
  "many-to-many": "N—N",
};

const CARD_W = 300;

/**
 * Carte d'un lien du schéma, posée au survol d'une arête : les deux colonnes
 * reliées, si le lien est obligatoire, si la base le garantit, et les champs de
 * relation qui le nomment. Elle ne capte pas le pointeur : l'arête reste survolée.
 *
 * @param detail - rendu par `describeLink`.
 * @param x - abscisse du pointeur dans le conteneur du graphe.
 * @param y - ordonnée du pointeur dans le conteneur du graphe.
 * @param width - largeur du conteneur, pour retourner la carte près du bord droit.
 */
export function LinkCard({
  detail,
  x,
  y,
  width,
}: {
  detail: LinkDetail;
  x: number;
  y: number;
  width: number;
}) {
  const { from, to } = detail;
  const left = x + 14 + CARD_W > width ? Math.max(0, x - 14 - CARD_W) : x + 14;
  const end = (side: { table: string; column?: string | undefined }) =>
    side.column === undefined ? side.table : `${side.table}.${side.column}`;
  return (
    <Paper
      role="tooltip"
      withBorder
      shadow="md"
      p="xs"
      radius="md"
      style={{
        position: "absolute",
        left,
        top: y + 14,
        width: CARD_W,
        zIndex: 10,
        pointerEvents: "none",
        // Translucide : le graphe reste lisible sous la carte.
        background:
          "color-mix(in srgb, var(--mantine-color-body) 86%, transparent)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Stack gap={6}>
        <Group gap={6} wrap="nowrap" align="flex-start">
          <Badge size="sm" variant="light" style={{ flexShrink: 0 }}>
            {CARDINALITY[detail.kind]}
          </Badge>
          <Text size="sm" fw={600} style={{ overflowWrap: "anywhere" }}>
            {detail.self
              ? `${from.table} → elle-même`
              : `${from.table} → ${to.table}`}
          </Text>
        </Group>
        <Text size="xs" ff="monospace" style={{ overflowWrap: "anywhere" }}>
          {end(from)}
          <br />→ {end(to)}
        </Text>
        <Text size="xs">
          {detail.optional === null
            ? "Plusieurs à plusieurs : la liaison passe par une table de jonction."
            : detail.optional
              ? "Facultatif — la colonne admet NULL."
              : "Obligatoire — la colonne est NOT NULL."}
        </Text>
        <Text size="xs" c={detail.enforced ? undefined : "dimmed"}>
          {detail.enforced
            ? "Contrainte en base : une valeur sans ligne visée est refusée."
            : "Lien logique : la base ne porte aucune contrainte."}
        </Text>
        {detail.fields.length > 0 && (
          <Text size="xs" c="dimmed">
            Champs de relation :{" "}
            {detail.fields
              .map((f) => `${f.entity}.${f.field} (${CARDINALITY[f.type]})`)
              .join(", ")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
