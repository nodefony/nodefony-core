import { observer } from "mobx-react-lite";
import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Group,
  Menu,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconGripVertical,
  IconLayoutGrid,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useAuth, useWorkspace } from "../stores";
import { isWorkspaceVisible } from "./presets";
import type { WorkspaceLayout } from "./types";

/* Dimensions de la vignette (mini-fenêtre fantôme). */
const TW = 156;
const TH = 88;

/**
 * Déplacement (px) au-delà duquel un appui devient un DRAG. En deçà, l'appui
 * reste un clic (= basculer de bureau) : sans ce seuil, le moindre tremblement
 * de souris pendant un clic réordonnerait les bureaux dans le dos de l'utilisateur.
 */
const DRAG_THRESHOLD = 4;

/**
 * Aperçu « mini-fenêtres fantômes » d'un bureau : les fenêtres rendues à
 * l'échelle (X/largeur en fraction → px ; Y/hauteur ramenés à la hauteur de
 * contenu). Carte mentale fidèle de chaque espace.
 */
function Thumb({
  layout,
  active,
}: {
  layout: WorkspaceLayout;
  active: boolean;
}) {
  const items = layout.items;
  const contentH = items.reduce((m, i) => Math.max(m, i.y + i.h), 0) || 1;
  return (
    <Box
      aria-hidden
      style={{
        position: "relative",
        width: TW,
        height: TH,
        borderRadius: 6,
        overflow: "hidden",
        background:
          "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--mantine-color-indigo-9) 16%, var(--mantine-color-body)) 0%, var(--mantine-color-body) 70%)",
        border: `${active ? "2px" : "1px"} solid ${active ? "var(--mantine-color-brand-5)" : "var(--mantine-color-default-border)"}`,
      }}
    >
      {items.map((it) => (
        <Box
          key={it.widgetId}
          style={{
            position: "absolute",
            // Inset (gouttière miniature) → reflète l'espacement réel du bureau.
            left: it.x * TW + 1,
            top: (it.y / contentH) * TH + 1,
            width: Math.max(2, it.w * TW - 2),
            height: Math.max(2, (it.h / contentH) * TH - 2),
            borderRadius: 2,
            background:
              "color-mix(in srgb, var(--mantine-color-brand-5) 38%, var(--mantine-color-body))",
            border: "1px solid var(--mantine-color-brand-4)",
          }}
        />
      ))}
      {items.length === 0 ? (
        <Text
          size="9px"
          c="dimmed"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
          }}
        >
          vide
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * **Bandeau d'espaces docké à la top bar** (façon Mission Control). Une fine
 * barre **collée sous la top bar** (sticky `top:0` car le scroll est sur
 * `AppShell.Main`, + plein-bleed pour la pleine largeur) qui **S'OUVRE** sur un
 * **slider de vignettes fantômes**, une par bureau. Clic vignette = bascule,
 * double-clic nom = renommer, **⋯** = renommer/dupliquer/supprimer, **« + »** =
 * ajout rapide (vierge ou modèle prédéfini nommé). Tout persisté.
 *
 * ⚠️ **z-index** : le bandeau vit dans `AppShell.Main` (région SOUS la top bar) →
 * il ne peut PAS la recouvrir ; z local faible (3). Les menus s'ouvrent en
 * portail (au-dessus, normal).
 */
export const WorkspaceSwitcher = observer(() => {
  const ws = useWorkspace();
  const auth = useAuth();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Filtre par rôle : un utilisateur ne voit QUE les bureaux qui lui sont
  // accessibles (un admin voit tout) → plus de bureau admin cliquable par erreur.
  const tabs = ws.layoutList.filter((l) =>
    isWorkspaceVisible(l.id, auth.roles),
  );
  const active = ws.active;
  const canDelete = tabs.length > 1;

  /* ── Réordonner les vignettes (drag au pointeur) ──────────────────────────
   * Même patron que le bureau (`WidgetGrid`) : `setPointerCapture` (aucun event
   * perdu si le curseur sort de la vignette), suivi en `transform` (compositor,
   * 0 render par frame), commit UNIQUE au relâché. Pas de lib de DnD : le besoin
   * est une liste horizontale, et la primitive pointeur est déjà celle du reste
   * du bureau — une seconde mécanique de drag dériverait de la première.
   *
   * Le drag ne doit pas voler le CLIC (= basculer de bureau) : on n'arme le
   * déplacement qu'au-delà d'un seuil (DRAG_THRESHOLD), et un clic franc reste
   * un clic. Équivalent CLAVIER dans le menu ⋯ (« Déplacer à gauche/droite ») —
   * un réordonnancement uniquement à la souris serait inaccessible.
   */
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    el: HTMLElement;
    sx: number;
    moved: boolean;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Id devant lequel on insérerait si on relâchait maintenant (`null` = en fin). */
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(
    undefined,
  );

  /** Id de la vignette devant laquelle insérer, d'après l'abscisse du curseur. */
  const dropTargetAt = useCallback(
    (clientX: number, draggedId: string): string | null => {
      const rail = railRef.current;
      if (!rail) return null;
      const cards = Array.from(
        rail.querySelectorAll<HTMLElement>("[data-ws-id]"),
      );
      for (const card of cards) {
        const id = card.dataset.wsId;
        if (!id || id === draggedId) continue;
        const r = card.getBoundingClientRect();
        // Avant la vignette dont le curseur n'a pas dépassé le milieu.
        if (clientX < r.left + r.width / 2) return id;
      }
      return null; // au-delà de toutes → en dernier
    },
    [],
  );

  const dragMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return; // encore un clic
      if (!d.moved) {
        d.moved = true;
        setDragId(d.id);
        document.body.style.userSelect = "none";
        d.el.style.willChange = "transform";
      }
      d.el.style.transform = `translate3d(${dx}px, 0, 0)`;
      setDropBefore(dropTargetAt(e.clientX, d.id));
    },
    [dropTargetAt],
  );

  const dragUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* déjà relâché */
      }
      d.el.style.transform = "";
      d.el.style.willChange = "";
      document.body.style.userSelect = "";
      const moved = d.moved;
      const before = dropTargetAt(e.clientX, d.id);
      dragRef.current = null;
      setDragId(null);
      setDropBefore(undefined);
      if (moved) ws.moveWorkspace(d.id, before); // commit unique
    },
    [dropTargetAt, ws],
  );

  const dragDown = useCallback(
    (id: string) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const el = (e.currentTarget as HTMLElement).closest(
        "[data-ws-id]",
      ) as HTMLElement | null;
      if (!el) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture non supportée */
      }
      dragRef.current = { id, el, sx: e.clientX, moved: false };
    },
    [],
  );

  /** Déplacement au CLAVIER (menu ⋯) — le drag seul serait inaccessible. */
  const shift = (id: string, dir: -1 | 1): void => {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= tabs.length) return;
    // Vers la droite : on passe DEVANT le suivant → cible = celui d'après (ou fin).
    ws.moveWorkspace(id, dir === -1 ? tabs[j].id : (tabs[j + 1]?.id ?? null));
  };

  const startRename = (id: string, label: string) => {
    setDraft(label);
    setEditing(id);
  };
  const commitRename = () => {
    if (editing) ws.renameWorkspace(editing, draft);
    setEditing(null);
  };

  const addMenu = (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Tooltip label="Nouveau bureau" withArrow>
          <ActionIcon variant="light" size="sm" aria-label="Ajouter un bureau">
            <IconPlus size={15} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Nouveau bureau</Menu.Label>
        <Menu.Item
          leftSection={<IconLayoutGrid size={14} />}
          onClick={() => ws.createWorkspace()}
        >
          Vierge
        </Menu.Item>
        <Menu.Divider />
        <Menu.Label>Depuis un modèle</Menu.Label>
        {ws.templates
          .filter(
            (t) => t.id !== "blank" && isWorkspaceVisible(t.id, auth.roles),
          )
          .map((t) => (
            <Menu.Item key={t.id} onClick={() => ws.createWorkspace(t.id)}>
              {t.label}
            </Menu.Item>
          ))}
      </Menu.Dropdown>
    </Menu>
  );

  return (
    // La STICKY est portée par l'en-tête UNIFIÉ du parent (Workspace) — pas ici :
    // deux sticky `top:0` (bandeau + PageHeader) se chevaucheraient.
    <Box>
      {/* Barre compacte TOUJOURS visible (l'« ouverture » bascule le slider). */}
      <Group justify="space-between" wrap="nowrap" py={6}>
        <UnstyledButton
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Replier les bureaux" : "Afficher les bureaux"}
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
        >
          <IconChevronDown
            size={16}
            style={{
              transition: "transform .15s ease",
              transform: open ? "none" : "rotate(-90deg)",
            }}
          />
          <Text fw={600} size="sm">
            Bureaux
          </Text>
          <Badge size="sm" variant="light" color="gray">
            {tabs.length}
          </Badge>
          {!open ? (
            <Text size="xs" c="dimmed" truncate>
              · {active.label}
            </Text>
          ) : null}
        </UnstyledButton>
        {addMenu}
      </Group>

      {/* Slider de vignettes (s'ouvre / se replie). */}
      <Collapse expanded={open}>
        <Box
          ref={railRef}
          role="tablist"
          aria-label="Bureaux"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            overflowX: "auto",
            // `overflow-x: auto` force `overflow-y: auto` → sans marge, le haut des
            // vignettes (bordure active) serait rogné. Padding haut = respiration.
            paddingTop: 6,
            paddingBottom: 12,
            // Pendant un drag, le snap se battrait avec le suivi du curseur.
            scrollSnapType: dragId ? "none" : "x proximity",
          }}
        >
          {tabs.map((l) => {
            const isActive = l.id === active.id;
            const dragging = dragId === l.id;
            // Trait d'insertion : où la vignette atterrirait si on relâchait ici.
            const showCaret = dragId !== null && dropBefore === l.id;
            return (
              <Box
                key={l.id}
                data-ws-id={l.id}
                style={{
                  position: "relative",
                  flexShrink: 0,
                  width: TW,
                  scrollSnapAlign: "start",
                  // La vignette portée suit le curseur (transform) et passe devant.
                  zIndex: dragging ? 2 : undefined,
                  opacity: dragging ? 0.85 : 1,
                  cursor: dragging ? "grabbing" : undefined,
                  // Marge de gauche = place du trait d'insertion (pas de reflow brutal).
                  borderLeft: showCaret
                    ? "2px solid var(--mantine-color-brand-5)"
                    : "2px solid transparent",
                  paddingLeft: 4,
                }}
              >
                {canDelete ? (
                  <Tooltip label="Supprimer ce bureau" withArrow>
                    <ActionIcon
                      size="xs"
                      variant="filled"
                      color="dark"
                      radius="xl"
                      aria-label={`Supprimer le bureau ${l.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        ws.deleteWorkspace(l.id);
                      }}
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        zIndex: 2,
                        opacity: 0.85,
                      }}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
                {/* Poignée de déplacement : le drag part d'ICI (pas de toute la
                    vignette) — sinon un clic « bascule de bureau » un peu appuyé
                    partirait en déplacement. Le clic sur l'aperçu reste un clic. */}
                <Tooltip label="Glisser pour réordonner" withArrow>
                  <Box
                    role="button"
                    tabIndex={-1}
                    aria-label={`Déplacer le bureau ${l.label}`}
                    onPointerDown={dragDown(l.id)}
                    onPointerMove={dragMove}
                    onPointerUp={dragUp}
                    onPointerCancel={dragUp}
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      zIndex: 2,
                      display: "grid",
                      placeItems: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      color: "var(--mantine-color-dimmed)",
                      background:
                        "color-mix(in srgb, var(--mantine-color-body) 70%, transparent)",
                      cursor: dragging ? "grabbing" : "grab",
                      touchAction: "none", // sinon le scroll tactile mange le drag
                    }}
                  >
                    <IconGripVertical size={13} />
                  </Box>
                </Tooltip>
                <UnstyledButton
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => ws.setActive(l.id)}
                  style={{ display: "block", width: TW }}
                >
                  <Thumb layout={l} active={isActive} />
                </UnstyledButton>
                <Group gap={2} wrap="nowrap" mt={4} justify="space-between">
                  {editing === l.id ? (
                    <TextInput
                      size="xs"
                      value={draft}
                      autoFocus
                      aria-label="Nom du bureau"
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <Text
                      size="xs"
                      fw={isActive ? 700 : 500}
                      c={isActive ? "brand" : undefined}
                      truncate
                      // `userSelect:none` → le double-clic déclenche le renommage au
                      // lieu de sélectionner le mot.
                      style={{ flex: 1, cursor: "text", userSelect: "none" }}
                      onDoubleClick={() => startRename(l.id, l.label)}
                      title="Double-clic pour renommer"
                    >
                      {l.label}
                    </Text>
                  )}
                  <Menu position="bottom-end" withinPortal returnFocus={false}>
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="xs"
                        aria-label={`Options du bureau ${l.label}`}
                      >
                        <IconDots size={13} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconPencil size={13} />}
                        onClick={() => startRename(l.id, l.label)}
                      >
                        Renommer
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconCopy size={13} />}
                        onClick={() => ws.duplicateWorkspace(l.id)}
                      >
                        Dupliquer
                      </Menu.Item>
                      <Menu.Divider />
                      {/* Réordonnancement au CLAVIER — le drag ne doit pas être la
                          SEULE façon de déplacer un bureau (WCAG : tout geste
                          pointeur a son équivalent clavier). */}
                      <Menu.Item
                        leftSection={<IconArrowLeft size={13} />}
                        disabled={tabs[0]?.id === l.id}
                        onClick={() => shift(l.id, -1)}
                      >
                        Déplacer à gauche
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconArrowRight size={13} />}
                        disabled={tabs[tabs.length - 1]?.id === l.id}
                        onClick={() => shift(l.id, 1)}
                      >
                        Déplacer à droite
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={13} />}
                        disabled={!canDelete}
                        onClick={() => ws.deleteWorkspace(l.id)}
                      >
                        Supprimer
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Box>
            );
          })}

          {/* Carte « + » d'ajout rapide. */}
          <Box style={{ flexShrink: 0, width: TW }}>
            <Menu position="bottom-start" withinPortal>
              <Menu.Target>
                <Tooltip label="Nouveau bureau" withArrow>
                  <UnstyledButton
                    aria-label="Ajouter un bureau"
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: TW,
                      height: TH,
                      borderRadius: 6,
                      border: "1px dashed var(--mantine-color-default-border)",
                      color: "var(--mantine-color-dimmed)",
                    }}
                  >
                    <IconPlus size={22} />
                  </UnstyledButton>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Nouveau bureau</Menu.Label>
                <Menu.Item
                  leftSection={<IconLayoutGrid size={14} />}
                  onClick={() => ws.createWorkspace()}
                >
                  Vierge
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Depuis un modèle</Menu.Label>
                {ws.templates
                  .filter(
                    (t) =>
                      t.id !== "blank" && isWorkspaceVisible(t.id, auth.roles),
                  )
                  .map((t) => (
                    <Menu.Item
                      key={t.id}
                      onClick={() => ws.createWorkspace(t.id)}
                    >
                      {t.label}
                    </Menu.Item>
                  ))}
              </Menu.Dropdown>
            </Menu>
            <Text size="xs" c="dimmed" mt={4} ta="center">
              Ajouter
            </Text>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
});

export default WorkspaceSwitcher;
