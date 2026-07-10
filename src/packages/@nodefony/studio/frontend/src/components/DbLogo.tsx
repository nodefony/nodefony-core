// SVG importés en RAW (contenu, pas URL) puis encodés en data URI (cf `svgUri`) :
// un asset > la limite d'inline Vite (4 Ko) serait sinon servi en URL `/@fs/…`, qui
// 404 quand la page Studio passe par le proxy dev (port 5152 ≠ Vite). Data URI =
// inline, aucune requête réseau → robuste quelle que soit la taille du logo.
import sqliteRaw from "../assets/db-logos/sqlite.svg?raw";
import postgresqlRaw from "../assets/db-logos/postgresql.svg?raw";
import mysqlRaw from "../assets/db-logos/mysql.svg?raw";
import mariadbRaw from "../assets/db-logos/mariadb.svg?raw";
import mongodbRaw from "../assets/db-logos/mongodb.svg?raw";
import redisRaw from "../assets/db-logos/redis.svg?raw";
import drizzleRaw from "../assets/db-logos/drizzle.svg?raw";

/** Encode un SVG brut en data URI inline (jamais de requête réseau). */
const svgUri = (raw: string): string =>
  `data:image/svg+xml,${encodeURIComponent(raw)}`;

const sqlite = svgUri(sqliteRaw);
const postgresql = svgUri(postgresqlRaw);
const mysql = svgUri(mysqlRaw);
const mariadb = svgUri(mariadbRaw);
const mongodb = svgUri(mongodbRaw);
const redis = svgUri(redisRaw);
const drizzle = svgUri(drizzleRaw);

/**
 * Table de logos par nom de **driver/base** (sqlite, postgres…) OU de **vendor
 * ORM** (drizzle…). Logos officiels (devicon colorés ; drizzle =
 * simple-icons recoloré). Mongoose réutilise le logo MongoDB (sa base).
 */
const LOGOS: Record<string, string> = {
  // Bases / drivers
  sqlite,
  "better-sqlite3": sqlite,
  postgres: postgresql,
  postgresql,
  pg: postgresql,
  mysql,
  mysql2: mysql,
  mariadb,
  mongodb,
  mongoose: mongodb,
  redis,
  // ORM (vendor)
  drizzle,
};

/** `true` si un logo existe pour ce nom (driver ou vendor). */
export function hasDbLogo(name?: string): boolean {
  return !!name && name.toLowerCase() in LOGOS;
}

/**
 * Logo d'une base de données ou d'un ORM, rendu en `<img>` (SVG officiel). Rend
 * `null` si aucun logo connu → l'appelant fournit un fallback (icône générique).
 */
export function DbLogo({
  name,
  size = 20,
  title,
}: {
  /** Nom du driver/base ou du vendor ORM (insensible à la casse). */
  name?: string;
  size?: number;
  /** Texte alternatif (a11y). */
  title?: string;
}) {
  const src = LOGOS[(name ?? "").toLowerCase()];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={title ?? name ?? ""}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
