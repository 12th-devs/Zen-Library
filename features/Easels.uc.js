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

    const formatWhen = timestamp => {
        if (!timestamp) return "";
        const delta = Date.now() - timestamp;
        const minute = 60000, hour = 3600000, day = 86400000;
        if (delta < minute) return "just now";
        if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
        if (delta < day) return `${Math.floor(delta / hour)}h ago`;
        if (delta < day * 7) return `${Math.floor(delta / day)}d ago`;
        return new Date(timestamp).toLocaleDateString();
    };

    class ZenLibraryEasels {
        constructor(library) {
            this.library = library;
            this._easels = [];
            this._thumbUrls = new Map();
            this._searchTerm = "";
        }

        get el() { return this.library.el.bind(this.library); }

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

        render() {
            const grid = this.el("div", { className: "easel-card-grid" });

            if (!this._store()) {
                grid.appendChild(this._empty(
                    "Zen Easel is not installed",
                    "Install and enable the zen-easel mod to keep boards here."
                ));
                this._scheduleRerender();
                return grid;
            }

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

            grid.appendChild(this.el("button", {
                className: "easel-card easel-card-new",
                type: "button",
                title: "New easel",
                // [audit] This was _openEasel(null), which means "open whichever easel is
                // already open" — so with an easel tab up the button just focused it and
                // nothing appeared to happen. It creates a board now.
                onclick: () => this._newEasel()
            }, [
                this.el("div", { className: "easel-card-plus", textContent: "+" }),
                this.el("div", { className: "easel-card-title", textContent: "New easel" })
            ]));

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

        _card(entry) {
            const thumb = this.el("div", { className: "easel-card-thumb" });
            this._applyThumbnail(thumb, entry.id);

            return this.el("button", {
                className: "easel-card",
                type: "button",
                title: entry.title || "Untitled Easel",
                oncontextmenu: e => this._contextMenu(e, entry),
                onclick: () => this._openEasel(entry.id)
            }, [
                thumb,
                this.el("div", { className: "easel-card-title", textContent: entry.title || "Untitled Easel" }),
                this.el("div", {
                    className: "easel-card-meta",
                    textContent: [
                        formatWhen(entry.updatedAt),
                        entry.objectCount ? `${entry.objectCount} item${entry.objectCount === 1 ? "" : "s"}` : ""
                    ].filter(Boolean).join(" · ")
                })
            ]);
        }

        // Thumbnails are optional; a board that has never been saved since thumbnails
        // shipped simply shows the placeholder.
        async _applyThumbnail(node, easelId) {
            const store = this._store();
            if (!store) return;

            // [audit] LEAK-1 — this used to mint a fresh blob: URL on every render and
            // overwrite the map entry, orphaning the previous URL with no way to revoke it.
            // Re-rendering the section a few times leaked a 640x480 PNG per card each time,
            // and BUG-3's fix makes the section re-render far more often than it used to.
            //
            // Keyed on the easel's updatedAt so a board that has actually been redrawn still
            // picks up its new thumbnail; anything else is served from the cache.
            const entry = this._easels.find(e => e.id === easelId);
            const stamp = entry ? entry.updatedAt : 0;
            const cached = this._thumbUrls.get(easelId);
            if (cached && cached.stamp === stamp) {
                node.style.backgroundImage = `url("${cached.url}")`;
                node.classList.add("has-thumb");
                return;
            }

            try {
                const bytes = await store.readThumbnail(easelId);
                if (!bytes) return;
                if (cached) {
                    try { URL.revokeObjectURL(cached.url); } catch (e) { }
                }
                const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
                this._thumbUrls.set(easelId, { url, stamp });
                node.style.backgroundImage = `url("${url}")`;
                node.classList.add("has-thumb");
            } catch (e) { }
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
            // still be on screen here. Refresh either way — the cached list is stale the
            // moment a board is added, and it outlives the panel in _modules.
            await this.refresh();
            if (window.gZenLibrary?._isOpen && this.library.activeTab === "easels") {
                this.library.update(true);
            }
        }

        _host() {
            const host = window.gZenEaselHost;
            if (!host) {
                console.error("[ZenLibrary] the Zen Easel host is not loaded in this window");
            }
            return host || null;
        }

        _contextMenu(e, entry) {
            e.preventDefault();
            const store = this._store();
            if (!store) return;

            const menu = this.el("div", { className: "easel-card-menu" });
            const item = (label, handler, danger = false) => this.el("button", {
                className: `easel-card-menu-item${danger ? " is-danger" : ""}`,
                type: "button",
                textContent: label,
                onclick: async () => {
                    close();
                    try { await handler(); } catch (err) { console.error("[ZenLibrary]", err); }
                }
            });

            const close = () => {
                menu.remove();
                this.library.shadowRoot.removeEventListener("pointerdown", onOutside, true);
            };
            const onOutside = ev => { if (!menu.contains(ev.target)) close(); };

            menu.append(
                item("Open", () => this._openEasel(entry.id)),
                item("Rename…", async () => {
                    const value = { value: entry.title || "Untitled Easel" };
                    const ok = Services.prompt.prompt(window, "Rename easel", "New name:", value, null, { value: false });
                    if (!ok || !value.value.trim()) return;
                    await store.renameEasel(entry.id, value.value.trim());
                    await this.refresh();
                    this.library.update(true);
                }),
                item("Delete", async () => {
                    const confirmed = Services.prompt.confirm(
                        window, "Delete easel",
                        `Delete "${entry.title || "Untitled Easel"}" and everything on it? This cannot be undone.`
                    );
                    if (!confirmed) return;
                    await store.removeEasel(entry.id);
                    await this.refresh();
                    this.library.update(true);
                }, true)
            );

            const host = this.library.shadowRoot.querySelector(".library-content") || this.library.shadowRoot;
            const bounds = host.getBoundingClientRect();
            menu.style.left = `${e.clientX - bounds.left}px`;
            menu.style.top = `${e.clientY - bounds.top}px`;
            host.appendChild(menu);
            this.library.shadowRoot.addEventListener("pointerdown", onOutside, true);
        }

        resetView() {
            this._searchTerm = "";
        }

        destroy() {
            // Entries are { url, stamp } now, not bare strings. See _applyThumbnail.
            for (const { url } of this._thumbUrls.values()) {
                try { URL.revokeObjectURL(url); } catch (e) { }
            }
            this._thumbUrls.clear();
        }
    }

    window.ZenLibraryEasels = ZenLibraryEasels;
})();
