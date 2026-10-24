/**
 * **SeverityFilter** — la rangée des huit sévérités, COMMUNE aux onglets
 * Journaux et Direct : même ordre, mêmes couleurs, même vue d'ouverture
 * (`DEFAULT_SEVERITIES`). Le Direct y ajoute le compte de chaque sévérité.
 */
import { Chip, Group, Text } from "@mantine/core";
import { IconFilter } from "@tabler/icons-react";
import { severityColor } from "./logFormat";
import { SEVERITIES, type Severity } from "./logsTypes";

export interface SeverityFilterProps {
  value: ReadonlySet<Severity>;
  onChange: (next: Set<Severity>) => void;
  /** Compte par sévérité, affiché dans la puce (flux du Direct). */
  counts?: Readonly<Record<Severity, number>>;
}

export function SeverityFilter({
  value,
  onChange,
  counts,
}: SeverityFilterProps) {
  return (
    <Group gap="sm" wrap="wrap" align="center">
      <Group gap={6} wrap="nowrap">
        <IconFilter size={14} />
        <Text size="xs" fw={600} c="dimmed">
          Sévérité
        </Text>
      </Group>
      <Chip.Group
        multiple
        value={[...value]}
        onChange={(vals) => onChange(new Set(vals))}
      >
        <Group gap={4} wrap="wrap">
          {SEVERITIES.map((s) => (
            <Chip key={s} value={s} size="xs" color={severityColor(s)}>
              {s}
              {counts !== undefined && counts[s] > 0 && (
                <Text
                  span
                  size="xs"
                  fw={700}
                  ml={4}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {counts[s]}
                </Text>
              )}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </Group>
  );
}
