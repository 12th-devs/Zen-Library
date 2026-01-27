"use strict";

(function () {
    class ZenLibrarySpaces {
        static getWorkspaces() { return window.gZenWorkspaces ? window.gZenWorkspaces.getWorkspaces() : []; }

        static calculatePanelWidth(count) {
            // sidebar (90) + grid padding (40) + cards (count * 240) + gaps (count * 16) + create-button (36 + 2 margin)
            const total = 90 + 40 + (count * 240) + (count * 16) + 38;
            return Math.min(total, window.innerWidth * 0.8);
        }

        static getLastWidth() { return this._lastWidth || 340; }

        static calculateMediaColumns(width) {
            const sidebar = 90;
            const padding = 36;
            const colWidth = 210;
            const gap = 16;
            const scrollbarBuffer = 4;

            const avail = width - sidebar - padding - scrollbarBuffer;
            return Math.max(1, Math.floor((avail + gap + 2) / (colWidth + gap)));
        }

        static calculateMediaWidth(count) {
            const sidebar = 90;
            const padding = 36;
            const colWidth = 210;
            const gap = 16;
            const scrollbarBuffer = 4;

            let cols = 1;
            if (count > 6) cols = 3;
            else if (count > 2) cols = 2;

            const total = sidebar + padding + (cols * colWidth) + ((cols - 1) * gap) + scrollbarBuffer;
            return Math.min(total, window.innerWidth * 0.9);
        }

        static getData() {
            const workspaces = this.getWorkspaces();
            const width = this.calculatePanelWidth(workspaces.length);
            this._lastWidth = width;
            return { workspaces, width };
        }

        constructor(library) {
            this.library = library;
            // Local state for folder expansion
            this._folderExpansion = new Map();
        }

        get el() { return this.library.el.bind(this.library); }
        get svg() { return this.library.svg.bind(this.library); }

        render() {
            // Capture existing scroll position
            const oldGrid = this.library.shadowRoot.querySelector(".library-workspace-grid");
            const oldScroll = oldGrid ? oldGrid.scrollLeft : 0;

            const { workspaces, width } = ZenLibrarySpaces.getData();
            // We return the grid to be appended by the main update loop, 
            // OR we can manage the container ourselves if the shell delegates that.
            // Based on ZenLibrary.uc.js's shell logic, it calls render() but also handles the grid creation 
            // in its `update()` method for sticky headers etc?
            // Actually, the main shell's update() seems to handle the High Level structure.
            // But if we want to modularize, we should do as much as possible here.

            // However, the main shell's `update()` (lines 2856+ in backup) does a lot of heavy lifting 
            // including calculating width and diffing hash.
            // The REFRACTORED ZenLibrary.uc.js (which we verified) delegates to `.update()`?
            // No, the refactored ZenLibrary.uc.js calls `this._spaces.render()`?
            // Let's look at the refactored ZenLibrary.uc.js ... I don't have it fully in memory 
            // but the plan was for `renderSpaces()` or similar.

            // Assuming the shell calls `render()` and expects an element back.
            // BUT, the Spaces UI is a horizontal grid that affects the WINDOW WIDTH.
            // The logic to resize the window (`this.style.setProperty("--zen-library-width"...)`) 
            // IS in the shell's `update()`.

            // So this module should primarily return the CONTENT (the grid).

            const grid = this.el("div", { className: "library-workspace-grid" });
            const fragment = document.createDocumentFragment();

            for (const ws of workspaces) {
                const card = this.createWorkspaceCard(ws);
                if (card) fragment.appendChild(card);
            }

            // Add "Create Space" button at end of grid
            fragment.appendChild(this.el("div", {
                className: "library-create-workspace-button",
                title: "Create Space",
                onclick: () => {
                    window.gZenLibrary.close();
                    const creationCmd = document.getElementById("cmd_zenOpenWorkspaceCreation");
                    if (creationCmd) creationCmd.doCommand();
                }
            }, [
                this.el("span", { textContent: "+" })
            ]));

            grid.appendChild(fragment);

            // Optimized wheel handling matching backup
            grid.onwheel = (e) => {
                const list = e.target.closest(".library-workspace-card-list");
                let shouldScrollHorizontal = !list;
                if (list) {
                    const isAtTop = list.scrollTop <= 0 && e.deltaY < 0;
                    const isAtBottom = Math.abs(list.scrollHeight - list.scrollTop - list.clientHeight) < 1 && e.deltaY > 0;
                    if (isAtTop || isAtBottom) shouldScrollHorizontal = true;
                }

                if (e.deltaY !== 0 && shouldScrollHorizontal) {
                    e.preventDefault();
                    if (e.deltaMode === 1) grid.scrollBy({ left: e.deltaY * 30, behavior: "smooth" });
                    else grid.scrollLeft += e.deltaY * 1.5;
                }
            };

            grid.classList.add("library-content-fade-in");

            // Restore scroll position
            if (oldScroll > 0) {
                requestAnimationFrame(() => { grid.scrollLeft = oldScroll; });
            }

            // Only animate entry if it's a fresh load (no old grid), otherwise instant
            if (!oldGrid) {
                setTimeout(() => grid.classList.add("scrollbar-visible"), 100);
            } else {
                grid.classList.add("scrollbar-visible");
            }

            return grid;
        }

        // --- Core Rendering Logic Copied from Backup ---

        createFolderIconSVG(iconURL = '', state = 'close', active = false) {
            const id1 = "nebula-native-grad-0-" + Math.floor(Math.random() * 100000);
            const id2 = "nebula-native-grad-1-" + Math.floor(Math.random() * 100000);

            let imageTag = "";
            if (iconURL) {
                imageTag = `<image href="${iconURL}" height="10" width="10" transform="translate(9 11)" />`;
            }

            const svgStr = `
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" state="${state}" active="${active}">
                <defs>
                    <linearGradient gradientUnits="userSpaceOnUse" x1="14" y1="5.625" x2="14" y2="22.375" id="${id1}">
                        <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
                        <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
                    </linearGradient>
                    <linearGradient gradientUnits="userSpaceOnUse" x1="14" y1="9.625" x2="14" y2="22.375" id="${id2}">
                        <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
                        <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
                    </linearGradient>
                </defs>
                <path class="back" d="M8 5.625H11.9473C12.4866 5.625 13.0105 5.80861 13.4316 6.14551L14.2881 6.83105C14.9308 7.34508 15.7298 7.625 16.5527 7.625H20C21.3117 7.625 22.375 8.68832 22.375 10V20C22.375 21.3117 21.3117 22.375 20 22.375H8C6.68832 22.375 5.625 21.3117 5.625 20V8C5.625 6.68832 6.68832 5.625 8 5.625Z" style="fill: var(--ws-folder-behind);" />
                <path class="back" d="M8 5.625H11.9473C12.4866 5.625 13.0105 5.80861 13.4316 6.14551L14.2881 6.83105C14.9308 7.34508 15.7298 7.625 16.5527 7.625H20C21.3117 7.625 22.375 8.68832 22.375 10V20C22.375 21.3117 21.3117 22.375 20 22.375H8C6.68832 22.375 5.625 21.3117 5.625 20V8C5.625 6.68832 6.68832 5.625 8 5.625Z" style="stroke-width: 1.5px; stroke: var(--ws-folder-stroke); fill: url(#${id1}); fill-opacity: 0.1;" />
                <rect class="front" x="5.625" y="9.625" width="16.75" height="12.75" rx="2.375" style="fill: var(--ws-folder-front);" />
                <rect class="front" x="5.625" y="9.625" width="16.75" height="12.75" rx="2.375" style="stroke-width: 1.5px; stroke: var(--ws-folder-stroke); fill: url(#${id2}); fill-opacity: 0.1;" />
                <g class="icon" style="fill: var(--ws-folder-stroke, currentColor);">
                     ${imageTag}
                </g>
                <g class="dots" style="fill: var(--ws-folder-stroke);">
                    <ellipse cx="10" cy="16" rx="1.25" ry="1.25"/>
                    <ellipse cx="14" cy="16" rx="1.25" ry="1.25"/>
                    <ellipse cx="18" cy="16" rx="1.25" ry="1.25"/>
                </g>
            </svg>`;
            return this.svg(svgStr);
        }

        createWorkspaceCard(ws) {
            try {
                if (!window.gZenWorkspaces) return null;

                let themeData = { gradient: "var(--zen-primary-color)", grain: 0, primaryColor: "var(--zen-primary-color)", isDarkMode: true, toolbarColor: [255, 255, 255, 0.6] };
                if (window.gZenThemePicker && window.gZenThemePicker.getGradientForWorkspace) {
                    themeData = window.gZenThemePicker.getGradientForWorkspace(ws);
                }

                const card = this.el("div", { className: "library-workspace-card" });
                card.setAttribute("workspace-id", ws.uuid);
                card.style.setProperty("--ws-gradient", themeData.gradient);
                card.style.setProperty("--ws-grain", themeData.grain);

                const pColor = themeData.primaryColor;
                const tColor = `rgba(${themeData.toolbarColor.join(',')})`;

                card.style.setProperty("--ws-primary-color", pColor);
                card.style.setProperty("--ws-text-color", tColor);
                card.style.colorScheme = themeData.isDarkMode ? "dark" : "light";

                // Native Zen Tab Highlights
                if (themeData.isDarkMode) {
                    card.style.setProperty("--ws-tab-selected-color", "rgba(255, 255, 255, 0.12)");
                    card.style.setProperty("--ws-tab-selected-shadow", "0 1px 1px 1px rgba(0, 0, 0, 0.1)");
                } else {
                    card.style.setProperty("--ws-tab-selected-color", "rgba(255, 255, 255, 0.8)");
                    card.style.setProperty("--ws-tab-selected-shadow", "0 1px 1px 1px rgba(0, 0, 0, 0.09)");
                }
                card.style.setProperty("--ws-tab-hover-color", `color-mix(in srgb, ${tColor}, transparent 92.5%)`);

                if (themeData.isDarkMode) {
                    card.style.setProperty("--ws-folder-front", `color-mix(in srgb, ${pColor}, black 40%)`);
                    card.style.setProperty("--ws-folder-behind", `color-mix(in srgb, ${pColor} 60%, #c1c1c1)`);
                    card.style.setProperty("--ws-folder-stroke", `color-mix(in srgb, ${pColor} 15%, #ebebeb)`);
                } else {
                    card.style.setProperty("--ws-folder-front", `color-mix(in srgb, ${pColor}, white 70%)`);
                    card.style.setProperty("--ws-folder-behind", `color-mix(in srgb, ${pColor} 60%, gray)`);
                    card.style.setProperty("--ws-folder-stroke", `color-mix(in srgb, ${pColor} 50%, black)`);
                }

                if (themeData.isDarkMode) card.classList.add("dark");

                let iconEl;
                if (ws.icon && (ws.icon.includes("/") || ws.icon.startsWith("data:"))) {
                    iconEl = this.el("div", {
                        className: "library-workspace-icon",
                        style: `mask-image: url("${ws.icon}");`
                    });
                } else if (ws.icon && ws.icon.trim().length > 0) {
                    iconEl = this.el("span", { textContent: ws.icon, className: "library-workspace-icon-text" });
                } else {
                    iconEl = this.el("div", { className: "library-workspace-icon-empty" });
                }

                const iconContainer = this.el("div", {
                    className: "library-workspace-icon-container"
                }, [iconEl]);

                const editBtn = this.el("div", {
                    className: "library-workspace-edit-button",
                    title: "Edit Workspace"
                }, [this.el("div")]);

                editBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.showWorkspaceMenu(e, ws);
                });

                const header = this.el("div", { className: "library-workspace-card-header" }, [
                    iconContainer,
                    this.el("span", {
                        className: "library-workspace-name",
                        textContent: ws.name
                    }),
                    editBtn
                ]);

                const listContainer = this.el("div", { className: "library-workspace-card-list" });
                const wsEl = window.gZenWorkspaces.workspaceElement(ws.uuid);
                if (wsEl) {
                    const pinnedContainer = wsEl.pinnedTabsContainer;
                    const normalContainer = wsEl.tabsContainer;

                    const items = [];
                    const collect = (container) => {
                        if (!container) return;
                        Array.from(container.children).forEach(child => {
                            if (child.hasAttribute('cloned') || child.hasAttribute('zen-empty-tab')) return;
                            if (window.gBrowser.isTab(child) || window.gBrowser.isTabGroup(child)) {
                                items.push(child);
                            }
                        });
                    };

                    collect(pinnedContainer);
                    const pinnedCount = items.length;
                    collect(normalContainer);

                    let separatorCreated = false;
                    const itemsLen = items.length;
                    for (let i = 0; i < itemsLen; i++) {
                        const item = items[i];
                        if (i === pinnedCount && !separatorCreated) {
                            const cleanupBtn = this.el("div", {
                                className: "library-workspace-cleanup-button",
                                title: "Clear unpinned tabs"
                            }, [this.el("span", { textContent: "Clear" })]);

                            cleanupBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                this.closeWorkspaceUnpinnedTabs(ws.uuid);
                            });

                            const separatorContainer = this.el("div", { className: "library-workspace-separator-container" }, [
                                this.el("div", { className: "library-workspace-separator" }),
                                cleanupBtn
                            ]);
                            listContainer.appendChild(separatorContainer);
                            separatorCreated = true;
                        }
                        this.renderItemRecursive(item, listContainer, ws.uuid);
                    }

                    if (itemsLen === 0) {
                        listContainer.appendChild(this.el("div", {
                            className: "empty-state",
                            style: "padding: 20px; text-align:center; opacity:0.5; font-size: 12px;",
                            textContent: "Empty Workspace"
                        }));
                    }
                }

                const dragHandle = this.el("div", {
                    className: "library-workspace-drag-handle",
                    textContent: "⠿",
                    title: "Drag to reorder"
                });

                // Drag and Drop Logic
                dragHandle.addEventListener("mousedown", (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();

                    const grid = card.parentElement;
                    if (!grid) return;

                    const overlay = this.el("div", {
                        id: "library-drag-overlay",
                        style: "position: fixed; inset: 0; z-index: 9998; cursor: grabbing; pointer-events: auto;"
                    });
                    document.body.appendChild(overlay);

                    const preDragRect = card.getBoundingClientRect();
                    card.setAttribute("dragged", "true");
                    grid.setAttribute("dragging-workspace", "true");

                    const placeholder = this.el("div", { className: "library-workspace-card-placeholder entering" });
                    grid.insertBefore(placeholder, card);

                    card.style.width = preDragRect.width + "px";
                    card.style.height = preDragRect.height + "px";

                    const gridRectAtStart = grid.getBoundingClientRect();
                    card.style.left = (preDragRect.left - gridRectAtStart.left) + "px";
                    card.style.top = (preDragRect.top - gridRectAtStart.top) + "px";

                    void card.offsetWidth;
                    const scaledRect = card.getBoundingClientRect();
                    const initialOffsetX = e.clientX - scaledRect.left;
                    const initialOffsetY = e.clientY - scaledRect.top;

                    const originalIndex = Array.from(grid.children).indexOf(placeholder);

                    let currentX = preDragRect.left;
                    let currentY = preDragRect.top;
                    let targetX = preDragRect.left;
                    let targetY = preDragRect.top;
                    let isDragging = true;
                    let isLanding = false;
                    let mouseX = e.clientX;
                    let mouseY = e.clientY;

                    const finalizeDrop = () => {
                        isDragging = false;
                        isLanding = false;
                        overlay.remove();

                        grid.removeAttribute("dragging-workspace");

                        Array.from(grid.children).forEach(s => {
                            s.style.transition = "";
                            s.style.transform = "";
                        });

                        grid.insertBefore(card, placeholder);
                        card.removeAttribute("dragged");
                        card.style.width = "";
                        card.style.height = "";
                        card.style.left = "";
                        card.style.top = "";
                        card.style.backgroundColor = "";

                        const newIndex = Array.from(grid.children).indexOf(card);
                        placeholder.remove();

                        if (newIndex !== originalIndex) {
                            if (window.gZenWorkspaces && window.gZenWorkspaces.reorderWorkspace) {
                                window.gZenWorkspaces.reorderWorkspace(ws.uuid, newIndex);
                                setTimeout(() => {
                                    if (this.library.update) this.library.update();
                                }, 100);
                            }
                        }

                        // Safety: Ensure create button is always last
                        const createBtn = grid.querySelector('.library-create-workspace-button');
                        if (createBtn && (card.compareDocumentPosition(createBtn) & Node.DOCUMENT_POSITION_PRECEDING)) {
                            grid.appendChild(createBtn);
                        }
                    };

                    const moveLoop = () => {
                        if (!isDragging && !isLanding) return;

                        const lerpFactor = isLanding ? 0.25 : 0.18;
                        currentX += (targetX - currentX) * lerpFactor;
                        currentY += (targetY - currentY) * lerpFactor;

                        const currentGridRect = grid.getBoundingClientRect();
                        card.style.left = (currentX - currentGridRect.left) + "px";
                        card.style.top = (currentY - currentGridRect.top) + "px";

                        if (isLanding) {
                            const dist = Math.hypot(targetX - currentX, targetY - currentY);
                            if (dist < 0.5) {
                                finalizeDrop();
                                return;
                            }
                        } else {
                            const scrollThreshold = 150;
                            if (mouseX < currentGridRect.left + scrollThreshold) {
                                const intensity = Math.pow((currentGridRect.left + scrollThreshold - mouseX) / scrollThreshold, 2);
                                grid.scrollLeft -= intensity * 25;
                            } else if (mouseX > currentGridRect.right - scrollThreshold) {
                                const intensity = Math.pow((mouseX - (currentGridRect.right - scrollThreshold)) / scrollThreshold, 2);
                                grid.scrollLeft += intensity * 25;
                            }
                        }

                        requestAnimationFrame(moveLoop);
                    };

                    const onMouseMove = (moveEvent) => {
                        mouseX = moveEvent.clientX;
                        mouseY = moveEvent.clientY;
                        targetX = mouseX - initialOffsetX;
                        targetY = mouseY - initialOffsetY;

                        const gridRect = grid.getBoundingClientRect();
                        const scrollLeft = grid.scrollLeft;
                        const paddingLeft = 16;
                        const cardWidthPlusGap = 240 + 16;

                        const localX = mouseX - gridRect.left + scrollLeft - paddingLeft;
                        let targetIdx = Math.floor(localX / cardWidthPlusGap);

                        const currentChildren = Array.from(grid.children).filter(c => c.classList.contains('library-workspace-card') && !c.hasAttribute('dragged') || c === placeholder);
                        targetIdx = Math.max(0, Math.min(targetIdx, currentChildren.length - 1));

                        const currentIdx = currentChildren.indexOf(placeholder);

                        if (targetIdx !== currentIdx) {
                            const siblings = currentChildren.filter(c => c !== placeholder);
                            const firstPositions = new Map();
                            siblings.forEach(s => firstPositions.set(s, s.getBoundingClientRect()));

                            // Find target element among static flow
                            const swapTarget = currentChildren[targetIdx < currentIdx ? targetIdx : targetIdx + 1] || grid.querySelector('.library-create-workspace-button');

                            grid.insertBefore(placeholder, swapTarget);

                            // Re-check index in the NEW child list
                            const newChildren = Array.from(grid.children).filter(c => c.classList.contains('library-workspace-card') && !c.hasAttribute('dragged') || c === placeholder);
                            const finalIdx = newChildren.indexOf(placeholder);

                            if (finalIdx !== currentIdx) {
                                // Trigger animation
                                placeholder.classList.remove("entering");
                                void placeholder.offsetWidth;
                                placeholder.classList.add("entering");

                                // Shift siblings smoothly (FLIP)
                                siblings.forEach(s => {
                                    const first = firstPositions.get(s);
                                    const last = s.getBoundingClientRect();
                                    const dx = first.left - last.left;
                                    if (dx !== 0) {
                                        s.style.transition = 'none';
                                        s.style.transform = `translateX(${dx}px)`;
                                        void s.offsetWidth;
                                        requestAnimationFrame(() => {
                                            s.style.transition = 'transform 0.3s var(--zen-library-easing)';
                                            s.style.transform = '';
                                        });
                                    }
                                });
                            }
                        }
                    };

                    const onMouseUp = () => {
                        isDragging = false;
                        document.removeEventListener("mousemove", onMouseMove);
                        document.removeEventListener("mouseup", onMouseUp);

                        const finalRect = placeholder.getBoundingClientRect();
                        targetX = finalRect.left;
                        targetY = finalRect.top;
                        isLanding = true;
                    };

                    document.addEventListener("mousemove", onMouseMove);
                    document.addEventListener("mouseup", onMouseUp);
                    requestAnimationFrame(moveLoop);
                });

                const footer = this.el("div", { className: "library-card-footer" }, [
                    dragHandle,
                    this.el("div", { textContent: "⋯" })
                ]);

                card.appendChild(header);
                card.appendChild(listContainer);
                card.appendChild(footer);

                return card;
            } catch (e) {
                console.error("Error creating workspace card:", e);
                return null;
            }
        }

        closeWorkspaceUnpinnedTabs(workspaceId) {
            const wsEl = window.gZenWorkspaces.workspaceElement(workspaceId);
            const tabs = Array.from(wsEl?.tabsContainer?.children || []).filter(child =>
                window.gBrowser.isTab(child) && !child.hasAttribute("zen-essential")
            );

            if (tabs.length === 0) return;

            let closableTabs = tabs.filter(tab => {
                const attributes = ["selected", "multiselected", "pictureinpicture", "soundplaying"];
                for (const attr of attributes) if (tab.hasAttribute(attr)) return false;
                const browser = tab.linkedBrowser;
                if (window.webrtcUI?.browserHasStreams(browser) ||
                    browser?.browsingContext?.currentWindowGlobal?.hasActivePeerConnections()) return false;
                return true;
            });

            if (closableTabs.length === 0) closableTabs = tabs;

            window.gBrowser.removeTabs(closableTabs, {
                closeWindowWithLastTab: false,
            });

            if (window.gZenUIManager?.showToast) {
                const restoreKey = window.gZenKeyboardShortcutsManager?.getShortcutDisplayFromCommand(
                    "History:RestoreLastClosedTabOrWindowOrSession"
                ) || "Ctrl+Shift+T";

                window.gZenUIManager.showToast("zen-workspaces-close-all-unpinned-tabs-toast", {
                    l10nArgs: { shortcut: restoreKey },
                });
            }

            if (this.library.update) {
                setTimeout(() => this.library.update(), 200);
            }
        }

        renderItemRecursive(item, container, wsId) {
            if (window.gBrowser.isTabGroup(item)) {
                if (item.hasAttribute("split-view-group")) {
                    this.renderSplitView(item, container, wsId);
                } else {
                    this.renderFolder(item, container, wsId);
                }
            } else if (window.gBrowser.isTab(item)) {
                this.renderTab(item, container, wsId);
            }
        }

        renderSplitView(group, container, wsId) {
            const splitEl = this.el("div", { className: "library-split-view-group" });
            const tabs = (group.tabs || []).filter(child => {
                return !child.hasAttribute('cloned') && !child.hasAttribute('zen-empty-tab');
            });
            tabs.forEach(tab => this.renderTab(tab, splitEl, wsId));
            container.appendChild(splitEl);
        }

        renderFolder(folder, container, wsId) {
            const folderId = folder.id || `${wsId}:${folder.label}`;

            let isExpanded;
            if (this._folderExpansion.has(folderId)) {
                isExpanded = this._folderExpansion.get(folderId);
            } else {
                const isNativeCollapsed = folder.hasAttribute("zen-folder-collapsed") || folder.collapsed;
                isExpanded = !isNativeCollapsed;
                this._folderExpansion.set(folderId, isExpanded);
            }

            const allTabs = folder.allItemsRecursive || folder.tabs || [];
            const hasActive = allTabs.some(t => t.selected);

            const folderEl = this.el("div", { className: `library-workspace-folder ${isExpanded ? '' : 'collapsed'}` });

            const headerEl = this.el("div", {
                className: "library-workspace-item folder",
                onclick: (e) => {
                    e.stopPropagation();
                    const currentlyExpanded = this._folderExpansion.get(folderId);
                    const newlyExpanded = !currentlyExpanded;

                    this._folderExpansion.set(folderId, newlyExpanded);
                    folderEl.classList.toggle("collapsed", !newlyExpanded);

                    const chevron = headerEl.querySelector(".folder-chevron svg");
                    if (chevron) {
                        const rot = newlyExpanded ? "0deg" : "-90deg";
                        chevron.setAttribute("style", `transform: rotate(${rot}); transition: transform 0.2s;`);
                    }

                    const iconSvg = headerEl.querySelector(".folder-icon svg");
                    if (iconSvg) {
                        iconSvg.setAttribute("state", newlyExpanded ? "open" : "close");
                    }
                }
            });

            const rot = isExpanded ? '0deg' : '-90deg';
            const chevronSvg = this.svg(`<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" style="transform: rotate(${rot}); transition: transform 0.2s;"><path d="M7 10l5 5 5-5z"/></svg>`);

            const folderIconSvg = this.createFolderIconSVG(folder.iconURL, isExpanded ? "open" : "close", hasActive && !isExpanded);

            headerEl.appendChild(this.el("span", { className: "folder-chevron" }, [chevronSvg]));

            const iconWrapper = this.el("span", { className: "item-icon folder-icon" });
            iconWrapper.appendChild(folderIconSvg);
            headerEl.appendChild(iconWrapper);

            headerEl.appendChild(this.el("span", { className: "item-label", textContent: folder.label || "Folder" }));

            folderEl.appendChild(headerEl);

            const contentEl = this.el("div", { className: "library-workspace-folder-content" });
            const children = (folder.allItems || folder.tabs || []).filter(child => {
                return !child.hasAttribute('cloned') && !child.hasAttribute('zen-empty-tab');
            });
            children.forEach(child => this.renderItemRecursive(child, contentEl, wsId));

            folderEl.appendChild(contentEl);
            container.appendChild(folderEl);
        }

        renderTab(tab, container, wsId) {
            const iconSrc = tab.image || tab.icon || "chrome://global/skin/icons/defaultFavicon.svg";
            const isPinned = tab.pinned;

            const itemEl = this.el("div", {
                className: `library-workspace-item ${tab.selected ? 'selected' : ''}`,
                onclick: () => {
                    if (window.gZenWorkspaces.activeWorkspace !== wsId) {
                        window.gZenWorkspaces.changeWorkspaceWithID(wsId);
                    }
                    window.gBrowser.selectedTab = tab;
                    window.gZenLibrary.close();
                }
            }, [
                this.el("img", { src: iconSrc, className: "item-icon", onerror: "this.src='chrome://global/skin/icons/defaultFavicon.svg'" }),
                this.el("span", { className: "item-label", textContent: tab.label })
            ]);

            const contextId = tab.getAttribute("usercontextid");
            if (contextId && contextId !== "0") {
                const computedStyle = window.getComputedStyle(tab);
                const identityColor = computedStyle.getPropertyValue("--identity-tab-color");
                const identityLine = this.el("div", {
                    className: "library-tab-identity-line",
                    style: `--identity-tab-color: ${identityColor || 'transparent'}`
                });
                itemEl.appendChild(identityLine);
            }

            const closeBtn = this.el("div", {
                className: `library-tab-close-button ${isPinned ? 'unpin' : 'close'}`,
                title: isPinned ? "Unpin Tab" : "Close Tab",
                onclick: (e) => {
                    e.stopPropagation();
                    if (isPinned) {
                        window.gBrowser.unpinTab(tab);
                    } else {
                        window.gBrowser.removeTab(tab);
                    }
                    if (this.library.update) setTimeout(() => this.library.update(), 150);
                }
            }, [this.el("div", { className: "icon-mask" })]);
            itemEl.appendChild(closeBtn);

            container.appendChild(itemEl);
        }

        showWorkspaceMenu(e, ws) {
            const button = e.currentTarget;
            const shadow = this.library.shadowRoot;

            // Remove existing menu if any
            const existing = shadow.querySelector(".library-workspace-menu");
            if (existing) existing.remove();

            const svgs = {
                rename: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 18L19.9999 19.094C19.4695 19.6741 18.7502 20 18.0002 20C17.2501 20 16.5308 19.6741 16.0004 19.094C15.4693 18.5151 14.75 18.1901 14.0002 18.1901C13.2504 18.1901 12.5312 18.5151 12 19.094M3.00003 20H4.67457C5.16376 20 5.40835 20 5.63852 19.9447C5.84259 19.8957 6.03768 19.8149 6.21663 19.7053C6.41846 19.5816 6.59141 19.4086 6.93732 19.0627L19.5001 6.49998C20.3285 5.67156 20.3285 4.32841 19.5001 3.49998C18.6716 2.67156 17.3285 2.67156 16.5001 3.49998L3.93729 16.0627C3.59139 16.4086 3.41843 16.5816 3.29475 16.7834C3.18509 16.9624 3.10428 17.1574 3.05529 17.3615C3.00003 17.5917 3.00003 17.8363 3.00003 18.3255V20Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                icon: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3.5V2M5.06066 5.06066L4 4M5.06066 13L4 14.0607M13 5.06066L14.0607 4M3.5 9H2M15.8645 16.1896L13.3727 20.817C13.0881 21.3457 12.9457 21.61 12.7745 21.6769C12.6259 21.7349 12.4585 21.7185 12.324 21.6328C12.1689 21.534 12.0806 21.2471 11.9038 20.6733L8.44519 9.44525C8.3008 8.97651 8.2286 8.74213 8.28669 8.58383C8.33729 8.44595 8.44595 8.33729 8.58383 8.2867C8.74213 8.22861 8.9765 8.3008 9.44525 8.44519L20.6732 11.9038C21.247 12.0806 21.5339 12.169 21.6327 12.324C21.7185 12.4586 21.7348 12.6259 21.6768 12.7745C21.61 12.9458 21.3456 13.0881 20.817 13.3728L16.1896 15.8645C16.111 15.9068 16.0717 15.9279 16.0374 15.9551C16.0068 15.9792 15.9792 16.0068 15.9551 16.0374C15.9279 16.0717 15.9068 16.111 15.8645 16.1896Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                theme: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.99997 11.2224L12.7778 15.0002M7.97485 20.975C6.60801 22.3419 4 22.0002 2 22.0002C3.0251 20.0002 1.65827 17.3921 3.0251 16.0253C4.39194 14.6585 6.60801 14.6585 7.97485 16.0253C9.34168 17.3921 9.34168 19.6082 7.97485 20.975ZM11.9216 15.9248L21.0587 6.05671C21.8635 5.18755 21.8375 3.83776 20.9999 3.00017C20.1624 2.16258 18.8126 2.13663 17.9434 2.94141L8.07534 12.0785C7.5654 12.5507 7.31043 12.7868 7.16173 13.0385C6.80514 13.6423 6.79079 14.3887 7.12391 15.0057C7.26283 15.2631 7.50853 15.5088 7.99995 16.0002C8.49136 16.4916 8.73707 16.7373 8.99438 16.8762C9.6114 17.2093 10.3578 17.195 10.9616 16.8384C11.2134 16.6897 11.4494 16.4347 11.9216 15.9248Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                profile: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 21V19C22 17.1362 20.7252 15.5701 19 15.126M15.5 3.29076C16.9659 3.88415 18 5.32131 18 7C18 8.67869 16.9659 10.1159 15.5 10.7092M17 21C17 19.1362 17 18.2044 16.6955 17.4693C16.2895 16.4892 15.5108 15.7105 14.5307 15.3045C13.7956 15 12.8638 15 11 15H8C6.13623 15 5.20435 15 4.46927 15.3045C3.48915 15.7105 2.71046 16.4892 2.30448 17.4693C2 18.2044 2 19.1362 2 21M13.5 7C13.5 9.20914 11.7091 11 9.5 11C7.29086 11 5.5 9.20914 5.5 7C5.5 4.79086 7.29086 3 9.5 3C11.7091 3 13.5 4.79086 13.5 7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                unload: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.93 4.93L19.07 19.07M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            };

            const card = button.closest(".library-workspace-card");
            const menu = this.el("div", { className: "library-workspace-menu" }, [
                this.createMenuItem("Rename", svgs.rename, (e) => this.renameWorkspace(ws)),
                this.createMenuItem("Change Icon", svgs.icon, (e) => this.changeWorkspaceIcon(ws, button)),
                this.createMenuItem("Edit Theme", svgs.theme, (e) => this.editWorkspaceTheme(ws, e)),
                this.createMenuItem("Unload Space", svgs.unload, (e) => this.unloadWorkspace(ws))
            ]);

            // Copy theme variables for hover states and colors
            if (card) {
                const vars = ["--ws-tab-hover-color", "--ws-tab-selected-color", "--ws-primary-color"];
                vars.forEach(v => menu.style.setProperty(v, card.style.getPropertyValue(v)));
                if (card.classList.contains("dark")) menu.classList.add("dark");
            }

            shadow.appendChild(menu);

            // Position it
            const rect = button.getBoundingClientRect();
            const grid = shadow.querySelector(".library-workspace-grid");
            const gridRect = grid.getBoundingClientRect();

            // Check if we have enough space below, else show above
            let top = rect.bottom - gridRect.top + 4;
            const menuHeight = 180; // Estimate
            if (top + menuHeight > gridRect.height) {
                top = rect.top - gridRect.top - menuHeight - 4;
            }

            menu.style.top = top + "px";
            menu.style.left = (rect.left - gridRect.left) + "px";

            // Click away and cleanup
            const closeMenu = (ev) => {
                // Don't close if clicking in the main menu OR the container submenu
                if (!menu.contains(ev.target) && !ev.target.closest(".library-container-submenu")) {
                    menu.classList.add("fade-out");
                    setTimeout(() => menu.remove(), 150);
                    window.removeEventListener("mousedown", closeMenu);
                    window.removeEventListener("wheel", closeMenu);
                }
            };
            window.addEventListener("mousedown", closeMenu);
            window.addEventListener("wheel", closeMenu);
        }

        createMenuItem(label, iconSvg, onclick, autoClose = true) {
            const item = this.el("div", {
                className: "menu-item",
                onclick: (e) => {
                    e.stopPropagation(); // Always stop propagation
                    onclick(e);
                    // Close menu after action if requested
                    if (autoClose) {
                        const menu = e.target.closest(".library-workspace-menu");
                        if (menu) {
                            menu.classList.add("fade-out");
                            setTimeout(() => menu.remove(), 150);
                        }
                    }
                }
            }, [
                this.el("div", { className: "menu-icon", innerHTML: iconSvg }),
                this.el("span", { textContent: label })
            ]);
            return item;
        }

        startInlineRename(e, ws) {
            const nameSpan = e.currentTarget;
            if (nameSpan.querySelector('input')) return;

            const originalName = ws.name;
            let finished = false;

            const input = this.el("input", {
                className: "library-workspace-rename-input",
                value: originalName,
                onkeydown: (ev) => {
                    if (ev.key === "Enter") {
                        ev.preventDefault();
                        finish(input.value);
                    } else if (ev.key === "Escape") {
                        ev.preventDefault();
                        finish(originalName);
                    }
                }
            });

            const finish = (newName) => {
                if (finished) return;
                finished = true;
                window.removeEventListener("mousedown", onClickOutside, true);

                if (newName && newName.trim() && newName !== originalName) {
                    ws.name = newName.trim();
                    if (window.gZenWorkspaces?.saveWorkspace) {
                        window.gZenWorkspaces.saveWorkspace(ws);
                    }
                    nameSpan.textContent = ws.name;
                } else {
                    nameSpan.textContent = originalName;
                }
                nameSpan.classList.remove("renaming");
            };

            // Global mousedown listener to cancel rename when clicking elsewhere
            const onClickOutside = (ev) => {
                // Allow clicking inside the name container (input or padding)
                if (!nameSpan.contains(ev.target)) {
                    finish(originalName);
                }
            };

            // Use capture phase to ensure we catch the click before blur
            window.addEventListener("mousedown", onClickOutside, true);

            nameSpan.innerHTML = "";
            nameSpan.appendChild(input);
            nameSpan.classList.add("renaming");
            input.focus();
            input.select();
        }

        async renameWorkspace(ws) {
            const header = this.library.shadowRoot.querySelector(`.library-workspace-card[workspace-id="${ws.uuid}"] .library-workspace-name`);
            if (header) {
                this.startInlineRename({ currentTarget: header }, ws);
            }
        }

        changeWorkspaceIcon(ws, anchor) {
            if (!window.gZenEmojiPicker) return;

            window.gZenEmojiPicker.open(anchor).then(async (emoji) => {
                // If emoji is null or empty, it means "delete icon" was pressed
                ws.icon = emoji || "";
                if (window.gZenWorkspaces?.saveWorkspace) {
                    await window.gZenWorkspaces.saveWorkspace(ws);
                    if (this.library.update) this.library.update();
                }
            }).catch(() => { }); // Prevent console errors on picker closing
        }

        async editWorkspaceTheme(ws, e) {
            // Close the library first to return focus to the main window
            if (window.gZenLibrary?.close) {
                window.gZenLibrary.close();
            }

            // Switch workspace if needed
            if (window.gZenWorkspaces.activeWorkspace !== ws.uuid) {
                await window.gZenWorkspaces.changeWorkspaceWithID(ws.uuid);
            }

            // Force focus to the main window content to ensure commands work
            if (window.content) window.content.focus();

            // Trigger after a safe delay
            setTimeout(() => {
                const cmd = document.getElementById("cmd_zenOpenZenThemePicker");
                if (cmd) cmd.doCommand();
            }, 300);
        }

        async unloadWorkspace(ws) {
            if (!window.gBrowser?.explicitUnloadTabs) return;

            const tabsToUnload = window.gZenWorkspaces.allStoredTabs.filter(
                (tab) =>
                    tab.getAttribute("zen-workspace-id") === ws.uuid &&
                    !tab.hasAttribute("zen-empty-tab") &&
                    !tab.hasAttribute("zen-essential") &&
                    !tab.hasAttribute("pending")
            );

            if (tabsToUnload.length === 0) return;

            await window.gBrowser.explicitUnloadTabs(tabsToUnload);
            if (this.library.update) setTimeout(() => this.library.update(), 500);
        }
    }

    window.ZenLibrarySpaces = ZenLibrarySpaces;
})();
