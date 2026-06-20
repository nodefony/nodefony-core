/**
 * Barre de filtres de la console auditeur — les axes EXACTS que le data plane sait
 * filtrer (`category`/`outcome`/`actor`/`action`/`since`). Chaque contrôle applique
 * immédiatement, sauf l'acteur (commit sur Entrée/blur → pas de re-fetch par frappe).
 */
import { useEffect, useState } from "react";
import {
  Group,
  Select,
  SegmentedControl,
  TextInput,
  Stack,
  Text,
} from "@mantine/core";
import { IconSearch, IconFilterOff } from "@tabler/icons-react";
import { Button } from "@mantine/core";

import { InfoHint } from "../../components/ui";
import {
  AUDIT_CATEGORIES,
  AUDIT_OUTCOMES,
  AUDIT_ACTIONS,
  AUDIT_PERIODS,
  type AuditCategory,
  type AuditFilter,
  type AuditOutcome,
  type AuditPeriod,
} from "./auditModel";

export interface AuditFiltersProps {
  filter: AuditFilter;
  /** Patch partiel du filtre (déclenche un re-fetch côté parent). */
  onChange: (patch: Partial<AuditFilter>) => void;
  /** Remet tout à zéro (période par défaut, aucun autre filtre). */
  onReset: () => void;
  /** `true` si au moins un filtre (hors période) est actif. */
  hasActiveFilter: boolean;
}

const OUTCOME_DATA = [
  { label: "Tous", value: "" },
  ...AUDIT_OUTCOMES.map((o) => ({ label: o.label, value: o.value })),
];

const CATEGORY_DATA = AUDIT_CATEGORIES.map((c) => ({
  value: c.value,
  label: c.label,
}));

const ACTION_DATA = AUDIT_ACTIONS.map((a) => ({
  value: a.value,
  label: a.label,
}));

const PERIOD_DATA = AUDIT_PERIODS.map((p) => ({
  label: p.label,
  value: p.value,
}));

export function AuditFilters({
  filter,
  onChange,
  onReset,
  hasActiveFilter,
}: AuditFiltersProps) {
  // Acteur : brouillon local, commit sur Entrée/blur (évite 1 re-fetch par frappe).
  const [actorDraft, setActorDraft] = useState(filter.actor ?? "");
  useEffect(() => setActorDraft(filter.actor ?? ""), [filter.actor]);

  const commitActor = () => {
    const trimmed = actorDraft.trim();
    if (trimmed !== (filter.actor ?? "")) {
      onChange({ actor: trimmed === "" ? undefined : trimmed });
    }
  };

  return (
    <Stack gap="xs">
      <Group gap="md" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Group gap={4}>
            <Text size="xs" fw={600} c="dimmed">
              Période
            </Text>
            <InfoHint text="Borne basse de la recherche (since). « Tout » = toute la fenêtre de rétention du journal." />
          </Group>
          <SegmentedControl
            size="xs"
            data={PERIOD_DATA}
            value={filter.period}
            onChange={(v) => onChange({ period: v as AuditPeriod })}
          />
        </Stack>

        <Stack gap={2}>
          <Group gap={4}>
            <Text size="xs" fw={600} c="dimmed">
              Issue
            </Text>
            <InfoHint text="Succès / Échec (l'acteur a raté une preuve) / Refus (une politique a refusé un acteur valide — signal Zero Trust)." />
          </Group>
          <SegmentedControl
            size="xs"
            data={OUTCOME_DATA}
            value={filter.outcome ?? ""}
            onChange={(v) =>
              onChange({ outcome: v === "" ? undefined : (v as AuditOutcome) })
            }
          />
        </Stack>

        <Select
          label="Catégorie"
          placeholder="Toutes"
          size="xs"
          clearable
          searchable
          data={CATEGORY_DATA}
          value={filter.category ?? null}
          onChange={(v) =>
            onChange({ category: (v as AuditCategory | null) ?? undefined })
          }
          w={170}
          comboboxProps={{ withinPortal: true }}
        />

        <Select
          label="Action"
          placeholder="Toutes"
          size="xs"
          clearable
          searchable
          data={ACTION_DATA}
          value={filter.action ?? null}
          onChange={(v) => onChange({ action: v ?? undefined })}
          w={230}
          comboboxProps={{ withinPortal: true }}
        />

        <TextInput
          label="Acteur"
          placeholder="identifiant exact"
          size="xs"
          value={actorDraft}
          onChange={(e) => setActorDraft(e.currentTarget.value)}
          onBlur={commitActor}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitActor();
          }}
          leftSection={<IconSearch size={14} />}
          w={190}
        />

        {hasActiveFilter && (
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconFilterOff size={14} />}
            onClick={onReset}
          >
            Réinitialiser
          </Button>
        )}
      </Group>
    </Stack>
  );
}
