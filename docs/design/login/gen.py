#!/usr/bin/env python3
"""Maquettes de la page de connexion (#547) — génère les habillages d'UN même balisage et la galerie.

Lancer : python3 docs/design/login/gen.py (réécrit les v*.html et index.html ; les f*.html,
propositions de fable, sont écrites à la main et lues par fable-manifest.json).

Chaque habillage ne change que des variables CSS et `data-layout` : c'est la
preuve que la page par défaut s'adapte à une application sans toucher au gabarit.
"""
import math
import random
from pathlib import Path
from urllib.parse import quote

OUT = Path(__file__).parent
random.seed(547)

LOGO_PATHS = [
    "M0 85.2C0 42.67 52.68 13.56 86.68 0C90.79 0.43 94.75 1.82 98.27 3.92C79.76 12.71 61.68 21.19 45.84 34.1C30.01 47.01 16.41 64.34 16.41 85.2C16.41 106.07 30.01 123.4 45.84 136.31C61.68 149.22 79.76 157.7 98.27 166.48C94.75 168.59 90.79 169.98 86.68 170.41C52.68 156.85 0 127.74 0 85.2Z",
    "M33.08 85.2C33.08 56 68.05 35.31 91.68 25.55C95.24 26.66 99.29 28.29 102.59 30.16C81.27 39.99 49.32 58.15 49.32 85.2C49.32 112.26 81.27 130.42 102.59 140.24C99.29 142.12 95.24 143.75 91.68 144.86C68.05 135.1 33.08 114.41 33.08 85.2Z",
    "M64.66 85.2C64.66 68.69 82.24 57.57 95.68 51.64C99.59 52.5 103.42 54.65 107.03 56.39C101.42 60.06 95.33 62.98 90.29 67.58C85.25 72.19 81.26 78.48 81.26 85.2C81.26 91.93 85.25 98.22 90.29 102.83C95.33 107.43 101.42 110.35 107.03 114.01C103.42 115.76 99.59 117.91 95.68 118.77C82.24 112.84 64.66 101.72 64.66 85.2Z",
]
LOGO_COLORS = ["#0067ba", "#448438", "#00a0f2"]


def logo(colors=None, cls="nf-logo", extra=""):
    colors = colors or LOGO_COLORS
    paths = "".join(f'<path fill="{c}" d="{d}"/>' for c, d in zip(colors, LOGO_PATHS))
    return f'<svg class="{cls}" viewBox="0 0 107.03 170.41" aria-hidden="true"{extra}>{paths}</svg>'


def data_uri(svg):
    return f'url("data:image/svg+xml,{quote(svg)}")'


# ── Fonds ───────────────────────────────────────────────────────────────────
def grid(color, size=40, minor=8):
    lines = f'<path d="M{size} 0H0V{size}" fill="none" stroke="{color}" stroke-width="1"/>'
    sub = "".join(
        f'<path d="M{x} 0V{size}M0 {x}H{size}" stroke="{color}" stroke-opacity=".35" stroke-width=".5"/>'
        for x in range(minor, size, minor)
    )
    return data_uri(f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}">{sub}{lines}</svg>')


def dots(color, size=22, r=1.1):
    return data_uri(f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}"><circle cx="{size/2}" cy="{size/2}" r="{r}" fill="{color}"/></svg>')


def watermark(color):
    paths = "".join(f'<path fill="{color}" d="{d}"/>' for d in LOGO_PATHS)
    return data_uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -20 160 210">{paths}</svg>')


def topo(color, w=1600, h=1000, opacity=0.5):
    """Courbes de niveau : anneaux bruités autour de quelques sommets."""
    peaks = [(w * 0.78, h * 0.28, 11), (w * 0.2, h * 0.82, 9), (w * 0.55, h * 0.95, 6)]
    out = []
    for cx, cy, rings in peaks:
        phase = [random.uniform(0, math.tau) for _ in range(4)]
        for k in range(1, rings + 1):
            r = k * 46
            pts = []
            for i in range(0, 73):
                a = i / 72 * math.tau
                n = (math.sin(3 * a + phase[0]) * 0.09 + math.sin(5 * a + phase[1]) * 0.05 + math.sin(2 * a + phase[2] + k * 0.3) * 0.07)
                rr = r * (1 + n)
                pts.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a) * 0.8:.1f}")
            out.append(f'<polyline points="{" ".join(pts)}"/>')
    return data_uri(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice">'
        f'<g fill="none" stroke="{color}" stroke-opacity="{opacity}" stroke-width="1.2">{"".join(out)}</g></svg>'
    )


def landscape(sky, layers, sun=None, w=1600, h=1000):
    """Paysage en APLATS : chaînes de montagnes superposées, couleurs pleines."""
    parts = [f'<rect width="{w}" height="{h}" fill="{sky}"/>']
    if sun:
        parts.append(f'<circle cx="{w*0.72}" cy="{h*0.3}" r="70" fill="{sun}"/>')
    for idx, color in enumerate(layers):
        base = h * (0.48 + idx * 0.12)
        amp = 120 - idx * 18
        pts = [f"0,{h}"]
        x = 0
        while x <= w:
            y = base - abs(math.sin(x / (180 + idx * 40) + idx)) * amp - random.uniform(0, amp * 0.25)
            pts.append(f"{x:.0f},{y:.0f}")
            x += random.randint(60, 140)
        pts.append(f"{w},{h}")
        parts.append(f'<polygon fill="{color}" points="{" ".join(pts)}"/>')
    return data_uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice">{"".join(parts)}</svg>')


# ── Jeux de couleurs ──────────────────────────────────────────────────────────
LIGHT = {
    "on-brand": "#ffffff", "accent": "#0067ba", "ok": "#1f8a5b", "warn": "#8a5a00", "crit": "#c4321a",
    # Palette claire de la page d'accueil du cœur (nodefony/views/index.eta).
    "bg": "#fafbfd", "surface": "#ffffff", "raised": "#f1f5fa", "line": "#e3e9f2",
    "line-strong": "#cfd8e6", "heading": "#0e1726", "text": "#2b3a52", "muted": "#5b6b84",
    "field": "#ffffff", "crit-bg": "#fff3f0", "ok-bg": "#edf8f2",
}


def block(vars_):
    return "\n".join(f"  --nf-login-{k}: {v};" for k, v in vars_.items())


def theme_css(dark, light):
    # Vert « Agentic ready » : celui du logo en clair, éclairci en sombre (3,4:1 sinon).
    dark = {"home-green": "#7cc46c", **dark}
    light = {"home-green": "#3f7a35", **light}
    return (
        f":root {{\n{block(dark)}\n  color-scheme: dark;\n}}\n"
        f'@media (prefers-color-scheme: light) {{\n:root:not([data-theme="dark"]) {{\n{block(light)}\n  color-scheme: light;\n}}\n}}\n'
        f':root[data-theme="light"] {{\n{block(light)}\n  color-scheme: light;\n}}\n'
    )


# Contenu d'information par défaut — la matrice du site du cœur. Futur
# `security.loginPage.hero` : { eyebrow, title, lead, chips } ; l'app le remplace.
NODEFONY_HERO = dict(
    eyebrow="Temps réel natif · développement agentic-ready · socle TypeScript isomorphe",
    title="Le framework Node.js fullstack",
    lead="Une action de contrôleur. Deux transports. La même session, la même sécurité, le même code.",
    chips=["Agentic ready", "Node.js ≥ 24", "TypeScript strict", "ESM only", "Licence Apache 2.0"],
)

HOME_FEATURES = [
    ('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', "Temps réel natif",
     "Le WebSocket n'est pas un ajout : même pipeline, même table de routes, même sécurité que le HTTP."),
    ('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>', "Sécurité par conception",
     "Pare-feu applicatif par zones, Zero Trust, CSRF Fetch Metadata, sessions hybrides, WebAuthn."),
    ('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', "DI & modules",
     "Injection de dépendances par décorateurs, modules autonomes, configuration validée au boot."),
    ('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.7-4-9s1.5-6.4 4-9z"/>', "Socle isomorphe",
     "Le même paquet côté serveur et côté navigateur : client temps réel, règles et types écrits une fois."),
]

# ── Les 10 habillages ─────────────────────────────────────────────────────────
VARIANTS = [
    dict(
        slug="v01-console", name="Console", layout="card",
        usage="Défaut proposé. Outils, back-offices, consoles : la signature de la barre de debug.",
        backdrop="aucun", dark={}, light=dict(LIGHT),
    ),
    dict(
        slug="v02-blueprint", name="Plan technique", layout="card",
        usage="Produits techniques, API, plateformes de données : grille de plan, fond bleu nuit.",
        backdrop="grille de plan",
        dark={"bg": "#0b1622", "surface": "#0f1d2c", "raised": "#142638", "line": "#1d3247", "line-strong": "#2a4560",
              "field": "#0b1825", "muted": "#8fa3b8", "backdrop": grid("#1a3550"), "card-shadow": "0 0 0 6px rgba(11,22,34,.9)"},
        light={**LIGHT, "bg": "#eef4fa", "line": "#d5e1ec", "line-strong": "#bfd0e0", "raised": "#eef3f8",
               "backdrop": grid("#cfe0ef"), "card-shadow": "0 0 0 6px rgba(238,244,250,.9)"},
    ),
    dict(
        slug="v03-points", name="Trame de points", layout="card",
        usage="SaaS grand public, applications métier : discret, clair d'abord, ombre légère.",
        backdrop="trame de points",
        dark={"bg": "#111317", "backdrop": dots("#2c3038"), "card-shadow": "0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.35)"},
        light={**LIGHT, "bg": "#f7f7f8", "backdrop": dots("#d4d7dc"), "card-shadow": "0 1px 2px rgba(16,24,40,.06), 0 12px 32px rgba(16,24,40,.08)"},
    ),
    dict(
        slug="v04-marque", name="Marque scindée", layout="split",
        usage="Application d'entreprise qui affirme sa marque : panneau plein à la couleur de l'app, logo en filigrane.",
        backdrop="filigrane du logo (panneau)",
        hero={**NODEFONY_HERO, "plate": False},
        home=True,
        dark={"bg": "#0a0f1c", "surface": "#111828", "raised": "#162034", "line": "#223046", "line-strong": "#2f4060",
              "field": "#0b1220", "heading": "#e8edf6", "text": "#c9d4e5", "muted": "#93a1ba",
              "hero-bg": "#0a0f1c", "hero-image": watermark("rgba(30,160,236,0.05)")},
        light={**LIGHT, "bg": "#fafbfd", "line": "#e3e9f2", "heading": "#0e1726", "muted": "#5b6b84",
               "hero-bg": "#f1f5fa", "hero-image": watermark("rgba(9,107,191,0.05)")},
    ),
    dict(
        slug="v05-illustration", name="Illustration scindée", layout="split",
        usage="Produit grand public ou institutionnel : une image de l'app dans le panneau (ici un paysage en aplats).",
        backdrop="illustration (panneau)",
        hero=dict(title="Bon retour.", lead="Reprenez là où vous vous étiez arrêté.", plate=True),
        dark={"hero-bg": "#0b1a2b",
              "hero-image": landscape("#0b1a2b", ["#123150", "#0f4a7a", "#0067ba", "#00467e"], sun="#ffab00"),
              "hero-plate": "rgba(11,26,43,.82)"},
        light={**LIGHT, "hero-bg": "#cfe6f7",
               "hero-image": landscape("#d9ecfa", ["#a9d1ef", "#6fb0e0", "#2f86c9", "#0067ba"], sun="#ffcf5a"),
               "hero-plate": "rgba(0,52,94,.88)"},
    ),
    dict(
        slug="v06-plein-ecran", name="Image plein écran", layout="card",
        usage="Site vitrine, événement, marque forte : l'image de l'app en fond, la carte reste pleine et lisible.",
        backdrop="illustration plein écran + voile",
        dark={"backdrop": landscape("#0b1a2b", ["#123150", "#0f4a7a", "#0067ba", "#00467e"], sun="#ffab00"),
              "backdrop-size": "cover", "veil": "rgba(8,12,18,.35)", "card-shadow": "0 20px 50px rgba(0,0,0,.45)",
              "surface": "#161a21", "line": "#2a2e36"},
        light={**LIGHT, "backdrop": landscape("#d9ecfa", ["#a9d1ef", "#6fb0e0", "#2f86c9", "#0067ba"], sun="#ffcf5a"),
               "backdrop-size": "cover", "veil": "rgba(255,255,255,.12)", "card-shadow": "0 20px 50px rgba(0,40,80,.25)"},
    ),
    dict(
        slug="v07-epure", name="Épuré", layout="bare",
        usage="Produit qui veut s'effacer : pas de carte, beaucoup d'air, titre plus grand.",
        backdrop="aucun",
        dark={"title-size": "30px", "card-width": "380px"},
        light={**LIGHT, "bg": "#ffffff", "title-size": "30px", "card-width": "380px"},
    ),
    dict(
        slug="v08-entreprise-sso", name="Entreprise — SSO d'abord", layout="card", sso_first=True,
        usage="Intranet derrière Keycloak : le fournisseur de l'entreprise passe AVANT le compte local. Rebrandé (sarcelle) pour montrer l'habillage.",
        backdrop="courbes de niveau",
        app="Acme Intranet",
        dark={"brand": "#0f766e", "brand-hover": "#0b5f58", "accent": "#2dd4bf", "bg": "#0e1514", "surface": "#141d1c",
              "raised": "#1a2625", "line": "#243432", "line-strong": "#334744", "field": "#101918", "muted": "#8fa6a2",
              "backdrop": topo("#2dd4bf", opacity=0.16), "backdrop-size": "cover"},
        light={**LIGHT, "brand": "#0f766e", "brand-hover": "#0b5f58", "accent": "#0f766e", "bg": "#f2f7f6",
               "line": "#dce8e6", "raised": "#edf4f3", "backdrop": topo("#0f766e", opacity=0.12), "backdrop-size": "cover"},
        logo_colors=["#0f766e", "#14b8a6", "#5eead4"],
    ),
    dict(
        slug="v09-terminal", name="Terminal", layout="card",
        usage="Outils de développeur, CLI, infrastructure : tout en chasse fixe, accent vert.",
        backdrop="aucun",
        mono=True,
        dark={"brand": "#238636", "brand-hover": "#1a6b2b", "accent": "#3fb950", "bg": "#0d1117", "surface": "#0d1117",
              "raised": "#161b22", "line": "#30363d", "line-strong": "#3d444d", "field": "#010409", "heading": "#e6edf3",
              "text": "#c9d1d9", "muted": "#8b949e", "radius": "4px", "card-radius": "6px",
              "font": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "label-font": "600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace", "title-size": "18px"},
        light={**LIGHT, "brand": "#1a7f37", "brand-hover": "#116329", "accent": "#1a7f37", "bg": "#fbfaf7", "surface": "#fffefb",
               "raised": "#f3f1ea", "line": "#e2ddd0", "line-strong": "#cfc8b8", "heading": "#1f2328", "muted": "#5f5a4e",
               "radius": "4px", "card-radius": "6px", "font": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
               "label-font": "600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace", "title-size": "18px"},
    ),
    dict(
        slug="v10-accessible", name="Haute lisibilité", layout="card",
        usage="Services publics, santé, bornes, publics âgés : contraste AAA, police 17 px, cibles 52 px, filets épais.",
        backdrop="aucun",
        big=True,
        dark={"brand": "#5cb3ff", "brand-hover": "#8ccaff", "on-brand": "#000000", "accent": "#8ccaff", "bg": "#000000",
              "surface": "#0a0a0a", "raised": "#1a1a1a", "line": "#6b6b6b", "line-strong": "#a3a3a3", "field": "#000000",
              "heading": "#ffffff", "text": "#f2f2f2", "muted": "#cfcfcf", "card-width": "460px", "title-size": "28px",
              "label-font": "700 16px/1.3 Inter, ui-sans-serif, system-ui, sans-serif"},
        light={**LIGHT, "brand": "#003f73", "brand-hover": "#002a4d", "accent": "#003f73", "bg": "#ffffff", "surface": "#ffffff",
               "line": "#6b6b6b", "line-strong": "#3b3b3b", "heading": "#000000", "text": "#1a1a1a", "muted": "#3b3b3b",
               "card-width": "460px", "title-size": "28px", "label-font": "700 16px/1.3 Inter, ui-sans-serif, system-ui, sans-serif"},
    ),
]

PHOTO = 'url("img/fond-ecran-2400.jpg")'
VARIANTS += [
    dict(
        slug="v11-photo-carte", name="Photo — carte console", layout="card",
        usage="L'image de l'application en fond (ici une vraie photo, 570 Ko servis), la carte console reste pleine et lisible au-dessus.",
        backdrop="photo réelle + voile",
        dark={"backdrop": PHOTO, "backdrop-size": "cover", "backdrop-position": "center 40%",
              "veil": "rgba(10,14,20,.55)", "card-shadow": "0 20px 50px rgba(0,0,0,.45)"},
        light={**LIGHT, "backdrop": PHOTO, "backdrop-size": "cover", "backdrop-position": "center 40%",
               "veil": "rgba(245,246,248,.18)", "card-shadow": "0 20px 50px rgba(10,30,50,.28)"},
    ),
    dict(
        slug="v12-photo-scindee", name="Photo — panneau scindé", layout="split",
        usage="Marque qui a une image forte : la photo occupe le panneau, le formulaire garde la finesse console à droite.",
        backdrop="photo réelle (panneau)",
        hero={**NODEFONY_HERO, "plate": True},
        home=True, photo_split=True,
        dark={"hero-bg": "#3c4c5c", "hero-image": PHOTO, "hero-plate": "rgba(13,22,32,.86)",
              "glass": "rgba(14,20,32,.8)", "glass-raised": "rgba(255,255,255,.05)", "glass-line": "rgba(255,255,255,.14)",
              "glass-muted": "#b4bdc9", "glass-green": "#8fd47f", "glass-shadow": "0 12px 40px rgba(0,0,0,.35)", "glass-saturate": "1.2"},
        light={**LIGHT, "hero-bg": "#3c4c5c", "hero-image": PHOTO, "hero-plate": "rgba(13,22,32,.86)",
               "glass": "rgba(255,255,255,.88)", "glass-raised": "rgba(255,255,255,.92)", "glass-line": "rgba(255,255,255,.9)",
               "glass-muted": "#4a5873", "glass-green": "#2f6a27", "glass-shadow": "0 12px 40px rgba(14,23,38,.18)",
               "glass-saturate": "1.8"},
    ),
]
_v12 = next(v for v in VARIANTS if v["slug"] == "v12-photo-scindee")
for slug, name, edge, usage in [
    ("v12b-photo-courbe", "Photo — bord courbe", "curve", "Le bord de la photo est une courbe découpée par clip-path: shape(), repli en biais ailleurs."),
]:
    VARIANTS.append({**_v12, "slug": slug, "name": name, "edge": edge, "usage": usage})

# 12B retenue par l'auteur « avec un overlay sur l'image » : voile plein sur la photo.
_v12b = next(v for v in VARIANTS if v["slug"] == "v12b-photo-courbe")
_v12b["name"] = "Photo — bord courbe + voile"
_v12b["usage"] = "Bord courbe (clip-path: shape()) et voile de couleur pleine sur la photo : l'image s'accorde à la carte et à la page."
_v12b["dark"] = {**_v12b["dark"], "hero-overlay": "rgba(8,14,26,.5)"}
_v12b["light"] = {**_v12b["light"], "hero-overlay": "rgba(9,60,120,.28)"}

# Écartées par l'auteur : 5 (illustration scindée), 6 (illustration plein écran), 9 (terminal), 10 (haute lisibilité).
REJECTED = {"v04-marque", "v05-illustration", "v06-plein-ecran", "v09-terminal", "v10-accessible", "v12-photo-scindee", "v12b-photo-courbe"}

ICONS = """<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-finger" viewBox="0 0 24 24"><path d="M12 11v2.5c0 2.8.9 4.8 2 6.5M8.5 13c0 2.8.5 4.8 1.6 7M6 9.5a6.5 6.5 0 0 1 12.3 1.4c.4 2 .4 4.8 0 7.6M9.2 9.2A3.5 3.5 0 0 1 15.5 11v2.2"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="3.8"/><path d="M10.8 12.2 19.5 3.5M16.5 6.5l2.5 2.5M14 9l2 2"/></symbol>
<symbol id="i-building" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/></symbol>
<symbol id="m-github" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></symbol>
</svg>"""


def page(v):
    app = v.get("app", "Mon application")
    lg = logo(v.get("logo_colors"))
    hero = v.get("hero")
    hero_html = ""
    if hero and v.get("home"):
        badges = "".join(
            f'<li class="agentic">{c}</li>' if i == 0 else f"<li>{c}</li>" for i, c in enumerate(hero["chips"])
        )
        feats = "".join(
            f'<div class="feature"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ic}</svg></span><h3>{t}</h3><p>{d}</p></div>'
            for ic, t, d in HOME_FEATURES
        )
        hero_html = f"""<aside class="nf-hero" aria-label="Nodefony">
        <div class="nf-home">
          {logo(cls="nf-home-logo")}
          <h2>{hero["title"]}</h2>
          <p class="sub">{hero["eyebrow"]}</p>
          <p class="sig">{hero["lead"]}</p>
          <ul class="badges">{badges}</ul>
          <div class="install" role="img" aria-label="Commande d'installation : npx nodefony create app"><span class="p">$</span><span>npx nodefony create app</span></div>
          <div class="features">{feats}</div>
        </div>
      </aside>"""
    elif hero:
        plate_open = '<div class="nf-hero-panel">' if hero["plate"] else "<div>"
        hero_html = f"""<aside class="nf-hero" aria-hidden="true">
        <div class="nf-hero-brand">{logo(["#ffffff", "#ffffff", "#ffffff"])}{app}</div>
        {plate_open}{f'<span class="nf-hero-eyebrow">{hero["eyebrow"]}</span>' if hero.get("eyebrow") else ""}<h2>{hero["title"]}</h2><p>{hero["lead"]}</p>{('<ul class="nf-hero-chips">' + "".join(f"<li>{c}</li>" for c in hero["chips"]) + "</ul>") if hero.get("chips") else ""}</div>
        <small>Propulsé par Nodefony</small>
      </aside>"""
    sso = v.get("sso_first")
    alt_html = (
        f"""<div data-alt>
            <div class="nf-alt">
              <a class="nf-btn primary span" href="#"><svg class="nf-icon" aria-hidden="true"><use href="#i-building"/></svg>Continuer avec {app.split()[0]} SSO</a>
            </div>
            <div class="nf-or">ou avec un compte local</div>
          </div>"""
        if sso
        else """<div data-alt>
            <div class="nf-or">ou</div>
            <div class="nf-alt">
              <button type="button" class="nf-btn span"><svg class="nf-icon" aria-hidden="true"><use href="#i-finger"/></svg>Se connecter avec une passkey</button>
              <a class="nf-btn" href="#"><svg class="nf-icon" aria-hidden="true"><use href="#i-key"/></svg>Keycloak</a>
              <a class="nf-btn" href="#"><svg class="nf-mark" aria-hidden="true"><use href="#m-github"/></svg>GitHub</a>
            </div>
          </div>"""
    )
    primary_cls = "nf-btn" if sso else "nf-btn primary"
    extra = ""
    if v.get("big"):
        extra += ".nf-input, .nf-btn { min-height: 52px; border-width: 2px; } body { font-size: 17px; } .nf-hint, .nf-link, .nf-btn { font-size: 16px; } .nf-otp input { height: 60px; border-width: 2px; } .nf-steps li, .nf-chip, .nf-facts, .nf-or { font-size: 12px; } .nf-sub { font-size: 17px; }\n"
    if v.get("mono"):
        extra += "h1::before { content: '$ '; color: var(--nf-login-accent); } label::before { content: '› '; color: var(--nf-login-accent); } .nf-avatar { border-radius: 4px; }\n"
    if sso:
        extra += "body[data-sso-first] form .nf-btn { width: 100%; }\n"
    if v.get("home"):
        extra += "body[data-layout=split] .nf-hero { justify-content: center; padding: 40px 48px; color: var(--nf-login-heading); }\n"
    if v.get("home") and v.get("photo_split"):
        # Verre dépoli : voile semi-opaque + flou, filet clair d'1 px. Opacité ≥ 0,72 : le
        # contraste ne dépend jamais de l'endroit de la photo qui passe dessous.
        extra += (".nf-home { padding: 32px 30px; border: 1px solid var(--nf-login-glass-line); border-radius: 18px; "
                  "background: var(--nf-login-glass); box-shadow: var(--nf-login-glass-shadow); "
                  "backdrop-filter: blur(22px) saturate(var(--nf-login-glass-saturate)); -webkit-backdrop-filter: blur(22px) saturate(var(--nf-login-glass-saturate)); } "
                  ".nf-home .feature, .nf-home .badges li { background: var(--nf-login-glass-raised); border-color: var(--nf-login-glass-line); } "
                  ":root[data-theme=light] .nf-home .feature { border-color: var(--nf-login-line); } "
                  ".nf-home .sig, .nf-home .feature p, .nf-home .badges li { color: var(--nf-login-glass-muted); } "
                  ".nf-home .badges li.agentic { color: var(--nf-login-glass-green); }\n")
    if v.get("hero") and not v.get("home"):
        # Matrice d'information (accroche, titre, phrase, pastilles) — commune à tout panneau.
        extra += ".nf-hero small { display: none; } .nf-hero h2 { font-size: 38px; } .nf-hero-eyebrow { display: block; margin-bottom: 14px; font: 700 11px/1.4 var(--nf-login-mono); letter-spacing: .6px; text-transform: uppercase; color: var(--nf-login-hero-muted); } .nf-hero-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 20px 0 0; padding: 0; list-style: none; } .nf-hero-chips li { padding: 5px 9px; border: 1px solid rgba(255,255,255,.32); border-radius: 12px; font: 700 10px/1 var(--nf-login-mono); letter-spacing: .5px; text-transform: uppercase; color: #fff; }\n"
    if v.get("photo_split") and not v.get("home"):
        # Sur une photo, aucun texte ne se pose à nu : tout passe sur une pastille pleine.
        extra += ".nf-hero-brand { align-self: flex-start; padding: 8px 14px; border-radius: 10px; background: var(--nf-login-hero-plate); } .nf-hero-panel { max-width: 560px; padding: 26px 28px; }\n"
    attrs = f'data-layout="{v["layout"]}"'
    if v["backdrop"] not in ("aucun",) and v["layout"] != "split":
        attrs += " data-backdrop"
    if sso:
        attrs += " data-sso-first"
    if v.get("edge"):
        attrs += f' data-edge="{v["edge"]}"'
    return f"""<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Se connecter — {app}</title>
    <link rel="stylesheet" href="base.css" />
    <style>
/* Habillage « {v["name"]} » — variables seulement (+ mise en page). */
{theme_css(v["dark"], v["light"])}{extra}    </style>
  </head>
  <body {attrs}>
    {ICONS}
    <header class="nf-strip">
      <div class="nf-strip-brand">{lg}{app}</div>
      <span class="nf-sep hide-sm" aria-hidden="true"></span>
      <span class="nf-chip env hide-sm">développement</span>
      <span class="nf-spacer"></span>
      <span class="nf-chip"><span class="nf-dot" aria-hidden="true"></span>serveur joignable</span>
    </header>
    <div class="nf-layout">
      {hero_html}
      <main class="nf-stage">
        <section class="nf-card" aria-labelledby="nf-title">
          <div class="nf-head">
            <div class="nf-brand">{lg}{app}</div>
            <h1 id="nf-title">Se connecter</h1>
            <p class="nf-sub" id="nf-sub">à {app}</p>
          </div>
          <ol class="nf-steps" aria-label="Étapes">
            <li data-tab="identifier" aria-current="step">Identifiant</li>
            <li data-tab="password">Mot de passe</li>
            <li data-tab="mfa" hidden>Vérification</li>
          </ol>
          <div class="nf-body">
          {alt_html if sso else ""}
          <form data-step="identifier">
            <div class="nf-field">
              <label for="nf-username">Identifiant ou adresse e-mail</label>
              <div class="nf-input"><svg class="nf-icon" aria-hidden="true"><use href="#i-user"/></svg>
                <input id="nf-username" name="username" autocomplete="username webauthn" autocapitalize="none" spellcheck="false" required /></div>
            </div>
            <button class="{primary_cls}" type="submit">Continuer <svg class="nf-icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>
          </form>
          <form data-step="password" hidden>
            <div class="nf-account"><span class="nf-avatar" aria-hidden="true">A</span><span class="who">admin</span>
              <button type="button" class="nf-link" data-go="identifier">Changer</button></div>
            <div class="nf-field">
              <div class="nf-label-row"><label for="nf-password">Mot de passe</label><a class="nf-link" href="#">Mot de passe oublié ?</a></div>
              <div class="nf-input"><svg class="nf-icon" aria-hidden="true"><use href="#i-lock"/></svg>
                <input id="nf-password" name="password" type="password" autocomplete="current-password" required />
                <button type="button" class="nf-reveal" data-reveal aria-label="Afficher le mot de passe" aria-pressed="false"><svg class="nf-icon"><use href="#i-eye"/></svg></button></div>
            </div>
            <button class="{primary_cls}" type="submit">Se connecter <svg class="nf-icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>
          </form>
          <form data-step="mfa" hidden>
            <div class="nf-field">
              <label id="nf-otp-label">Code à 6 chiffres</label>
              <div class="nf-otp" role="group" aria-labelledby="nf-otp-label">
                <input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chiffre 1" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 2" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 3" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 4" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 5" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 6" />
              </div>
            </div>
            <p class="nf-hint">Le code affiché par votre application d'authentification.</p>
            <button class="nf-btn primary" type="submit">Vérifier</button>
            <button type="button" class="nf-link nf-center">Utiliser un code de récupération</button>
          </form>
          <div data-step="authenticated" hidden>
            <div class="nf-done" role="status"><span class="ring" aria-hidden="true"><svg class="nf-icon"><use href="#i-check"/></svg></span>
              <strong>Session ouverte</strong><span class="dest">→ /admin/users</span><span class="nf-progress" aria-hidden="true"><span></span></span></div>
          </div>
          {"" if sso else alt_html}
          <div class="nf-message" aria-live="polite" data-message></div>
          <noscript><p class="nf-hint">Cette page a besoin de JavaScript pour vous connecter.</p></noscript>
          </div>
        </section>
        <div class="nf-foot">
          <ul class="nf-facts" aria-label="Protection de la session">
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>cookie HttpOnly</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>anti-CSRF</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>CSP stricte</li>
          </ul>
          <a class="nf-powered" href="https://github.com/nodefony/nodefony-core" rel="noopener noreferrer">{logo(["currentColor"] * 3)}Propulsé par Nodefony</a>
        </div>
      </main>
    </div>
    <div class="mock" role="toolbar" aria-label="Maquette">
      <a href="index.html">← galerie</a>
      <button data-go="identifier">identifiant</button><button data-go="password">mot de passe</button>
      <button data-go="mfa">code</button><button data-go="authenticated">connecté</button>
      <button data-err="401">401</button><button data-err="429">429</button>
      <button data-alt-toggle>fournisseurs</button><button data-theme-toggle>thème</button>
    </div>
    <script src="mock.js"></script>
  </body>
</html>
"""


def gallery():
    cards = []
    import json
    shown = [v for v in VARIANTS if v["slug"] not in REJECTED]
    manifest = OUT / "fable-manifest.json"
    if manifest.exists():
        shown += [{**f, "by": "fable"} for f in json.loads(manifest.read_text(encoding="utf-8"))]
    for v in shown:
        num = v["slug"].split("-")[0].upper().replace("V", "")
        by = '<span class="g-by">fable</span>' if v.get("by") == "fable" else ""
        cards.append(f"""      <article class="g-card">
        <a class="g-shot" href="{v["slug"]}.html" aria-label="Ouvrir « {v["name"]} »">
          <span class="g-badge">{num}</span>{by}
          <iframe data-src="{v["slug"]}.html" tabindex="-1" loading="lazy" title="Aperçu {v["name"]}"></iframe>
        </a>
        <div class="g-meta">
          <div class="g-title"><span class="g-num">{num}</span><a href="{v["slug"]}.html">{v["name"]}</a></div>
          <p>{v["usage"]}</p>
          <div class="g-tags"><span>{ {"card": "carte", "split": "scindée", "bare": "nue"}.get(v["layout"], v["layout"]) }</span><span>fond : {v["backdrop"]}</span></div>
        </div>
      </article>""")
    return f"""<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Page de connexion — propositions</title>
    <style>
      :root {{ --bg:#14161a; --card:#1c1f26; --raised:#22262e; --line:#2a2e36; --h:#f1f3f5; --t:#cfd3d8; --m:#8a9099; --a:#3aa0ff; color-scheme: dark; }}
      @media (prefers-color-scheme: light) {{ :root {{ --bg:#f5f6f8; --card:#fff; --raised:#f0f2f5; --line:#e3e6ea; --h:#111317; --t:#343a40; --m:#5d646d; --a:#0067ba; color-scheme: light; }} }}
      * {{ box-sizing: border-box; }}
      body {{ margin:0; background:var(--bg); color:var(--t); font:14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }}
      header {{ position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; padding:14px 24px; border-bottom:1px solid var(--line); background:var(--card); }}
      h1 {{ margin:0; font-size:17px; color:var(--h); }}
      h1 small {{ margin-left:8px; font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; color:var(--m); }}
      .ctl {{ display:flex; align-items:center; gap:6px; }}
      .ctl > span {{ font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; color:var(--m); }}
      .ctl button {{ min-height:30px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:var(--raised); color:var(--t); font:600 12px/1 inherit; cursor:pointer; }}
      .ctl button[aria-pressed="true"] {{ border-color:var(--a); color:var(--h); box-shadow: inset 0 -2px 0 var(--a); }}
      .spacer {{ flex:1; }}
      .audit {{ color:var(--a); font-weight:600; text-decoration:none; }} .audit:hover {{ text-decoration:underline; }}
      .audit-pick {{ padding:3px 9px; border:1px solid var(--a); border-radius:10px; font:700 10px/1.4 ui-monospace, monospace; letter-spacing:.5px; text-transform:uppercase; color:var(--h); }}
      main {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(380px, 1fr)); gap:20px; padding:24px; }}
      .g-card {{ overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--card); }}
      .g-shot {{ position:relative; display:block; aspect-ratio:16/10; overflow:hidden; border-bottom:1px solid var(--line); background:var(--raised); }}
      .g-shot iframe {{ position:absolute; top:0; left:0; width:1280px; height:800px; border:0; transform-origin:0 0; pointer-events:none; }}
      .g-shot:hover {{ outline:2px solid var(--a); outline-offset:-2px; }}
      .g-badge {{ position:absolute; top:10px; left:10px; z-index:1; display:grid; place-items:center; min-width:34px; height:34px; padding:0 8px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--h); font:800 15px/1 ui-monospace, monospace; }}
      .g-by {{ position:absolute; top:10px; right:10px; z-index:1; padding:5px 8px; border:1px solid var(--a); border-radius:6px; background:var(--card); color:var(--h); font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; }}
      body.mobile .g-shot {{ aspect-ratio: 16/10; background: var(--raised); }}
      body.mobile .g-shot iframe {{ left:50%; width:390px; height:844px; }}
      .g-meta {{ padding:14px 16px 16px; }}
      .g-title {{ display:flex; align-items:center; gap:10px; }}
      .g-title a {{ color:var(--h); font-weight:650; font-size:15px; text-decoration:none; }}
      .g-title a:hover {{ text-decoration:underline; }}
      .g-num {{ font:700 11px/1 ui-monospace, monospace; color:var(--a); }}
      .g-meta p {{ margin:6px 0 10px; color:var(--m); font-size:13px; }}
      .g-tags {{ display:flex; flex-wrap:wrap; gap:6px; }}
      .g-tags span {{ padding:3px 8px; border:1px solid var(--line); border-radius:10px; background:var(--raised); font:700 10px/1.2 ui-monospace, monospace; letter-spacing:.4px; text-transform:uppercase; color:var(--m); }}
    </style>
  </head>
  <body>
    <header>
      <h1>Page de connexion<small>#547 · propositions · un seul balisage</small></h1>
      <a class="audit" href="audit.html">Audit et décisions (ADR-0015)</a>
      <span class="audit-pick">beta 3 : F03</span>
      <span class="spacer"></span>
      <div class="ctl" data-group="step"><span>étape</span>
        <button data-v="identifier" aria-pressed="true">identifiant</button><button data-v="password">mot de passe</button>
        <button data-v="mfa">code</button><button data-v="error">erreur</button><button data-v="authenticated">connecté</button></div>
      <div class="ctl" data-group="theme"><span>thème</span>
        <button data-v="" aria-pressed="true">système</button><button data-v="light">clair</button><button data-v="dark">sombre</button></div>
      <div class="ctl" data-group="format"><span>format</span>
        <button data-v="desktop" aria-pressed="true">bureau</button><button data-v="mobile">mobile</button></div>
    </header>
    <main>
{chr(10).join(cards)}
    </main>
    <script>
      const state = {{ step: "identifier", theme: "", format: "desktop" }};
      const frames = [...document.querySelectorAll("iframe[data-src]")];
      function fit() {{
        for (const f of frames) {{
          const box = f.parentElement.getBoundingClientRect();
          if (state.format === "mobile") {{
            const s = box.height / 844;
            f.style.transform = `translateX(-50%) scale(${{s}})`;
            f.style.transformOrigin = "50% 0";
          }} else {{
            f.style.transform = `scale(${{box.width / 1280}})`;
            f.style.transformOrigin = "0 0";
          }}
        }}
      }}
      function load() {{
        const q = new URLSearchParams({{ embed: "1", step: state.step }});
        if (state.theme) q.set("theme", state.theme);
        for (const f of frames) {{
          f.src = `${{f.dataset.src}}?${{q}}`;
          const a = f.closest("article").querySelectorAll("a[href]");
          const open = new URLSearchParams({{ step: state.step }});
          if (state.theme) open.set("theme", state.theme);
          a.forEach((el) => (el.href = `${{f.dataset.src}}?${{open}}`));
        }}
        document.body.classList.toggle("mobile", state.format === "mobile");
        fit();
      }}
      document.querySelectorAll(".ctl").forEach((g) =>
        g.addEventListener("click", (e) => {{
          const b = e.target.closest("button");
          if (!b) return;
          state[g.dataset.group] = b.dataset.v;
          g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          load();
        }}),
      );
      addEventListener("resize", fit);
      load();
    </script>
  </body>
</html>
"""


for v in VARIANTS:
    if v["slug"] in REJECTED:
        continue  # écartées par l'auteur : ni générées ni montrées
    (OUT / f'{v["slug"]}.html').write_text(page(v), encoding="utf-8")
(OUT / "index.html").write_text(gallery(), encoding="utf-8")
print("ok", len(VARIANTS), "habillages")
