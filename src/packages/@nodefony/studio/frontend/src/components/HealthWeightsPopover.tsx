/**
 * `<HealthWeightsPopover>` — bouton + popover de **pondération** de l'indice « Santé
 * du framework » (méthode Derringer-Suich, cf {@link ../utils/health}). Composant
 * PARTAGÉ pour garder le bouton **au même endroit** partout où la card santé apparaît
 * (accueil cluster = card pod, page mono/détail worker) → ergonomie : l'utilisateur
 * retrouve le réglage SUR la card qu'il règle, jamais perdu dans la top bar.
 *
 * Contrôlé : `weights` + `onChange` (l'état + la persistance vivent chez l'appelant,
 * clé `nf.supervision.weights`). `labels` = sondes réglables selon le contexte (pod
 * lean = 4 ; mono = 8).
 */
import {
  ActionIcon,
  Button,
  Group,
  Popover,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { DEFAULT_WEIGHTS } from "../utils/health";

interface HealthWeightsPopoverProps {
  /** Poids courants (réglés par l'utilisateur, persistés par l'appelant). */
  weights: Record<string, number>;
  /** Émis à chaque réglage (l'appelant met à jour son state + persiste). */
  onChange: (next: Record<string, number>) => void;
  /** Sondes réglables dans ce contexte (pod = 4, mono = 8). */
  labels: string[];
  /** Ligne d'aide optionnelle dans le dropdown. */
  summary?: string;
}

export function HealthWeightsPopover({
  weights,
  onChange,
  labels,
  summary,
}: HealthWeightsPopoverProps) {
  const wOf = (label: string): number =>
    weights[label] ?? DEFAULT_WEIGHTS[label] ?? 1;
  return (
    <Popover width={300} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Régler la pondération de la santé du framework"
        >
          <IconAdjustmentsHorizontal size={18} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>
            Pondération de la santé
          </Text>
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => onChange({ ...DEFAULT_WEIGHTS })}
          >
            Défaut
          </Button>
        </Group>
        {summary ? (
          <Text size="xs" c="dimmed" mb="sm">
            {summary}
          </Text>
        ) : null}
        <Stack gap="xs">
          {labels.map((label) => (
            <div key={label}>
              <Group justify="space-between" gap={4}>
                <Text size="xs">{label}</Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  ×{wOf(label).toFixed(1)}
                </Text>
              </Group>
              <Slider
                size="xs"
                min={0}
                max={3}
                step={0.1}
                value={wOf(label)}
                onChange={(v) => onChange({ ...weights, [label]: v })}
                label={(v) => `×${v.toFixed(1)}`}
                aria-label={`poids ${label}`}
              />
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
