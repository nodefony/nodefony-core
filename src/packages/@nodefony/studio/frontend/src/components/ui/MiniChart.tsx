import { useLayoutEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Card,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconArrowsMaximize } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { stableTop } from "../../utils/chartScale";

/** Une série de points pour {@link MiniChart}. */
export interface MiniChartSeries {
  data: number[];
  color: string;
  label: string;
}

export interface MiniChartProps {
  series: MiniChartSeries[];
  height?: number;
  /** Plafond Y forcé (sinon auto = max × 1.15). */
  max?: number | undefined;
  /** Zone rouge au-dessus de ce seuil (alerte visuelle). */
  threshold?: number | undefined;
  /** Formate une valeur (axe + tooltip). Défaut = entier. */
  format?: ((v: number) => string) | undefined;
  /**
   * Heure d'ARRIVÉE de chaque point (`Date.now()` du navigateur), alignée sur
   * la FIN des séries. Donnée avec `windowMs` : abscisse en TEMPS — chaque
   * point est placé à son heure et la courbe défile à vitesse CONSTANTE
   * (largeur ÷ fenêtre). Un retard devient un trou visible, jamais une
   * accélération : avec un cran par point, deux points arrivés collés après
   * un trou faisaient rattraper la courbe d'un coup.
   */
  times?: readonly number[] | undefined;
  /** Durée visible, en ms (avec `times`). Défilement coupé sous `prefers-reduced-motion`. */
  windowMs?: number | undefined;
}

/** `prefers-reduced-motion`, lu une fois (pas de défilement animé si demandé). */
let reducedMotion: boolean | null = null;
function prefersReducedMotion(): boolean {
  reducedMotion ??=
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reducedMotion;
}

/** Format par défaut d'une valeur : entier arrondi. Hissé pour garder une référence stable. */
const roundFormat = (v: number): string => String(Math.round(v));

/**
 * MiniChart — mini-graphe SVG temps-réel, **zéro dépendance** (recharts 2.x est
 * cassé sous React 19). Survol : ligne-guide + points + tooltip. Repères Y, zone
 * de seuil optionnelle. Extrait du Dashboard → réutilisable par toute page live.
 *
 * Accessibilité : `role="img"` + `aria-label` résumant la dernière valeur de
 * chaque série (le SVG seul est opaque au lecteur d'écran).
 */
export function MiniChart({
  series,
  height = 190,
  max,
  threshold,
  format = roundFormat,
  times,
  windowMs,
}: MiniChartProps) {
  const W = 600;
  const H = 200;
  const pad = 6;
  const [hover, setHover] = useState<{
    idx: number;
    xPx: number;
    w: number;
  } | null>(null);
  const topRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  const top =
    max ??
    (topRef.current = stableTop(
      topRef.current,
      Math.max(0, ...series.flatMap((s) => s.data)),
    ));
  const plotW = W - pad * 2;
  const timed =
    times !== undefined &&
    windowMs !== undefined &&
    windowMs > 0 &&
    times.length >= 2;
  // Index GLOBAL g : en temps, l'index dans `times` (séries alignées sur la
  // fin) ; sinon l'index du point, séries alignées sur le début.
  const slots = timed ? times.length : n;
  const lastTime = timed ? times[slots - 1] : undefined;
  // Ancre des positions : l'heure à laquelle le DERNIER point a été dessiné.
  // Elle ne change qu'à l'arrivée d'un point — un re-rendu sans point neuf
  // (survol) garde les mêmes positions pendant que l'animation continue.
  const anchorRef = useRef<{ last: number | undefined; at: number }>({
    last: undefined,
    at: 0,
  });
  if (timed && anchorRef.current.last !== lastTime) {
    anchorRef.current = { last: lastTime, at: Date.now() };
  }
  const anchor = anchorRef.current.at;
  const speed = timed ? plotW / windowMs : 0; // unités du viewBox par ms
  const animate = timed && !prefersReducedMotion();
  const xOfG = (g: number): number =>
    timed
      ? pad + plotW - (anchor - (times[g] ?? anchor)) * speed
      : pad + (g * plotW) / Math.max(1, n - 1);
  const gOf = (len: number, i: number): number => (timed ? slots - len + i : i);
  const valueAt = (s: MiniChartSeries, g: number): number | undefined =>
    s.data[timed ? g - (slots - s.data.length) : g];
  const yOf = (v: number) => H - pad - (Math.min(v, top) / top) * (H - pad * 2);
  // Une animation LINÉAIRE par point reçu, à vitesse constante : la courbe
  // parcourt toute la largeur utile en `windowMs`. Elle porte sur un <div>
  // HTML, pas sur un groupe SVG : la transform d'un élément HTML est jouée par
  // le compositeur — la courbe glisse même quand le fil principal est occupé,
  // et rien n'est repeint entre deux points. Avant la peinture (layout effect)
  // et recalée sur le temps déjà écoulé depuis l'ancre : sinon le délai entre
  // le rendu et l'effet se lit comme un saut.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!animate || el === null || typeof el.animate !== "function") return;
    const anim = el.animate(
      [
        { transform: "translateX(0%)" },
        { transform: `translateX(${(-plotW / W) * 100}%)` },
      ],
      { duration: windowMs, easing: "linear", fill: "forwards" },
    );
    anim.currentTime = Math.min(windowMs, Math.max(0, Date.now() - anchor));
    return () => anim.cancel();
  }, [lastTime, animate, plotW, windowMs, anchor]);
  if (n < 2) return null;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    // Abscisse DANS les données : la courbe a glissé depuis l'ancre.
    const xData = frac * W + (animate ? speed * (Date.now() - anchor) : 0);
    let best = 0;
    for (let g = 1; g < slots; g += 1) {
      if (Math.abs(xOfG(g) - xData) < Math.abs(xOfG(best) - xData)) best = g;
    }
    setHover({
      idx: best,
      xPx: frac * r.width,
      w: r.width,
    });
  };

  const tipLeft = hover
    ? hover.xPx > hover.w * 0.6
      ? hover.xPx - 140
      : hover.xPx + 12
    : 0;
  const ariaLabel = series
    .map((s) => `${s.label} ${format(s.data[s.data.length - 1] ?? 0)}`)
    .join(", ");

  return (
    <div
      style={{ position: "relative" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label={`Graphe temps réel — ${ariaLabel}`}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {threshold != null && (
          <rect
            x={pad}
            y={yOf(top)}
            width={W - pad * 2}
            height={Math.max(0, yOf(threshold) - yOf(top))}
            fill="var(--mantine-color-red-6)"
            opacity={0.07}
          />
        )}
        <line
          x1={pad}
          y1={yOf(0)}
          x2={W - pad}
          y2={yOf(0)}
          stroke="var(--mantine-color-default-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.6}
        />
      </svg>
      {/* Courbes : rognées à la zone utile (couche fixe), portées par un div
          qui défile (couche compositeur). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 ${(pad / W) * 100}% 0 ${(pad / W) * 100}%)`,
          pointerEvents: "none",
        }}
      >
        <div
          ref={scrollRef}
          style={{
            position: "absolute",
            inset: 0,
            willChange: animate ? "transform" : undefined,
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ display: "block", overflow: "visible" }}
          >
            {series.map((s) => {
              const len = s.data.length;
              const line = s.data
                .map(
                  (v, i) =>
                    `${xOfG(gOf(len, i)).toFixed(1)},${yOf(v).toFixed(1)}`,
                )
                .join(" ");
              const area = `${xOfG(gOf(len, 0)).toFixed(1)},${H - pad} ${line} ${xOfG(gOf(len, len - 1)).toFixed(1)},${H - pad}`;
              const last = s.data[s.data.length - 1];
              return (
                <g key={s.label}>
                  <polygon points={area} fill={s.color} opacity={0.1} />
                  <polyline
                    points={line}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {last !== undefined && (
                    <circle
                      cx={xOfG(gOf(len, len - 1))}
                      cy={yOf(last)}
                      r={3}
                      fill={s.color}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              );
            })}
            {hover && (
              <>
                <line
                  x1={xOfG(hover.idx)}
                  y1={pad}
                  x2={xOfG(hover.idx)}
                  y2={H - pad}
                  stroke="var(--mantine-color-dimmed)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.6}
                />
                {series.map((s) => (
                  <circle
                    key={s.label}
                    cx={xOfG(hover.idx)}
                    cy={yOf(valueAt(s, hover.idx) ?? 0)}
                    r={3.5}
                    fill={s.color}
                    stroke="var(--mantine-color-body)"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
      <Text
        c="dimmed"
        style={{ position: "absolute", top: 0, left: 2, fontSize: 10 }}
      >
        {format(top)}
      </Text>
      <Text
        c="dimmed"
        style={{ position: "absolute", bottom: 0, left: 2, fontSize: 10 }}
      >
        0
      </Text>
      {hover && (
        <Paper
          shadow="sm"
          p={6}
          withBorder
          style={{
            position: "absolute",
            top: 4,
            left: tipLeft,
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          <Stack gap={2}>
            {series.map((s) => (
              <Group key={s.label} gap={6} wrap="nowrap">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: s.color,
                    borderRadius: 2,
                  }}
                />
                <Text size="xs">
                  {s.label} : <b>{format(valueAt(s, hover.idx) ?? 0)}</b>
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </div>
  );
}

/**
 * Carte titrée enveloppant un graphe (titre + badge + légende courte).
 *
 * `fullscreen` (opt-in) ajoute un bouton ⤢ qui ouvre le graphe en plein écran
 * (Modal `fullScreen`). Pour que le graphe **grossisse vraiment** (et pas juste
 * se centre), passer `children` en **render-prop** `({ fullscreen }) => …` et
 * adapter la hauteur du `MiniChart` (le SVG est `preserveAspectRatio="none"` →
 * il s'étire à la hauteur donnée). `children` ReactNode simple reste supporté.
 */
export function ChartCard({
  title,
  caption,
  badge,
  icon,
  fullscreen = false,
  children,
}: {
  title: string;
  caption: string;
  badge?: ReactNode;
  /** Icône de provenance (ex. logo Node.js, icône de l'élément qui détient la sonde). */
  icon?: ReactNode;
  fullscreen?: boolean;
  children: ReactNode | ((opts: { fullscreen: boolean }) => ReactNode);
}) {
  const [opened, setOpened] = useState(false);
  const render = (fs: boolean): ReactNode =>
    typeof children === "function" ? children({ fullscreen: fs }) : children;
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb={2} wrap="nowrap">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {icon}
          <Title order={2} size="h4">
            {title}
          </Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {badge}
          {fullscreen && (
            <Tooltip label="Plein écran" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Afficher « ${title} » en plein écran`}
                onClick={() => setOpened(true)}
              >
                <IconArrowsMaximize size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        {caption}
      </Text>
      {render(false)}
      {fullscreen && (
        <Modal
          opened={opened}
          onClose={() => setOpened(false)}
          fullScreen
          radius={0}
          title={title}
          transitionProps={{ transition: "fade", duration: 150 }}
        >
          <Stack gap="sm">
            {badge && <Group gap="xs">{badge}</Group>}
            <Text size="sm" c="dimmed">
              {caption}
            </Text>
            {render(true)}
          </Stack>
        </Modal>
      )}
    </Card>
  );
}

/** Pastille de légende (trait coloré + libellé gris). `size` adapte la police
 *  (ex. `"md"` en plein écran). */
export function Legend({
  color,
  label,
  size = "xs",
}: {
  color: string;
  label: string;
  size?: string;
}) {
  const big = size !== "xs";
  return (
    <Group gap={6} wrap="nowrap">
      <span
        style={{
          width: big ? 18 : 12,
          height: big ? 4 : 3,
          background: color,
          borderRadius: 2,
        }}
      />
      <Text size={size} c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
