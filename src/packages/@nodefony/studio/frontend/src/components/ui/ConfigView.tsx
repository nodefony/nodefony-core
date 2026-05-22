import type { ReactNode } from "react";
import { Badge, Code, Group, Stack, Text } from "@mantine/core";

export interface ConfigViewProps {
  /** Objet de configuration (sérialisé côté serveur, secrets déjà retirés). */
  value: unknown;
  /** Profondeur courante (interne, pour l'indentation des sous-sections). */
  level?: number;
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Rend une valeur scalaire de façon parlante (booléen → badge activé/désactivé…). */
function formatScalar(v: unknown): ReactNode {
  if (v === null || v === undefined)
    return (
      <Text span c="dimmed">
        —
      </Text>
    );
  if (typeof v === "boolean")
    return (
      <Badge size="xs" variant="light" color={v ? "teal" : "gray"}>
        {v ? "activé" : "désactivé"}
      </Badge>
    );
  if (typeof v === "number") return <Code>{String(v)}</Code>;
  if (typeof v === "string")
    return v === "" ? (
      <Text span c="dimmed">
        (vide)
      </Text>
    ) : (
      <Text span size="sm" style={{ wordBreak: "break-word" }}>
        {v}
      </Text>
    );
  return <Code>{String(v)}</Code>;
}

/**
 * ConfigView — rend une configuration en **options lisibles** (clé → valeur +
 * type parlant) plutôt qu'un dump JSON : objets imbriqués = sous-sections
 * indentées, tableaux résumés, booléens en badges. Texte uniquement (jamais
 * d'HTML injecté). NB : des descriptions prose par option nécessiteraient un
 * schéma de config déclaré par chaque module (évolution future).
 */
export function ConfigView({ value, level = 0 }: ConfigViewProps): ReactNode {
  if (!isPlainObj(value) || Object.keys(value).length === 0) {
    return (
      <Text c="dimmed" size="sm">
        Configuration vide.
      </Text>
    );
  }
  return (
    <Stack
      gap={2}
      style={{
        paddingLeft: level ? 12 : 0,
        borderLeft: level
          ? "1px solid var(--mantine-color-default-border)"
          : undefined,
      }}
    >
      {Object.entries(value).map(([k, v]) => {
        if (isPlainObj(v)) {
          return (
            <div key={k}>
              <Text size="sm" fw={600} mt={6}>
                {k}
              </Text>
              <ConfigView value={v} level={level + 1} />
            </div>
          );
        }
        if (Array.isArray(v)) {
          const scalarOnly = v.every((x) => !isPlainObj(x) && !Array.isArray(x));
          return (
            <Group
              key={k}
              justify="space-between"
              wrap="nowrap"
              gap="xl"
              align="flex-start"
              style={{ padding: "2px 0" }}
            >
              <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                {k}
              </Text>
              <div style={{ textAlign: "right", minWidth: 0 }}>
                {v.length === 0 ? (
                  <Text span c="dimmed">
                    (aucun)
                  </Text>
                ) : scalarOnly ? (
                  <Text span size="sm" style={{ wordBreak: "break-word" }}>
                    {v.map(String).join(", ")}
                  </Text>
                ) : (
                  <Badge size="xs" variant="light" color="gray">
                    {v.length} élément(s)
                  </Badge>
                )}
              </div>
            </Group>
          );
        }
        return (
          <Group
            key={k}
            justify="space-between"
            wrap="nowrap"
            gap="xl"
            style={{ padding: "2px 0" }}
          >
            <Text size="sm" c="dimmed">
              {k}
            </Text>
            <div style={{ textAlign: "right" }}>{formatScalar(v)}</div>
          </Group>
        );
      })}
    </Stack>
  );
}
