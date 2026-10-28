# Agent Note: Desktop floating assistant above other applications

Status: implemented

English | [中文](2026-10-28-desktop-floating-assistant.zh.md)

## Problem

Desktop users reach a running Harness agent only through the main window, an ordinary window that sits behind the foreground application. The product needs a resident surface that stays above every other window, on every macOS Space and over fullscreen applications, without a second application backend or a second client composition.

## Decision

The shell owns the floating assistant as two always-on-top windows. The ball is a shell-owned `dsh-app://shell/floating-ball.html` document in a frameless, transparent, non-resizable window at the `floating` level, visible on all workspaces and over fullscreen on macOS; dragging moves the window through a narrow preload IPC, and a click toggles the panel. The panel is a second always-on-top window that loads the ordinary product document with `?dshCompact=1`, so the authenticated Web application, its boot injections, the Host cookie, and the WebSocket credential injection all apply unchanged.

`ownedProductWindow` in the main process admits exactly two product documents — the main window and the panel main frame — to the product IPC guards, the startup-failure report, the locale and theme synchronization, and the WebSocket credential injection. The client frame reads the `dshCompact` query and renders one centre column under a shell drag strip, leaving the sidebar, rightbar, bottom row, and window-chrome seat unrendered; the URL owns the mode so a panel reload restores it without shell state.

The assistant is opt-in through the application menu checkbox (and the Windows caption Application menu). The enabled flag and the ball position persist in `userData/desktop/floating-assistant.json`; an unreadable file starts disabled. Escape hides the panel, the ball click and the checkbox show it again beside the ball clamped into the ball's display work area, disabling destroys both windows, and quit disposes them with the rest of the shell.

## Alternatives considered

**One window resizing between ball and panel.** Collapsing would navigate or resize away the client document, losing drafts and scroll position on every collapse, or the ball state would keep a panel-sized transparent hit region over the desktop.

**A WebContentsView overlay on the main window, like the update dialogs.** Overlays live and die with their owner window, so a hidden main window would take the assistant with it; residency requires windows the main window lifecycle does not own.

**A macOS menu bar extra as the only entry.** It gives Windows no resident anchor and ties the panel to a menu item instead of a user-placed ball; the tray remains Windows-only as before.

**Default-on residency.** A ball on every startup would join headless qualification runs and the test harness window index before any user choice; the checkbox keeps residency explicit and persisted.

## Consequences

The product IPC and WebSocket credential guards admit two owned product documents instead of one; every new product window must join `ownedProductWindow` explicitly. A shell document, a sandboxed preload, and its packaged file-list entry join the release payload. The compact frame is a URL-driven layout mode of `ui-layout`, covered by the frame spec beside the three-column cases. The floating windows stay outside the shortcut attach and overlay-owner mechanisms, so product shortcuts and update overlays keep targeting the main window only.
