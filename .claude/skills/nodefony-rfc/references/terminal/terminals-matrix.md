# Terminaux : molette, souris, sélection, OSC 52, CPR/DECRQM

Établi le 2026-10-05 sur les sources AMONT (branches `master`/`main` au moment de la lecture, jamais une version livrée précise). Règle : une case dit ce que la source affirme ; « Inconnu » = aucune source lue ne le dit ; l'ABSENCE d'une occurrence dans un fichier (grep) est notée « non trouvé dans X », jamais promue en « non supporté ». Les extraits verbatim sont dans la section « Sources » plus bas ([n]) ; les paragraphes xterm ctlseqs sont dans `xterm-ctlseqs-extracts.md` (cité `[ctl]`).

Colonnes :
- a = écran alternatif SANS suivi souris : la molette devient-elle des flèches ? (défaut, réglage, DECSET 1007)
- b = modes souris : 1000 / 1002 / 1003 / 1006 (SGR) / 1015
- c = touche forçant la SÉLECTION NATIVE quand le suivi souris est actif
- d = OSC 52 (écriture / lecture)
- e = `ESC[6n` (CPR) / DECRQM `ESC[?2026$p`

Limite générale : « logiciel livré » ≠ « code amont ». Terminal.app est fermé (seule la doc Apple parle) ; conhost est lu dans OpenConsole (dépôt microsoft/terminal), la version embarquée par chaque build de Windows est Inconnue.

| Terminal | a. molette en alt screen sans souris | b. modes souris | c. sélection native | d. OSC 52 | e. CPR / DECRQM 2026 |
| --- | --- | --- | --- | --- | --- |
| **macOS Terminal.app** | Réglage « Scroll alternate screen » (Réglages > Profils > Clavier) [104]. Défaut : Inconnu. Honore DECSET 1007 : Inconnu. (Constat de l'appelant, non sourcé : molette = historique natif en profil Basic.) | Inconnu (la doc ne liste aucun mode). Menu View > « Allow Mouse Reporting », coché par défaut [105] | Inconnu | Écriture : « Not supported » (source SECONDAIRE communautaire) [113] ; lecture : Inconnu | Inconnu / Inconnu |
| **iTerm2** | Pas de flèches par défaut : « Automatically enable alternate mouse scroll » = NO ; « Terminal may enable alternate mouse scroll » (clé `Allow Alternate Mouse Scroll`) = YES [97][94]. DECSET 1007 honoré seulement si ce dernier réglage est actif [96] | 1000, 1002, 1003, 1006, 1015 oui ; 1001 « not implemented » [102][101] | Option, temporaire [94]. Réglage : « Enable mouse reporting » (décocher) [94]. Réglage de la touche : Inconnu | Écriture : réglage « Applications in terminal may access clipboard », défaut NO [98][95]. Lecture : consentement demandé à chaque fois [95] | CPR oui [103] ; DECRQM oui si niveau VT >= 300 [99] ; 2026 géré [100] |
| **VS Code (terminal intégré, xterm.js)** | OUI sans réglage : buffer sans scrollback (= écran alternatif) et suivi souris absent → `ESC[A`/`ESC[B` (`ESC O A/B` si DECCKM) [10][11]. Ne lit pas DECSET 1007 : aucune occurrence de `1007` dans `InputHandler.ts` (grep) | 1000, 1002, 1003, 1006 oui ; 1005 et 1015 non [14][16] | macOS : Option+clic UNIQUEMENT si `terminal.integrated.macOptionClickForcesSelection` = true (défaut false) [21][23][13]. Autres OS : Maj [13] | Écriture ET lecture (`?`) via l'addon clipboard chargé sans réglage [22][19][20]. Réglage de coupure : Inconnu (aucun trouvé dans `terminalConfiguration.ts`) | CPR oui [18] ; DECRQM oui [16][17] ; 2026 géré [15][17] |
| **xterm.js nu** | Même code : alt screen + suivi souris absent → flèches (selon DECCKM) [10][11] ; pas de lecture de 1007 (grep) | idem VS Code [14][16] | Maj (hors macOS) ; macOS : Option si option `macOptionClickForcesSelection` [13]. Défaut xterm.js de l'option : Inconnu | Pas de handler dans le coeur (commentaire seul) [119] ; l'addon-clipboard l'ajoute, écriture + lecture [19][20] | CPR oui [18] ; DECRQM oui [16][17] ; 2026 géré [15][17] |
| **Windows Terminal** | OUI par défaut : `Mode::AlternateScroll` fait partie des modes initiaux [25] ; actif en alt buffer sur événement molette [26] ; DECSET 1007 honoré [24][29] ; Maj l'inhibe [27] | 1000, 1002, 1003, 1005, 1006 ; 1015 absent de la liste [24] | Maj, non configurable (TODO GH#4875 dans le code) [27] | Écriture seulement si `_clipboardOperationsAllowed` et fenêtre focalisée [31] ; lecture (`?`) non servie [30]. Nom du réglage utilisateur : Inconnu | CPR oui [28] ; DECRQM oui (1007, 2026) [29] ; 2026 géré [24][29] |
| **Console Windows héritée (conhost)** | Même adapter qu'OpenConsole [24][25][26] ; ce qu'embarque chaque Windows : Inconnu | Même table [24]. La souris VT n'est reçue que si QuickEdit est COUPÉ [32]. Version Windows : Inconnu | Inconnu (QuickEdit en jeu [32]) | Inconnu | DECXCPR documenté par Microsoft [33] ; la doc ne liste ni mode souris ni 2026 [33] ; OpenConsole : [28][29] ; version Windows : Inconnu |
| **GNOME Terminal / VTE** | OUI par défaut : 1007 a pour défaut True et est écrivable [35] ; molette -> flèches en alt screen si le mode est actif [39]. Réglage utilisateur : Inconnu | 1000, 1002, 1003, 1006 écrivables [34][35] ; 1015 PAS écrivable [37][38] | Maj, non configurable (Inconnu) [40] | Ignoré : OSC 52 tombe dans la liste sans traitement [41][42] | CPR oui [44] ; DECRQM oui [43] ; 2026 reconnu mais pas écrivable (réponse « reset ») [36][38][43] |
| **Konsole** | OUI par défaut : propriété de profil `AlternateScrolling` = true [50] ; molette -> flèches en alt screen sans suivi souris [51] ; DECSET 1007 honoré et non remis à zéro au reset [47][49]. Libellé UI du réglage : Inconnu | 1000, 1002, 1003, 1006, 1015 [45][46][47] | Maj [52] | Écriture oui, sans réglage trouvé ; lecture non (un `?` est traité comme des données à écrire) [53] | CPR oui [54] ; DECRQM : aucun gestionnaire trouvé dans `Vt102Emulation.cpp` (Inconnu) ; 2026 posé [48] |
| **kitty** | OUI : alt screen sans suivi souris -> `fake_scroll` (flèches, encodage selon DECCKM) [55][56]. DECSET 1007 non lu : absent de `modes.h` [57]. Réglage : Inconnu | 1000, 1002, 1003, 1005, 1006, 1015, 1016 [57] | Maj+clic (`start_simple_selection_grabbed shift+left press grabbed`), réglable par `mouse_map` [59][60] | `clipboard_control` : défaut `write-clipboard write-primary read-clipboard-ask read-primary-ask` [61] | CPR oui [115] ; DECRQM oui [62] ; 2026 géré [58] |
| **Alacritty** | OUI par défaut : `TermMode::default()` contient `ALTERNATE_SCROLL` [63] ; DECSET 1007 honoré [116] ; molette -> `ESC O A` / `ESC O B` (SS3 FIXE, sans regarder DECCKM), Maj inhibe [66] | 1000 (click), 1002 (drag), 1003 (motion), 1005 (UTF8), 1006 (SGR) ; 1015 non trouvé [116][68] | Maj [67] | `terminal.osc52` : défaut `OnlyCopy` (écriture seule) ; valeurs Disabled/OnlyCopy/OnlyPaste/CopyPaste [64][65] | CPR oui [71] ; DECRQM oui, 2026 -> « Reset » et mode no-op [69][70] |
| **WezTerm** | OUI sans réglage de défaut : alt screen sans suivi souris -> flèches, `alternate_buffer_wheel_scroll_speed` = 3 par tick [73][74]. DECSET 1007 : aucun gestionnaire trouvé [76] | 1000, 1002, 1003, 1006 (+ SgrPixels) ; 1015 et 1007 non trouvés [76][118] | Maj par défaut ; réglage `bypass_mouse_reporting_modifiers` [72] | Écriture oui ; lecture (`QuerySelection`) ignorée ; réglage : Inconnu [75] | CPR oui [117] ; DECRQM oui (existe) [118] ; 2026 géré [77] |
| **Ghostty** | OUI par défaut : `mouse_alternate_scroll` défaut true, DECSET 1007 honoré ; conditions : alt screen + aucun suivi souris + mode actif ; flèches CSI ou SS3 selon DECCKM [78][79] | 1000, 1002, 1003, 1006, 1015 présents ; 2026 présent [78] | Maj par défaut ; réglage `mouse-shift-capture` (false / true / always / never, surchargeable par XTSHIFTESCAPE) [80] | `clipboard-write` = allow ; `clipboard-read` = ask (valeurs ask/allow/deny) [81] | CPR oui [83] ; DECRQM oui [82] ; 2026 présent [78] |
| **xterm** | NON par défaut : ressource `alternateScroll` = false [3] ; DECSET 1007 la pose [2][ctl]. Sans elle, la molette fait défiler l'historique (scroll-back/scroll-forw) [1] | 1000, 1002, 1003, 1006, 1015 (et 1001, 1005) [ctl] | Maj ; ressource `shiftEscape` [4] | Désactivé par défaut : `allowWindowOps` = false [5] ET `SetSelection` dans `disallowedWindowOps` par défaut [6] ; OSC 52 : [7] | CPR oui [8] ; DECRQM oui [9] ; 2026 : absent de ctlseqs.txt (Inconnu) |
| **tmux** (multiplexeur) | tmux ne traduit PAS la molette en flèches : binding par défaut en alt screen = `send -M` [84], ignoré si le pane n'a aucun mode souris [85]. DECSET 1007 non trouvé dans `input.c` [92][120]. Option `mouse` : défaut off [86][87] | Côté pane : 1000, 1002, 1003, 1005, 1006 ; 1007 et 1015 non trouvés [92][120] | tmux (mouse on) capte la souris pour ses bindings ; la sélection native reste celle du terminal hôte : touche Inconnue côté tmux (le manuel ne la cite pas) | `set-clipboard` : défaut `external` (écrit l'OSC 52 vers le terminal hôte, n'accepte pas les buffers créés par séquence) ; `get-clipboard` : défaut `buffer` [88][89][90][91] | CPR oui [93] ; DECRQM oui [92] ; 2026 oui [92] |
| **JetBrains (terminal intégré, moteur JediTerm)** | Aucun gestionnaire 1007 trouvé [106][107] ; molette = défilement de la barre [110] ; défilement désactivé en alt buffer [111] ; pas de flèches trouvées dans `TerminalPanel`. Nouveau terminal des IDE récents : Inconnu | 1000, 1001, 1002, 1003, 1005, 1006 ; 1015 non trouvé [106][107] | Maj ; réglage `forceActionOnMouseReporting` [109] | Inconnu (aucun `52` dans `JediEmulator.java`) | CPR oui [112] ; DECRQM : pas de gestionnaire trouvé [114] ; 2026 géré [108] |

## Sources numérotées

Chaque entrée : URL (+ copie brute locale sous `tmp/scratch/terminal-research/raw/`) et extrait verbatim, généré par script depuis le fichier brut (`build_sources.py`) — pas retapé.

### [1] xterm ctlseqs : molette et Alternate Scroll

URL : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt  (copie brute : tmp/scratch/terminal-research/raw/ctlseqs.txt, lignes 3013-3021)

```text
By default, the wheel mouse events (buttons 4 and 5) are translated to
scroll-back and scroll-forw actions, respectively.  Those actions
normally scroll the whole window, as if the scrollbar was used.

However if Alternate Scroll mode is set, then cursor up/down controls
are sent when the terminal is displaying the Alternate Screen Buffer.
The initial state of Alternate Scroll mode is set using the
alternateScroll resource.

```

### [2] xterm ctlseqs : DECSET 1007

URL : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt  (copie brute : tmp/scratch/terminal-research/raw/ctlseqs.txt, lignes 982-983)

```text
            Ps = 1 0 0 7  -> Enable Alternate Scroll Mode, xterm.  This
          corresponds to the alternateScroll resource.
```

### [3] xterm man : ressource alternateScroll (defaut false)

URL : https://invisible-island.net/xterm/manpage/xterm.txt  (copie brute : tmp/scratch/terminal-research/raw/xterm-man.txt, lignes 2041-2046)

```text
       alternateScroll (class ScrollCond)
               If   "true",  the  scroll-back  and  scroll-forw  actions  send
               cursor-up and -down keys when xterm is displaying the alternate
               screen.  The default is "false".

               The alternateScroll state can  also  be  set  using  a  control
```

### [4] xterm man : shiftEscape (Maj outrepasse le protocole souris)

URL : https://invisible-island.net/xterm/manpage/xterm.txt  (copie brute : tmp/scratch/terminal-research/raw/xterm-man.txt, lignes 4557-4560)

```text
               application.  Xterm normally allows you to use the shift-key to
               temporarily   override  this  mouse  protocol,  permitting  the
               selection and copying actions to be used.

```

### [5] xterm man : allowWindowOps (defaut false)

URL : https://invisible-island.net/xterm/manpage/xterm.txt  (copie brute : tmp/scratch/terminal-research/raw/xterm-man.txt, lignes 2004-2011)

```text
               Specifies whether extended window control sequences (as used in
               dtterm)  should  be  allowed.   These  include  several control
               sequences which manipulate the window size or position, as well
               as reporting these values and the title or icon name.  Each  of
               these can be abused in a script; curiously enough most terminal
               emulators  that  implement  these restrict only a small part of
               the repertoire.  For fine-tuning, see disallowedWindowOps.  The
               default is "false".
```

### [6] xterm man : disallowedWindowOps (defaut, contient SetSelection = OSC 52)

URL : https://invisible-island.net/xterm/manpage/xterm.txt  (copie brute : tmp/scratch/terminal-research/raw/xterm-man.txt, lignes 2856-2859)

```text
               controls  adapted  from  dtterm  the  operation  number).   The
               default value is

                   GetChecksum,GetIconTitle,GetSelection,GetWinTitle,SetSelection,SetXprop
```

### [7] xterm ctlseqs : OSC 52

URL : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt  (copie brute : tmp/scratch/terminal-research/raw/ctlseqs.txt, lignes 2156-2159)

```text
            Ps = 5 2  -> Manipulate Selection Data.  These controls may
          be disabled using the allowWindowOps resource.  The parameter
          Pt is parsed as
               Pc ; Pd
```

### [8] xterm ctlseqs : CPR

URL : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt  (copie brute : tmp/scratch/terminal-research/raw/ctlseqs.txt, lignes 1386-1387)

```text
            Ps = 6  -> Report Cursor Position (CPR) [row;column].
          Result is CSI r ; c R
```

### [9] xterm ctlseqs : DECRQM prive

URL : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt  (copie brute : tmp/scratch/terminal-research/raw/ctlseqs.txt, lignes 1514-1519)

```text
          Request DEC private mode (DECRQM).  For VT300 and up, reply
          DECRPM is
            CSI ? Ps ; Pm $ y
          where Ps is the mode number as in DECSET/DECRST, Pm is the
          mode value as in the ANSI DECRQM.
          A few private modes are read-only, provided only for reporting
```

### [10] xterm.js MouseService : molette -> fleches en buffer sans scrollback (aucune lecture de DECSET 1007)

URL : https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/MouseService.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-MouseService.ts, lignes 262-269)

```text
    if (!this._bufferService.buffer.hasScrollback) {
      // Convert wheel events into up/down events when the buffer does not have scrollback, this
      // enables scrolling in apps hosted in the alt buffer such as vim or tmux even when mouse
      // events are not enabled.
      // This used implementation used get the actual lines/partial lines scrolled from the
      // viewport but since moving to the new viewport implementation has been simplified to
      // simply send a single up or down sequence.

```

### [11] xterm.js MouseService : sequence fleche selon DECCKM

URL : https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/MouseService.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-MouseService.ts, lignes 288-289)

```text
      const sequence = C0.ESC + (this._coreService.decPrivateModes.applicationCursorKeys ? 'O' : '[') + (ev.deltaY < 0 ? 'A' : 'B');
      this._coreService.triggerDataEvent(sequence, true);
```

### [12] xterm.js MouseService : molette laissee a l'app si le protocole la demande

URL : https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/MouseService.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-MouseService.ts, lignes 252-256)

```text
  private _handlePassiveWheel(ctx: IMouseBindContext, ev: WheelEvent): false | void {
    // do nothing, if app side handles wheel itself
    if (ctx.requestedEvents.wheel) {
      return;
    }
```

### [13] xterm.js SelectionService.shouldForceSelection

URL : https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/SelectionService.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-Sel.ts, lignes 437-447)

```text
  public shouldForceSelection(event: MouseEvent): boolean {
    if (this._optionsService.rawOptions.mouseEventsRequireAlt && this._mouseStateService.areMouseEventsActive) {
      return !event.altKey;
    }

    if (Browser.isMac) {
      return event.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection;
    }

    return event.shiftKey;
  }
```

### [14] xterm.js InputHandler : table de support DECSET (1000/1002/1003/1006 oui, 1005/1015 non)

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 1916-1925)

```text
   * | 1000  | X11 xterm mouse protocol.                               | #Y      |
   * | 1002  | Use Cell Motion Mouse Tracking.                         | #Y      |
   * | 1003  | Use All Motion Mouse Tracking.                          | #Y      |
   * | 1004  | Send FocusIn/FocusOut events                            | #Y      |
   * | 1005  | Enable UTF-8 Mouse Mode.                                | #N      |
   * | 1006  | Enable SGR Mouse Mode.                                  | #Y      |
   * | 1015  | Enable urxvt Mouse Mode.                                | #N      |
   * | 1016  | Enable SGR-Pixels Mouse Mode.                           | #Y      |
   * | 1047  | Use Alternate Screen Buffer.                            | #Y      |
   * | 1048  | Save cursor as in DECSC.                                | #Y      |
```

### [15] xterm.js InputHandler : 2026 dans setModePrivate

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 2035-2037)

```text
        case 2026: // synchronized output (https://github.com/contour-terminal/vt-extensions/blob/master/synchronized-output.md)
          this._coreService.decPrivateModes.synchronizedOutput = true;
          break;
```

### [16] xterm.js InputHandler : DECRQM 1015

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 2387-2387)

```text
    if (p === 1015) return f(p, V.PERMANENTLY_RESET);
```

### [17] xterm.js InputHandler : DECRQM 2026

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 2392-2392)

```text
    if (p === 2026) return f(p, b2v(dm.synchronizedOutput));
```

### [18] xterm.js InputHandler : DSR/CPR

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 2743-2756)

```text
  public deviceStatus(params: IParams): boolean {
    switch (params.params[0]) {
      case 5:
        // status report
        this._coreService.triggerDataEvent(`${C0.ESC}[0n`);
        break;
      case 6:
        // cursor position
        const y = this._activeBuffer.y + 1;
        const x = this._activeBuffer.x + 1;
        this._coreService.triggerDataEvent(`${C0.ESC}[${y};${x}R`);
        break;
    }
    return true;
```

### [19] xterm.js addon-clipboard : OSC 52

URL : https://github.com/xtermjs/xterm.js/blob/master/addons/addon-clipboard/src/ClipboardAddon.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-clip.ts, lignes 20-21)

```text
    this._disposable = terminal.parser.registerOscHandler(52, data => this._setOrReportClipboard(data));
  }
```

### [20] xterm.js addon-clipboard : requete '?' (lecture)

URL : https://github.com/xtermjs/xterm.js/blob/master/addons/addon-clipboard/src/ClipboardAddon.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-clip.ts, lignes 40-44)

```text
    if (pd === '?') {
      const text = this._provider.readText(pc);

      // Report clipboard
      if (text instanceof Promise) {
```

### [21] VS Code : reglage macOptionClickForcesSelection (defaut false)

URL : https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts  (copie brute : tmp/scratch/terminal-research/raw/vsc-conf.ts, lignes 148-152)

```text
	[TerminalSettingId.MacOptionClickForcesSelection]: {
		description: localize('terminal.integrated.macOptionClickForcesSelection', "Controls whether to force selection when using Option+click on macOS. This will force a regular (line) selection and disallow the use of column selection mode. This enables copying and pasting using the regular terminal selection, for example, when mouse mode is enabled in tmux."),
		type: 'boolean',
		default: false
	},
```

### [22] VS Code : addon clipboard (OSC 52) charge sans reglage, lecture et ecriture

URL : https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts  (copie brute : tmp/scratch/terminal-research/raw/vsc-xterm.ts, lignes 337-348)

```text
		this._xtermAddonLoader.importAddon('clipboard').then(ClipboardAddon => {
			if (this._store.isDisposed) {
				return;
			}
			this._clipboardAddon = this._instantiationService.createInstance(ClipboardAddon, undefined, {
				async readText(type: string): Promise<string> {
					return _clipboardService.readText(type === 'p' ? 'selection' : 'clipboard');
				},
				async writeText(type: string, text: string): Promise<void> {
					return _clipboardService.writeText(text, type === 'p' ? 'selection' : 'clipboard');
				}
			});
```

### [23] VS Code : option transmise a xterm.js

URL : https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts  (copie brute : tmp/scratch/terminal-research/raw/vsc-xterm.ts, lignes 267-267)

```text
			macOptionClickForcesSelection: config.macOptionClickForcesSelection,
```

### [24] Windows Terminal / conhost : modes DECSET declares (1000..1007, pas de 1015)

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/adapter/DispatchTypes.hpp  (copie brute : tmp/scratch/terminal-research/raw/wt-dt.hpp, lignes 538-547)

```text
        VT200_MOUSE_MODE = DECPrivateMode(1000),
        BUTTON_EVENT_MOUSE_MODE = DECPrivateMode(1002),
        ANY_EVENT_MOUSE_MODE = DECPrivateMode(1003),
        FOCUS_EVENT_MODE = DECPrivateMode(1004),
        UTF8_EXTENDED_MODE = DECPrivateMode(1005),
        SGR_EXTENDED_MODE = DECPrivateMode(1006),
        ALTERNATE_SCROLL = DECPrivateMode(1007),
        ASB_AlternateScreenBuffer = DECPrivateMode(1049),
        XTERM_BracketedPasteMode = DECPrivateMode(2004),
        SO_SynchronizedOutput = DECPrivateMode(2026),
```

### [25] Windows Terminal : modes d'entree par defaut = AlternateScroll actif

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/input/terminalInput.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-ti.cpp, lignes 97-97)

```text
    _inputMode = { Mode::Ansi, Mode::AutoRepeat, Mode::AlternateScroll };
```

### [26] Windows Terminal : ShouldSendAlternateScroll

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/input/mouseInput.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-mouse.cpp, lignes 488-494)

```text
bool TerminalInput::ShouldSendAlternateScroll(const unsigned int button, const short delta) const noexcept
{
    const auto inAltBuffer{ _inAlternateBuffer };
    const auto inAltScroll{ _inputMode.test(Mode::AlternateScroll) };
    const auto wasMouseWheel{ (button == WM_MOUSEWHEEL || button == WM_MOUSEHWHEEL) && delta != 0 };
    return inAltBuffer && inAltScroll && wasMouseWheel;
}
```

### [27] Windows Terminal : Maj supprime le suivi souris et l'alternate scroll

URL : https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalControl/ControlInteractivity.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-ci.cpp, lignes 744-766)

```text
    bool ControlInteractivity::_canSendVTMouseInput(const ::Microsoft::Terminal::Core::ControlKeyStates modifiers)
    {
        // If the user is holding down Shift, suppress mouse events
        // TODO GH#4875: disable/customize this functionality
        if (modifiers.IsShiftPressed())
        {
            return false;
        }
        return _core->IsVtMouseModeEnabled();
    }

    bool ControlInteractivity::_shouldSendAlternateScroll(const ::Microsoft::Terminal::Core::ControlKeyStates modifiers, const Core::Point delta)
    {
        // If the user is holding down Shift, suppress mouse events
        // TODO GH#4875: disable/customize this functionality
        if (modifiers.IsShiftPressed())
        {
            return false;
        }
        if (delta.Y != 0)
        {
            return _core->ShouldSendAlternateScroll(WM_MOUSEWHEEL, delta.Y);
        }
```

### [28] Windows Terminal : DSR/CPR

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/adapter/adaptDispatch.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-ad.cpp, lignes 1392-1398)

```text
    case DispatchTypes::StatusType::CursorPositionReport:
        _CursorPositionReport(false);
        break;
    case DispatchTypes::StatusType::ExtendedCursorPositionReport:
        _CursorPositionReport(true);
        break;
    case DispatchTypes::StatusType::PrinterStatus:
```

### [29] Windows Terminal : DECRQM 1007 et 2026

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/adapter/adaptDispatch.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-ad.cpp, lignes 2021-2031)

```text
        state = mapTemp(_terminalInput.GetInputMode(TerminalInput::Mode::AlternateScroll));
        break;
    case DispatchTypes::ModeParams::ASB_AlternateScreenBuffer:
        state = mapTemp(_usingAltBuffer);
        break;
    case DispatchTypes::ModeParams::XTERM_BracketedPasteMode:
        state = mapTemp(_api.GetSystemMode(ITerminalApi::Mode::BracketedPaste));
        break;
    case DispatchTypes::ModeParams::SO_SynchronizedOutput:
        state = mapTemp(_renderSettings.GetRenderMode(RenderSettings::Mode::SynchronizedOutput));
        break;
```

### [30] Windows Terminal : OSC 52 (la requete '?' n'est pas servie)

URL : https://github.com/microsoft/terminal/blob/main/src/terminal/parser/OutputStateMachineEngine.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-osm.cpp, lignes 823-829)

```text
        std::wstring setClipboardContent;
        auto queryClipboard = false;
        if (_GetOscSetClipboard(string, setClipboardContent, queryClipboard) && !queryClipboard)
        {
            _dispatch->SetClipboard(setClipboardContent);
        }
        break;
```

### [31] Windows Terminal : OSC 52 conditionne a _clipboardOperationsAllowed et _focused

URL : https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalCore/TerminalApi.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-tapi.cpp, lignes 157-163)

```text
void Terminal::CopyToClipboard(wil::zwstring_view content)
{
    if (_clipboardOperationsAllowed && _focused)
    {
        _pfnCopyToClipboard(content);
    }
}
```

### [32] conhost : souris VT recue seulement si QuickEdit est coupe

URL : https://github.com/microsoft/terminal/blob/main/src/host/getset.cpp  (copie brute : tmp/scratch/terminal-research/raw/wt-getset.cpp, lignes 372-378)

```text
            // Mouse input should be received when mouse mode is on and quick edit mode is off
            // (for more information regarding the quirks of mouse mode and why/how it relates
            //  to quick edit mode, see GH#9970)
            const auto newQuickEditMode{ WI_IsFlagSet(gci.Flags, CONSOLE_QUICK_EDIT_MODE) };
            WI_ClearFlagIf(oldMode, ENABLE_MOUSE_INPUT, oldQuickEditMode);
            WI_ClearFlagIf(newMode, ENABLE_MOUSE_INPUT, newQuickEditMode);

```

### [33] Microsoft Learn : Console VT sequences (DECXCPR documente ; aucun mode souris ni 2026 liste)

URL : https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences  (copie brute : tmp/scratch/terminal-research/raw/msvt.txt, lignes 440-447)

```text
 Description 
 Behavior 
 ESC [ 6 n 
 DECXCPR 
 Report Cursor Position 
 Emit the cursor position as: ESC [ <r> ; <c> R Where <r> = cursor row and <c> = cursor column 
 ESC [ 0 c 
 DA 
```

### [34] VTE : modes.py 1000/1001/1002/1003

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/modes.py  (copie brute : tmp/scratch/terminal-research/raw/vte-modes.py, lignes 1247-1250)

```text
    mode_WHAT('XTERM_MOUSE_VT220', 1000, default=False, flags=Flags.WRITABLE),
    mode_WHAT('XTERM_MOUSE_VT220_HIGHLIGHT', 1001, default=False, flags=Flags.WRITABLE),
    mode_WHAT('XTERM_MOUSE_BUTTON_EVENT', 1002, default=False, flags=Flags.WRITABLE),
    mode_WHAT('XTERM_MOUSE_ANY_EVENT', 1003, default=False, flags=Flags.WRITABLE),
```

### [35] VTE : modes.py 1006 et 1007 (defaut True)

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/modes.py  (copie brute : tmp/scratch/terminal-research/raw/vte-modes.py, lignes 1255-1256)

```text
    mode_WHAT('XTERM_MOUSE_EXT_SGR', 1006, default=False, flags=Flags.WRITABLE),
    mode_WHAT('XTERM_ALTBUF_SCROLL', 1007, default=True, flags=Flags.WRITABLE),
```

### [36] VTE : modes.py 2026 (sans flag WRITABLE)

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/modes.py  (copie brute : tmp/scratch/terminal-research/raw/vte-modes.py, lignes 1050-1050)

```text
    mode_WHAT('CONTOUR_BATCHED_RENDERING', 2026, default=False),
```

### [37] VTE : modes.py 1015 (sans flag WRITABLE)

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/modes.py  (copie brute : tmp/scratch/terminal-research/raw/vte-modes.py, lignes 1152-1152)

```text
    mode_WHAT('RXVT_MOUSE_EXT', 1015, default=False),
```

### [38] VTE : definition du flag WRITABLE

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/modes.py  (copie brute : tmp/scratch/terminal-research/raw/vte-modes.py, lignes 35-37)

```text
class Flags(enum.Flag):
    NONE = 0
    WRITABLE = enum.auto()
```

### [39] VTE : vte.cc, molette -> fleches en ecran alternatif si 1007

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vte.cc  (copie brute : tmp/scratch/terminal-research/raw/vte.cc, lignes 10350-10353)

```text
	if (m_screen == &m_alternate_screen &&
            m_modes_private.XTERM_ALTBUF_SCROLL()) {
		char *normal;
		gsize normal_length;
```

### [40] VTE : vte.cc, Maj force la selection quand le suivi souris est actif

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vte.cc  (copie brute : tmp/scratch/terminal-research/raw/vte.cc, lignes 7485-7491)

```text
			/* If we're in event mode, and the user held down the
			 * shift key, we start selecting. */
			if (m_mouse_tracking_mode != MouseTrackingMode::eNONE) {
				if (m_modifiers & GDK_SHIFT_MASK) {
					start_selecting = TRUE;
				}
			} else {
```

### [41] VTE : vteseq.cc, OSC 52 (XTERM_SET_XSELECTION) dans la liste ignoree

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vteseq.cc  (copie brute : tmp/scratch/terminal-research/raw/vte-seq.cc, lignes 8036-8036)

```text
        case VTE_OSC_XTERM_SET_XSELECTION:
```

### [42] VTE : vteseq.cc, fin de la liste ignoree (default: break)

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vteseq.cc  (copie brute : tmp/scratch/terminal-research/raw/vte-seq.cc, lignes 8065-8068)

```text
        case VTE_OSC_YF_RQGWR:
        default:
                break;
        }
```

### [43] VTE : vteseq.cc, DECRQM_DEC

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vteseq.cc  (copie brute : tmp/scratch/terminal-research/raw/vte-seq.cc, lignes 4661-4683)

```text
Terminal::DECRQM_DEC(vte::parser::Sequence const& seq)
{
        /*
         * DECRQM_DEC - request-mode-dec
         * Same as DECRQM_ECMA but for DEC modes.
         *
         * References: VT525
         */

        auto const param = seq.collect1(0);
        auto const mode = m_modes_private.mode_from_param(param);

        int value;
        switch (mode) {
        case vte::terminal::modes::Private::eUNKNOWN:      value = 0; break;
        case vte::terminal::modes::Private::eALWAYS_SET:   value = 3; break;
        case vte::terminal::modes::Private::eALWAYS_RESET: value = 4; break;
        default: assert(mode >= 0); value = m_modes_private.get(mode) ? 1 : 2; break;
        }

        _vte_debug_print(vte::debug::category::MODES,
                         "Reporting private mode {} ({}) is {}",
                         param, m_modes_private.mode_to_cstring(mode),
```

### [44] VTE : vteseq.cc, CPR

URL : https://gitlab.gnome.org/GNOME/vte/-/blob/master/src/vteseq.cc  (copie brute : tmp/scratch/terminal-research/raw/vte-seq.cc, lignes 6518-6521)

```text
        case 6:
                /* Request cursor position report
                 * Reply: CPR
                 *   @arg[0]: line
```

### [45] Konsole : Vt102Emulation.cpp, mode 1000

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 2280-2280)

```text
    case token_csi_pr('h', 1000) :          setMode      (MODE_Mouse1000); break; //XTERM
```

### [46] Konsole : Vt102Emulation.cpp, 1002/1003

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 2290-2295)

```text
    case token_csi_pr('h', 1002) :          setMode      (MODE_Mouse1002); break; //XTERM
    case token_csi_pr('l', 1002) :        resetMode      (MODE_Mouse1002); break; //XTERM
    case token_csi_pr('s', 1002) :         saveMode      (MODE_Mouse1002); break; //XTERM
    case token_csi_pr('r', 1002) :      restoreMode      (MODE_Mouse1002); break; //XTERM

    case token_csi_pr('h', 1003) :          setMode      (MODE_Mouse1003); break; //XTERM
```

### [47] Konsole : Vt102Emulation.cpp, 1006/1007/1015

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 2308-2320)

```text
    case token_csi_pr('h', 1006) :          setMode      (MODE_Mouse1006); break; //XTERM
    case token_csi_pr('l', 1006) :        resetMode      (MODE_Mouse1006); break; //XTERM
    case token_csi_pr('s', 1006) :         saveMode      (MODE_Mouse1006); break; //XTERM
    case token_csi_pr('r', 1006) :      restoreMode      (MODE_Mouse1006); break; //XTERM

    case token_csi_pr('h', 1007) :          setMode      (MODE_Mouse1007); break; //XTERM
    case token_csi_pr('l', 1007) :        resetMode      (MODE_Mouse1007); break; //XTERM
    case token_csi_pr('s', 1007) :         saveMode      (MODE_Mouse1007); break; //XTERM
    case token_csi_pr('r', 1007) :      restoreMode      (MODE_Mouse1007); break; //XTERM

    case token_csi_pr('h', 1015) :          setMode      (MODE_Mouse1015); break; //URXVT
    case token_csi_pr('l', 1015) :        resetMode      (MODE_Mouse1015); break; //URXVT
    case token_csi_pr('s', 1015) :         saveMode      (MODE_Mouse1015); break; //URXVT
```

### [48] Konsole : 2026

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 2354-2355)

```text
    case token_csi_pr('h', 2026):           setMode      (MODE_SynchronizedUpdate); break; //ITERM2
    case token_csi_pr('l', 2026):         resetMode      (MODE_SynchronizedUpdate); break; //ITERM2
```

### [49] Konsole : 1007 non remis a zero, propriete de profil

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 3484-3486)

```text
    // MODE_Mouse1007 (Alternate Scrolling) is not reset here, to maintain
    // the profile alternate scrolling property after reset() is called, which
    // makes more sense; also this matches XTerm behavior.
```

### [50] Konsole : profil AlternateScrolling defaut true

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/profile/Profile.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-prof.cpp, lignes 182-182)

```text
    {AlternateScrolling, "AlternateScrolling", INTERACTION_GROUP, true},
```

### [51] Konsole : TerminalDisplay, molette -> fleches en ecran alternatif sans suivi souris

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/terminalDisplay/TerminalDisplay.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-td.cpp, lignes 1917-1923)

```text
        if (!usesMouseTracking() && !_sessionController->session()->isPrimaryScreen() && _scrollBar->alternateScrolling()) {
            // Send simulated up / down key presses to the terminal program
            // for the benefit of programs such as 'less' (which use the alternate screen)

            // assume that each Up / Down key event will cause the terminal application
            // to scroll by one line.
            //
```

### [52] Konsole : TerminalDisplay, Maj selectionne quand le suivi souris est actif

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/terminalDisplay/TerminalDisplay.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-td.cpp, lignes 1390-1400)

```text
            // There are a couple of use cases when selecting text :
            // Normal buffer or Alternate buffer when not using Mouse Tracking:
            //  select text or extendSelection or columnSelection or columnSelection + extendSelection
            //
            // Alternate buffer when using Mouse Tracking and with Shift pressed:
            //  select text or columnSelection
            if (!usesMouseTracking() && ((ev->modifiers() == Qt::ShiftModifier) || (((ev->modifiers() & Qt::ShiftModifier) != 0u) && _columnSelectionMode))) {
                extendSelection(ev->pos());
            } else if ((!usesMouseTracking() && !((ev->modifiers() & Qt::ShiftModifier)))
                       || (usesMouseTracking() && ((ev->modifiers() & Qt::ShiftModifier) != 0u))) {
                clearSelection();
```

### [53] Konsole : OSC 52, ecriture seulement

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 1285-1307)

```text
    if (attribute == Clipboard) {
        // Clipboard
        QStringList params = value.split(QLatin1Char(';'));
        if (params.length() == 0) {
            return;
        }

        bool clipboard = false;
        bool selection = false;
        if (params[0].isEmpty() || params[0].contains(QLatin1Char('c')) || params[0].contains(QLatin1Char('s'))) {
            clipboard = true;
        }
        if (params[0].contains(QLatin1Char('p'))) {
            selection = true;
        }

        if (params.length() == 2) {
            // Copy to clipboard
            if (clipboard) {
                QApplication::clipboard()->setText(QString::fromUtf8(QByteArray::fromBase64(params[1].toUtf8())), QClipboard::Clipboard);
            }
            if (selection) {
                QApplication::clipboard()->setText(QString::fromUtf8(QByteArray::fromBase64(params[1].toUtf8())), QClipboard::Selection);
```

### [54] Konsole : CSI 6 n

URL : https://invent.kde.org/utilities/konsole/-/blob/master/src/Vt102Emulation.cpp  (copie brute : tmp/scratch/terminal-research/raw/kon-vt.cpp, lignes 2153-2153)

```text
    case token_csi_ps('n',   6) :      reportCursorPosition (          ); break;
```

### [55] kitty : molette en ecran alternatif sans suivi souris -> fake_scroll

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/mouse.c  (copie brute : tmp/scratch/terminal-research/raw/kitty-mouse.c, lignes 355-359)

```text
    Screen *screen = w->render_data.screen;
    if (screen->linebuf == screen->main_linebuf) {
        finish_scroll_animation(screen);
        screen_history_scroll(screen, SCROLL_LINE, upwards);
        update_drag(w);
```

### [56] kitty : fake_scroll envoie une fleche

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/keys.c  (copie brute : tmp/scratch/terminal-research/raw/kitty-x-keys.c, lignes 363-368)

```text
fake_scroll(Window *w, int amount, bool upwards) {
    if (!w) return;
    int key = upwards ? GLFW_FKEY_UP : GLFW_FKEY_DOWN;
    GLFWkeyevent ev = {.key = key};
    char encoded_key[KEY_BUFFER_SIZE] = {0};
    Screen *screen = w->render_data.screen;
```

### [57] kitty : modes.h (1000/1002/1003/1005/1006/1015/1016)

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/modes.h  (copie brute : tmp/scratch/terminal-research/raw/kitty-modes.h, lignes 62-70)

```text
#define MOUSE_BUTTON_TRACKING (1000 << 5)
#define MOUSE_MOTION_TRACKING (1002 << 5)
#define MOUSE_MOVE_TRACKING (1003 << 5)
#define FOCUS_TRACKING (1004 << 5)
#define MOUSE_UTF8_MODE (1005 << 5)
#define MOUSE_SGR_MODE (1006 << 5)
#define MOUSE_URXVT_MODE (1015 << 5)
#define MOUSE_SGR_PIXEL_MODE (1016 << 5)

```

### [58] kitty : modes.h 2026

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/modes.h  (copie brute : tmp/scratch/terminal-research/raw/kitty-modes.h, lignes 86-86)

```text
#define PENDING_UPDATE (2026 << 5)
```

### [59] kitty : Maj+clic force la selection quand l'app a grabbe la souris (defaut)

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/options/definition.py  (copie brute : tmp/scratch/terminal-research/raw/kitty-def.py, lignes 1415-1415)

```text
    'start_simple_selection_grabbed shift+left press grabbed mouse_selection normal',
```

### [60] kitty : doc mouse_map, Shift pour selectionner quand grabbed

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/options/definition.py  (copie brute : tmp/scratch/terminal-research/raw/kitty-def.py, lignes 1332-1335)

```text
also add the following mapping and hold :kbd:`Shift` when selecting and dragging::

    mouse_map shift+left press grabbed mouse_selection drag_or_normal_select

```

### [61] kitty : clipboard_control (defaut)

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/options/definition.py  (copie brute : tmp/scratch/terminal-research/raw/kitty-def.py, lignes 3139-3151)

```text
    'clipboard_control',
    'write-clipboard write-primary read-clipboard-ask read-primary-ask',
    option_type='clipboard_control',
    long_text="""
Allow programs running in kitty to read and write from the clipboard. You can
control exactly which actions are allowed. The possible actions are:
:code:`write-clipboard`, :code:`read-clipboard`, :code:`write-primary`,
:code:`read-primary`, :code:`read-clipboard-ask`, :code:`read-primary-ask`. The
default is to allow writing to the clipboard and primary selection and to ask
for permission when a program tries to read from the clipboard. Note that
disabling the read confirmation is a security risk as it means that any program,
even the ones running on a remote server via SSH can read your clipboard. See
also :opt:`clipboard_max_size`.
```

### [62] kitty : report_mode_status (DECRQM) existe

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/screen.c  (copie brute : tmp/scratch/terminal-research/raw/kitty-screen.c, lignes 3267-3268)

```text
report_mode_status(Screen *self, unsigned int which, bool private) {
    unsigned int q = private ? which << 5 : which;
```

### [63] Alacritty : TermMode::default() inclut ALTERNATE_SCROLL

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 113-121)

```text
impl Default for TermMode {
    fn default() -> TermMode {
        TermMode::SHOW_CURSOR
            | TermMode::LINE_WRAP
            | TermMode::ALTERNATE_SCROLL
            | TermMode::URGENCY_HINTS
    }
}

```

### [64] Alacritty : Osc52 defaut OnlyCopy

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 372-384)

```text
pub enum Osc52 {
    /// The handling of the escape sequence is disabled.
    Disabled,
    /// Only copy sequence is accepted.
    ///
    /// This option is the default as a compromise between entirely
    /// disabling it (the most secure) and allowing `paste` (the less secure).
    #[default]
    OnlyCopy,
    /// Only paste sequence is accepted.
    OnlyPaste,
    /// Both are accepted.
    CopyPaste,
```

### [65] Alacritty : man alacritty(5), osc52

URL : https://github.com/alacritty/alacritty/blob/master/extra/man/alacritty.5.scd  (copie brute : tmp/scratch/terminal-research/raw/ala-man.scd, lignes 618-624)

```text
*osc52* = _"Disabled"_ | _"OnlyCopy"_ | _"OnlyPaste"_ | _"CopyPaste"_

	Controls the ability to write to the system clipboard with the _OSC 52_
	escape sequence. While this escape sequence is useful to copy contents
	from the remote server, allowing any application to read from the clipboard
	can be easily abused while not providing significant benefits over
	explicitly pasting text.
```

### [66] Alacritty : molette -> ESC O A/B (SS3 fixe), sauf Maj

URL : https://github.com/alacritty/alacritty/blob/master/alacritty/src/input/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-input.rs, lignes 797-817)

```text
            .terminal()
            .mode()
            .contains(TermMode::ALT_SCREEN | TermMode::ALTERNATE_SCROLL)
            && !self.ctx.modifiers().state().shift_key()
        {
            // The chars here are the same as for the respective arrow keys.
            let line_cmd = if is_scroll_up { b'A' } else { b'B' };
            let column_cmd = if new_scroll_x_px > 0. { b'D' } else { b'C' };

            let mut content = Vec::with_capacity(3 * (lines + columns));

            for _ in 0..lines {
                content.push(0x1b);
                content.push(b'O');
                content.push(line_cmd);
            }

            for _ in 0..columns {
                content.push(0x1b);
                content.push(b'O');
                content.push(column_cmd);
```

### [67] Alacritty : Maj contourne le mode souris

URL : https://github.com/alacritty/alacritty/blob/master/alacritty/src/input/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-input.rs, lignes 619-620)

```text
        if !self.ctx.modifiers().state().shift_key() && self.ctx.mouse_mode() {
            self.ctx.mouse_mut().click_state = ClickState::None;
```

### [68] Alacritty : SgrMouse/Utf8Mouse (pas de 1015)

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 1972-1973)

```text
            NamedPrivateMode::SgrMouse => {
                self.mode.remove(TermMode::UTF8_MOUSE);
```

### [69] Alacritty : SyncUpdate est un no-op au set/reset

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 1992-1992)

```text
            NamedPrivateMode::SyncUpdate => (),
```

### [70] Alacritty : DECRQM 2026 rend Reset

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 2084-2084)

```text
                NamedPrivateMode::SyncUpdate => ModeState::Reset,
```

### [71] Alacritty : DSR 6

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 1332-1344)

```text
    fn device_status(&mut self, arg: usize) {
        trace!("Reporting device status: {arg}");
        match arg {
            5 => {
                let text = String::from("\x1b[0n");
                self.event_proxy.send_event(Event::PtyWrite(text));
            },
            6 => {
                let pos = self.grid.cursor.point;
                let text = format!("\x1b[{};{}R", pos.line + 1, pos.column + 1);
                self.event_proxy.send_event(Event::PtyWrite(text));
            },
            _ => debug!("unknown device status query: {arg}"),
```

### [72] WezTerm : bypass_mouse_reporting_modifiers (defaut SHIFT)

URL : https://github.com/wezterm/wezterm/blob/main/docs/config/lua/config/bypass_mouse_reporting_modifiers.md  (copie brute : tmp/scratch/terminal-research/raw/wez-bypass.md, lignes 9-21)

```text
If an application has enabled mouse reporting mode, mouse events are sent
directly to the application, and do not get routed through the mouse
assignment logic.

Holding down the `bypass_mouse_reporting_modifiers` modifier key(s) will
prevent the event from being passed to the application.

The default value for `bypass_mouse_reporting_modifiers` is `SHIFT`, which
means that holding down shift while clicking will not send the mouse
event to eg: vim running in mouse mode and will instead treat the event
as though `SHIFT` was not pressed and then match it against the mouse
assignments.

```

### [73] WezTerm : molette -> fleches en ecran alternatif sans suivi souris

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/mouse.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-mouse.rs, lignes 119-123)

```text
        } else if self.mouse_tracking || self.button_event_mouse || self.any_event_mouse {
            self.encode_x10_or_utf8(event, button)?;
        } else if self.screen.is_alt_screen_active() {
            // Send cursor keys instead (equivalent to xterm's alternateScroll mode)
            for _ in 0..self.config.alternate_buffer_wheel_scroll_speed() {
```

### [74] WezTerm : doc alternate_buffer_wheel_scroll_speed

URL : https://github.com/wezterm/wezterm/blob/main/docs/config/lua/config/alternate_buffer_wheel_scroll_speed.md  (copie brute : tmp/scratch/terminal-research/raw/wez-abw.md, lignes 12-18)

```text
When an application activates the *Alternate Screen Buffer* (this is
common for "full screen" terminal programs such as pagers and editors),
the alternate screen doesn't have a scrollback.

In this mode, if the application hasn't enabled mouse reporting, wezterm will
generate Arrow Up/Down key events when the vertical mouse wheel is scrolled.

```

### [75] WezTerm : OSC 52, QuerySelection ignore

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/performer.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-perf.rs, lignes 791-798)

```text
            }
            OperatingSystemCommand::QuerySelection(_) => {}
            OperatingSystemCommand::SetSelection(selection, selection_data) => {
                let selection = selection_to_selection(selection);
                match self.set_clipboard_contents(selection, Some(selection_data)) {
                    Ok(_) => (),
                    Err(err) => error!("failed to set clipboard in response to OSC 52: {:#?}", err),
                }
```

### [76] WezTerm : modes DECSET traites (1000/1002/1003/1006 ; ni 1007 ni 1015)

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-ts.rs, lignes 1879-1879)

```text
            Mode::SetDecPrivateMode(DecPrivateMode::Code(DecPrivateModeCode::MouseTracking)) => {
```

### [77] WezTerm : 2026 traite

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-ts.rs, lignes 1694-1694)

```text
                DecPrivateModeCode::SynchronizedOutput,
```

### [78] Ghostty : modes.zig (1007 defaut true, 1015, 2026)

URL : https://github.com/ghostty-org/ghostty/blob/main/src/terminal/modes.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-modes.zig, lignes 360-377)

```text
    .{ .name = "mouse_event_normal", .value = 1000, .default_configurable = false },
    .{ .name = "mouse_event_button", .value = 1002, .default_configurable = false },
    .{ .name = "mouse_event_any", .value = 1003, .default_configurable = false },
    .{ .name = "focus_event", .value = 1004 },
    .{ .name = "mouse_format_utf8", .value = 1005, .default_configurable = false },
    .{ .name = "mouse_format_sgr", .value = 1006, .default_configurable = false },
    .{ .name = "mouse_alternate_scroll", .value = 1007, .default = true },
    .{ .name = "mouse_format_urxvt", .value = 1015, .default_configurable = false },
    .{ .name = "mouse_format_sgr_pixels", .value = 1016, .default_configurable = false },
    .{ .name = "ignore_keypad_with_numlock", .value = 1035, .default = true },
    .{ .name = "alt_esc_prefix", .value = 1036, .default = true },
    .{ .name = "alt_sends_escape", .value = 1039 },
    .{ .name = "reverse_wrap_extended", .value = 1045 },
    .{ .name = "alt_screen", .value = 1047, .default_configurable = false },
    .{ .name = "save_cursor", .value = 1048, .default_configurable = false },
    .{ .name = "alt_screen_save_cursor_clear_enter", .value = 1049, .default_configurable = false },
    .{ .name = "bracketed_paste", .value = 2004 },
    .{ .name = "synchronized_output", .value = 2026, .default_configurable = false },
```

### [79] Ghostty : Surface.zig, molette -> fleches (selon DECCKM) en ecran alternatif sans suivi souris

URL : https://github.com/ghostty-org/ghostty/blob/main/src/Surface.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-surface.zig, lignes 3652-3674)

```text
        // If we're in alternate screen with alternate scroll enabled, then
        // we convert to cursor keys. This only happens if we're:
        // (1) alt screen (2) no explicit mouse reporting and (3) alt
        // scroll mode enabled.
        if (self.io.terminal.screens.active_key == .alternate and
            self.io.terminal.flags.mouse_event == .none and
            self.io.terminal.modes.get(.mouse_alternate_scroll))
        {
            if (y.delta != 0) {
                // When we send mouse events as cursor keys we always
                // clear the selection.
                try self.setSelection(null);

                const seq = if (self.io.terminal.modes.get(.cursor_keys)) seq: {
                    // cursor key: application mode
                    break :seq switch (y.direction()) {
                        .up_right => "\x1bOA",
                        .down_left => "\x1bOB",
                    };
                } else seq: {
                    // cursor key: normal mode
                    break :seq switch (y.direction()) {
                        .up_right => "\x1b[A",
```

### [80] Ghostty : mouse-shift-capture

URL : https://github.com/ghostty-org/ghostty/blob/main/src/config/Config.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-config.zig, lignes 951-961)

```text
/// The default value of `false` means that the shift key is not sent with
/// the mouse protocol and will extend the selection. This value can be
/// conditionally overridden by the running program with the `XTSHIFTESCAPE`
/// sequence.
///
/// The value `true` means that the shift key is sent with the mouse protocol
/// but the running program can override this behavior with `XTSHIFTESCAPE`.
///
/// The value `never` is the same as `false` but the running program cannot
/// override this behavior with `XTSHIFTESCAPE`. The value `always` is the
/// same as `true` but the running program cannot override this behavior with
```

### [81] Ghostty : clipboard-read / clipboard-write

URL : https://github.com/ghostty-org/ghostty/blob/main/src/config/Config.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-config.zig, lignes 2448-2460)

```text
/// Whether to allow programs running in the terminal to read/write to the
/// system clipboard (OSC 52, for googling). The default is to allow clipboard
/// reading after prompting the user and allow writing unconditionally.
///
/// Valid values are:
///
///   * `ask`
///   * `allow`
///   * `deny`
///
@"clipboard-read": ClipboardAccess = .ask,
@"clipboard-write": ClipboardAccess = .allow,

```

### [82] Ghostty : stream_handler.zig, requestMode (DECRQM)

URL : https://github.com/ghostty-org/ghostty/blob/main/src/termio/stream_handler.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-sh.zig, lignes 596-598)

```text
    fn requestMode(self: *StreamHandler, mode: terminal.Mode) !void {
        self.sendModeReport(self.terminal.modes.getReport(.fromMode(mode)));
    }
```

### [83] Ghostty : stream_handler.zig, DSR cursor_position

URL : https://github.com/ghostty-org/ghostty/blob/main/src/termio/stream_handler.zig  (copie brute : tmp/scratch/terminal-research/raw/gh-sh.zig, lignes 855-856)

```text
            .cursor_position => {
                const pos: struct {
```

### [84] tmux : binding molette par defaut

URL : https://github.com/tmux/tmux/blob/master/key-bindings.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-kb.c, lignes 514-514)

```text
		"bind -n WheelUpPane { if -F '#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -e } }",
```

### [85] tmux : input_key_mouse ignore l'evenement si le pane n'a aucun mode souris

URL : https://github.com/tmux/tmux/blob/master/input-keys.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-ik.c, lignes 804-806)

```text
	/* Ignore events if no mouse mode or the pane is not visible. */
	if (m->ignore || (s->mode & ALL_MOUSE_MODES) == 0)
		return;
```

### [86] tmux : option mouse

URL : https://github.com/tmux/tmux/blob/master/options-table.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-opt.c, lignes 939-945)

```text
	{ .name = "mouse",
	  .type = OPTIONS_TABLE_FLAG,
	  .scope = OPTIONS_TABLE_SESSION,
	  .default_num = TMUX_MOUSE,
	  .text = "Whether the mouse is recognised and mouse key bindings are "
		  "executed. "
		  "Applications inside panes can use the mouse even when 'off'."
```

### [87] tmux : TMUX_MOUSE

URL : https://github.com/tmux/tmux/blob/master/tmux.h  (copie brute : tmp/scratch/terminal-research/raw/tmux-h.h, lignes 108-108)

```text
#define TMUX_MOUSE 0
```

### [88] tmux : set-clipboard

URL : https://github.com/tmux/tmux/blob/master/options-table.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-opt.c, lignes 531-539)

```text
	{ .name = "set-clipboard",
	  .type = OPTIONS_TABLE_CHOICE,
	  .scope = OPTIONS_TABLE_SERVER,
	  .choices = options_table_set_clipboard_list,
	  .default_num = 1,
	  .text = "Whether to attempt to set the system clipboard ('on' or "
		  "'external') and whether to allow applications to create "
		  "paste buffers with an escape sequence ('on' only)."
	},
```

### [89] tmux : valeurs de set-clipboard

URL : https://github.com/tmux/tmux/blob/master/options-table.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-opt.c, lignes 85-87)

```text
static const char *options_table_set_clipboard_list[] = {
	"off", "external", "on", NULL
};
```

### [90] tmux : get-clipboard

URL : https://github.com/tmux/tmux/blob/master/options-table.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-opt.c, lignes 437-445)

```text
	{ .name = "get-clipboard",
	  .type = OPTIONS_TABLE_CHOICE,
	  .scope = OPTIONS_TABLE_SERVER,
	  .choices = options_table_get_clipboard_list,
	  .default_num = 1,
	  .text = "When an application requests the clipboard, whether to "
		  "ignore the request ('off'); respond with the newest buffer "
		  "('buffer'); request the clipboard from the most recently "
		  "used terminal ('request'); or to request the clipboard, "
```

### [91] tmux : man set-clipboard

URL : https://github.com/tmux/tmux/blob/master/tmux.1  (copie brute : tmp/scratch/terminal-research/raw/tmux.1, lignes 5020-5034)

```text
Attempt to set the terminal clipboard content using the
.Xr xterm 1
escape sequence, if there is an
.Em \&Ms
entry in the
.Xr terminfo 5
description (see the
.Sx TERMINFO EXTENSIONS
section).
.Pp
If set to
.Ic on ,
.Nm
will both accept the escape sequence to create a buffer and attempt to set
the terminal clipboard.
```

### [92] tmux : DECRQM (1000..1006, 2004, 2026 ; pas de 1007 ni 1015)

URL : https://github.com/tmux/tmux/blob/master/input.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-input.c, lignes 1690-1705)

```text
		case 1002:	/* mouse: button-event tracking */
			n = (s->mode & MODE_MOUSE_BUTTON) ? 1 : 2;
			break;
		case 1003:	/* mouse: any-event tracking */
			n = (s->mode & MODE_MOUSE_ALL) ? 1 : 2;
			break;
		case 1004:	/* focus reporting */
			n = (s->mode & MODE_FOCUSON) ? 1 : 2;
			break;
		case 1005:	/* mouse: UTF-8 */
			n = (s->mode & MODE_MOUSE_UTF8) ? 1 : 2;
			break;
		case 1006:	/* mouse: SGR */
			n = (s->mode & MODE_MOUSE_SGR) ? 1 : 2;
			break;
		case 2004:	/* bracketed paste */
```

### [93] tmux : DSR 6

URL : https://github.com/tmux/tmux/blob/master/input.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-input.c, lignes 1721-1731)

```text
	case INPUT_CSI_DSR:
		switch (input_get(ictx, 0, 0, 0)) {
		case -1:
			break;
		case 5:
			input_reply(ictx, 1, "\033[0n");
			break;
		case 6:
			input_reply(ictx, 1, "\033[%u;%uR", s->cy + 1,
			    s->cx + 1);
			break;
```

### [94] iTerm2 doc : profil Terminal (souris, alternate mouse scroll)

URL : https://iterm2.com/documentation-preferences-profiles-terminal.html  (copie brute : tmp/scratch/terminal-research/raw/iterm-documentation-preferences-profiles-terminal.md, lignes 42-64)

```text
#### Enable mouse reporting

If selected, applications may choose to receive information about the mouse. This can be temporarily disabled by holding down Option.

#### Report mouse wheel events

If disabled, the mouse wheel will always perform its default action (such as scrolling history) rather than being reported to an app that has enabled mouse reporting.

#### Report mouse clicks & drags

If disabled, the mouse buttons will always perform their default action (such as making a selection) rather than being reported to an app that has enabled mouse reporting.

#### Terminal may enable alternate mouse scroll

Alternate mouse scroll is a feature where the scroll wheel sends arrow up/down keys rather than navigating history. If enabled, a program may switch into alternate mouse scroll.

#### Automatically enable alternate mouse scroll

When enabled, alternate mouse scroll will be turned on any time you're in an interactive application.

#### Restrict alternate mouse scroll to vertical scrolling

When enabled, a horizontal scroll gesture will never send arrow keys when alternate mouse scroll is on.
```

### [95] iTerm2 doc : acces presse-papiers

URL : https://iterm2.com/documentation-preferences-general.html  (copie brute : tmp/scratch/terminal-research/raw/iterm-documentation-preferences-general.md, lignes 256-262)

```text
#### Applications in terminal may access clipboard

If enabled, clipboard access will be granted via escape code to programs running in iTerm2. They will be able to set the contents of the system pasteboard. For more details, see [Shell Integration Utilities](https://iterm2.com/documentation-utilities.html).

#### Allow sending of clipboard contents?

An app running in the terminal can request that the terminal transmit the clipboard contents to it. Since this is a security risk, it normally requires you to consent each time.
```

### [96] iTerm2 source : DECSET 1007 conditionne au reglage de profil

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 918-922)

```text
            case 1007:
                if (!mode || [self.delegate terminalAllowAlternateMouseScroll]) {
                    self.alternateScrollMode = mode;
                }
                break;
```

### [97] iTerm2 source : defauts de profil (alternate mouse scroll)

URL : https://github.com/gnachman/iTerm2/blob/master/sources/Settings/iTermProfilePreferences.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-pp.m, lignes 1193-1203)

```text
                  KEY_AUTOMATICALLY_ENABLE_ALTERNATE_MOUSE_SCROLL: @NO,
                  KEY_RESTRICT_ALTERNATE_MOUSE_SCROLL_TO_VERTICAL: @NO,
                  KEY_CHARACTER_ENCODING: @(NSUTF8StringEncoding),
                  KEY_TERMINAL_TYPE: @"xterm",
                  KEY_ANSWERBACK_STRING: @"",
                  KEY_XTERM_MOUSE_REPORTING: @NO,
                  KEY_XTERM_MOUSE_REPORTING_ALLOW_MOUSE_WHEEL: @YES,
                  KEY_XTERM_MOUSE_REPORTING_ALLOW_CLICKS_AND_DRAGS: @YES,
                  KEY_UNICODE_VERSION: @8,
                  KEY_ALLOW_TITLE_REPORTING: @NO,
                  KEY_ALLOW_ALTERNATE_MOUSE_SCROLL: @YES,
```

### [98] iTerm2 source : OSC 52 defaut @NO

URL : https://github.com/gnachman/iTerm2/blob/master/sources/Settings/iTermPreferences.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-pref.m, lignes 726-726)

```text
                  kPreferenceKeyAllowClipboardAccessFromTerminal: @NO,
```

### [99] iTerm2 source : DECRQM

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 2659-2660)

```text
        case VT100CSI_DECRQM_DEC:  // CSI ? Pd $ p
            if (_vtLevel >= iTermEmulationLevel300) {
```

### [100] iTerm2 source : 2026

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 1032-1034)

```text
            case 2026:
                // https://github.com/microsoft/terminal/issues/8331
                self.synchronizedUpdates = mode;
```

### [101] iTerm2 source : 1015

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 924-926)

```text
            case 1015:
                if (mode) {
                    self.mouseFormat = MOUSE_FORMAT_URXVT;
```

### [102] iTerm2 source : 1000/1002/1003/1006

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 884-887)

```text
            case 1000:
            // case 1001:
            // TODO: MOUSE_REPORTING_HIGHLIGHT not implemented.
            case 1002:
```

### [103] iTerm2 source : DSR 6 (CPR)

URL : https://github.com/gnachman/iTerm2/blob/master/sources/VT100/VT100Terminal.m  (copie brute : tmp/scratch/terminal-research/raw/iterm-vt.m, lignes 1318-1319)

```text
            case 6: { // Command from host -- Please report active position
                if (self.originMode) {
```

### [104] Apple : Terminal > Reglages > Profils > Clavier (Scroll alternate screen)

URL : https://support.apple.com/guide/terminal/trmlkbrd/mac  (copie brute : tmp/scratch/terminal-research/raw/apple-kbd.md, lignes 384-384)

```text
| Scroll alternate screen | To enable alternate screen scrolling, select “Scroll alternate screen.” |
```

### [105] Apple : Allow Mouse Reporting

URL : https://support.apple.com/guide/terminal/trmlc69728a5/mac  (copie brute : tmp/scratch/terminal-research/raw/apple-mouse.md, lignes 372-378)

```text
The Allow Mouse Reporting option controls whether mouse events are reported. By default, each new Terminal window has the Allow Mouse Reporting option selected.

When Allow Mouse Reporting is selected in Terminal and mouse reporting is enabled in an app running in Terminal, mouse events are reported to that app. If Allow Mouse Reporting is not selected in Terminal, mouse events are not reported, even if an application enables mouse reporting.

This option does not enable mouse reporting behavior, it just controls whether mouse reporting is allowed. Mouse reporting is enabled in an app, such as Vim, that runs in a Terminal window. In general, mouse reporting is not enabled in apps by default. For example, to enable mouse reporting in Vim, you need to add a set mouse=a command to your ~/.vimrc file.

[Open Terminal for me](x-help-action://openApp?bundleId=com.apple.Terminal)
```

### [106] JediTerm (moteur JetBrains) : modes DECSET traites

URL : https://github.com/JetBrains/jediterm/blob/master/core/src/com/jediterm/terminal/emulator/JediEmulator.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-emu.java, lignes 659-659)

```text
        case 1000:
```

### [107] JediTerm : 1005/1006

URL : https://github.com/JetBrains/jediterm/blob/master/core/src/com/jediterm/terminal/emulator/JediEmulator.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-emu.java, lignes 691-703)

```text
        case 1005:
          if (enabled) {
            myTerminal.setMouseFormat(MouseFormat.MOUSE_FORMAT_XTERM_EXT);
          } else {
            myTerminal.setMouseFormat(MouseFormat.MOUSE_FORMAT_XTERM);
          }
          return true;
        case 1006:
          if (enabled) {
            myTerminal.setMouseFormat(MouseFormat.MOUSE_FORMAT_SGR);
          } else {
            myTerminal.setMouseFormat(MouseFormat.MOUSE_FORMAT_XTERM);
          }
```

### [108] JediTerm : 2026

URL : https://github.com/JetBrains/jediterm/blob/master/core/src/com/jediterm/terminal/emulator/JediEmulator.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-emu.java, lignes 721-727)

```text
        case 2026:
          if (enabled) {
            SynchronizedOutput syncOutput = new SynchronizedOutput(myDataStream, myTerminal);
            syncOutput.await();
          }
          return true;
        case 9001:
```

### [109] JediTerm : Maj = action locale (selection)

URL : https://github.com/JetBrains/jediterm/blob/master/ui/src/com/jediterm/terminal/ui/TerminalPanel.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-panel.java, lignes 452-459)

```text
  public boolean isLocalMouseAction(MouseEvent e) {
    return mySettingsProvider.forceActionOnMouseReporting() || (isMouseReporting() == e.isShiftDown());
  }

  public boolean isRemoteMouseAction(MouseEvent e) {
    return isMouseReporting() && !e.isShiftDown();
  }

```

### [110] JediTerm : molette = defilement de la barre

URL : https://github.com/JetBrains/jediterm/blob/master/ui/src/com/jediterm/terminal/ui/TerminalPanel.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-panel.java, lignes 362-368)

```text
  protected void handleMouseWheelEvent(@NotNull MouseWheelEvent e, @NotNull JScrollBar scrollBar) {
    if (e.isShiftDown() || e.getUnitsToScroll() == 0 || Math.abs(e.getPreciseWheelRotation()) < 0.01) {
      return;
    }
    moveScrollBar(e.getUnitsToScroll());
    e.consume();
  }
```

### [111] JediTerm : defilement desactive en alt buffer

URL : https://github.com/JetBrains/jediterm/blob/master/ui/src/com/jediterm/terminal/ui/TerminalPanel.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-panel.java, lignes 1671-1671)

```text
    myScrollingEnabled = !useAlternateScreenBuffer;
```

### [112] JediTerm : DSR (DEC-specifique refuse ; 6 = CPR)

URL : https://github.com/JetBrains/jediterm/blob/master/core/src/com/jediterm/terminal/emulator/JediEmulator.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-emu.java, lignes 769-785)

```text
  private boolean deviceStatusReport(ControlSequence args) {
    if (args.startsWithQuestionMark()) {
      LOG.warn("Don't support DEC-specific Device Report Status");
      return false;
    }
    int c = args.getArg(0, 0);
    if (c == 5) {
      String str = "\033[0n";
      LOG.debug("Sending Device Report Status : " + str);
      myTerminal.deviceStatusReport(str);
      return true;
    } else if (c == 6) {
      int row = myTerminal.getCursorY();
      int column = myTerminal.getCursorX();

      if (myTerminal instanceof JediTerminal && ((JediTerminal) myTerminal).isOriginMode()) {
        row -= (((JediTerminal) myTerminal).getScrollRegionTop() - 1);
```

### [113] can-i-use-terminal (source SECONDAIRE, contribution communautaire) : OSC 52 set, ligne Terminal.app

URL : https://can-i-use-terminal.github.io/features/osc52copy.html  (copie brute : tmp/scratch/terminal-research/raw/ciut-osc52.md, lignes 129-131)

```text
[Terminal.app](https://can-i-use-terminal.github.io/terminals/terminal_macos.html)Not created

Not created Not supported
```

### [114] JediTerm : CSI p (DECSTR seulement, pas de DECRQM)

URL : https://github.com/JetBrains/jediterm/blob/master/core/src/com/jediterm/terminal/emulator/JediEmulator.java  (copie brute : tmp/scratch/terminal-research/raw/jedi-emu.java, lignes 512-516)

```text
        if (args.startsWithExclamationMark()) {
          // DECSTR (Soft Terminal Reset) https://vt100.net/docs/vt510-rm/DECSTR.html
          myTerminal.reset(false);
          return true;
        }
```

### [115] kitty : DSR 6 (CPR)

URL : https://github.com/kovidgoyal/kitty/blob/master/kitty/screen.c  (copie brute : tmp/scratch/terminal-research/raw/kitty-screen.c, lignes 3243-3245)

```text
        case 6: // cursor position
            x = self->cursor->x;
            y = self->cursor->y;
```

### [116] Alacritty : DECSET 1000/1002/1003/1006/1005/1007 (set)

URL : https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/term/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/ala-mod.rs, lignes 1954-1984)

```text
            NamedPrivateMode::ReportMouseClicks => {
                self.mode.remove(TermMode::MOUSE_MODE);
                self.mode.insert(TermMode::MOUSE_REPORT_CLICK);
                self.event_proxy.send_event(Event::MouseCursorDirty);
            },
            NamedPrivateMode::ReportCellMouseMotion => {
                self.mode.remove(TermMode::MOUSE_MODE);
                self.mode.insert(TermMode::MOUSE_DRAG);
                self.event_proxy.send_event(Event::MouseCursorDirty);
            },
            NamedPrivateMode::ReportAllMouseMotion => {
                self.mode.remove(TermMode::MOUSE_MODE);
                self.mode.insert(TermMode::MOUSE_MOTION);
                self.event_proxy.send_event(Event::MouseCursorDirty);
            },
            NamedPrivateMode::ReportFocusInOut => self.mode.insert(TermMode::FOCUS_IN_OUT),
            NamedPrivateMode::BracketedPaste => self.mode.insert(TermMode::BRACKETED_PASTE),
            // Mouse encodings are mutually exclusive.
            NamedPrivateMode::SgrMouse => {
                self.mode.remove(TermMode::UTF8_MOUSE);
                self.mode.insert(TermMode::SGR_MOUSE);
            },
            NamedPrivateMode::Utf8Mouse => {
                self.mode.remove(TermMode::SGR_MOUSE);
                self.mode.insert(TermMode::UTF8_MOUSE);
            },
            NamedPrivateMode::AlternateScroll => self.mode.insert(TermMode::ALTERNATE_SCROLL),
            NamedPrivateMode::LineWrap => self.mode.insert(TermMode::LINE_WRAP),
            NamedPrivateMode::Origin => {
                self.mode.insert(TermMode::ORIGIN);
                self.goto(0, 0);
```

### [117] WezTerm : CSI 6 n (RequestActivePositionReport)

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-ts.rs, lignes 2666-2667)

```text
            Cursor::RequestActivePositionReport => {
                let line = OneBased::from_zero_based(
```

### [118] WezTerm : DECRQM (QueryDecPrivateMode) existe pour la souris

URL : https://github.com/wezterm/wezterm/blob/main/term/src/terminalstate/mod.rs  (copie brute : tmp/scratch/terminal-research/raw/wez-ts.rs, lignes 1887-1890)

```text
            Mode::QueryDecPrivateMode(DecPrivateMode::Code(DecPrivateModeCode::MouseTracking)) => {
                self.decqrm_response(mode, true, self.mouse_tracking);
            }

```

### [119] xterm.js InputHandler : OSC 52 en commentaire, sans handler dans le coeur

URL : https://github.com/xtermjs/xterm.js/blob/master/src/common/InputHandler.ts  (copie brute : tmp/scratch/terminal-research/raw/xj-ih.ts, lignes 315-316)

```text
    //  52 - Manipulate Selection Data.
    // 104 ; c - Reset Color Number c.
```

### [120] tmux : DECSET (set) 1000/1002/1003/1005/1006 (pas de 1007/1015)

URL : https://github.com/tmux/tmux/blob/master/input.c  (copie brute : tmp/scratch/terminal-research/raw/tmux-input.c, lignes 2052-2073)

```text
			screen_write_mode_clear(sctx, ALL_MOUSE_MODES);
			screen_write_mode_set(sctx, MODE_MOUSE_STANDARD);
			break;
		case 1002:
			screen_write_mode_clear(sctx, ALL_MOUSE_MODES);
			screen_write_mode_set(sctx, MODE_MOUSE_BUTTON);
			break;
		case 1003:
			screen_write_mode_clear(sctx, ALL_MOUSE_MODES);
			screen_write_mode_set(sctx, MODE_MOUSE_ALL);
			break;
		case 1004:
			screen_write_mode_set(sctx, MODE_FOCUSON);
			break;
		case 1005:
			screen_write_mode_set(sctx, MODE_MOUSE_UTF8);
			break;
		case 1006:
			screen_write_mode_set(sctx, MODE_MOUSE_SGR);
			break;
		case 47:
		case 1047:
```
