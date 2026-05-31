/**
 * **BackplaneBanner** — bandeau toujours visible en tête de la page Logs : il
 * répond à « sur quel backplane joue-t-on, et peut-on en changer ? ».
 *
 * Montre l'axe **DESTINATION queryable** (driver de relecture actif + capacités),
 * l'axe **WRITE** (sink, orthogonal), la **santé** (compteurs), et — en
 * développement uniquement — le **sélecteur de driver** (action de contrôle
 * runtime, `POST /backplane/driver`, masquée en prod = 12-factor).
 *
 * Ergonomie « temps réel calme » : les compteurs flashent brièvement au
 * changement (`FlashValue`, one-shot) et sont en `tabular-nums` (0 jitter) ; le
 * style ne bat jamais en boucle.
 */
import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconPencil, IconCircleDot } from "@tabler/icons-react";
import { useNotifications, useStore } from "../../stores";
import {
  DataState,
  DocHint,
  FlashValue,
  WarnHint,
  ensureLiveStyles,
} from "../../components/ui";
import type { BackplaneMeta } from "./logsTypes";
import { LOGS_DOC, driverMeta } from "./logFormat";
import { CapabilityBadges, DriverIcon } from "./LogVisuals";

export interface BackplaneBannerProps {
  meta: BackplaneMeta | null;
  loading: boolean;
  error: string | null;
  /** Recharge la méta backplane (après un switch). */
  reload: () => void;
  /** Notifie l'orchestrateur qu'un switch a eu lieu (rafraîchit les onglets). */
  onSwitched?: () => void;
}

/** Une mini-statistique compacte (label + valeur live qui flashe au changement). */
function Counter({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  /** Couleur de la valeur si > 0 (compteur « signifiant » : erreurs, invalides). */
  color?: string;
  hint: string;
}) {
  return (
    <Box style={{ minWidth: 64 }}>
      <Group gap={4} wrap="nowrap" mb={1}>
        <Text fz={10} fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: 0.3 }}>
          {label}
        </Text>
        <DocHint title={label} version={LOGS_DOC} summary={hint} />
      </Group>
      <Text
        fw={700}
        size="lg"
        c={color && value > 0 ? color : undefined}
        style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
      >
        <FlashValue value={value}>{value.toLocaleString("fr-FR")}</FlashValue>
      </Text>
    </Box>
  );
}

export function BackplaneBanner({
  meta,
  loading,
  error,
  reload,
  onSwitched,
}: BackplaneBannerProps) {
  const store = useStore();
  const notifications = useNotifications();
  const [switching, setSwitching] = useState(false);

  useEffect(ensureLiveStyles, []);

  const active = meta?.activeDriver ?? null;
  const isDev = meta?.environment === "development";
  const drivers = meta?.drivers ?? [];
  const onlyOne = drivers.length <= 1;

  const switchDriver = async (name: string) => {
    if (!name || name === active?.name) return;
    setSwitching(true);
    try {
      await store.api.postAbsolute("/nodefony/syslog/api/backplane/driver", {
        name,
      });
      notifications.notify("success", `Driver de relecture → « ${name} »`, {
        title: "Log Backplane",
        source: "api",
      });
      reload();
      onSwitched?.();
    } catch (e) {
      notifications.notify(
        "error",
        e instanceof Error ? e.message : "switch refusé",
        { title: "Log Backplane", source: "api" },
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md" style={{ contain: "content" }}>
      <DataState
        loading={loading && !meta}
        error={error}
        onRetry={reload}
        minHeight={90}
      >
        {meta && (
          <Stack gap="sm">
            {/* Ligne 1 — driver actif (DESTINATION) + switch + sink (WRITE). */}
            <Group justify="space-between" wrap="wrap" gap="md">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <DriverIcon name={active?.name ?? "generic"} />
                <Box style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text fw={700} truncate>
                      {active ? driverMeta(active.name).label : "Aucun driver"}
                    </Text>
                    {active && (
                      <Badge size="xs" variant="default" tt="none">
                        {active.name}
                      </Badge>
                    )}
                    <DocHint
                      title="Driver de logs actif"
                      version={LOGS_DOC}
                      summary="La DESTINATION des logs — l'endroit où ils sont rangés et d'où on les RELIT (onglet Explorer). On peut en changer à la volée en développement."
                      sections={[
                        {
                          label: "Pourquoi ça compte",
                          body: "Demain : mémoire → fichier → Elasticsearch / Loki. Le même écran de recherche interrogera n'importe lequel, sans changer le front.",
                        },
                        {
                          label: active
                            ? `Ce que sait faire « ${active.name} »`
                            : "Capacités",
                          body: "Persistant = garde les logs dans la durée · Recherche = on peut fouiller l'historique · Temps réel = alimente le flux Live.",
                        },
                      ]}
                    />
                  </Group>
                  {active && (
                    <Group gap="xs" mt={4} wrap="nowrap">
                      <CapabilityBadges capabilities={active.capabilities} />
                    </Group>
                  )}
                </Box>
              </Group>

              <Group gap="md" wrap="nowrap">
                {/* Axe WRITE (orthogonal au driver de relecture). */}
                <Group gap={6} wrap="nowrap">
                  <Badge
                    variant="light"
                    color="gray"
                    leftSection={<IconPencil size={12} />}
                    tt="none"
                  >
                    écriture → {meta.write.sink}
                  </Badge>
                  <DocHint
                    title="Écriture (axe WRITE — LB.W)"
                    version={LOGS_DOC}
                    summary="Où part la LIGNE TEXTE de chaque log (stdout, fichier, null). Indépendant du driver de relecture."
                    sections={[
                      {
                        label: "Orthogonal",
                        body: "Écrire (texte) et relire (Pdu structurés) sont 2 axes distincts : on peut écrire sur stdout ET relire en mémoire.",
                      },
                    ]}
                  />
                </Group>

                {/* Switch driver — DEV ONLY. */}
                {isDev && (
                  <Group gap={6} wrap="nowrap">
                    <Select
                      size="xs"
                      w={170}
                      value={active?.name ?? null}
                      data={drivers.map((d) => d.name)}
                      onChange={(v) => v && switchDriver(v)}
                      disabled={switching || onlyOne}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: true }}
                      aria-label="changer de driver de relecture"
                      leftSection={<IconCircleDot size={14} />}
                    />
                    {onlyOne ? (
                      <WarnHint
                        title="Un seul driver enregistré"
                        version={LOGS_DOC}
                        summary="Le registry ne contient que « memory ». Enregistre file/elastic/loki (LB.2+) pour pouvoir switcher."
                      />
                    ) : (
                      <DocHint
                        title="Changer de driver (dev uniquement)"
                        version={LOGS_DOC}
                        summary="Bascule la destination des logs à chaud (vide + ferme l'ancienne, active la nouvelle — opération atomique)."
                        sections={[
                          {
                            label: "Pourquoi seulement en dev",
                            body: "En production, la destination est figée par la config/les variables d'env (12-factor) : un serveur qui change de cible en plein vol casserait la traçabilité. Le bouton est donc masqué hors développement.",
                          },
                          {
                            label: "Essaie",
                            body: "Bascule sur « console » (sans Recherche) → l'onglet Explorer t'expliquera qu'on ne peut plus fouiller ; reviens sur « mémoire » pour réactiver la recherche.",
                          },
                        ]}
                      />
                    )}
                  </Group>
                )}
              </Group>
            </Group>

            {/* Ligne 2 — santé (compteurs). */}
            <Group gap="lg" wrap="wrap">
              <Counter
                label="valides"
                value={meta.counters.valid}
                hint="Total des logs acceptés depuis le démarrage (cumul)."
              />
              <Counter
                label="erreurs"
                value={meta.counters.errorTotal}
                color="orange"
                hint="Cumul des logs de sévérité ERROR. Un cumul, pas un taux : il ne fait que monter."
              />
              <Counter
                label="critiques"
                value={meta.counters.criticTotal}
                color="red"
                hint="Cumul des logs CRITIC/ALERT/EMERGENCY. > 0 = à investiguer."
              />
              <Counter
                label="invalides"
                value={meta.counters.invalid}
                color="orange"
                hint="Logs rejetés (mal formés). > 0 = un émetteur produit des Pdu invalides."
              />
              <Counter
                label="omis"
                value={meta.counters.missed}
                hint="Logs perdus sous surcharge (coalescing). > 0 = pic de débit."
              />
              <Counter
                label="en mémoire"
                value={meta.counters.buffered}
                hint="Pdu actuellement dans le ring buffer (≠ cumul). Borné : c'est ce que « memory » peut relire."
              />
            </Group>
          </Stack>
        )}
      </DataState>
    </Paper>
  );
}
