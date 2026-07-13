/**
 * ActionPanel — console d'exécution d'UNE action : formulaire auto construit
 * depuis les métadonnées décorateurs (path vars, `@Query`, `@Headers`, `@Body`)
 * + exécution par les DEUX portes (HTTP fetch / socket Nodefony `api.request`)
 * avec réponses côte à côte et latence par porte.
 *
 * Moments rendus visibles :
 * - **switch HTTP ⇄ Socket** : la MÊME action controller répond sur les deux
 *   transports (une route `duplex` déclare aussi WEBSOCKET) ;
 * - **idempotence** : « Rejouer même clé » renvoie la réponse MÉMORISÉE
 *   (même payload, 0 ré-exécution — comparer les ids/latences).
 *
 * Les erreurs sont des RÉPONSES (fail-loud pédagogique) : un 401 anonyme au
 * pont, un 400 « clé manquante », un 405 « pas de transport WS » s'affichent
 * comme le serveur les rend — jamais masqués par un fallback.
 */
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Code,
  Grid,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import {
  IconBolt,
  IconRefresh,
  IconRepeat,
  IconSend,
} from "@tabler/icons-react";
import { useNodefony } from "nodefony/react";
import { JsonViewer, TipHint } from "../../components/ui";
import {
  buildUrl,
  describeInjectedSource,
  httpMethodsOf,
  isMutation,
  makeIdempotencyKey,
  type ExecResult,
  type PlaygroundAction,
} from "./PlaygroundModel";
import { GuardBadges, MethodBadge, StatusBadge } from "./PlaygroundFormat";

/** Exécution HTTP — fetch same-origin, latence mesurée, réponse jamais levée. */
async function runHttp(
  method: string,
  url: string,
  body: string | undefined,
  headers: Record<string, string>,
): Promise<ExecResult> {
  const t0 = performance.now();
  try {
    const h = new Headers(headers);
    h.set("Accept", "application/json");
    if (body !== undefined) h.set("Content-Type", "application/json");
    const res = await fetch(url, {
      method,
      headers: h,
      body,
      credentials: "same-origin",
    });
    const isJson = (res.headers.get("Content-Type") ?? "").includes(
      "application/json",
    );
    const payload = isJson ? await res.json() : await res.text();
    return {
      transport: "http",
      status: res.status,
      ok: res.ok,
      durationMs: performance.now() - t0,
      body: payload,
      error: null,
      instance: res.headers.get("x-nodefony-instance"),
    };
  } catch (e) {
    return {
      transport: "http",
      status: null,
      ok: false,
      durationMs: performance.now() - t0,
      body: null,
      error: e instanceof Error ? e.message : String(e),
      instance: null,
    };
  }
}

/** Forme structurelle d'un `RpcError` du pont (duck-typing cross-bundle). */
interface RpcErrorLike {
  name?: string;
  message?: string;
  data?: { status?: number; body?: unknown };
}

/**
 * Exécution socket — pont `api.request`/`api.mutate` du client Nodefony.
 * Un `RpcError` porte le statut HTTP équivalent (`data.status`) : on le rend
 * comme une réponse (pas un crash) — c'est la radiographie du refus.
 */
async function runSocket(
  client: ReturnType<typeof useNodefony>,
  method: string,
  url: string,
  body: unknown,
  idempotencyKey: string | undefined,
): Promise<ExecResult> {
  const t0 = performance.now();
  try {
    const payload =
      method === "GET"
        ? await client.request<unknown>(url as `/${string}`)
        : await client.mutate<unknown>(url as `/${string}`, {
            method: method as "POST" | "PUT" | "PATCH" | "DELETE",
            body,
            idempotencyKey: idempotencyKey ?? makeIdempotencyKey(),
          });
    return {
      transport: "socket",
      status: 200,
      ok: true,
      durationMs: performance.now() - t0,
      body: payload,
      error: null,
      instance: null,
    };
  } catch (e) {
    const rpc = e as RpcErrorLike;
    const status = rpc.name === "RpcError" ? (rpc.data?.status ?? null) : null;
    return {
      transport: "socket",
      status,
      ok: false,
      durationMs: performance.now() - t0,
      body: rpc.data?.body ?? null,
      error: rpc.message ?? String(e),
      instance: null,
    };
  }
}

/** Carte de résultat d'une porte (statut + latence + payload). */
function ResultCard({ result }: { result: ExecResult }) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {result.transport === "http" ? "Porte HTTP" : "Porte Socket"}
          </Text>
          <StatusBadge status={result.status} />
        </Group>
        <Text
          size="sm"
          c="dimmed"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {result.durationMs.toFixed(1)} ms
          {result.instance ? ` · ${result.instance}` : ""}
        </Text>
      </Group>
      {result.error !== null && (
        <Text size="sm" c="red" role="alert" mb="xs">
          {result.error}
        </Text>
      )}
      {result.body !== null && result.body !== undefined && (
        <JsonViewer value={result.body} maxHeight={260} />
      )}
    </Card>
  );
}

export interface ActionPanelProps {
  action: PlaygroundAction;
}

/** Console d'exécution d'une action (formulaire + double porte + résultats). */
export function ActionPanel({ action }: ActionPanelProps) {
  const client = useNodefony();
  const methods = httpMethodsOf(action);
  const [method, setMethod] = useState(methods[0] ?? "GET");
  const [vars, setVars] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of action.variables) {
      const d = action.defaults[v];
      init[v] = d === undefined || d === null ? "" : String(d);
    }
    return init;
  });
  const [query, setQuery] = useState<Record<string, string>>({});
  const [headerVals, setHeaderVals] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("{}");
  const [idemKey, setIdemKey] = useState(makeIdempotencyKey);
  const [running, setRunning] = useState(false);
  const [httpResult, setHttpResult] = useState<ExecResult | null>(null);
  const [socketResult, setSocketResult] = useState<ExecResult | null>(null);

  // Champs pilotés par les métadonnées décorateurs de l'action.
  const queryKeys = useMemo(
    () =>
      action.params
        .filter((p) => p.source === "query" && p.key)
        .map((p) => p.key as string),
    [action],
  );
  const headerKeys = useMemo(
    () =>
      action.params
        .filter((p) => p.source === "headers" && p.key)
        .map((p) => p.key as string),
    [action],
  );
  const injected = useMemo(
    () =>
      action.params.filter(
        (p) => !["param", "body", "query", "headers"].includes(p.source),
      ),
    [action],
  );
  const hasBody =
    isMutation(method) || action.params.some((p) => p.source === "body");
  const mutation = isMutation(method);
  const url = action.path ? buildUrl(action.path, vars, query) : "";

  /** Parse le body JSON du textarea — erreur rendue en résultat (fail-loud). */
  const parseBody = (): { ok: true; value: unknown } | { ok: false } => {
    if (!hasBody || bodyText.trim() === "")
      return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(bodyText) as unknown };
    } catch {
      return { ok: false };
    }
  };

  const exec = async (
    transport: "http" | "socket",
    reuseKey: boolean,
  ): Promise<void> => {
    const parsed = parseBody();
    if (!parsed.ok) {
      const bad: ExecResult = {
        transport,
        status: null,
        ok: false,
        durationMs: 0,
        body: null,
        error: "Body : JSON invalide (corrigez avant d'envoyer).",
        instance: null,
      };
      (transport === "http" ? setHttpResult : setSocketResult)(bad);
      return;
    }
    // Nouvelle clé à chaque envoi NORMAL ; « rejouer » réutilise la clé affichée.
    const key = reuseKey ? idemKey : makeIdempotencyKey();
    if (!reuseKey && mutation) setIdemKey(key);
    setRunning(true);
    try {
      if (transport === "http") {
        const headers: Record<string, string> = { ...headerVals };
        for (const k of Object.keys(headers)) {
          if (headers[k] === "") delete headers[k];
        }
        if (mutation && action.guards.idempotent) {
          headers["Idempotency-Key"] = key;
        }
        setHttpResult(
          await runHttp(
            method,
            url,
            hasBody && parsed.value !== undefined
              ? JSON.stringify(parsed.value)
              : undefined,
            headers,
          ),
        );
      } else {
        setSocketResult(
          await runSocket(
            client,
            method,
            url,
            parsed.value,
            mutation ? key : undefined,
          ),
        );
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack gap="sm">
      {/* En-tête : transports + gardes (radiographie déclarative). */}
      <Group gap="xs" wrap="wrap">
        {action.methods.map((m) => (
          <MethodBadge key={m} method={m} />
        ))}
        <Code>{action.path ?? "—"}</Code>
        <GuardBadges action={action} />
      </Group>

      {/* Sélecteur de méthode logique quand la route en déclare plusieurs. */}
      {methods.length > 1 && (
        <Group gap="xs">
          {methods.map((m) => (
            <Button
              key={m}
              size="compact-xs"
              variant={m === method ? "filled" : "default"}
              onClick={() => setMethod(m)}
            >
              {m}
            </Button>
          ))}
        </Group>
      )}

      {/* Formulaire auto — piloté par les métadonnées. */}
      <Grid gap="xs">
        {action.variables.map((v) => (
          <Grid.Col key={v} span={{ base: 12, sm: 4 }}>
            <TextInput
              label={`{${v}}`}
              description="variable de path"
              value={vars[v] ?? ""}
              onChange={(e) => setVars({ ...vars, [v]: e.currentTarget.value })}
            />
          </Grid.Col>
        ))}
        {queryKeys.map((k) => (
          <Grid.Col key={k} span={{ base: 12, sm: 4 }}>
            <TextInput
              label={k}
              description="@Query"
              value={query[k] ?? ""}
              onChange={(e) =>
                setQuery({ ...query, [k]: e.currentTarget.value })
              }
            />
          </Grid.Col>
        ))}
        {headerKeys.map((k) => (
          <Grid.Col key={k} span={{ base: 12, sm: 4 }}>
            <TextInput
              label={k}
              description="@Headers"
              value={headerVals[k] ?? ""}
              onChange={(e) =>
                setHeaderVals({ ...headerVals, [k]: e.currentTarget.value })
              }
            />
          </Grid.Col>
        ))}
      </Grid>
      {hasBody && (
        <Textarea
          label="Body (JSON)"
          autosize
          minRows={3}
          maxRows={10}
          value={bodyText}
          onChange={(e) => setBodyText(e.currentTarget.value)}
          styles={{
            input: { fontFamily: "var(--mantine-font-family-monospace)" },
          }}
        />
      )}
      {injected.length > 0 && (
        <Text size="xs" c="dimmed">
          Injecté par le serveur :{" "}
          {injected
            .map(
              (p) =>
                `@${p.source}${p.key ? `(${p.key})` : ""} — ${describeInjectedSource(p.source)}`,
            )
            .join(" · ")}
        </Text>
      )}

      {/* Barre d'exécution — les deux portes + rejeu idempotent. */}
      <Group gap="xs" wrap="wrap">
        <Button
          leftSection={<IconSend size={16} />}
          loading={running}
          onClick={() => void exec("http", false)}
        >
          Envoyer HTTP
        </Button>
        <Tooltip
          label={
            action.duplex
              ? "La même action, par la socket Nodefony (pont api.request)"
              : "Cette route ne déclare pas le transport WEBSOCKET — le pont répondra 405 (démonstration honnête)"
          }
        >
          <Button
            variant={action.duplex ? "light" : "default"}
            leftSection={<IconBolt size={16} />}
            loading={running}
            onClick={() => void exec("socket", false)}
          >
            Envoyer Socket
          </Button>
        </Tooltip>
        {mutation && action.guards.idempotent && (
          <>
            <Button
              variant="outline"
              color="indigo"
              leftSection={<IconRepeat size={16} />}
              loading={running}
              onClick={() => void exec("socket", true)}
            >
              Rejouer même clé (socket)
            </Button>
            <Button
              variant="outline"
              color="indigo"
              leftSection={<IconRepeat size={16} />}
              loading={running}
              onClick={() => void exec("http", true)}
            >
              Rejouer même clé (HTTP)
            </Button>
            <Group gap={4}>
              <Code style={{ fontSize: 11 }}>{idemKey}</Code>
              <Tooltip label="Régénérer la clé d'idempotence">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  aria-label="Régénérer la clé d'idempotence"
                  onClick={() => setIdemKey(makeIdempotencyKey())}
                >
                  <IconRefresh size={14} />
                </Button>
              </Tooltip>
              <TipHint
                title="Idempotence visible"
                summary="Envoyer exécute l'action avec une clé NEUVE. « Rejouer même clé » renvoie la réponse MÉMORISÉE par le serveur : même payload (mêmes ids), zéro ré-exécution — comparez avec un envoi neuf."
              />
            </Group>
          </>
        )}
      </Group>

      {/* Réponses côte à côte — le moment « une action, deux transports ». */}
      {(httpResult || socketResult) && (
        <Grid gap="sm">
          {httpResult && (
            <Grid.Col span={{ base: 12, md: socketResult ? 6 : 12 }}>
              <ResultCard result={httpResult} />
            </Grid.Col>
          )}
          {socketResult && (
            <Grid.Col span={{ base: 12, md: httpResult ? 6 : 12 }}>
              <ResultCard result={socketResult} />
            </Grid.Col>
          )}
        </Grid>
      )}
    </Stack>
  );
}
