"use strict";

(function () {
    class ZenLibraryMedia {
        constructor(library) {
            this.library = library;
            this._container = null;
            this._searchTerm = "";
            this._itemCount = 0;
        }

        get el() { return this.library.el.bind(this.library); }

        render() {
            // Main wrapper
            const wrapper = this.el("div", {
                className: "library-list-wrapper"
            });
            const container = this.el("div", { className: "media-grid" });
            wrapper.appendChild(container);
            this._container = container;
            this.library._mediaContainer = container; // Keep ref

            const startLoading = () => {
                this.fetchDownloads().then(downloads => {
                    this.renderList(downloads);
                    this._container.classList.add("library-content-fade-in");
                    setTimeout(() => this._container.classList.add("scrollbar-visible"), 100);
                });
            };

            const isTransitioning = window.gZenLibrary && window.gZenLibrary._isTransitioning;
            const loading = this.el("div", { className: "empty-state library-content-fade-in" });

            // Use correct Media Icon SVG (Film Strip) - Consistent 64x64
            const iconSvg = `
<svg class="empty-icon media-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M9 3L8 8M16 3L15 8M22 8H2M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>`;
            const iconContainer = this.el("div");
            iconContainer.innerHTML = iconSvg;
            loading.appendChild(iconContainer.firstElementChild);

            loading.appendChild(this.el("h3", { textContent: "Gathering media..." }));
            loading.appendChild(this.el("p", { textContent: "Looking for your downloaded images and videos." }));

            container.appendChild(loading);

            const delay = isTransitioning ? 400 : 250;
            setTimeout(() => {
                const l = container.querySelector(".empty-state");
                if (l) l.remove();
                startLoading();
            }, delay);

            return wrapper;
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
                    // Simplification for Map: only need basic info
                    if (d.succeeded) status = "completed";
                    else if (d.error || d.canceled) status = "failed";
                    else status = "paused";

                    if (d.target && d.target.path && !fileExists) {
                        status = "deleted";
                    }

                    return {
                        id: d.id,
                        filename: String(filename || "FN_MISSING"),
                        size: Number(d.totalBytes) || 0,
                        status: status,
                        url: String(d.source?.url || "URL_MISSING"),
                        timestamp: d.endTime || d.startTime || Date.now(),
                        targetPath: String(targetPath || ""),
                        raw: d
                    };
                });
            } catch (e) {
                console.error("ZenLibrary: Error fetching downloads", e);
                return [];
            }
        }

        renderList(downloads) {
            if (!this._container) return;
            this._container.innerHTML = "";
            this._container.classList.add("scrollbar-visible");

            const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico", "bmp"];
            const VIDEO_EXTS = ["mp4", "webm", "mkv", "avi", "mov"];

            const mediaItems = downloads.filter(d => {
                if (d.status === "deleted" || d.status === "failed") return false;
                const ext = d.filename.split('.').pop().toLowerCase();
                const isMedia = IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
                if (!isMedia) return false;
                if (this._searchTerm && !d.filename.toLowerCase().includes(this._searchTerm.toLowerCase())) {
                    return false;
                }
                return true;
            });

            // Update count
            const prevCount = this._itemCount;
            this._itemCount = mediaItems.length;
            window.gZenLibraryMediaCount = this._itemCount;

            if (this._itemCount !== prevCount) {
                if (this.library.update) this.library.update();
            }

            if (mediaItems.length === 0) {
                this._container.innerHTML = "";
                const emptyState = this.el("div", { className: "empty-state" }, [
                    this.el("div", {
                        className: "empty-icon media-icon",
                        innerHTML: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3L8 8M16 3L15 8M22 8H2M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                    }),
                    this.el("h3", { textContent: this._searchTerm ? "No matching media" : "No media found" }),
                    this.el("p", { textContent: this._searchTerm ? "Try a different search term." : "We couldn't find any images or videos in your downloads." })
                ]);
                this._container.appendChild(emptyState);
                return;
            }

            // Sort by TS
            mediaItems.sort((a, b) => {
                const tsA = typeof a.timestamp === 'number' ? (a.timestamp > 1e14 ? a.timestamp / 1000 : a.timestamp) : a.timestamp.getTime();
                const tsB = typeof b.timestamp === 'number' ? (b.timestamp > 1e14 ? b.timestamp / 1000 : b.timestamp) : b.timestamp.getTime();
                return tsB - tsA;
            });

            // Helper for columns - using the method from Spaces if available or fallback
            // We'll define a standard way to get width
            const libWidth = parseFloat(this.library.style.getPropertyValue("--zen-library-width")) || 340;
            // Assuming ZenLibrarySpaces is available globally as confirmed by user "files loaded"
            // But if we are modularizing Spaces, we might need a safer check.
            let colCount = 1;
            try {
                if (window.ZenLibrarySpacesRenderer && window.ZenLibrarySpacesRenderer.calculateMediaColumns) {
                    colCount = window.ZenLibrarySpacesRenderer.calculateMediaColumns(libWidth);
                } else if (window.ZenLibrarySpaces && window.ZenLibrarySpaces.calculateMediaColumns) {
                    colCount = window.ZenLibrarySpaces.calculateMediaColumns(libWidth);
                }
            } catch (e) { }

            const masonryWrapper = this.el("div", {
                className: "media-masonry-wrapper",
                style: `column-count: ${colCount};`
            });
            const grid = this._container;
            grid.innerHTML = "";
            grid.appendChild(masonryWrapper);

            // Smooth vertical scrolling
            grid.onwheel = (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    if (e.deltaMode === 1) {
                        grid.scrollBy({ top: e.deltaY * 30, behavior: "smooth" });
                    } else {
                        grid.scrollTop += e.deltaY * 2;
                    }
                }
            };

            const fragment = document.createDocumentFragment();

            mediaItems.forEach(item => {
                const ext = item.filename.split('.').pop().toLowerCase();
                const isVideo = VIDEO_EXTS.includes(ext);
                const fileUrl = "file://" + item.targetPath;

                const card = this.el("div", {
                    className: "media-card",
                    onclick: (e) => this.showGlance(item, e),
                    title: item.filename
                });

                const previewContainer = this.el("div", { className: "media-preview-container" });

                if (isVideo) {
                    const videoEl = this.el("video", {
                        src: fileUrl,
                        preload: "metadata",
                        muted: true
                    });
                    previewContainer.appendChild(videoEl);

                    const durationBadge = this.el("div", { className: "video-duration-badge", textContent: "..." });
                    videoEl.addEventListener("loadedmetadata", () => {
                        const mins = Math.floor(videoEl.duration / 60);
                        const secs = Math.floor(videoEl.duration % 60);
                        durationBadge.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                    });
                    previewContainer.appendChild(durationBadge);
                } else {
                    const imgEl = this.el("img", {
                        src: fileUrl,
                        loading: "lazy",
                    });
                    previewContainer.appendChild(imgEl);
                }

                let timeStr = "";
                try {
                    let ts = item.timestamp;
                    if (ts instanceof Date) ts = ts.getTime();
                    if (typeof ts === 'number' && ts > 1e14) ts = ts / 1000;
                    const date = new Date(ts);
                    timeStr = date.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " +
                        date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
                } catch (e) { }

                const info = this.el("div", { className: "media-info" }, [
                    this.el("div", { className: "media-title", textContent: item.filename }),
                    this.el("div", { className: "media-meta-row" }, [
                        this.el("div", { className: "media-meta", textContent: this.formatBytes(item.size) }),
                        this.el("div", { className: "media-time", textContent: timeStr })
                    ])
                ]);

                card.appendChild(previewContainer);
                card.appendChild(info);
                fragment.appendChild(card);
            });

            masonryWrapper.appendChild(fragment);
        }

        showGlance(item, event) {
            const fileUrl = "file://" + item.targetPath;
            if (window.gZenGlanceManager) {
                if (window.gZenGlanceManager.closeGlance) {
                    window.gZenGlanceManager.closeGlance();
                }

                const rect = event.currentTarget.getBoundingClientRect();
                window.gZenGlanceManager.openGlance({
                    url: fileUrl,
                    clientX: rect.left,
                    clientY: rect.top,
                    width: rect.width,
                    height: rect.height
                });
            }
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

    window.ZenLibraryMedia = ZenLibraryMedia;
})();
