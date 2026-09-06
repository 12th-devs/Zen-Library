// Zen Library — Easels.
//
// Lists the boards stored by the zen-easel mod and opens them at about:easel.
//
// The index is read straight from zen-easel's background store, not from any of its
// window scripts. That matters for two reasons: this section works even with the easel
// mod's per-window scripts disabled or not yet loaded, and it removes what would
// otherwise be a load-order dependency between two independent mods.

"use strict";

(function () {
    if (window.ZenLibraryEasels) return;

    const STORE_URL = "chrome://sine/content/zen-easel/background/store.sys.mjs";

    class ZenLibraryEasels {
        constructor(library) {
            this.library = library;
            this._easels = [];
            this._searchTerm = "";
        }

        get el() { return this.library.el.bind(this.library); }
        get svg() { return this.library.svg.bind(this.library); }

        // Resolved lazily so that a profile without the easel mod installed shows an
        // empty state rather than throwing at library construction.
        _store() {
            try {
                return ChromeUtils.importESModule(STORE_URL).EaselStore;
            } catch (e) {
                return null;
            }
        }

        async init() {
            await this.refresh();
        }

        async refresh() {
            const store = this._store();
            if (!store) {
                this._easels = [];
                return;
            }
            try {
                this._easels = await store.listEasels();
            } catch (e) {
                console.error("[ZenLibrary] could not read the easel index:", e);
                this._easels = [];
            }
        }

        // refresh() reloads the list; this puts the reloaded list back on screen. Guarded
        // because the cached list outlives the panel in _modules — a mutation can land
        // after the library has been closed, and re-rendering then would redraw a detached
        // element for nothing.
        async _reload() {
            await this.refresh();
            if (window.gZenLibrary?._isOpen && this.library.activeTab === "easels") {
                this.library.update(true);
            }
        }

        render() {
            const grid = this.el("div", { className: "easel-card-grid" });
            this.library.enterContent(grid);

            if (!this._store()) {
                grid.appendChild(this._empty(
                    "Zen Easel is not installed",
                    "Install and enable the zen-easel mod to keep boards here."
                ));
                this._scheduleRerender();
                return grid;
            }

            // First child of the two-column grid, so it sits at the top of the left
            // column rather than trailing the last board where it used to sit.
            grid.appendChild(this.el("button", {
                className: "easel-card easel-card-new",
                type: "button",
                title: "New easel",
                // [audit] This was _openEasel(null), which means "open whichever easel is
                // already open" — so with an easel tab up the button just focused it and
                // nothing appeared to happen. It creates a board now.
                onclick: () => this._newEasel()
            }));

            const term = (this._searchTerm || "").trim().toLowerCase();
            const visible = term
                ? this._easels.filter(e => (e.title || "").toLowerCase().includes(term))
                : this._easels;

            if (!visible.length) {
                grid.appendChild(this._empty(
                    term ? "No easels match" : "No easels yet",
                    term ? "Try a different search." : "Press Ctrl+Shift+E to start one."
                ));
            } else {
                for (const entry of visible) grid.appendChild(this._card(entry));
            }

            this._scheduleRerender();
            return grid;
        }

        // A cheap identity for the rendered list: what would make the grid look different.
        //
        // [audit] BUG-3 — this is load-bearing now that update(force) actually re-renders.
        // _scheduleRerender() is called from render(), so an unconditional re-render would
        // be render → refresh → render → refresh forever, one read of index.json per lap.
        // Comparing signatures means the loop settles the moment the list stops changing,
        // which is the first lap in the ordinary case.
        _signature(list = this._easels) {
            return list.map(e => `${e.id}:${e.updatedAt}:${e.title}`).join("|");
        }

        // The list is read asynchronously but render() is synchronous, so the first paint
        // after opening the section can be a frame behind. Re-render once the fresh index
        // lands rather than making the click wait on a file read.
        _scheduleRerender() {
            if (this._refreshing) return;
            this._refreshing = true;
            const before = this._signature();

            this.refresh()
                .then(() => {
                    this._refreshing = false;
                    if (this.library.activeTab !== "easels") return;
                    if (this._signature() === before) return;
                    this.library.update(true);
                })
                .catch(() => { this._refreshing = false; });
        }

        _cardTitle(title) {
            const text = title || "Untitled Easel";
            return text.length > 20 ? `${text.slice(0, 20)}…` : text;
        }

        _card(entry) {
            const mark = this.el("div", { className: "easel-card-mark" });
            const squiggle = this.svg(`<svg class="easel-card-squiggle" viewBox="20 38 76 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 79.08 42.08 C 91.19 54.79 88.45 58.62 81.98 56.04 C 75.51 53.47 66.12 44.54 59.62 47.55 C 53.12 50.56 91.47 84.24 77.76 86.61 C 72.57 87.51 43.87 53.27 34.03 56.04 C 23.75 58.94 58.53 84.24 60.64 100.31" stroke="currentColor" stroke-width="7.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
            if (squiggle) mark.appendChild(squiggle);

            const fullTitle = entry.title || "Untitled Easel";
            return this.el("button", {
                className: "easel-card",
                type: "button",
                dataset: { id: entry.id },
                title: fullTitle,
                oncontextmenu: e => this._contextMenu(e, entry),
                onclick: () => this._openEasel(entry.id)
            }, [
                this.el("div", { className: "easel-card-frame" }, [
                    this.el("div", { className: "easel-card-body" }, [
                        this.el("div", { className: "easel-card-count", textContent: String(entry.objectCount ?? 0) }),
                        this.el("div", { className: "easel-card-copy" }, [
                            mark,
                            this.el("div", { className: "easel-card-title", textContent: this._cardTitle(entry.title) })
                        ])
                    ])
                ])
            ]);
        }

        _empty(title, detail) {
            return this.el("div", { className: "empty-state" }, [
                this.el("div", { className: "empty-icon easels-icon" }),
                this.el("h3", { textContent: title }),
                this.el("p", { textContent: detail })
            ]);
        }

        /* ------------------------------------------------------------- actions */

        // Opening is the easel host's job: it owns the one-tab-per-easel rule and knows
        // whether about:easel resolved or the chrome URL fallback is in play.
        _openEasel(easelId) {
            const host = this._host();
            if (!host) return;
            host.openEasel(easelId);
            if (window.gZenLibrary) window.gZenLibrary.close();
        }

        // [audit] The "+" card. Creates a board and opens it — see createEasel() in
        // zen-easel's host for why this cannot just be _openEasel(null).
        //
        // Falls back to creating the document directly if the host predates createEasel,
        // so a mismatched pair of mod versions degrades to a working button rather than a
        // silent one.
        async _newEasel() {
            const host = this._host();
            if (!host) return;

            // Started before the panel closes, but not awaited until after: creating a board
            // is a file write, and holding the library open across it would make the click
            // feel like it had not registered — which is the complaint this whole change is
            // about.
            const creating = (async () => {
                if (typeof host.createEasel === "function") return host.createEasel();
                const store = this._store();
                if (!store) throw new Error("the Zen Easel store is not available");
                const { entry } = await store.createDocument("Untitled Easel");
                return host.openEasel(entry.id);
            })();

            if (window.gZenLibrary) window.gZenLibrary.close();

            try {
                await creating;
            } catch (e) {
                console.error("[ZenLibrary] could not create an easel:", e);
                return;
            }

            // close() declines while a transition is already running, so the section can
            // still be on screen here. Reload either way — the cached list is stale the
            // moment a board is added.
            await this._reload();
        }

        _host() {
            const host = window.gZenEaselHost;
            if (!host) {
                console.error("[ZenLibrary] the Zen Easel host is not loaded in this window");
            }
            return host || null;
        }

        // [audit] UI — this menu used to be a plain <div> parented into the library's own
        // shadow root. That made it a child of the sidebar panel: it was clipped at the
        // panel's edge, and it painted over the panel's translucent background instead of
        // an opaque surface of its own. It is now the same construction the History
        // section uses — a real XUL menupopup in mainPopupSet, opened at screen
        // coordinates — so the platform owns its styling, its backdrop and its
        // dismiss-on-outside-click, and it can overflow the sidebar.
        _ensureContextMenu() {
            if (document.getElementById("zen-easels-context-menu")) return;
            const popup = document.createXULElement("menupopup");
            popup.id = "zen-easels-context-menu";

            const openItem = document.createXULElement("menuitem");
            openItem.id = "zen-easels-ctx-open";
            openItem.setAttribute("label", "Open");

            const renameItem = document.createXULElement("menuitem");
            renameItem.id = "zen-easels-ctx-rename";
            renameItem.setAttribute("label", "Rename…");

            const deleteItem = document.createXULElement("menuitem");
            deleteItem.id = "zen-easels-ctx-delete";
            deleteItem.setAttribute("label", "Delete");

            popup.appendChild(openItem);
            popup.appendChild(renameItem);
            popup.appendChild(document.createXULElement("menuseparator"));
            popup.appendChild(deleteItem);
            (document.getElementById("mainPopupSet") || document.body).appendChild(popup);
        }

        _contextMenu(e, entry) {
            e.preventDefault();
            const store = this._store();
            if (!store) return;

            this._ensureContextMenu();
            const popup = document.getElementById("zen-easels-context-menu");

            // One popup is shared by every card, so the previous card's handlers have to go
            // before this card's are attached. Cloning each item over itself drops them with
            // the old node.
            for (const id of ["zen-easels-ctx-open", "zen-easels-ctx-rename", "zen-easels-ctx-delete"]) {
                const el = document.getElementById(id);
                if (el) el.replaceWith(el.cloneNode(true));
            }

            const on = (id, handler) => {
                document.getElementById(id).addEventListener("command", async () => {
                    try { await handler(); } catch (err) { console.error("[ZenLibrary]", err); }
                });
            };

            on("zen-easels-ctx-open", () => this._openEasel(entry.id));

            on("zen-easels-ctx-rename", async () => {
                const current = entry.title || "Untitled Easel";
                const value = { value: current };
                const ok = Services.prompt.prompt(window, "Rename easel", "New name:", value, null, { value: false });
                const title = ok ? value.value.trim() : "";
                // A name that came back unchanged is not worth an index write and a full
                // re-render of the grid.
                if (!title || title === current) return;
                await store.renameEasel(entry.id, title);
                await this._reload();
            });

            on("zen-easels-ctx-delete", async () => {
                const confirmed = Services.prompt.confirm(
                    window, "Delete easel",
                    `Delete "${entry.title || "Untitled Easel"}" and everything on it? This cannot be undone.`
                );
                if (!confirmed) return;
                await store.removeEasel(entry.id);

                this._easels = this._easels.filter(e => e.id !== entry.id);
                const grid = this.library.shadowRoot?.querySelector(".easel-card-grid");
                const card = grid?.querySelector(`.easel-card[data-id="${CSS.escape(entry.id)}"]`);
                if (!card) {
                    await this._reload();
                    return;
                }
                const siblings = [...grid.querySelectorAll(".easel-card")].filter(n => n !== card);
                await window.ZenLibraryUtil.animateCardRemove(card, { siblings });
                if (grid.isConnected && !grid.querySelector(".easel-card:not(.easel-card-new)")) {
                    // Branch on the search term like render() does, or the last match deleted reads as "no easels at all".
                    const term = (this._searchTerm || "").trim();
                    grid.appendChild(this._empty(
                        term ? "No easels match" : "No easels yet",
                        term ? "Try a different search." : "Press Ctrl+Shift+E to start one."
                    ));
                }
            });

            popup.openPopupAtScreen(e.screenX, e.screenY, true);
        }

        resetView() {
            this._searchTerm = "";
        }

        destroy() {
            // The popup lives in mainPopupSet, outside anything the library tears down
            // itself, so it has to be removed by hand or a reload leaves one behind.
            document.getElementById("zen-easels-context-menu")?.remove();
        }
    }

    window.ZenLibraryEasels = ZenLibraryEasels;
})();
