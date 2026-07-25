/**
 * **RuntimeModeChip** — pastille « mode runtime » de la topbar, à côté du titre.
 *
 * Lit l'identité runtime (`GET /nodefony/kernel/api/info`) et l'affiche en une
 * pastille **calme** : environnement (dev/prod) + mode process (mono/cluster).
 * Au survol, un `HoverCard` déroule les infos les plus utiles (version, Node,
 * plateforme, PID, uptime, modules, git). Clic → page Runtime.
 *
 * Volontairement **statique** (un seul fetch) : l'identité runtime ne change pas
 * en vol (env, version, Node…) → aucun tick, aucun clignotement (ergonomie
 * « temps réel calme »). Les métriques LIVES (CPU, mémoire, workers) vivent dans
 * les pages Runtime/Supervision/Cluster.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import {
  Anchor,
  Badge,
  Divider,
  Group,
  Stack,
  Text,
  ThemeIcon,
  HoverCard,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAffiliate,
  IconArrowRight,
  IconBolt,
  IconRocket,
  IconServer,
} from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { DefinitionList, KeyValue } from "./ui";

/** Identité runtime renvoyée par `/nodefony/kernel/api/info` (miroir local). */
interface RuntimeInfo {
  version: string;
  environment: string;
  debug: boolean;
  domain: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  modules: number;
  cluster?: { isCluster: boolean };
  /** Fonds de panier (info rapide). `log` = driver de relecture + sink d'écriture. */
  backplanes?: { log?: { driver: string | null; sink: string } };
  git?: { branch?: string; commit?: string } | null;
}

/** Sous-ensemble du health realtime : juste le fond de panier (driver + portée). */
interface RealtimeBackplaneLite {
  backplane?: { driver: string; kind: string; crossPod: boolean };
}

/** Présentation par environnement (couleur + icône + libellé court). */
function envMeta(environment: string): {
  label: string;
  color: string;
  Icon: typeof IconRocket;
} {
  if (environment === "production") {
    return { label: "prod", color: "teal", Icon: IconRocket };
  }
  if (environment === "development") {
    return { label: "dev", color: "yellow", Icon: IconBolt };
  }
  return { label: environment, color: "grape", Icon: IconServer };
}

/** Uptime en **paliers** (calme, pas de churn ms↔s) : « 42 s » / « 12 min » / « 3 h 07 ». */
function fmtUptime(s: number): string {
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} h ${String(m).padStart(2, "0")}`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return `${d} j ${h} h`;
}

export function RuntimeModeChip() {
  const store = useStore();
  const navigate = useNavigate();
  const fetcher = useCallback(
    () => store.api.getAbsolute<RuntimeInfo>("/nodefony/kernel/api/info"),
    [store],
  );
  const { data: info, reload } = useResource(fetcher);

  // Fond de panier Realtime — module séparé (cycle interdit framework→realtime)
  // → lu depuis son propre data plane. Optionnel : 404 si realtime absent → la
  // ligne se masque (dégradation propre).
  const rtFetcher = useCallback(
    () =>
      store.api.getAbsolute<RealtimeBackplaneLite>(
        "/nodefony/realtime/api/health",
      ),
    [store],
  );
  const { data: rt, reload: reloadRt } = useResource(rtFetcher);

  // Le driver de logs (et autres états runtime) peut changer à chaud (switch dev
  // dans la page Logs) → re-synchroniser à l'OUVERTURE du popover (au survol) pour
  // ne jamais afficher un fond de panier périmé. Fetch froid, négligeable.
  const refresh = useCallback(() => {
    reload();
    reloadRt();
  }, [reload, reloadRt]);

  // Tant que la méta n'est pas là, rien (0 placeholder qui saute dans la topbar).
  if (!info) return null;

  const env = envMeta(info.environment);
  const isCluster = info.cluster?.isCluster === true;
  const modeLabel = isCluster ? "Cluster (multi-worker)" : "Mono-process";

  return (
    <HoverCard
      width={300}
      position="bottom-start"
      shadow="md"
      openDelay={150}
      closeDelay={120}
      withinPortal
      onOpen={refresh}
    >
      <HoverCard.Target>
        <UnstyledButton
          onMouseEnter={refresh}
          onClick={() => navigate("/nodefony/runtime")}
          aria-label={`Mode runtime : ${env.label}${isCluster ? ", cluster" : ", mono-process"} — ouvrir Runtime`}
        >
          <Badge
            variant="light"
            color={env.color}
            leftSection={<env.Icon size={12} />}
            rightSection={isCluster ? <IconAffiliate size={12} /> : undefined}
            style={{ cursor: "pointer", textTransform: "none" }}
          >
            {env.label}
            {isCluster ? " · cluster" : ""}
          </Badge>
        </UnstyledButton>
      </HoverCard.Target>

      <HoverCard.Dropdown p="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <ThemeIcon
                variant="light"
                color={env.color}
                size="md"
                radius="md"
              >
                <env.Icon size={16} />
              </ThemeIcon>
              <div style={{ minWidth: 0 }}>
                <Text fw={700} size="sm" truncate>
                  Runtime Nodefony
                </Text>
                <Text size="xs" c="dimmed">
                  {modeLabel}
                </Text>
              </div>
            </Group>
            <Badge size="sm" variant="light" color="brand" tt="none">
              v{info.version}
            </Badge>
          </Group>

          <Divider />

          <DefinitionList gap={4}>
            <KeyValue
              k="Environnement"
              v={`${info.environment}${info.debug ? " · debug" : ""}`}
            />
            <KeyValue k="Mode" v={modeLabel} />
            <KeyValue k="Node.js" v={info.node} mono />
            <KeyValue k="Plateforme" v={info.platform} mono />
            <KeyValue k="Domaine" v={info.domain} mono />
            <KeyValue k="PID" v={String(info.pid)} mono />
            <KeyValue k="Modules" v={String(info.modules)} />
            <KeyValue k="Démarré depuis" v={fmtUptime(info.uptime)} />
            {info.git?.branch && (
              <KeyValue
                k="Git"
                v={`${info.git.branch}${info.git.commit ? `@${info.git.commit}` : ""}`}
                mono
              />
            )}
          </DefinitionList>

          <Divider />

          {/* Fonds de panier (backplanes) — info rapide. */}
          <Stack gap={2}>
            <Text fz={10} fw={600} tt="uppercase" c="dimmed">
              Fonds de panier
            </Text>
            <DefinitionList gap={4}>
              <KeyValue
                k="Logs"
                v={`${info.backplanes?.log?.driver ?? "—"} · ${info.backplanes?.log?.sink ?? "—"}`}
                mono
              />
              {rt?.backplane && (
                <KeyValue
                  k="Realtime"
                  v={`${rt.backplane.driver} · ${rt.backplane.crossPod ? "cross-pod" : "local"}`}
                  mono
                />
              )}
            </DefinitionList>
          </Stack>

          <Divider />

          <Anchor
            component="button"
            type="button"
            size="xs"
            onClick={() => navigate("/nodefony/runtime")}
          >
            <Group gap={4} wrap="nowrap">
              <IconArrowRight size={13} />
              Détails runtime & santé
            </Group>
          </Anchor>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
