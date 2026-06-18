# Zen-Library fork

This is a modified GitHub fork of [JustAdumbPrsn/Zen-Library](https://github.com/JustAdumbPrsn/Zen-Library).

The upstream repository currently does not include an explicit open source license. This fork is published on GitHub for collaboration and patch review purposes. No additional license is granted for the upstream code.

This project is not affiliated with Arc, The Browser Company, Zen Browser, Sine, or the original Zen-Library project.

## Fork-specific changes

This fork is synchronized with the upstream `v2.1 Zen 1.20.1b` line and keeps the upstream Library, Downloads, Media, History, Spaces, and Boosts features.

Compared with upstream, this fork focuses on macOS shortcuts, workspace-edge gestures, and faster transitions.

### Shortcuts

- Keeps the upstream `Alt + Shift + B` toggle shortcut.
- Keeps the upstream macOS `Cmd + Alt + B` shortcut.
- Adds a macOS `Cmd + Shift + B` toggle shortcut for an Arc-like Library gesture.

### Workspace edge gestures

- Adds horizontal wheel and Firefox `MozSwipeGesture` handling.
- Lets the Library behave like a virtual space before the leftmost Zen workspace.
- Opens the Library only when the active workspace is the first visible workspace and the gesture starts from the sidebar or workspace edge.
- Closes the Library when swiping back from inside the Library.
- Honors Zen's natural scroll setting and right-to-left layout direction.
- Filters mostly vertical scrolls and gestures that begin outside the sidebar or Library to reduce accidental opens.

### Faster transitions

- Reduces the toggle debounce from `100ms` to `40ms`.
- Reduces the open transition wait from `400ms` to `60ms`.
- Reduces the close cleanup wait from `300ms` to `120ms`.
- Shortens the related sidebar, panel, content, app-content, glance-overlay, and toolbox fade animations in `css/animator.css` and `css/core.css`.

### Files changed

- `ZenLibrary.uc.js`: shortcut handling, wheel/swipe gesture handling, workspace-edge detection, and transition timing.
- `css/animator.css`: faster app-content, tabbox, glance-overlay, Library opacity, and toolbox fade transitions.
- `css/core.css`: faster Library sidebar, main panel, and content enter/exit animations.

<img width="1426" height="803" alt="image" src="https://github.com/user-attachments/assets/3701c50e-1454-4107-8a48-bd86fcf15e7a" />
<img width="1426" height="803" alt="image" src="https://github.com/user-attachments/assets/5c536564-2d5a-410c-bde3-7751d8a2aa8b" />
<img width="1386" height="808" alt="image" src="https://github.com/user-attachments/assets/b8585f4f-3fd0-44fd-94ff-f2d53c8ad441" />
<img width="1386" height="808" alt="image" src="https://github.com/user-attachments/assets/779b5577-13fb-46be-bb0c-e8c4273366e7" />

## Installation process

Note: You must have [Sine](https://github.com/CosmoCreeper/Sine) installed to download this mod.

1. Go to settings > Sine Mods.
2. Below the marketplace, open Sine settings and enable downloading JS from unofficial sources.
3. Paste this repository URL into Sine's GitHub repository install field: `github.com/HidakaKoyo/Zen-Library`.
4. If Sine asks to restart, restart the browser. You can also go to `about:support` and click Clear startup cache.
5. After the mod is installed successfully, press `Alt + Shift + B` to open or close the library. On macOS, this fork also supports `Cmd + Alt + B` and `Cmd + Shift + B`.

Since this is an experimental version, it may have minor bugs.

## Upstream

- Repository: [JustAdumbPrsn/Zen-Library](https://github.com/JustAdumbPrsn/Zen-Library)
- Original author: JustADumbPrsn
