"use strict";

(function () {
    class ZenLibraryDownloads {
        constructor(library) {
            this.library = library;
            this._container = null;
            this._searchTerm = "";
            this._cachedDownloads = null; // Pre-fetched data cache
            this._isFetching = false;
        }

        /**
         * Background initialization - called at startup to pre-fetch data
         */
        async init() {
            if (this._isFetching) return;
            this._isFetching = true;
            try {
                this._cachedDownloads = await this.fetchDownloads();
            } catch (e) {
                console.error("ZenLibrary Downloads init error:", e);
            } finally {
                this._isFetching = false;
            }
        }

        get el() { return this.library.el.bind(this.library); }

        render() {
            // Main wrapper for switcher and panes
            const wrapper = this.el("div", {
                className: "library-list-wrapper"
            });
            const container = this.el("div", { className: "library-list-container" });
            wrapper.appendChild(container);
            this._container = container;
            this.library._downloadsContainer = container;

            // If we have cached data, render instantly
            if (this._cachedDownloads) {
                this.renderList(this._cachedDownloads);
                container.classList.add("library-content-fade-in");
                setTimeout(() => container.classList.add("scrollbar-visible"), 50);
                // Trigger a background sync to check for updates
                this.sync();
                return wrapper;
            }

            // No cache - show loading and fetch
            const loading = this.el("div", { className: "empty-state library-content-fade-in" }, [
                this.el("div", { className: "empty-icon downloads-icon" }),
                this.el("h3", { textContent: "Loading downloads..." }),
                this.el("p", { textContent: "Hang tight, we're gathering your download history." })
            ]);
            container.appendChild(loading);

            const isTransitioning = window.gZenLibrary && window.gZenLibrary._isTransitioning;
            const delay = isTransitioning ? 300 : 100;
            setTimeout(() => {
                this.fetchDownloads().then(downloads => {
                    this._cachedDownloads = downloads;
                    const l = container.querySelector(".empty-state");
                    if (l) l.remove();
                    this.renderList(downloads);
                    container.classList.add("library-content-fade-in");
                    setTimeout(() => container.classList.add("scrollbar-visible"), 100);
                });
            }, delay);

            return wrapper;
        }

        /**
         * Sync - called after rendering cached data to check for updates
         * Always re-fetches to detect status changes (e.g., deleted files)
         */
        async sync() {
            try {
                const freshDownloads = await this.fetchDownloads();

                // Always update cache and re-render to catch status changes
                // Status changes (deleted, completed) don't change length/timestamp
                this._cachedDownloads = freshDownloads;
                this.renderList(freshDownloads);
            } catch (e) {
                console.error("ZenLibrary Downloads sync error:", e);
            }
        }


        async fetchDownloads() {
            try {
                const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
                const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
                const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");

                const isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
                const list = await DownloadHistory.getList({ type: isPrivate ? Downloads.ALL : Downloads.PUBLIC });
                const allDownloadsRaw = await list.getAll();

                return allDownloadsRaw.map(d => {
                    let filename = "Unknown Filename";
                    let targetPath = "";
                    let fileExists = false;

                    if (d.target && d.target.path) {
                        try {
                            let file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                            file.initWithPath(d.target.path);
                            fileExists = file.exists();
                            filename = file.leafName;
                            targetPath = d.target.path;
                        } catch (e) {
                            const pathParts = String(d.target.path).split(/[\\/]/);
                            filename = pathParts.pop() || "ErrorInPathUtil";
                        }
                    }

                    if ((filename === "Unknown Filename" || filename === "ErrorInPathUtil") && d.source && d.source.url) {
                        try {
                            const decodedUrl = decodeURIComponent(d.source.url);
                            let urlObj;
                            try {
                                urlObj = new URL(decodedUrl);
                                const pathSegments = urlObj.pathname.split("/");
                                filename = pathSegments.pop() || pathSegments.pop() || "Unknown from URL Path";
                            } catch (urlParseError) {
                                const urlPartsDirect = String(d.source.url).split("/");
                                const lastPartDirect = urlPartsDirect.pop() || urlPartsDirect.pop();
                                filename = lastPartDirect.split("?")[0] || "Invalid URL Filename";
                            }
                        } catch (e) {
                            const urlPartsDirect = String(d.source.url).split("/");
                            const lastPartDirect = urlPartsDirect.pop() || urlPartsDirect.pop();
                            filename = lastPartDirect.split("?")[0] || "Invalid URL Filename";
                        }
                    }

                    let status = "unknown";
                    let progressBytes = Number(d.bytesTransferredSoFar) || 0;
                    let totalBytes = Number(d.totalBytes) || 0;

                    if (d.succeeded) {
                        status = "completed";
                        if (d.target && d.target.size && Number(d.target.size) > totalBytes) {
                            totalBytes = Number(d.target.size);
                        }
                        progressBytes = totalBytes;
                    } else if (d.error || d.canceled) {
                        status = "failed";
                    } else if (d.stopped || d.hasPartialData || d.state === Downloads.STATE_PAUSED || d.state === Downloads.STATE_DOWNLOADING) {
                        status = "paused";
                    }

                    if (status === "completed" && totalBytes === 0 && progressBytes > 0) {
                        totalBytes = progressBytes;
                    }

                    if (d.target && d.target.path && !fileExists) {
                        status = "deleted";
                    }

                    return {
                        id: d.id,
                        filename: String(filename || "FN_MISSING"),
                        size: totalBytes,
                        status: status,
                        url: String(d.source?.url || "URL_MISSING"),
                        timestamp: d.endTime || d.startTime || Date.now(),
                        targetPath: String(targetPath || ""),
                        raw: d
                    };
                }).filter(d => d.timestamp && (this._searchTerm ? d.filename.toLowerCase().includes(this._searchTerm.toLowerCase()) : true));

            } catch (e) {
                console.error("ZenLibrary: Error fetching downloads", e);
                return [];
            }
        }

        renderList(downloads) {
            if (!this._container) return;
            this._container.innerHTML = "";
            this._container.classList.add("scrollbar-visible");

            if (downloads.length === 0) {
                const emptyState = this.el("div", { className: "empty-state" }, [
                    this.el("div", { className: "empty-icon downloads-icon" }),
                    this.el("h3", { textContent: "No downloads found" }),
                    this.el("p", { textContent: this._searchTerm ? "Try a different search term." : "Your download history is empty." })
                ]);
                this._container.appendChild(emptyState);
                return;
            }

            // Group by date
            const groups = {};
            const now = new Date();
            downloads.forEach(d => {
                const date = new Date(d.timestamp);
                const diffTime = now - date;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                let key = "Earlier";
                if (diffDays === 0 && now.getDate() === date.getDate()) key = "Today";
                else if (diffDays === 1) key = "Yesterday";
                else if (diffDays < 7) key = date.toLocaleDateString(undefined, { weekday: "long" });
                else if (diffDays < 30) key = "Last Month";

                if (!groups[key]) groups[key] = [];
                groups[key].push(d);
            });

            const order = ["Today", "Yesterday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Last Month", "Earlier"];

            order.forEach(key => {
                if (!groups[key]) return;

                this._container.appendChild(this.el("div", { className: "history-section-header", textContent: key }));

                groups[key].sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
                    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    const itemEl = new window.ZenLibraryItem();
                    itemEl.data = item; // Sets item data and status classes
                    itemEl.setAttribute("icon", `moz-icon://${item.targetPath}?size=32`);
                    itemEl.setAttribute("title", item.filename);
                    itemEl.setAttribute("subtitle", `${this.formatBytes(item.size)} • ${item.status}`);
                    itemEl.setAttribute("time", timeStr);

                    itemEl.onclick = (e) => {
                        // Ignore clicks on the folder icon, handled separately
                        if (e.target.closest('.item-folder-icon')) return;
                        this.handleAction(item, "open");
                    };
                    itemEl.oncontextmenu = (e) => {
                        e.preventDefault();
                        this.handleContextMenu(e, item);
                    };

                    const folderIcon = this.el("div", {
                        className: `item-folder-icon${item.status === "deleted" ? " disabled" : ""}`,
                        title: item.status === "deleted" ? "File deleted" : "Show in Folder",
                        onclick: (e) => {
                            e.stopPropagation();
                            if (item.status === "deleted") return;
                            this.handleAction(item, "show");
                        },
                        innerHTML: `<div class="item-folder-mask"></div>`
                    });

                    itemEl.appendSecondaryAction(folderIcon);
                    this._container.appendChild(itemEl);
                });
            });

            this._container.appendChild(this.el("div", { className: "history-bottom-spacer" }));
        }

        handleAction(item, action) {
            try {
                const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                file.initWithPath(item.targetPath);

                if (action === "open-external" || action === "open") {
                    if (file.exists()) file.launch();
                    else alert("File does not exist.");
                } else if (action === "show") {
                    if (file.exists()) file.reveal();
                    else alert("File does not exist.");
                }
            } catch (e) {
                console.error("ZenLibrary: Download action failed", e);
            }
        }

        handleContextMenu(event, item) {
            // Placeholder
        }

        formatBytes(bytes, decimals = 2) {
            if (!+bytes || bytes === 0) return "0 Bytes";
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
        }
    }

    window.ZenLibraryDownloads = ZenLibraryDownloads;
})();
