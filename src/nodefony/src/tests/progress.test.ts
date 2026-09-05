/**
 * Les indicateurs d'attente et de progression — ce qu'ils écrivent, et surtout
 * ce qu'ils N'écrivent pas.
 *
 * Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher :
 *
 *  1. **Hors terminal, aucune animation.** Une forge d'intégration capture un
 *     tube, pas un terminal : `\r` n'y ramène nulle part et chaque image
 *     deviendrait une ligne. Un banc de dix minutes rendrait des milliers de
 *     lignes de décor, et le journal serait illisible là où on en a le plus
 *     besoin.
 *  2. **Le minuteur meurt à l'arrêt, et il est `unref`.** Une animation oubliée
 *     retient un processus qui devrait sortir — le genre de défaut qui ne se
 *     voit qu'en forge, sous la forme d'un travail qui n'en finit pas.
 *  3. **La ligne précédente est effacée avant la suivante.** Sans cela, un
 *     verdict court laisse derrière lui la queue d'un libellé plus long, et
 *     l'utilisateur lit une phrase qui n'a jamais été écrite.
 *  4. **Les bornes de la barre tiennent.** Un `done` négatif, au-delà du total,
 *     ou un total nul ne doivent jamais produire une barre déformée — ni une
 *     division par zéro.
 *
 * Le flux est un DOUBLE : on inspecte ce qui a été écrit, plutôt que de
 * regarder un vrai terminal — c'est ce qui rend ces contrôles exécutables dans
 * une forge, où il n'y a précisément pas de terminal.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ARC_FRAMES,
  BAR_STYLES,
  BRAILLE_FRAMES,
  LINE_FRAMES,
  ProgressBar,
  Spinner,
  formatDuration,
  renderBar,
} from "../cli/progress";

/** Sortie de test : retient tout, et se fait passer ou non pour un terminal. */
function fakeStream(isTTY: boolean) {
  const chunks: string[] = [];
  return {
    isTTY,
    columns: 80,
    write(text: string) {
      chunks.push(text);
      return true;
    },
    get text() {
      return chunks.join("");
    },
    get chunks() {
      return chunks;
    },
  } as unknown as NodeJS.WriteStream & { text: string; chunks: string[] };
}

/**
 * Compte les minuteurs créés pendant l'appel, et les nettoie.
 *
 * On compte les minuteurs CRÉÉS plutôt que les octets écrits : le nombre
 * d'écritures dépend des détails de `readline` (un effacement, un
 * repositionnement, puis le texte), ce qui ferait un test juste pour une raison
 * qu'on ne contrôle pas.
 */
function countTimers(run: () => void): number {
  const created: NodeJS.Timeout[] = [];
  const original = globalThis.setInterval;
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    const timer = original(fn, ms);
    created.push(timer);
    return timer;
  }) as typeof globalThis.setInterval;
  try {
    run();
  } finally {
    globalThis.setInterval = original;
    for (const timer of created) clearInterval(timer);
  }
  return created.length;
}

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
describe("renderBar — une fonction pure, donc éprouvable au caractère près", () => {
  it("dessine la proportion demandée, à la largeur demandée", () => {
    expect(renderBar(3, 10, { width: 10 })).toBe("▰▰▰▱▱▱▱▱▱▱");
    expect(renderBar(5, 10, { width: 4 })).toBe("▰▰▱▱");
    expect(renderBar(10, 10, { width: 5 })).toBe("▰▰▰▰▰");
    expect(renderBar(0, 10, { width: 5 })).toBe("▱▱▱▱▱");
  });

  it("respecte le style demandé", () => {
    expect(renderBar(1, 2, { width: 4, style: BAR_STYLES.ascii })).toBe("==--");
    expect(renderBar(1, 2, { width: 2, style: BAR_STYLES.solid })).toBe("█░");
    expect(renderBar(1, 4, { width: 4, style: BAR_STYLES.dots })).toBe("●○○○");
  });

  it("PIÈGE : total nul — une barre vide, jamais une division par zéro", () => {
    const bar = renderBar(5, 0, { width: 6 });
    expect(bar).toBe("▱▱▱▱▱▱");
    expect(bar.length).toBe(6);
  });

  it("PIÈGE : hors bornes — la largeur ne bouge JAMAIS", () => {
    for (const [done, total] of [
      [-5, 10],
      [50, 10],
      [Number.NaN, 10],
      [3, -10],
    ] as const) {
      const bar = renderBar(done, total, { width: 8 });
      expect(bar.length, `done=${done} total=${total}`).toBe(8);
    }
  });

  it("une largeur nulle rend la chaîne vide", () => {
    expect(renderBar(1, 2, { width: 0 })).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("formatDuration — lisible par un humain", () => {
  it("choisit l'unité selon l'ordre de grandeur", () => {
    expect(formatDuration(840)).toBe("840ms");
    expect(formatDuration(12_340)).toBe("12.3s");
    expect(formatDuration(245_000)).toBe("4m 05s");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Spinner — sur un terminal", () => {
  it("dessine dès le démarrage, sans attendre la première image", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream });
    spinner.start("Compilation");
    expect(stream.text).toContain("Compilation");
    expect(stream.text).toContain(BRAILLE_FRAMES[0]);
    spinner.stop();
  });

  it("fait tourner les images au fil du temps", () => {
    vi.useFakeTimers();
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream, intervalMs: 80 });
    spinner.start("Attente");
    vi.advanceTimersByTime(160);
    expect(stream.text).toContain(BRAILLE_FRAMES[1]);
    expect(stream.text).toContain(BRAILLE_FRAMES[2]);
    spinner.stop();
  });

  it("accepte un autre jeu d'images", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream, frames: LINE_FRAMES });
    spinner.start("Attente");
    expect(stream.text).toContain(LINE_FRAMES[0]);
    spinner.stop();
    const arcs = fakeStream(true);
    new Spinner({ stream: arcs, frames: ARC_FRAMES }).start("x");
    expect(arcs.text).toContain(ARC_FRAMES[0]);
  });

  it("efface la ligne AVANT d'écrire la suivante — pas de queue résiduelle", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream });
    spinner.start("Un libellé particulièrement long");
    spinner.setLabel("Court");
    // `readline.clearLine` écrit une séquence d'effacement : sa présence prouve
    // que le nettoyage a EU LIEU, et pas seulement qu'on a réécrit par-dessus.
    expect(stream.text).toMatch(/\[/);
    spinner.stop("✓ Fini");
    expect(stream.text.endsWith("✓ Fini\n")).toBe(true);
  });

  it("accepte un rendu fourni par l'appelant", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({
      stream,
      render: (frame, label) => `[dev] ${frame} ${label} !!`,
    });
    spinner.start("Build");
    expect(stream.text).toContain("[dev] ");
    expect(stream.text).toContain("Build !!");
    spinner.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("HORS terminal (forge, tube, redirection)", () => {
  it("Spinner : n'anime RIEN, pas un octet tant qu'on ne fige pas de ligne", () => {
    vi.useFakeTimers();
    const stream = fakeStream(false);
    const spinner = new Spinner({ stream });
    spinner.start("Compilation");
    vi.advanceTimersByTime(5_000);
    expect(stream.text).toBe("");
    expect(spinner.animating).toBe(false);
    // …mais l'objet se considère bien en attente : le cycle de vie est le même.
    expect(spinner.running).toBe(true);
    spinner.stop();
  });

  it("ProgressBar : n'anime RIEN non plus, même en avançant", () => {
    const stream = fakeStream(false);
    const bar = new ProgressBar({ stream, spin: true });
    bar.start(10, "Compilation");
    for (let i = 0; i < 10; i++) bar.increment();
    expect(stream.text).toBe("");
    expect(bar.done).toBe(10);
    bar.stop();
  });

  it("la ligne finale, elle, est écrite — c'est la seule trace du passage", () => {
    const stream = fakeStream(false);
    const spinner = new Spinner({ stream });
    spinner.start("Compilation");
    spinner.stop("✓ Compilation (12.3s)");
    expect(stream.text).toBe("✓ Compilation (12.3s)\n");
  });

  it("aucune séquence d'échappement — un journal doit rester lisible", () => {
    const stream = fakeStream(false);
    const spinner = new Spinner({ stream });
    spinner.start("Étape");
    spinner.setLabel("Autre");
    spinner.refresh();
    spinner.stop("fini");
    expect(stream.text).not.toMatch(/\[/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Cycle de vie — le minuteur ne survit pas, et ne retient rien", () => {
  it("plus rien n'est écrit après stop()", () => {
    vi.useFakeTimers();
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream });
    spinner.start("Attente");
    spinner.stop();
    const written = stream.text.length;
    vi.advanceTimersByTime(10_000);
    expect(stream.text.length).toBe(written);
    expect(spinner.running).toBe(false);
    expect(spinner.animating).toBe(false);
  });

  it("le minuteur est `unref` — il ne retient jamais le processus", () => {
    const stream = fakeStream(true);
    const unref = vi.fn();
    const original = globalThis.setInterval;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      const timer = original(fn, ms);
      clearInterval(timer);
      return { unref } as unknown as NodeJS.Timeout;
    }) as typeof globalThis.setInterval;
    try {
      new Spinner({ stream }).start("Attente");
    } finally {
      globalThis.setInterval = original;
    }
    // Un test qui « attend la sortie » ne distinguerait pas ce cas d'une simple
    // lenteur : seul l'appel constaté le prouve.
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("un second start() ne crée PAS un deuxième minuteur", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream });
    const timers = countTimers(() => {
      spinner.start("Une");
      spinner.start("Deux");
    });
    expect(timers).toBe(1);
    expect(stream.text).toContain("Deux");
    spinner.stop();
  });

  it("une ProgressBar SANS `spin` ne crée aucun minuteur", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream });
    const timers = countTimers(() => bar.start(5, "Lot"));
    expect(timers).toBe(0);
    bar.stop();
  });

  it("réutilisable : stop() puis start() repart proprement", () => {
    const stream = fakeStream(true);
    const spinner = new Spinner({ stream });
    spinner.start("Première");
    spinner.stop("✓ Première");
    spinner.start("Seconde");
    expect(spinner.running).toBe(true);
    expect(stream.text).toContain("Seconde");
    spinner.stop("✓ Seconde");
  });

  it("stop() sans start() ne jette pas et n'écrit rien", () => {
    const stream = fakeStream(true);
    new Spinner({ stream }).stop();
    new ProgressBar({ stream }).stop();
    expect(stream.text).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("ProgressBar — la progression dont on connaît le total", () => {
  it("dessine barre, avancement et libellé", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream, width: 4 });
    bar.start(4, "Bundles");
    bar.update(2);
    expect(stream.text).toContain("▰▰▱▱");
    expect(stream.text).toContain("2/4");
    expect(stream.text).toContain("Bundles");
    bar.stop();
  });

  it("increment() avance d'un cran, et du pas demandé", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream });
    bar.start(10);
    bar.increment();
    expect(bar.done).toBe(1);
    bar.increment(4);
    expect(bar.done).toBe(5);
    bar.stop();
  });

  it("le total peut changer en cours de route (un lot qui grossit)", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream, width: 4 });
    bar.start(2, "Découverte");
    bar.update(2);
    expect(stream.text).toContain("2/2");
    bar.setTotal(8);
    expect(bar.total).toBe(8);
    expect(stream.text).toContain("2/8");
    bar.stop();
  });

  it("`spin: true` ajoute un tourniquet qui vit MALGRÉ un avancement figé", () => {
    vi.useFakeTimers();
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream, spin: true, intervalMs: 80 });
    bar.start(10, "Étape lente");
    // Rien n'avance pendant ce temps : c'est exactement le cas où une barre
    // seule est indiscernable d'un blocage.
    vi.advanceTimersByTime(160);
    expect(stream.text).toContain(BRAILLE_FRAMES[1]);
    expect(stream.text).toContain(BRAILLE_FRAMES[2]);
    expect(bar.done).toBe(0);
    bar.stop();
  });

  it("le rendu reçoit un état complet, et peut tout recomposer", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({
      stream,
      width: 10,
      render: (state) =>
        `${Math.round(state.ratio * 100)}% ${state.bar} ${state.done}/${state.total} ${state.label}`,
    });
    bar.start(4, "Lot");
    bar.update(3);
    expect(stream.text).toContain("75% ");
    expect(stream.text).toContain("3/4 Lot");
    bar.stop();
  });

  it("un start() sur une barre déjà lancée remet l'avancement à zéro", () => {
    const stream = fakeStream(true);
    const bar = new ProgressBar({ stream });
    bar.start(5, "Premier lot");
    bar.update(4);
    bar.start(3, "Second lot");
    expect(bar.done).toBe(0);
    expect(bar.total).toBe(3);
    bar.stop();
  });
});
