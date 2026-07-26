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
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconPencil,
  IconCircleDot,
  IconActivity,
  IconCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useNotifications, useStore } from "../../stores";
import {
  DataState,
  DocHint,
  FlashValue,
  ensureLiveStyles,
} from "../../components/ui";
import type { BackplaneMeta } from "./logsTypes";
import { LOGS_DOC, PLACEHOLDER_DRIVERS, driverMeta } from "./logFormat";
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
        <Text
          fz={10}
          fw={600}
          tt="uppercase"
          c="dimmed"
          style={{ letterSpacing: 0.3 }}
        >
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
  const registeredNames = new Set(drivers.map((d) => d.name));
  // Tous les modes connus dans le select : enregistrés (memory/console + file/
  // cluster-file + loki/opensearch montés en dev) = sélectionnables ; connus mais
  // non montés (URL absente, ou prod) = grisés « via config ». Visibilité complète, 0 404.
  const driverOptions = [
    ...drivers.map((d) => ({ value: d.name, label: driverMeta(d.name).label })),
    ...PLACEHOLDER_DRIVERS.filter((n) => !registeredNames.has(n)).map((n) => {
      const dm = driverMeta(n);
      return {
        value: n,
        label: `${dm.label} — ${dm.upcoming ? "à venir" : "via config"}`,
        disabled: true,
      };
    }),
  ];

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
                      w={220}
                      value={active?.name ?? null}
                      data={driverOptions}
                      onChange={(v) => v && switchDriver(v)}
                      disabled={switching}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: true }}
                      aria-label="changer de driver de relecture"
                      leftSection={<IconCircleDot size={14} />}
                    />
                    <DocHint
                      title="Changer de driver (dev uniquement)"
                      version={LOGS_DOC}
                      summary="Bascule la destination des logs à chaud (vide + ferme l'ancienne, active la nouvelle — opération atomique). Le défaut reste « mémoire »."
                      sections={[
                        {
                          label: "Pourquoi seulement en dev",
                          body: "En production, la destination est figée par la config/les variables d'env (12-factor) : un serveur qui change de cible en plein vol casserait la traçabilité. Le sélecteur est donc masqué hors développement.",
                        },
                        {
                          label: "Modes grisés « via config »",
                          body: "Driver implémenté mais non monté ici (URL absente, ou prod). En dev, memory/console/file/cluster-file sont montés d'office ; loki/opensearch dès que LOKI_URL/OPENSEARCH_URL sont définis. En prod, seul le driver configuré est monté.",
                        },
                        {
                          label: "Essaie",
                          body: "Bascule sur « Fichier JSONL » → l'Explorer relit les logs persistés sur disque ; « console » (sans Recherche) → l'Explorer explique qu'on ne peut plus fouiller ; reviens sur « Mémoire ».",
                        },
                      ]}
                    />
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

            {/* Ligne 3 — sonde de la destination (joignabilité + latence + infos). */}
            <DestinationPing driverName={active?.name ?? null} />
          </Stack>
        )}
      </DataState>
    </Paper>
  );
}

/** Résultat de la sonde `/backplane/ping` (miroir de `ILogDriverProbe` core). */
interface DriverProbe {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  info?: Record<string, string | number>;
}

/**
 * Sonde la DESTINATION du driver actif : « répond-elle, en combien de temps, et
 * quelles infos utiles ? ». Auto-sonde au changement de driver + bouton « Tester ».
 * Pour memory/file/cluster-file = local (toujours joignable, latence 0) ; pour
 * loki/opensearch = vraie requête réseau (`/ready`, `GET /`, `_count`).
 */
function DestinationPing({ driverName }: { driverName: string | null }) {
  const store = useStore();
  const [probe, setProbe] = useState<DriverProbe | null>(null);
  const [loading, setLoading] = useState(false);

  const ping = useCallback(async () => {
    if (!driverName) return;
    setLoading(true);
    try {
      const r = await store.api.getAbsolute<DriverProbe>(
        `/nodefony/syslog/api/backplane/ping?driver=${encodeURIComponent(driverName)}`,
      );
      setProbe(r);
    } catch (e) {
      setProbe({
        ok: false,
        latencyMs: 0,
        detail: e instanceof Error ? e.message : "échec de la sonde",
      });
    } finally {
      setLoading(false);
    }
  }, [store, driverName]);

  // Auto-sonde au montage ET à chaque changement de driver actif.
  useEffect(() => {
    setProbe(null);
    void ping();
  }, [ping]);

  return (
    <Group gap="sm" wrap="wrap">
      <Button
        size="xs"
        variant="light"
        leftSection={<IconActivity size={14} />}
        loading={loading}
        onClick={() => void ping()}
      >
        Tester la destination
      </Button>
      {probe && (
        <>
          <Badge
            color={probe.ok ? "teal" : "red"}
            variant="light"
            leftSection={
              probe.ok ? (
                <IconCheck size={12} />
              ) : (
                <IconAlertTriangle size={12} />
              )
            }
            tt="none"
          >
            {probe.ok ? "joignable" : "injoignable"}
          </Badge>
          <Text
            size="xs"
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {probe.latencyMs} ms
          </Text>
          {probe.info &&
            Object.entries(probe.info)
              .filter(([k]) => k !== "endpoint")
              .map(([k, v]) => (
                <Badge key={k} size="xs" variant="default" tt="none">
                  {k}: {String(v)}
                </Badge>
              ))}
          {probe.detail && (
            <Text size="xs" c="red" truncate maw={360}>
              {probe.detail}
            </Text>
          )}
        </>
      )}
      <DocHint
        title="Sonde de destination"
        version={LOGS_DOC}
        summary="Vérifie que la destination des logs répond (ping), mesure la latence et remonte des infos utiles (version, statut, nombre d'entrées)."
        sections={[
          {
            label: "Local vs distant",
            body: "memory/file/cluster-file = local (toujours joignable, 0 ms). loki/opensearch = sonde réseau réelle (/ready pour Loki ; GET / + _count pour OpenSearch).",
          },
        ]}
      />
    </Group>
  );
}
