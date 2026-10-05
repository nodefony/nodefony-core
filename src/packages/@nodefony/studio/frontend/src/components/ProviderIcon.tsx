/**
 * Icône d'un fournisseur d'identité (Google, GitHub, Keycloak…) — SEULE table
 * des marques connues de la console : l'écran de connexion, les comptes liés
 * d'un utilisateur, la page Rôles la partagent.
 *
 * La table ne DÉCIDE rien, elle embellit : un fournisseur inconnu reçoit une
 * icône neutre et reste affiché — c'est le serveur, seul lecteur de la
 * configuration, qui dit ce qui existe.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconShieldLock,
} from "@tabler/icons-react";

interface IIconProps {
  size?: number | string;
  style?: CSSProperties;
}

/**
 * Marque Keycloak — tracé de simple-icons (CC0), rempli en `currentColor` :
 * elle prend la couleur du texte qui l'entoure, donc reste lisible en thème
 * clair comme sombre et dans un badge coloré (le gris officiel disparaît sur
 * fond sombre).
 */
export function KeycloakIcon({ size = 24, style }: IIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d="m18.742 1.182-12.493.002C4.155 4.784 2.079 8.393 0 12.002c2.071 3.612 4.162 7.214 6.252 10.816l12.49-.004 3.089-5.404h2.158v-.002H24L23.996 6.59h-2.168zM8.327 4.792h2.081l1.04 1.8-3.12 5.413 3.117 5.403-1.035 1.81H8.327a2047.566 2047.566 0 0 0-4.168-7.204C5.547 9.606 6.937 7.2 8.327 4.792Zm6.241 0 2.086.003c1.393 2.405 2.78 4.813 4.166 7.222l-4.167 7.2h-2.08c-.382-.562-1.038-1.808-1.038-1.808l3.123-5.405-3.124-5.413z" />
    </svg>
  );
}

/** Composant d'icône : une marque dessinée ou une icône Tabler. */
export type ProviderIconComponent = (props: IIconProps) => ReactNode;

/** Marques reconnues — un fragment du nom de fournisseur, en minuscules. */
type Brand = "keycloak" | "github" | "google";
const BRANDS: readonly Brand[] = ["keycloak", "github", "google"];

/** La marque d'un fournisseur d'après son nom de configuration, ou `null`. */
function brandOf(name: string): Brand | null {
  const lower = name.toLowerCase();
  return BRANDS.find((b) => lower.includes(b)) ?? null;
}

/**
 * Le COMPOSANT d'icône d'un fournisseur, par son nom de configuration
 * (`keycloak`, `keycloak-rh`…) : sa marque si on la reconnaît, sinon un
 * bouclier neutre. Pour qui doit garder le composant (une puce rendue plus
 * loin) ; sinon {@link ProviderIcon}.
 */
export function providerIconComponent(name: string): ProviderIconComponent {
  switch (brandOf(name)) {
    case "keycloak":
      return KeycloakIcon;
    case "github":
      return IconBrandGithub;
    case "google":
      return IconBrandGoogle;
    case null:
      return IconShieldLock;
  }
}

/** Icône d'un fournisseur par son nom — voir {@link providerIconComponent}. */
export function ProviderIcon({
  name,
  size = 18,
  style,
}: IIconProps & { name: string }) {
  const props = { size, ...(style ? { style } : {}) };
  switch (brandOf(name)) {
    case "keycloak":
      return <KeycloakIcon {...props} />;
    case "github":
      return <IconBrandGithub {...props} />;
    case "google":
      return <IconBrandGoogle {...props} />;
    case null:
      return <IconShieldLock {...props} />;
  }
}
