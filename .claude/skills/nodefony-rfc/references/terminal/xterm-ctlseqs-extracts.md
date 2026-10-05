# Extraits verbatim de xterm ctlseqs

Source : https://invisible-island.net/xterm/ctlseqs/ctlseqs.txt (XTerm Patch #411, 2026/08/23). Numéros de ligne = ctlseqs.txt. Copie brute dans tmp/scratch/terminal-research/raw/ctlseqs.txt.

NOTE : le mode 2026 (sortie synchronisée) et DECRQM 2026 n'apparaissent NULLE PART dans ctlseqs (grep 2026 → seulement la date de patch). Spec de référence : contour-terminal/vt-extensions (hors xterm).


## DECSET 1000..1007, 1015, 1016 (lignes 971-990)

```text
            Ps = 1 0 0 0  -> Send Mouse X & Y on button press and
          release.  See the section Mouse Tracking.  This is the X11
          xterm mouse protocol.
            Ps = 1 0 0 1  -> Use Hilite Mouse Tracking, xterm.
            Ps = 1 0 0 2  -> Use Cell Motion Mouse Tracking, xterm.  See
          the section Button-event tracking.
            Ps = 1 0 0 3  -> Use All Motion Mouse Tracking, xterm.  See
          the section Any-event tracking.
            Ps = 1 0 0 4  -> Send FocusIn/FocusOut events, xterm.
            Ps = 1 0 0 5  -> Enable UTF-8 Mouse Mode, xterm.
            Ps = 1 0 0 6  -> Enable SGR Mouse Mode, xterm.
            Ps = 1 0 0 7  -> Enable Alternate Scroll Mode, xterm.  This
          corresponds to the alternateScroll resource.
            Ps = 1 0 1 0  -> Scroll to bottom on tty output (rxvt).
          This sets the scrollTtyOutput resource to "true".
            Ps = 1 0 1 1  -> Scroll to bottom on key press (rxvt).  This
          sets the scrollKey resource to "true".
            Ps = 1 0 1 4  -> Enable fastScroll resource, xterm.
            Ps = 1 0 1 5  -> Enable urxvt Mouse Mode.
            Ps = 1 0 1 6  -> Enable SGR Mouse PixelMode, xterm.
```

## DECSET 1046-1049 (lignes 1019-1030)

```text
            Ps = 1 0 4 6  -> Enable switching to/from Alternate Screen
          Buffer, xterm.  This works for terminfo-based systems,
          updating the titeInhibit resource.
            Ps = 1 0 4 7  -> Use Alternate Screen Buffer, xterm.  This
          may be disabled by the titeInhibit resource.
            Ps = 1 0 4 8  -> Save cursor as in DECSC, xterm.  This may
          be disabled by the titeInhibit resource.
            Ps = 1 0 4 9  -> Save cursor as in DECSC, xterm.  After
          saving the cursor, switch to the Alternate Screen Buffer,
          clearing it first.  This may be disabled by the titeInhibit
          resource.  This control combines the effects of the 1 0 4 7
          and 1 0 4 8  modes.  Use this with terminfo-based applications
```

## DECSET 2004 (ligne 1043)

```text
            Ps = 2 0 0 4  -> Set bracketed paste mode, xterm.
```

## DECRST 1000..1007 (lignes 1118-1129)

```text
            Ps = 1 0 0 0  -> Don't send Mouse X & Y on button press and
          release.  See the section Mouse Tracking.
            Ps = 1 0 0 1  -> Don't use Hilite Mouse Tracking, xterm.
            Ps = 1 0 0 2  -> Don't use Cell Motion Mouse Tracking,
          xterm.  See the section Button-event tracking.
            Ps = 1 0 0 3  -> Don't use All Motion Mouse Tracking, xterm.
          See the section Any-event tracking.
            Ps = 1 0 0 4  -> Don't send FocusIn/FocusOut events, xterm.
            Ps = 1 0 0 5  -> Disable UTF-8 Mouse Mode, xterm.
            Ps = 1 0 0 6  -> Disable SGR Mouse Mode, xterm.
            Ps = 1 0 0 7  -> Disable Alternate Scroll Mode, xterm.  This
          corresponds to the alternateScroll resource.
```

## DECRST 1049 (lignes 1163-1170)

```text
            Ps = 1 0 4 7  -> Use Normal Screen Buffer, xterm.  Clear the
          screen first if in the Alternate Screen Buffer.  This may be
          disabled by the titeInhibit resource.
            Ps = 1 0 4 8  -> Restore cursor as in DECRC, xterm.  This
          may be disabled by the titeInhibit resource.
            Ps = 1 0 4 9  -> Use Normal Screen Buffer and restore cursor
          as in DECRC, xterm.  This may be disabled by the titeInhibit
          resource.  This combines the effects of the 1 0 4 7  and 1 0 4
```

## DECRST 2004 (ligne 1185)

```text
            Ps = 2 0 0 4  -> Reset bracketed paste mode, xterm.
```

## DSR / CPR ESC[6n (lignes 1383-1388)

```text
CSI Ps n  Device Status Report (DSR).
            Ps = 5  -> Status Report.
          Result ("OK") is CSI 0 n
            Ps = 6  -> Report Cursor Position (CPR) [row;column].
          Result is CSI r ; c R

```

## DECRQM (lignes 1500-1522)

```text
          S8C1T, but DECSCL is preferred.

CSI Ps $ p
          Request ANSI mode (DECRQM).  For VT300 and up, reply DECRPM is
            CSI Ps ; Pm $ y
          where Ps is the mode number as in SM/RM, and Pm is the mode
          value:
            0 - not recognized
            1 - set
            2 - reset
            3 - permanently set
            4 - permanently reset

CSI ? Ps $ p
          Request DEC private mode (DECRQM).  For VT300 and up, reply
          DECRPM is
            CSI ? Ps ; Pm $ y
          where Ps is the mode number as in DECSET/DECRST, Pm is the
          mode value as in the ANSI DECRQM.
          A few private modes are read-only, provided only for reporting
          their values using this control sequence.
          o   1 3  and 1 4  correspond to the resources cursorBlink and
              cursorBlinkXOR.
```

## XTSHIFTESCAPE (lignes 1598-1614)

```text

CSI > Ps s
          Set/reset shift-escape options (XTSHIFTESCAPE), xterm.  This
          corresponds to the shiftEscape resource.

          Valid values for the parameter:
            Ps = 0  -> allow shift-key to override mouse protocol.
            Ps = 1  -> conditionally allow shift-key as modifier in
          mouse protocol.

          These resource values are disallowed in the control sequence:
            Ps = 2  -> always allow shift-key as modifier in mouse
          protocol.
            Ps = 3  -> never allow shift-key as modifier in mouse
          protocol.

          If no parameter is given, xterm uses the default, which is 0 .
```

## OSC 52 (lignes 2156-2182)

```text
            Ps = 5 2  -> Manipulate Selection Data.  These controls may
          be disabled using the allowWindowOps resource.  The parameter
          Pt is parsed as
               Pc ; Pd

          The first, Pc, may contain zero or more characters from the
          set c , p , q , s , 0 , 1 , 2 , 3 , 4 , 5 , 6 , and 7 .  It is
          used to construct a list of selection parameters for
          clipboard, primary, secondary, select, or cut-buffers 0
          through 7 respectively, in the order given.  If the parameter
          is empty, xterm uses s 0 , to specify the configurable
          primary/clipboard selection and cut-buffer 0.

          The second parameter, Pd, gives the selection data.  Normally
          this is a string encoded in base64 (RFC-4648).  The data
          becomes the new selection, which is then available for pasting
          by other applications.

          If the second parameter is a ? , xterm replies to the host
          with the selection data encoded using the same protocol.  It
          uses the first selection found by asking successively for each
          item from the list of selection parameters.

          If the second parameter is neither a base64 string nor ? ,
          then the selection is cleared.

            Ps = 6 0  -> Query allowed features (XTQALLOWED).  XTerm
```

## Mouse Tracking : intro, constantes (lignes 2908-2945)

```text
Mouse Tracking

The VT widget can be set to send the mouse position and other
information on button presses.  These modes are typically used by
editors and other full-screen applications that want to make use of the
mouse.

There are two sets of mutually exclusive modes:

o   mouse protocol

o   protocol encoding

The mouse protocols include DEC Locator mode, enabled by the DECELR CSI
Ps ; Ps '  z control sequence, and is not described here (control
sequences are summarized above).  The remaining five modes of the mouse
protocols are each enabled (or disabled) by a different parameter in the
"DECSET CSI ? Pm h " or "DECRST CSI ? Pm l " control sequence.

Manifest constants for the parameter values are defined in xcharmouse.h
as follows:

     #define SET_X10_MOUSE               9
     #define SET_VT200_MOUSE             1000
     #define SET_VT200_HIGHLIGHT_MOUSE   1001
     #define SET_BTN_EVENT_MOUSE         1002
     #define SET_ANY_EVENT_MOUSE         1003

     #define SET_FOCUS_EVENT_MOUSE       1004

     #define SET_ALTERNATE_SCROLL        1007

     #define SET_EXT_MODE_MOUSE          1005
     #define SET_SGR_EXT_MODE_MOUSE      1006
     #define SET_URXVT_EXT_MODE_MOUSE    1015
     #define SET_PIXEL_POSITION_MOUSE    1016

The motion reporting modes are strictly xterm extensions, and are not
```

## Normal tracking 1000 + Wheel mice + Alternate Scroll (lignes 2965-3022)

```text

o   Cx and Cy are the x and y coordinates of the mouse when the button
    was pressed.


Normal tracking mode

Normal tracking mode sends an escape sequence on both button press and
release.  Modifier key (shift, ctrl, meta) information is also sent.  It
is enabled by specifying parameter 1000 to DECSET.  On button press or
release, xterm sends CSI M CbCxCy.

o   The low two bits of Cb encode button information:

              0=MB1 pressed,
              1=MB2 pressed,
              2=MB3 pressed, and
              3=release.

o   The next three bits encode the modifiers which were down when the
    button was pressed and are added together:

              4=Shift,
              8=Meta, and
              16=Control.

    The shift and control modifiers are normally irrelevant because
    xterm uses the control modifier with mouse for popup menus, and the
    shift modifier is used in the default translations for button
    events.

    There is no predefined meta modifier.  XTerm checks first if the
    keysyms listed in the predefined modifiers include Meta_L or Meta_R.
    If found, xterm uses that modifier for meta.  Next, it tries Alt_L
    or Alt_R.  If none of those are found, xterm uses the mod1 modifier,
    This is not necessarily the "Meta" key according to xmodmap(1).

o   Cx and Cy are the x and y coordinates of the mouse event, encoded as
    in X10 mode.


Wheel mice

Wheel mice may return buttons 4 and 5.  Those buttons are represented by
the same event codes as buttons 1 and 2 respectively, except that 64 is
added to the event code.  Release events for the wheel buttons are not
reported.

By default, the wheel mouse events (buttons 4 and 5) are translated to
scroll-back and scroll-forw actions, respectively.  Those actions
normally scroll the whole window, as if the scrollbar was used.

However if Alternate Scroll mode is set, then cursor up/down controls
are sent when the terminal is displaying the Alternate Screen Buffer.
The initial state of Alternate Scroll mode is set using the
alternateScroll resource.


```

## Button-event 1002, Any-event 1003, Extended coordinates 1005/1006 (lignes 3091-3185)

```text
Button-event tracking

Button-event tracking is essentially the same as normal tracking, but
xterm also reports button-motion events.  Motion events are reported
only if the mouse pointer has moved to a different character cell.  It
is enabled by specifying parameter 1002 to DECSET.  On button press or
release, xterm sends the same codes used by normal tracking mode.

o   On button-motion events, xterm adds 32 to the event code (the third
    character, Cb).

o   The other bits of the event code specify button and modifier keys as
    in normal mode.  For example, motion into cell x,y with button 1
    down is reported as

    CSI M @ CxCy

    ( @  = 32 + 0 (button 1) + 32 (motion indicator) ).  Similarly,
    motion with button 3 down is reported as

    CSI M B CxCy

    ( B  = 32 + 2 (button 3) + 32 (motion indicator) ).


Any-event tracking

Any-event mode is the same as button-event mode, except that all motion
events are reported, even if no mouse button is down.  It is enabled by
specifying 1003 to DECSET.


FocusIn/FocusOut

FocusIn/FocusOut can be combined with any of the mouse events since it
uses a different protocol.  When set, it causes xterm to send CSI I
when the terminal gains focus, and CSI O  when it loses focus.


Extended coordinates

The original X10 mouse protocol limits the Cx and Cy ordinates to 223
(=255 - 32).  XTerm supports more than one scheme for extending this
range, by changing the protocol encoding:

UTF-8 (1005)
          This enables UTF-8 encoding for Cx and Cy under all tracking
          modes, expanding the maximum encodable position from 223 to
          2015.  For positions less than 95, the resulting output is
          identical under both modes.  Under extended mouse mode,
          positions greater than 95 generate "extra" bytes which will
          confuse applications which do not treat their input as a UTF-8
          stream.  Likewise, Cb will be UTF-8 encoded, to reduce
          confusion with wheel mouse events.

          Under normal mouse mode, positions outside (160,94) result in
          byte pairs which can be interpreted as a single UTF-8
          character; applications which do treat their input as UTF-8
          will almost certainly be confused unless extended mouse mode
          is active.

          This scheme has the drawback that the encoded coordinates will
          not pass through luit(1) unchanged, e.g., for locales using
          non-UTF-8 encoding.

SGR (1006)
          The normal mouse response is altered to use

          o   CSI < followed by semicolon-separated

          o   encoded button value,

          o   Px and Py ordinates and

          o   a final character which is M  for button press and m  for
              button release.

          The encoded button value in this case does not add 32 since
          that was useful only in the X10 scheme for ensuring that the
          byte containing the button value is a printable code.

          o   The modifiers are encoded in the same way.

          o   A different final character is used for button release to
              resolve the X10 ambiguity regarding which button was
              released.

          The highlight tracking responses are also modified to an SGR-
          like format, using the same SGR-style scheme and button-
          encodings.

URXVT (1015)
          The normal mouse response is altered to use

          o   CSI followed by semicolon-separated
```

## Bracketed Paste Mode (lignes 2821-2840)

```text
Bracketed Paste Mode

When bracketed paste mode is set, pasted text is bracketed with control
sequences so that the program can differentiate pasted text from typed-
in text.  When bracketed paste mode is set, the program will receive:
   ESC [ 2 0 0 ~ ,
followed by the pasted text, followed by
   ESC [ 2 0 1 ~ .
For background and discussion, see the FAQ:

  XTerm - bracketed-paste

Readline Modes

Several modes provide support for mouse button events in readline.
Bracketed paste is one of these readline modes, but is used more widely.

Some assumptions (particular mouse buttons) and limitations (the mouse
is clicked on the current row on the screen) apply:

```

## Rappel : DECSET 1049 est au bloc ci-dessus (1019-1030)

## 1005/1006/1015 suite (lignes 3185-3200)
```text
          o   CSI followed by semicolon-separated

          o   encoded button value,

          o   the Px and Py ordinates and final character M .

          This uses the same button encoding as X10, but printing it as
          a decimal integer rather than as a single byte.

          However, CSI M  can be mistaken for DL (delete lines), while
          the highlight tracking CSI T  can be mistaken for SD (scroll
          down), and the Window manipulation controls.  For these
          reasons, the 1015 control is not recommended; it is not an
          improvement over 1006.

SGR-Pixels (1016)
```
