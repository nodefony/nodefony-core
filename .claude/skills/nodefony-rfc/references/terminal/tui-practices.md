# Pratiques des TUI : souris captée, sélection, copie, molette

Relevé du 2026-10-05. Chaque affirmation porte une source numérotée `[n]` (URL + extrait verbatim, en anglais car cité tel quel). Une case sans source s'écrit « Inconnu ».
Les extraits ont été lus dans les fichiers bruts (raw GitHub, API `gh`, pages officielles), jamais reconstitués de mémoire.

---

## 1. tmux

- **Défaut** : souris NON captée. Option `mouse` désactivée par défaut (le manuel dit seulement « If on, tmux captures the mouse » [1] ; la valeur par défaut « off » n'est pas écrite dans l'extrait lu : Inconnu en citation directe, mais la FAQ [2] parle de « leave the mouse off »).
- **Sélection** : avec `mouse on`, tmux reçoit tout (« all or nothing » [2]) et fournit son propre copy-mode ; le contournement vers la sélection native du terminal est une touche modificatrice (Shift sous la plupart des terminaux Linux, Option sous iTerm2) [2].
- **Copie** : OSC 52 via l'option `set-clipboard` (défaut `external`) [3], ou pipe vers un outil (`copy-command`) [4].
- **Molette** : dépend de `mouse on` (événements WheelUp/WheelDown liés comme touches) [1].
- **Raison donnée** : l'impossibilité d'un partage fin entre application et terminal [2].

Sources
- [1] https://raw.githubusercontent.com/tmux/tmux/master/tmux.1 — « If on, tmux captures the mouse and allows mouse events to be bound as key bindings. » ; « The following mouse events are available: … WheelUp / WheelDown … MouseDown1 MouseUp1 MouseDrag1 MouseDragEnd1 … DoubleClick1 … TripleClick1 ».
- [2] https://raw.githubusercontent.com/wiki/tmux/tmux/FAQ.md — « Terminals do not offer fine-grained mouse support - tmux can either turn on the mouse and receive all mouse events (clicks, scrolling, everything) or it can leave the mouse off and receive no events. » ; « However, when an application turns on the mouse, most terminals provide a way to bypass it. On many Linux terminals this is holding down the `Shift` key; for iTerm2 it is the `option` key. »
- [3] https://raw.githubusercontent.com/wiki/tmux/tmux/Clipboard.md — « The `set-clipboard` option must be set to `on` or `external`. The default is `external`. » ; « The big advantage of this is that it works over an *ssh(1)* connection even if X11 forwarding is not configured. The disadvantages are that it is patchily supported and can be tricky to configure. » ; « any application running inside tmux can create a tmux paste buffer and set the system clipboard » (avec `on`) ; iTerm2 : « it has to be enabled from the preferences » ; VTE : « VTE terminals (GNOME terminal, XFCE terminal, Terminator) do not support the OSC 52 escape sequence » (affirmation de la page tmux, non revérifiée sur les versions récentes de VTE) ; st : « versions before 0.8.3 have a length limit ».
- [4] tmux.1 (même fichier que [1]) — « copy-command shell-command : Give the command to pipe to if the copy-pipe copy mode command is used without arguments. »
- [5] tmux.1 — `set-clipboard [on | external | off]` : « Attempt to set the terminal clipboard content using the xterm(1) escape sequence, if there is an Ms entry in the terminfo(5) description » ; et `allow-passthrough` : « Allow programs in the pane to bypass tmux using a terminal escape sequence (\ePtmux;...\e\e\\). If set to on, passthrough sequences will be allowed only if the pane is visible. »

## 2. GNU screen

- **Défaut** : ne capte pas la souris pour elle-même : `mousetrack` vaut off par défaut [6].
- **Sélection / copie / molette** : Inconnu (le manuel lu ne décrit pas la sélection native sous screen). Note : le même manuel recense les modes `?9`, `?1000` parmi les séquences que screen sait relayer/émuler (tableau des modes de la section « Control Sequences »).
- **Raison** : Inconnu.
- Écueil relevé ailleurs : sous screen, une copie OSC 52 longue s'affiche en base64 dans la fenêtre (voir §17, Claude Code [57]).

Sources
- [6] https://r.jina.ai/https://www.gnu.org/software/screen/manual/screen.html — « This command determines whether screen will watch for mouse clicks. When this command is enabled, regions that have been split in various ways can be selected by pointing to them with a mouse and left-clicking them. » ; « defmousetrack on|off … This command determines the default state of the mousetrack command, currently defaulting of off. »

## 3. vim

- **Défaut** : `mouse` vaut `""` (vide) par défaut ; `"a"` pour GUI et Win32 ; `defaults.vim` le pose à `"a"` ou `"nvi"` [7].
- **Sélection** : en xterm, un clic normal va à vim, un clic avec Shift ou Ctrl va au terminal [8]. Si le terminal ne sait pas contourner : `mouse=nvi`, puis `:` pour sortir du mode souris et sélectionner pour le système [7].
- **Copie** : sélection native du terminal, ou registres vim (`xterm-clipboard`) [8].
- **Molette** : gérée par vim quand le mode est inclus dans `mouse` ; sinon va au terminal [8].
- **Raison** : le choix par mode (`n v i c h a r`) existe précisément pour laisser des modes à la sélection système [7].

Sources
- [7] https://raw.githubusercontent.com/vim/vim/master/runtime/doc/options.txt — « 'mouse' string (default "", "a" for GUI and Win32, set to "a" or "nvi" in |defaults.vim|) » ; « If your terminal can't overrule the mouse events going to the application, use: :set mouse=nvi — Then you can press ":", select text for the system, and press Esc to go back to Vim using the mouse events. »
- [8] https://raw.githubusercontent.com/vim/vim/master/runtime/doc/term.txt — « In an xterm, with the currently active mode included in the 'mouse' option, normal mouse clicks are used by Vim, mouse clicks with the shift or ctrl key pressed go to the xterm. With the currently active mode not included in 'mouse' all mouse clicks go to the xterm. »

## 4. neovim

- **Défaut** : `mouse` = `"nvi"` [9] (souris captée en modes normal, visuel, insertion ; pas en ligne de commande).
- **Sélection** : « To temporarily disable mouse support, hold the shift key while using the mouse. » [9]
- **Copie** : sélection du terminal avec Shift, ou clipboard neovim : Inconnu pour le détail (non lu).
- **Raison** : Inconnu au-delà du texte de l'option.

Source
- [9] https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/options.txt — « 'mouse' string (default "nvi") … Enables mouse support. … To temporarily disable mouse support, hold the shift key while using the mouse. »

## 5. less

- **Défaut** : souris NON captée ; `--mouse` est opt-in [10]. Donc sélection native intacte par défaut.
- **Molette** : avec `--mouse`, la molette fait défiler (`vscroll`), `--wheel-lines=n` règle le pas (1 par défaut) [10].
- **Plateformes** : « Mouse input works only on terminals which support X11 mouse reporting, and on Windows. » [10]
- **Raison** : Inconnu (pas de justification dans la page). Observation sans source de raison : less utilise l'écran alternatif, et la molette y fonctionne souvent par le mode 1007 du terminal (voir §22 Windows Terminal [W1]).

Source
- [10] https://raw.githubusercontent.com/gwsw/less/master/less.nro.VER — « Enabling --mouse is the same as --emouse=vmove,click. Disabling --mouse is the same as --emouse=-. » ; « --wheel-lines=n : Set the number of lines or columns to scroll when the mouse wheel is scrolled and the --mouse or --emouse option is in effect. The default is 1 line or column. » ; « Mouse input works only on terminals which support X11 mouse reporting, and on Windows. »

## 6. htop

- **Défaut** : souris activée (option de désactivation `-M`) [11].
- **Sélection / copie / molette** : Inconnu (la page ne les traite pas).
- **Raison** : Inconnu.

Source
- [11] https://raw.githubusercontent.com/htop-dev/htop/main/htop.1.in — « -M --no-mouse : Disable support of mouse control » (l'existence de l'interrupteur de désactivation implique l'activation par défaut ; la page ne dit pas « par défaut »).

## 7. btop

- **Défaut** : « Full mouse support » annoncé [12].
- **Sélection / copie** : Inconnu (la copie du processus choisi est une demande fermée, #496, non lue).
- **Molette** : « mouse scrolling works in process list and menu boxes » [12].
- **Raison** : Inconnu.

Source
- [12] https://raw.githubusercontent.com/aristocratos/btop/main/README.md — « Full mouse support: all buttons with a highlighted key are clickable and mouse scrolling works in process list and menu boxes. »

## 8. Midnight Commander

- **Défaut** : souris active dans xterm ; option `-d / --nomouse` pour la couper [13].
- **Sélection** : « you can get the default mouse behavior (cutting and pasting text) by holding down the Shift key » [13] ; idem dans l'éditeur [13].
- **Copie** : sélection native avec Shift ; presse-papiers propre à mcedit (`mcedit.clip`) : Inconnu pour les détails.
- **Molette** : gérée par mc quand la souris est active ; vitesse figée (2 lignes viewer/éditeur, 1 ailleurs, selon un commentaire d'issue Windows Terminal [W4]).
- **Raison** : Inconnu au-delà de la description.

Source
- [13] https://raw.githubusercontent.com/MidnightCommander/mc/master/doc/man/mc.1.in — « -d, --nomouse : Disable mouse support. » ; « If you are running Midnight Commander with the mouse support, you can get the default mouse behavior (cutting and pasting text) by holding down the Shift key. » ; « -g, --oldmouse : Force a "normal tracking" mouse mode. Used when running on xterm-capable terminals (tmux/screen). »

## 9. lazygit

- **Défaut** : souris captée (`mouseEvents: true`) [14].
- **Sélection** : plus difficile ; Option sous macOS [14].
- **Copie / molette** : Inconnu (copie interne non lue).
- **Raison** : l'auteur annonce le compromis dans la config elle-même [14].

Source
- [14] https://raw.githubusercontent.com/jesseduffield/lazygit/master/docs/Config.md — « If true, capture mouse events. When mouse events are captured, it's a little harder to select text: e.g. requiring you to hold the option key when on macOS. mouseEvents: true »

## 10. k9s

- **Défaut** : souris DÉSACTIVÉE (`enableMouse: false`) [15].
- **Historique de la décision** : la prise en charge de la souris a d'abord été livrée sans interrupteur, a cassé la sélection, puis a été rendue opt-in [16].
- **Sélection** : Shift+clic en contournement (rapporté sous Windows Terminal) [16].
- **Raison** : le mainteneur reconnaît l'erreur de conception [16].

Sources
- [15] https://raw.githubusercontent.com/derailed/k9s/master/README.md — « # Enable mouse support. Default false / enableMouse: false »
- [16] https://github.com/derailed/k9s/issues/874 « Latest version broke selecting text by mouse » — « Not possible to select text (i.e. value form a list or some string in the log output) with just the mouse. We use this a lot to select and copy relevant information » ; commentaire : « Workaround is Shift+Click, here (with Windows Terminal). If we can't have both navigation and selection with clicks, an option to have the previous behavior would be nice » ; mainteneur (derailed) : « Should know better when introducing a new feature to make sure one can turn it off... »

## 11. bubbletea (Go)

- **Défaut** : souris NON captée ; opt-in via `WithMouseCellMotion()` / `WithMouseAllMotion()` (v1) ou `View.MouseMode` (v2, valeur zéro `MouseModeNone`) [17][18].
- **Sélection** : la doc de l'issue officielle dit que la sélection native est perdue quand la souris est captée ; la solution annoncée est « implement text selection in Bubble Tea » comme tmux [19].
- **Copie** : pas de mécanisme intégré lu ; patron communautaire (voir §23) [19].
- **Molette** : via les événements `MouseWheelUp/Down` quand un mode souris est actif [17].
- **Raison** : « a limitation of pretty much all terminals » [19].

Sources
- [17] https://raw.githubusercontent.com/charmbracelet/bubbletea/v1.3.10/options.go — « WithMouseCellMotion … This will try to enable the mouse in extended mode (SGR), if that is not supported by the terminal it will fall back to normal mode (X10). … The mouse will be automatically disabled when the program exits. »
- [18] https://raw.githubusercontent.com/charmbracelet/bubbletea/main/tea.go (v2) — « MouseModeNone disables mouse events. » ; « MouseModeCellMotion enables mouse click, release, and wheel events. Mouse movement events are also captured if a mouse button is pressed (i.e., drag events). Cell motion mode is better supported than all motion mode. »
- [19] https://github.com/charmbracelet/bubbletea/issues/162 « Allow both native text selection and mouse wheel scrolling » — « when the mouse is enabled in a terminal native text selection is no longer possible. It's a limitation of pretty much all terminals. The plan is to implement text selection in Bubble Tea to overcome this limitation (similar to how it's done in tmux) however it will take some time » (meowgorithm, 2021-11-25) ; 2025-08 : « Claude Code is different because it uses the default terminal buffer which already allows for native mouse interaction for scrolling and text selection (it doesn't load into an alternate full screen buffer like Vim or tmux). I did see that this functionality landed in Charm's TUI coding agent, Crush so I assume that it could be ported into Bubble Tea » (pmarsceill) ; 2026-08-25 : « This essentially disables scrolling and enables selection while mouse click is pressed down and enables scrolling and disables selection while mouse click is released … We should automatically copy the text selected during this duration, since scrolling removes the selection. In my opinion such a weird UX cant be a default in the framework itself. » (t3snake). L'issue est toujours ouverte.

## 12. Textual (Python)

- **Défaut** : souris captée ; sélection de texte INTÉGRÉE dans l'application (clic-glisser dans les widgets, `ALLOW_SELECT = True`), copie par Ctrl+C [20][21].
- **Copie** : `App.copy_to_clipboard` écrit une séquence OSC 52 (`\x1b]52;c;<base64>\a`) ; la docstring prévient « This does not work on macOS Terminal, but will work on most other terminals. » [21]
- **Contournement natif** : touche modificatrice — iTerm : Option ; Gnome Terminal : Shift ; Windows Terminal : Shift [20].
- **Raison** : arbitrage assumé « sélection dans l'application » ; la FAQ renvoie vers le terminal pour les widgets qui n'ont pas encore la sélection [20].

Sources
- [20] https://raw.githubusercontent.com/Textualize/textual/main/docs/FAQ.md — « Textual supports text selection for most widgets, via click and drag. Press ctrl+c to copy. For widgets that don't yet support text selection, you can try and use your terminal's builtin support. Most terminal emulators offer a modifier key which you can hold while you click and drag … iTerm Hold the OPTION key. Gnome Terminal Hold the SHIFT key. Windows Terminal Hold the SHIFT key. »
- [21] https://raw.githubusercontent.com/Textualize/textual/main/src/textual/app.py — `ALLOW_SELECT: ClassVar[bool] = True` « A switch to toggle arbitrary text selection for the app. » ; `copy_to_clipboard` : « !!! note This does not work on macOS Terminal, but will work on most other terminals. » ; `base64_text = base64.b64encode(text.encode("utf-8")).decode("utf-8")` puis `self._driver.write(f"\x1b]52;c;{base64_text}\a")` ; `ENABLE_SELECT_AUTO_SCROLL`, `SELECT_AUTO_SCROLL_LINES = 3` (défilement automatique en bord de sélection).

## 13. ratatui / crossterm (Rust)

- **Défaut** : souris NON captée. « Mouse and focus events are not enabled by default. You have to enable them with the EnableMouseCapture … command. » [22]
- **Ce qu'écrit `EnableMouseCapture`** : `?1000h`, `?1002h`, `?1003h` (tous les mouvements), puis le mode SGR `?1006h` (et RXVT) [23].
- **Sélection** : perdue une fois capturée ; l'issue ratatui #985 la demande, sans décision lue [24].
- **Copie / raison** : Inconnu.

Sources
- [22] https://raw.githubusercontent.com/crossterm-rs/crossterm/master/src/event.rs — « Mouse and focus events are not enabled by default. »
- [23] même fichier — `EnableMouseCapture::write_ansi` : « // Normal tracking: Send mouse X & Y on button press and release csi!("?1000h"), // Button-event tracking: Report button motion events (dragging) csi!("?1002h"), // Any-event tracking: Report all motion events csi!("?1003h"), // RXVT mouse mode … » ; la désactivation émet `?1006l ?1003l ?1002l ?1000l`.
- [24] https://github.com/ratatui/ratatui/issues/985 « Make the rendered text on the terminal copyable » — « In ratatui apps (e.g. example app 'table'), I can't select any text, so it is not very useful as a lightweight admin interface where texts need to be copy-able easily. » (la demande renvoie au projet gitu, qui implémente une sélection propre). Mainteneur : « there's lots of different ways to interpret "copying" ».

## 14. Ink (React/Node)

- **Défaut** : écran alternatif en opt-in (`alternateScreen: true`) ; la doc rappelle que le scrollback n'est pas disponible dans l'écran alternatif [25]. Souris : l'API expose des positions d'éléments « to compare with mouse events » [25] ; défaut de capture : Inconnu.
- **Sélection** : débat ouvert. Le PR #980 (fermé non fusionné) détaille pourquoi écran alternatif + défilement virtuel cassent la sélection native ; le PR #984 (« getFrameController() for application-owned text selection ») propose un pont minimal pour que l'application implémente SA sélection [26].
- **Copie** : Inconnu (rien d'intégré lu).

Sources
- [25] https://raw.githubusercontent.com/vadimdemedes/ink/master/readme.md — « Render the app in the terminal's alternate screen buffer. … This is the same mechanism used by programs like vim, htop, and less. Note: The terminal's scrollback buffer is not available while in the alternate screen. »
- [26] https://github.com/vadimdemedes/ink/pull/980 — « Alternate-screen mode and virtual scrolling together break text selection, which is a basic user expectation: 1. The scrollback buffer is empty. … 2. Virtual scrolling means the full content is never on screen. … 3. Ink's render pipeline is opaque to the application. » ; https://github.com/vadimdemedes/ink/pull/984 — « a small, opt-in, read-only frame controller for apps that own their alternate-screen viewport and implement selection themselves ».

## 15. Claude Code CLI (Anthropic)

- **Défaut** : deux rendus. Le rendu plein écran (écran alternatif) capte la souris ; sélection DANS l'application, copie automatique au relâchement [27]. Désactivation : `CLAUDE_CODE_DISABLE_MOUSE=1` (garde le rendu, perd molette/clics) ; `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` (garde la molette) [27]. Séquences activées observées par un tiers : `?1000h ?1006h ?1049h` [28].
- **Sélection** : glisser, double-clic mot (frontières iTerm2, un chemin = une unité, une URL entière), triple-clic ligne ; Shift+flèches pour étendre au clavier [27].
- **Copie** : `pbcopy` (macOS), `wl-copy` (Wayland) ou `xclip`/`xsel` (X11, écrit aussi PRIMARY), PowerShell `Set-Clipboard` (Windows et WSL) ; dans tmux écrit aussi le tampon tmux ; sous SSH repli sur OSC 52 [27].
- **Molette** : iTerm2 exige « Enable mouse reporting » ; sous tmux exige `set -g mouse on` [27].
- **Sélection native** : touche selon terminal — Terminal.app : `Fn` ; iTerm2 : `Option` ; VS Code : `Shift` ; autres : `Shift` [27].
- **Raison** : sans flicker, mémoire plate, souris ; et la doc admet que « Mouse capture is the most common friction point, especially over SSH or inside tmux » [27].
- **Écueils signalés** : OSC 52 annoncé réussi alors que VTE (GNOME Terminal) l'ignore [28] ; capture par défaut critiquée comme silencieuse sur Terminal.app [29] ; iTerm2 bloque OSC 52 par défaut [27].

Sources
- [27] https://code.claude.com/docs/en/fullscreen.md — « It draws the interface on the terminal's alternate screen buffer, like `vim` or `htop` » ; « Terminal's native click-and-drag to select and copy → In-app selection, copies automatically on mouse release » ; « Selected text copies to your clipboard automatically on mouse release. » ; « Mouse capture is the most common friction point, especially over SSH or inside tmux. When Claude Code captures mouse events, your terminal's native copy-on-select stops working. The selection you make with click-and-drag exists inside Claude Code, not in your terminal's selection buffer » ; « macOS: `pbcopy` · Linux: `wl-copy` on Wayland, or `xclip` or `xsel` on X11 … Claude Code writes both the clipboard and the PRIMARY selection · Windows and WSL: PowerShell `Set-Clipboard` » ; « Inside tmux it also writes to the tmux paste buffer. Over SSH it falls back to OSC 52 escape sequences. Inside GNU screen … if you copied a selection longer than roughly 570 characters, GNU screen printed base64 text into the window instead. » ; « Some terminals block OSC 52 by default. iTerm2 blocks it until you turn on Settings → General → Selection → Applications in terminal may access clipboard » ; « Terminal.app: `Fn` · iTerm2: `Option` · VS Code, Cursor, and Devin Desktop: `Shift` … · Most other terminals: `Shift` » ; « the terminal mouse protocol has no way to encode the `Cmd` key » ; « `CLAUDE_CODE_NO_FLICKER=1 CLAUDE_CODE_DISABLE_MOUSE=1 claude` ».
- [28] https://github.com/anthropics/claude-code/issues/93147 — « Claude enables `?1000h` / `?1006h`. A normal click-drag is delivered to Claude rather than creating a terminal selection. … Holding `Shift` bypasses this and produces a real VTE selection, but VTE does not autoscroll on a Shift-modified drag, so the selection is capped at the visible screen. » ; « OSC 52 copy reports success even when the terminal discards it … GNOME Terminal / VTE does not implement OSC 52 » (test : gnome-terminal VTE 0.80.1 « unchanged — discarded », kitty 0.41.1 « set correctly ») ; « The alternate screen keeps output out of scrollback ».
- [29] https://github.com/anthropics/claude-code/issues/71826 « Mouse capture is on by default and silently breaks native terminal copy » — « Default mouse capture to off, opt-in for those who want wheel-scroll/click. » (fermé par inactivité, sans décision).

## 16. OpenAI Codex CLI

- **Défaut** : depuis 0.157.0, plein écran avec capture de souris (issue #48044 et #50370, version 0.160.0) ; retour au mode « scrollback » par `/tui` ; `tui.alternate_screen = "never"` restaure sélection native [30][31].
- **Décision du mainteneur** : à la demande « Mouse capture must be opt-in », réponse « If you prefer the older behavior, you can switch to scrollback mode using `/tui`. » — donc pas de changement de défaut [30].
- **Réglage documenté** : `tui.alternate_screen` : `auto | always | never` ; « default: auto; auto skips it in Zellij to preserve scrollback » [31].
- **Copie / molette / raison** : Inconnu (pas de doc officielle sur la souris lue).

Sources
- [30] https://github.com/openai/codex/issues/50370 « TUI: mouse capture must be opt-in, never enabled or enforced by default » — « After the fullscreen behavior became active, ordinary terminal interaction regressed: selection and scrollback no longer behaved like the native terminal, and the TUI owned pointer events. » ; « The verified workaround was: [tui] alternate_screen = "never" » ; etraut-openai : « If you prefer the older behavior, you can switch to scrollback mode using `/tui`. » ; https://github.com/openai/codex/issues/48044 (« 0.157.0 fullscreen default breaks middle-click primary-selection paste », fermé).
- [31] https://developers.openai.com/codex/config-reference.md — « tui.alternate_screen : auto | always | never — Control alternate screen usage for the TUI (default: auto; auto skips it in Zellij to preserve scrollback). »

## 17. Google gemini-cli

- **Défaut** : écran alternatif désactivé (`ui.useAlternateBuffer` = `false`) ; OSC 52 optionnel (`experimental.useOSC52Copy`) [32].
- **Historique** : en v0.15.0 la capture souris a été activée dès que l'écran alternatif l'était, et a cassé sélection et copie ; l'issue de conception admet le compromis [33][34].
- **Décision** : le PR « native text selection » (#13048) a été fermé sans fusion ; le PR « mouse interaction toggle » (#13875) idem (fermé) ; l'issue #13033 (fermée) expose le dilemme ; la voie retenue côté produit est lue dans la doc seulement par le réglage `useAlternateBuffer` = false [32][33].
- **Sélection** : mode « copy mode » au clavier (Ctrl+S) évoqué dans les issues [33].

Sources
- [32] https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/settings.md — « Use Alternate Screen Buffer | `ui.useAlternateBuffer` | Use an alternate screen buffer for the UI, preserving shell history. | `false` » ; « Use OSC 52 Copy | `experimental.useOSC52Copy` | Use OSC 52 for copying. This may be more robust than the default system when using remote terminal sessions (if your terminal is configured to allow it). »
- [33] https://github.com/google-gemini/gemini-cli/issues/13033 — « To support scroll wheel based scrolling well in alternate buffer mode we have to listen for mouse events which unfortunately means we cannot allow users to copy and paste normally due to terminal restrictions. » ; « Users are confused about how to select text with the new UI and the current experience is cumbersome with a ctrl-S shortcut just to enter selection mode. »
- [34] https://github.com/google-gemini/gemini-cli/pull/13875 — « v0.15.0 broke native terminal text selection and copy/paste for 17+ users by unconditionally enabling mouse event capture when alternate buffer mode is active. » ; https://github.com/google-gemini/gemini-cli/issues/13264 « gemini-cli hijacks the mouse, rendering it unusable » — « selecting 'Login with Google' - trying to copy and paste the URL. But gemini-cli already disabled the mouse. Selection with 'shift' does not work too. »

## 18. opencode

- **Défaut** : souris captée (`enableMouse()` dans le moteur de rendu), sélection DANS l'application avec copie au relâchement (copy-on-select) par OSC 52 [35].
- **Interrupteurs** : `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT=1` ne coupe PAS la capture ; `tui.json` `"mouse": false` existe selon une issue, avec une régression où la molette devient des flèches (historique du prompt) [35].
- **Écueils** : OSC 52 sous multiplexeur/SSH, message « copied » faux [36] ; mojibake UTF-8 sur texte japonais à la copie [37] ; demande d'option `copy_on_select` [38].
- **Raison** : Inconnu (pas de justification officielle lue ; les trois issues sont des demandes d'utilisateurs).

Sources
- [35] https://github.com/anomalyco/opencode/issues/36266 « Toggle to disable mouse tracking in the TUI » — « OpenCode's TUI captures mouse input by default (`enableMouse()` in the renderer setup). On selection it tries to write to the clipboard via OSC52 (`console.onCopySelection`). » ; « macOS Terminal.app only gained OSC52 support in macOS Sonoma 14.4 / Terminal 2.13 » (affirmation de l'auteur de l'issue, non vérifiée par une source Apple) ; commentaire bot : « #35295: Suggests that a `"mouse": false` setting in `tui.json` already exists, but has a bug where wheel events fall back to arrow keys and trigger prompt-history navigation ».
- [36] https://github.com/anomalyco/opencode/issues/15907 « Clipboard copy not working over SSH + tmux in Ghostty » — « OpenCode's copy function shows "copied to clipboard" notification but doesn't actually update the system clipboard » ; doublon cité : « #12082: Clipboard copy fails in Zellij and other multiplexers (OSC52 written to stdout instead of /dev/tty) ».
- [37] https://github.com/anomalyco/opencode/issues/30068 « Copying Japanese text from chat output results in mojibake (UTF-8 misinterpreted as Latin1) » (commentaire final : « This appears to be a VS Code Terminal / OSC52 issue rather than an OpenCode issue. »).
- [38] https://github.com/anomalyco/opencode/issues/10490 « Add config option to disable copy-on-select behavior » — « OC implements "XTerm / GPM"-style copy-on-select … I'm aware that in e.g. Ghostty's config I can set `mouse-shift-capture = never` to make shift+click always selects text, without notifying the app ».

## 19. Warp

- **Défaut** : reporting de la souris aux applications plein écran activé (`mouse_reporting_enabled` = true, selon un résultat de recherche non relu à la source) ; menu `Settings > Features > Terminal > Enable Mouse Reporting` [39].
- **Sélection** : « If you want a mouse event to go to Warp instead (for example, for text selection) without disabling mouse reporting, you can hold the `Shift` key. » [39]
- **Molette** : « Mouse reporting must be enabled to also toggle scroll reporting. » [39]
- **Raison** : Inconnu au-delà de la doc.

Source
- [39] https://docs.warp.dev/terminal/more-features/full-screen-apps/ — « Warp supports configuring how to handle mouse and scroll events. They can be sent to the currently running app, e.g. `vim`, or kept and handled by Warp. » ; « Once mouse reporting is enabled, Warp will use ANSI escape sequences to communicate mouse events to the running app. »

## 20. GitHub Copilot CLI (ajouté : exemple cité par la demande)

- **Défaut** : capture souris active dans l'écran alternatif ; Terminal.app oblige à `Fn` pour sélectionner ; `--no-alt-screen` a été retiré en 1.0.12, remplacé par `--no-mouse` / `mouse: false` et `copyOnSelect` (par défaut true sous macOS) [40].
- **Raison** : décision de produit en réponse à l'issue #2384 : réglage souris séparé de l'écran alternatif [40].

Source
- [40] https://github.com/github/copilot-cli/issues/2384 — « In Terminal.app on macos, mouse selection can't be copied with alt-screen - and the --no-alt-screen is remove in 1.0.12 » ; réponse : « This should be resolved with the `--no-mouse` flag or `mouse: false` config option, available since v0.0.419. Using either disables TUI mouse capture and restores native terminal selection in Terminal.app. Alternatively, `copyOnSelect` (which defaults to true on macOS) should auto-copy text selected within the TUI to your clipboard. »

## 21. Terminal.app (macOS) : réglage de la molette en écran alternatif

- Apple documente un réglage de profil « Scroll alternate screen » : « To enable alternate screen scrolling, select “Scroll alternate screen.” » [A1]. La page ne dit PAS que ce réglage est le mode 1007 xterm, ni sa valeur par défaut : Inconnu.

Source
- [A1] https://support.apple.com/guide/terminal/trmlkbrd/mac (Profils > Clavier).

## 22. Windows Terminal : mode 1007 (alternate scroll)

- Désactivé par défaut jusqu'à janvier 2024, puis activé par défaut ; une application qui active elle-même un suivi souris prend la priorité sur 1007 [W1][W2].
- Une molette en 1007 envoie UNE flèche par cran (pas de multiplicateur) ; configurable demandé (#19923, ouvert) [W3].
- Conhost : supportait déjà 1007 en 2020 (désactivé par défaut, comme xterm) [W2].
- Conflit signalé : le zoom Ctrl+molette est avalé par le mode 1007 (#17383, ouvert).

Sources
- [W1] https://github.com/microsoft/terminal/pull/16535 (fusionné 2024-01-09) « Enable alternate scroll mode by default » — « This PR enables alternate scroll mode by default, and also fixes the precedence so if there is any other mouse tracking mode enabled, that will take priority. » ; https://github.com/microsoft/terminal/issues/13187 — j4james : « Every terminal I've tested that has support for alternate scroll also has it enabled by default, except for XTerm » ; « if an application has a mouse tracking mode enabled (e.g. mode 1003) at the same time as alternate scroll, that mouse tracking should take precedence ».
- [W2] https://github.com/microsoft/terminal/issues/3321 — zadjii-msft : « the vintage console already does support this mode » ; j4james : « it still doesn't work in VIM, because VIM turns on Cursor Keys Mode (`DECCKM`) … » (corrigé par le PR #5081 « Fix the Alternate Scroll Mode when DECCKM enabled », 2020-03-23) ; « we were probably correct in leaving the scroll mode disabled by default as Xterm has done. I just discovered there is an option you can enable in VIM which will make it handle all the mouse scrolling itself. And if we were to enable the alternate scroll mode by default, we'd just end up breaking that functionality. » ; et sur Mintty avec `set mouse=a` : « it's generating up/down key strokes as well as passing the mouse events through ».
- [W3] https://github.com/microsoft/terminal/issues/13187 — DHowett : « Windows defaults to scrolling 3 lines per wheel detent, but if we translated a single wheel scroll event into three up/down events we would risk overshooting » ; zadjii-msft : « I'd suspect we send one `^[[A` per wheel click, resulting in one line scrolled » ; https://github.com/microsoft/terminal/issues/19923 « Make mouse wheel alternate scroll delta/length configurable » (ouvert).
- [W4] https://github.com/microsoft/terminal/issues/18102 « Mouse tracking does not respect the system's `rows to scroll` setting » — DHowett : « Xterm mouse reporting reports *button events,* of which each wheel detent is one. Xterm mouse reporting does not report lines scrolled. How many lines the application scrolls when it receives a wheel detent reports an application choice. » ; o-sdn-o : « in Midnight Commander the scrolling speed is hardcoded as 2 lines per wheel step for the viewer and editor, and 1 line everywhere else ».
- xterm (définition du mode) : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt — « Ps = 1 0 0 7 -> Enable Alternate Scroll Mode, xterm. This corresponds to the alternateScroll resource. » ; page de manuel xterm : « alternateScroll … If true, the scroll-back and scroll-forw actions send cursor-up and -down keys when xterm is displaying the alternate screen. The default is false. »
- xterm : le contournement Shift est lui-même configurable : `CSI > Ps s` (XTSHIFTESCAPE) « Ps = 0 -> allow shift-key to override mouse protocol. Ps = 1 -> conditionally allow shift-key as modifier in mouse protocol. » ; « Ps = 3 -> never allow shift-key as modifier in mouse protocol » (même fichier ctlseqs.txt).

## 23. Patron « sélection DANS l'application »

Qui le fait, relevé aux sources ci-dessus :

| Acteur | Capture | Surlignage | Déclencheur de copie | Chemin de copie | Source |
| --- | --- | --- | --- | --- | --- |
| tmux (copy-mode) | souris captée (`mouse on`) | dessiné par tmux | commande de copy-mode | OSC 52 (`set-clipboard`) et/ou `copy-command` (pipe) | [3][4][5] |
| Claude Code (plein écran) | oui | oui, dessiné par l'app | relâchement du bouton (`Copy on select`), sinon Ctrl+Shift+c | `pbcopy` / `wl-copy` / `xclip`+`xsel` / `Set-Clipboard`, tampon tmux, repli OSC 52 sous SSH | [27] |
| Textual | oui | oui | Ctrl+C | OSC 52 | [20][21] |
| opencode | oui | oui | relâchement (copy-on-select) | OSC 52 | [35][38] |
| Copilot CLI | oui (désactivable `--no-mouse`) | oui | `copyOnSelect` | Inconnu (non lu) | [40] |
| Crush (Charm) | oui | oui | Inconnu | Inconnu (PR #563 « Text Selection », corps vide à la lecture) | [19] |
| Patron proposé pour bubbletea | `MouseModeNone` quand le bouton est enfoncé, `CellMotion` sinon | non précisé | copie automatique au relâchement, « since scrolling removes the selection » | non précisé | [19] |
| Ink (proposition) | l'application | `getSelection/setSelection` | l'application | l'application | [26] |

Écueils cités par les sources
- SSH et terminaux sans OSC 52 : copie annoncée réussie mais ignorée (VTE/GNOME Terminal) [28] ; message « copied » faux sous tmux + SSH + Ghostty [36].
- Multiplexeurs : tmux exige `set-clipboard` et la capacité `Ms` [3][5] ; OSC 52 écrit sur stdout au lieu de /dev/tty sous Zellij [36] ; GNU screen affiche du base64 pour les copies longues (~570 caractères avant v2.1.219) [27].
- Permission : iTerm2 bloque OSC 52 par défaut [27][3] ; xterm le désactive par défaut (`disallowedWindowOps: 20,21,SetXprop`) [3][5].
- Terminal.app : OSC 52 ne marche pas selon Textual [21] ; une affirmation d'issue le dit supporté depuis Sonoma 14.4 (non vérifié) [35].
- Double-clic mot : Claude Code reprend les frontières de mot d'iTerm2 (un chemin = une unité ; une URL entière avec son schéma) [27] ; Textual traite la sélection de caractères double largeur (`#6186`, CHANGELOG).
- Sélection rectangulaire : Inconnu (aucune source lue ne la traite pour le patron « dans l'application »).
- Défilement automatique en bord pendant le glisser : Textual `SELECT_AUTO_SCROLL_*` [21] ; un bug de Claude Code perd des caractères quand le glisser fait défiler (issue anthropics/claude-code#83961, titre lu, corps non lu).
- Scrollback vide en écran alternatif : le surlignage natif ne peut pas dépasser l'écran visible [28][26] ; Claude Code propose `[` en mode transcript pour déverser la conversation dans le scrollback natif [27].
- Windows Terminal : OSC 52 copié sous le verrou d'écriture, blocage observé (PR #20467), corrigé (#20728, fusionné 2026-09-28) ; et gating au focus (#19357).
- Touche de contournement qui varie : Fn (Terminal.app), Option (iTerm2), Shift (la plupart des autres) [27] ; Ghostty `mouse-shift-capture` [38].
