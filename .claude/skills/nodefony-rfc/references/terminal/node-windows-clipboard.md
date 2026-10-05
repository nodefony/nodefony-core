# Node.js, Windows et presse-papiers : contraintes avec sources

Relevé du 2026-10-05. Extraits verbatim (anglais), lus dans les fichiers bruts. Une case sans source s'écrit « Inconnu ».

---

## B.1 `setRawMode(true)` sous Windows et séquences souris SGR

### Faits établis par le code

1. **libuv** : `uv_tty_set_mode` a un mode `UV_TTY_MODE_RAW_VT` qui, sous Windows, pose `ENABLE_VIRTUAL_TERMINAL_INPUT` ; le mode `UV_TTY_MODE_RAW` historique ne le pose pas [N1][N2].
   - Source [N1] https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/tty.c (`uv_tty_set_mode`) :
     ```
     case UV_TTY_MODE_RAW_VT:
       try_set_flags = ENABLE_VIRTUAL_TERMINAL_INPUT;
       InterlockedExchange(&uv__tty_console_in_need_mode_reset, 1);
       /* fallthrough */
     case UV_TTY_MODE_RAW:
       flags = ENABLE_WINDOW_INPUT;
       break;
     case UV_TTY_MODE_IO:
       return UV_ENOTSUP;
     ...
     if (!SetConsoleMode(tty->handle, flags | try_set_flags) &&
         !SetConsoleMode(tty->handle, flags)) {
     ```
     Note : `ENABLE_MOUSE_INPUT` n'est jamais posé par libuv ; et la lecture « classique » (hors VT) ne traite que les `KEY_EVENT` (`if (handle->tty.rd.last_input_record.EventType != KEY_EVENT)`, tty.c). En mode RAW non-VT, un clic souris n'arrive donc pas à Node comme séquence SGR ; en `RAW_VT` c'est le terminal/ConPTY qui émet les séquences.
   - [N2] https://raw.githubusercontent.com/libuv/libuv/v1.x/include/uv.h — « Raw input mode. On Windows ENABLE_VIRTUAL_TERMINAL_INPUT is also set. » (`UV_TTY_MODE_RAW_VT`) ; et pour `UV_TTY_MODE_RAW` : « Raw input mode (On Windows, ENABLE_WINDOW_INPUT is also enabled). May become equivalent to UV_TTY_MODE_RAW_VT in future libuv versions. »
2. **Version libuv** : `UV_TTY_MODE_RAW_VT` est apparu avec libuv **1.51.0** (2025-04-25) : https://raw.githubusercontent.com/libuv/libuv/v1.x/ChangeLog — « 2025.04.25, Version 1.51.0 (Stable) … * win: add ENABLE_VIRTUAL_TERMINAL_INPUT raw tty mode (Anna Henningsen) ». PR : https://github.com/libuv/libuv/pull/4688 « win,tty: allow setting `ENABLE_VIRTUAL_TERMINAL_INPUT` for raw mode ».
3. **Node** : `setRawMode(true)` utilise `UV_TTY_MODE_RAW_VT` depuis le PR https://github.com/nodejs/node/pull/58358 « tty: use terminal VT mode on Windows » (fusionné 2025-05-18) :
   « int err = uv_tty_set_mode(&wrap->handle_, args[0]->IsTrue() ? UV_TTY_MODE_RAW_VT : UV_TTY_MODE_NORMAL); » (src/tty_wrap.cc).
   Premières versions publiées : **Node 24.2.0** (`c094bea8d9`) et **Node 22.17.0** (`7be70979c6`), lues dans les CHANGELOG : https://raw.githubusercontent.com/nodejs/node/main/doc/changelogs/CHANGELOG_V24.md et `CHANGELOG_V22.md` (« **tty**: use terminal VT mode on Windows (Anna Henningsen) #58358 »). Ces deux versions embarquent libuv 1.51.0 (`deps/uv/include/uv/version.h` aux tags v22.17.0 et v24.2.0). Absent du CHANGELOG v20 lu : le grep de `58358` n'y a rien trouvé (donc pas de RAW_VT en 20.x, d'après cette lecture ; fichier CHANGELOG_V20 non relu en détail).
4. **API actuelle** : `setRawMode('raw')` = `UV_TTY_MODE_RAW_VT` ; `true` garde le même comportement ; `'io'` = `UV_TTY_MODE_IO` (Unix seulement) — PR https://github.com/nodejs/node/pull/64140 (fusionné 2026-08-23), doc : « v26.8.0, v24.21.0 : The `mode` argument supports `'raw'` and `'io'`. » ; « On Windows, `setRawMode()` requires write permission to the console input buffer. » ; « binary-safe I/O mode … is not supported on Windows. » (https://raw.githubusercontent.com/nodejs/node/main/doc/api/tty.md). Code : https://raw.githubusercontent.com/nodejs/node/main/lib/tty.js (`rawMode === 'raw'` → `UV_TTY_MODE_RAW_VT`).

### Faits établis par le comportement observé (Windows Terminal et conhost)

- Issue https://github.com/nodejs/node/issues/56338 « Node.js tty.ReadStream does not pass in mouse event ANSI escape codes in Windows terminal » (Node v22.9.0, Windows 10 19045, code : `\x1b[?1000h` + `\x1b[?1003h` puis `setRawMode(true)`) : un commentaire dit « The issue is no longer reproducable since latest Windows upgrade (Mar 2025) … Windows Terminal v1.22.10352.0 … adopting ConPTY ». Fermée automatiquement pour inactivité, sans correctif Node (donc l'amélioration vient du côté Windows, pas de Node). Confirmation indirecte, pas un test exécuté ici.
- Issue https://github.com/nodejs/node/issues/61161 « Windows: setRawMode(true) overwrites console mode flags instead of preserving them » (fermée) : « This breaks mouse input in TUI applications because `ENABLE_MOUSE_INPUT` and `ENABLE_EXTENDED_FLAGS` get wiped out. » — un TUI qui posait ces drapeaux via FFI les perd ; hors voie VT.
- PR libuv #2169 « tty,win: Add mouse tracking to tty on Windows » (fermé non fusionné) : échange où l'auteur note qu'avec `ENABLE_VIRTUAL_TERMINAL_INPUT` « the input sequence seems to be that of xterm ».
- Désorganisation d'état : https://github.com/libuv/libuv/pull/4688 — « not all shells reset this mode when an application exits. For example, when running a Node.js program with this flag enabled inside of PowerShell in Windows terminal, if the application exits while in raw TTY input mode, neither the shell nor the terminal emulator reset this flag, rendering the input stream unusable. Hence, `uv_tty_reset_mode()` is extended to reset the terminal to its original state if the new mode is being used. » → toujours restaurer (`setRawMode(false)`) et laisser `uv_tty_reset_mode` jouer à la sortie.
- Windows Terminal et conhost, test direct d'un `ESC[?1000h ESC[?1006h` suivi de la lecture de `stdin` par Node : **non exécuté ici** (aucune machine Windows, interdiction de lancer Node/serveur). Les preuves ci-dessus sont indirectes. Statut : **Inconnu à l'exécution**, à prouver par un test Node pur sur le job Windows de la CI (levier 3 de la règle des 3 plateformes).
- Support de la souris par ConPTY : issue https://github.com/microsoft/terminal/issues/376 « [Conpty] Add support for mouse input » (2019, wezterm : conpty « swallows the mouse reporting escape sequences ») fermée ; un commentaire de 2020-05 : « in latest Microsoft Store version of Windows Terminal mouse input is supported (at least in Vim) ». Numéro de version précise : Inconnu.
- La page « Console Virtual Terminal Sequences » (MicrosoftDocs/Console-Docs) ne mentionne pas la souris dans la version lue : grep sur `mouse|1000|1006|1007` sans résultat (seuls `ENABLE_VIRTUAL_TERMINAL_INPUT` et `?1049` y figurent) → la doc officielle ne GARANTIT pas le suivi souris SGR sous conhost ; Inconnu.

### Verdict B.1
- **Autorisé** : sous Node ≥ 22.17 / ≥ 24.2 (libuv 1.51), `setRawMode(true)` met la console en `ENABLE_VIRTUAL_TERMINAL_INPUT` ; le terminal (Windows Terminal moderne, ConPTY) émet alors les séquences d'entrée xterm, y compris celles que l'application a demandées (`?1000/?1002/?1006`) — d'après les issues ci-dessus, non rejoué.
- **Interdit/incertain** : Node plus ancien (libuv < 1.51) : mode RAW non-VT, `KEY_EVENT` seulement ; conhost hérité : support de la souris SGR non documenté par Microsoft (Inconnu).
- Il est donc **un constat à faire à l'exécution**, pas à déduire de `process.platform` (axiome n°4 du CLAUDE.md).

---

## B.2 Écrire dans le presse-papiers sans dépendance native

### Commandes système

| Plateforme | Commande | Source |
| --- | --- | --- |
| macOS | `pbcopy` (stdin) | [C1] Claude Code : « macOS: `pbcopy` » |
| Linux Wayland | `wl-copy` (stdin) | [C2] wl-clipboard README : « $ ls ~/Downloads \| wl-copy » |
| Linux X11 | `xclip` ou `xsel` ; à écrire dans le presse-papiers ET dans PRIMARY pour le collage molette | [C1][C3] |
| Windows et WSL | PowerShell `Set-Clipboard` ; alternative `clip.exe` | [C1][C4] |
| Windows, via le terminal | `Set-Clipboard -AsOSC52` (PowerShell 7.4) | [C4] |

- [C1] https://code.claude.com/docs/en/fullscreen.md — « **macOS**: `pbcopy` · **Linux**: `wl-copy` on Wayland, or `xclip` or `xsel` on X11, whichever is installed. Claude Code writes both the clipboard and the PRIMARY selection, so middle-click paste works. · **Windows and WSL**: PowerShell `Set-Clipboard` ». Inside tmux : « it also writes to the tmux paste buffer. Over SSH it falls back to OSC 52 escape sequences. »
- [C2] https://raw.githubusercontent.com/bugaevc/wl-clipboard/master/README.md — « This project implements two command-line Wayland clipboard utilities, `wl-copy` and `wl-paste` ».
- [C3] https://raw.githubusercontent.com/astrand/xclip/master/xclip.1 — « Reads from standard in, or from one or more files, and makes the data available as an X selection for pasting into X applications. » ; « The default action is to silently wait in the background for X selection requests (pastes) until another application … » ; `-selection` : « "primary" to use XA_PRIMARY (default), … or "clipboard" for XA_CLIPBOARD » → il faut `-selection clipboard` ; le processus reste en arrière-plan pour servir les collages (`-loops n`).
- [C4] https://raw.githubusercontent.com/MicrosoftDocs/PowerShell-Docs/main/reference/7.5/Microsoft.PowerShell.Management/Set-Clipboard.md — « `-AsOSC52` : When connected to a remote session over SSH, `Set-Clipboard` sets the clipboard of the remote machine, not the local host. When you use this parameter, `Set-Clipboard` uses the OSC52 ANSI escape sequence to set the clipboard of the local machine. … The Windows Terminal supports this feature. This parameter was added in PowerShell 7.4. » ; « On Linux, this cmdlet requires the `xclip` utility to be in the path. »
- `clip.exe` et Unicode : https://github.com/xavi-/node-copy-paste/pull/45 — « Windows (specifically clip.exe) appears to use the dreaded `isTextUnicode` to decide character encoding. This means that sometimes extended chars copy correctly, other times not. » (contournement du PR : code page 65001 + UTF-8 ; un BOM « works, but BOM is also copied to clipboard as extra data »). Donc ne pas s'y fier pour du texte non ASCII ; `Set-Clipboard` n'a pas été testé ici sur ce point (Inconnu).
- Détection de capacité : Windows « `ps` manque aussi des images `node:*-slim` » (règle de la maison) — idem ici : lancer l'outil et constater `ENOENT`, ne jamais déduire de `process.platform`. Les outils absents (`wl-copy` hors Wayland, `xclip` hors X11, aucun sur serveur sans affichage) rendent la voie système indisponible : repli OSC 52.

### OSC 52

- Définition : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt — « Ps = 5 2 -> Manipulate Selection Data. These controls may be disabled using the allowWindowOps resource. The parameter Pt is parsed as Pc ; Pd … The first, Pc, may contain zero or more characters from the set c , p , q , s , 0 … Normally this is a string encoded in base64 (RFC-4648). The data becomes the new selection, which is then available for pasting by other applications. If the second parameter is a ? , xterm replies to the host with the selection data » (lecture : `ESC ] 52 ; c ; <base64> BEL`).
- Exemple de production réelle (Textual) : `self._driver.write(f"\x1b]52;c;{base64_text}\a")` avec `base64.b64encode(text.encode("utf-8"))` — https://raw.githubusercontent.com/Textualize/textual/main/src/textual/app.py. L'encodage UTF-8 AVANT le base64 est indispensable ; l'issue opencode #30068 « Copying Japanese text … mojibake (UTF-8 misinterpreted as Latin1) » le rappelle (cause finale attribuée à VS Code Terminal / OSC52 par un commentaire, non tranchée).

Écueils, avec sources
- **Désactivé par défaut dans xterm** : « xterm supports OSC 52 but it is disabled by default. It can be enabled by putting this in .Xresources or .Xdefaults: XTerm*disallowedWindowOps: 20,21,SetXprop » — https://raw.githubusercontent.com/wiki/tmux/tmux/Clipboard.md.
- **iTerm2 : permission** : « iTerm2 supports OSC 52 but it has to be enabled from the preferences » (même page) ; « iTerm2 blocks it until you turn on Settings → General → Selection → Applications in terminal may access clipboard; running /terminal-setup in iTerm2 enables this for you. » — https://code.claude.com/docs/en/fullscreen.md.
- **VTE (GNOME Terminal, XFCE Terminal, Terminator)** : « do not support the OSC 52 escape sequence. Most will ignore it, but some versions will not and will instead print it to the terminal » (tmux wiki) ; test direct dans l'issue anthropics/claude-code#93147 : « gnome-terminal (VTE 0.80.1) | unchanged — discarded ; kitty 0.41.1 | set correctly » ; l'application a affiché « sent 2088 chars via OSC 52 » alors que rien n'était copié → **il n'y a aucun accusé de réception** : une copie OSC 52 ne se constate pas, elle se suppose.
- **Terminal.app** : Textual : « This does not work on macOS Terminal, but will work on most other terminals. » ; une issue opencode dit l'inverse depuis Sonoma 14.4 (non vérifié) : Inconnu, donc ne pas compter dessus.
- **Taille maximale** : AUCUNE valeur universelle trouvée. Observés : GNU screen « if you copied a selection longer than roughly 570 characters, GNU screen printed base64 text into the window instead » (Claude Code, avant v2.1.219) ; st « versions before 0.8.3 have a length limit on the amount of text that can be copied, so text may be truncated » (tmux wiki) ; tmux `input-buffer-size` : « Maximum of bytes allowed to read in escape and control sequences. Once reached, the sequence will be discarded. » (tmux.1) ; kitty : `clipboard_max_size` — « The maximum size (in MB) of data from programs running in kitty that will be stored for writing to the system clipboard. A value of zero means no size limit » (kitty/options/definition.py, valeur par défaut non relue : Inconnu). Pour Windows Terminal et ConPTY : Inconnu.
- **Kitty** : « Kitty does support OSC 52, but it has a bug where it appends to the clipboard each time text is copied rather than replacing it. … `clipboard_control write-primary write-clipboard no-append` » (tmux wiki, version de kitty non précisée).
- **tmux** : OSC 52 exige l'option `set-clipboard` et la capacité terminfo `Ms` (« By default, tmux adds the `Ms` capability for terminals where `TERM` matches `xterm*` ») ; tmux imbriqué, voir la page Clipboard ; une application dans tmux peut aussi émettre `\ePtmux;…\e\\` si `allow-passthrough` vaut `on` (« passthrough sequences will be allowed only if the pane is visible ») — tmux.1. Avec `set-clipboard on`, « any application running inside tmux can create a tmux paste buffer and set the system clipboard » : risque de sécurité (tmux wiki).
- **Windows Terminal** : OSC 52 en écriture présent : PR #18905 « wpf: allow OSC 52 to write the clipboard » (2025-05-13) et #18949 « Add support for OSC 52 clipboard copy in conhost » (2025-06-10) ; #19357 « OSC 52: Gate clipboard writes on focus to prevent background clipboard hijacking » (2026-02-27) : « require _isFocused alongside _clipboardOperationsAllowed » — une copie émise terminal non focalisé est ignorée ; PR #20467 / #20728 : deadlock/lags de 5 à 30 s quand la même trame change le titre et copie, ou quand on recopie en rafale (« Spamming OSC 52 copy freezes the application », #20210 ouvert) → **ne pas émettre OSC 52 en rafale** (conflation / debounce à prévoir côté application). URLs : https://github.com/microsoft/terminal/pull/19357 , /pull/20728 , /pull/20467 , /issues/20210.
- Paramètre de contrôle d'accès côté terminal pour WT (clé `clipboard…` ou équivalent) : Inconnu (non lu).

---

## B.3 Molette et `ESC[?1007h` sous Windows Terminal

- Mode 1007 (alternate scroll) défini par xterm : « Ps = 1 0 0 7 -> Enable Alternate Scroll Mode, xterm. This corresponds to the alternateScroll resource. » (ctlseqs.txt) ; resource : « the scroll-back and scroll-forw actions send cursor-up and -down keys when xterm is displaying the alternate screen. The default is "false". » (xterm.man).
- Windows Terminal : support ajouté par PR #12569 « Add support for alternate scroll mode in Terminal » (fusionné 2022-04-12) ; activé PAR DÉFAUT par PR #16535 (fusionné 2024-01-09), avec priorité d'un suivi souris actif : « if there is any other mouse tracking mode enabled, that will take priority. » Issue d'origine #13187 (fermée) : « It's not like an app that didn't request that mode is going to get anything particularly bad by getting up/down keystrokes » (zadjii-msft). Version de WT portant #16535 : Inconnu (non relevée).
- Comportement : « I'd suspect we send one `^[[A` per wheel click, resulting in one line scrolled » (zadjii-msft, #13187) ; « Windows defaults to scrolling 3 lines per wheel detent, but if we translated a single wheel scroll event into three up/down events we would risk overshooting » (DHowett) ; demande de réglage de la longueur : #19923 (ouvert). Les flèches émises respectent DECCKM (PR #5081, 2020-03-23, conhost).
- Conflit : #17383 « alternate scroll mode breaks ctrl-mousewheel zoom » (ouvert).
- Pour le dilemme du plein écran : en 1007 seul (sans 1000/1002/1006), la molette devient des touches ↑/↓ lues par `stdin`, la sélection native reste intacte, et le défilement par cran est d'1 ligne. Dès qu'un mode de suivi souris (1000…) est actif, il l'emporte sur 1007 (#16535), donc 1007 et la capture sont exclusifs.
- Conhost hérité : « the vintage console already does support this mode » (#3321, 2019), désactivé par défaut (comme xterm) ; pas de relevé plus récent : Inconnu.
- Terminal.app : Apple expose un réglage de profil « Scroll alternate screen » (https://support.apple.com/guide/terminal/trmlkbrd/mac : « To enable alternate screen scrolling, select “Scroll alternate screen.” ») ; la page ne dit ni que c'est 1007 ni son défaut : Inconnu.
- Autres terminaux (conclusion tirée de j4james dans #13187, un contributeur) : « Every terminal I've tested that has support for alternate scroll also has it enabled by default, except for XTerm, and even XTerm has an option for that. » — affirmation d'un tiers, non revérifiée terminal par terminal.
