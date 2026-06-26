import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Modal,
  Stack,
  Group,
  Button,
  Slider,
  Text,
  FileButton,
} from "@mantine/core";
import { IconCamera, IconTrash, IconZoomIn } from "@tabler/icons-react";
import { useNotifications } from "../../stores";
import { initials, gravatarUrl, type AvatarProfile } from "../../utils/avatar";

/** Côté du viewport carré (= diamètre du guide circulaire). */
const VIEWPORT = 260;
/** Côté de l'image de sortie (avatar recadré, carré affiché en cercle). */
const OUTPUT = 256;
/** Garde-fou taille du fichier d'ENTRÉE (le résultat recadré est bien plus petit). */
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

/**
 * Avatar d'affichage : `picture` (data URL / URL) → Gravatar (email, async) →
 * initiales. Mantine retombe sur les `children` (initiales) si `src` est absent
 * ou échoue (404 Gravatar, blocage CSP).
 */
export function UserAvatar({
  profile,
  identifier,
  size = 64,
}: {
  profile: AvatarProfile;
  identifier?: string;
  size?: number;
}) {
  const [gravatar, setGravatar] = useState<string | null>(null);
  const picture = profile.picture?.trim();
  const email = profile.email?.trim();

  useEffect(() => {
    let alive = true;
    if (!picture && email) {
      void gravatarUrl(email, Math.max(80, size * 2)).then((u) => {
        if (alive) setGravatar(u);
      });
    } else {
      setGravatar(null);
    }
    return () => {
      alive = false;
    };
  }, [picture, email, size]);

  return (
    <Avatar
      src={picture || gravatar || undefined}
      size={size}
      radius="xl"
      color="brand"
    >
      {initials(profile, identifier)}
    </Avatar>
  );
}

/**
 * Recadreur circulaire d'avatar — **0 dépendance** : l'image est déplaçable
 * (pointer) + zoomable (slider), un masque circulaire montre le rendu final. Au
 * « Valider », un `<canvas>` 256px **re-encode** la zone visible en WebP → data
 * URL. Le re-encodage canvas neutralise EXIF/polyglotte/SVG (le serveur ne
 * reçoit qu'un raster pur, borné). Suffisant pour Studio (admin desktop).
 */
function AvatarCropper({
  src,
  onCancel,
  onDone,
}: {
  src: string;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);

  const baseScale = nat ? Math.max(VIEWPORT / nat.w, VIEWPORT / nat.h) : 1;
  const scale = baseScale * zoom;
  const dispW = nat ? nat.w * scale : VIEWPORT;
  const dispH = nat ? nat.h * scale : VIEWPORT;

  // Borne l'offset pour que le disque reste TOUJOURS couvert par l'image.
  const clampOff = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEWPORT - dispW, x)),
      y: Math.min(0, Math.max(VIEWPORT - dispH, y)),
    }),
    [dispW, dispH],
  );

  // Dimensions naturelles + centrage initial.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      const bs = Math.max(
        VIEWPORT / img.naturalWidth,
        VIEWPORT / img.naturalHeight,
      );
      const w = img.naturalWidth * bs;
      const h = img.naturalHeight * bs;
      setOff({ x: (VIEWPORT - w) / 2, y: (VIEWPORT - h) / 2 });
    };
    img.src = src;
  }, [src]);

  // Re-borne l'offset quand le zoom change (les bornes dépendent de dispW/H).
  useEffect(() => {
    if (nat) setOff((o) => clampOff(o.x, o.y));
  }, [zoom, nat, clampOff]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    setOff(
      clampOff(
        drag.current.ox + (e.clientX - drag.current.px),
        drag.current.oy + (e.clientY - drag.current.py),
      ),
    );
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const confirm = async (): Promise<void> => {
    if (!nat) return;
    setBusy(true);
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image"));
        img.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas indisponible");
      // Zone visible du viewport en coordonnées image (inverse de la transfo).
      const sSize = VIEWPORT / scale;
      ctx.drawImage(
        img,
        -off.x / scale,
        -off.y / scale,
        sSize,
        sSize,
        0,
        0,
        OUTPUT,
        OUTPUT,
      );
      // WebP compact ; repli PNG automatique si le navigateur ne sait pas l'encoder.
      onDone(canvas.toDataURL("image/webp", 0.85));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md" align="center">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "relative",
          width: VIEWPORT,
          height: VIEWPORT,
          overflow: "hidden",
          borderRadius: 8,
          touchAction: "none",
          cursor: "grab",
          background: "var(--mantine-color-dark-8)",
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: off.x,
            top: off.y,
            width: dispW,
            height: dispH,
            userSelect: "none",
            maxWidth: "none",
          }}
        />
        {/* Masque « spotlight » : disque clair, extérieur assombri. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            pointerEvents: "none",
          }}
        />
      </div>

      <Group gap="xs" w={VIEWPORT}>
        <IconZoomIn size={16} aria-hidden />
        <Slider
          flex={1}
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={setZoom}
          label={(v) => `${v.toFixed(1)}×`}
          aria-label="Zoom de l'avatar"
        />
      </Group>

      <Group justify="flex-end" w={VIEWPORT}>
        <Button variant="default" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        <Button onClick={confirm} loading={busy} disabled={!nat}>
          Valider
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * Bloc avatar éditable : aperçu (`UserAvatar`) + bouton « Changer la photo »
 * (sélection fichier → recadrage circulaire → data URL WebP) + « Retirer ».
 * Le parent décide quoi faire de la data URL (`onChange`) — ici on ne persiste
 * rien (la page enregistre `picture` via son endpoint profil).
 */
export function AvatarUpload({
  profile,
  identifier,
  onChange,
  disabled,
}: {
  profile: AvatarProfile;
  identifier?: string;
  onChange: (picture: string) => void;
  disabled?: boolean;
}) {
  const notifications = useNotifications();
  const [src, setSrc] = useState<string | null>(null);

  const onPick = (file: File | null): void => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      notifications.notify("error", "Format non supporté (PNG, JPEG, WebP).", {
        source: "api",
      });
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      notifications.notify("error", "Image trop lourde (max 10 Mo).", {
        source: "api",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result as string);
    reader.onerror = () =>
      notifications.notify("error", "Lecture du fichier impossible.", {
        source: "api",
      });
    reader.readAsDataURL(file);
  };

  return (
    <Group gap="lg" align="center">
      <UserAvatar profile={profile} identifier={identifier} size={84} />
      <Stack gap="xs">
        <Group gap="xs">
          <FileButton onChange={onPick} accept={ACCEPTED} disabled={disabled}>
            {(props) => (
              <Button
                {...props}
                variant="light"
                leftSection={<IconCamera size={16} />}
                disabled={disabled}
              >
                Changer la photo
              </Button>
            )}
          </FileButton>
          {profile.picture && (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              disabled={disabled}
              onClick={() => onChange("")}
            >
              Retirer
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          PNG, JPEG ou WebP. Recadrée en cercle, redimensionnée à {OUTPUT}px.
        </Text>
      </Stack>

      <Modal
        opened={src !== null}
        onClose={() => setSrc(null)}
        title="Recadrer l'avatar"
        centered
        size="auto"
      >
        {src && (
          <AvatarCropper
            src={src}
            onCancel={() => setSrc(null)}
            onDone={(dataUrl) => {
              onChange(dataUrl);
              setSrc(null);
            }}
          />
        )}
      </Modal>
    </Group>
  );
}

export default AvatarUpload;
