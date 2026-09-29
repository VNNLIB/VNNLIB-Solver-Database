/*
 * Page behaviour: the side rail, the page transition, the scroll reveal, the
 * code example and the back to top button.
 */
(function () {
    "use strict";

    /* --------------------------------------------------- page transition -- */

    /*
     * An overlay while moving between pages.
     *
     * What it is for: acknowledging the click. These are static pages, so the
     * next one usually arrives in well under a second, and in that window the
     * browser shows nothing at all, which reads as a click that did not land.
     *
     * What it is not for: padding the wait. The delay below is a floor on how
     * briefly the overlay may appear, so it cannot flash in and out and look like
     * a glitch. It is not a timer the navigation waits on: if the page takes
     * longer than this, the overlay simply stays until it arrives.
     *
     * Raising this to a few seconds would make every page change feel slower than
     * doing nothing at all, which is the opposite of the point. 450ms is about
     * the shortest interval that still registers as deliberate.
     */
    const MINIMUM_MS = 450;

    const overlay = document.createElement("div");
    overlay.className = "page-transition";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<div class="page-transition__spinner"></div>';
    document.body.appendChild(overlay);

    function showOverlay() {
        overlay.setAttribute("data-visible", "true");
    }

    function hideOverlay() {
        overlay.removeAttribute("data-visible");
    }

    /*
     * Coming back with the back button can restore the page from the browser's
     * cache exactly as it was left, overlay included, which would leave it stuck
     * over the content. `pageshow` fires in that case where `load` does not.
     */
    window.addEventListener("pageshow", hideOverlay);

    document.addEventListener("click", function (event) {
        // Anything the browser handles specially is left alone: a new tab, a
        // download, a different origin, an anchor on this page.
        if (event.defaultPrevented || event.button !== 0) {
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const link = event.target.closest("a[href]");
        if (!link || link.target === "_blank" || link.hasAttribute("download")) {
            return;
        }

        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) {
            return;
        }
        // Same document, different fragment: that is scrolling, not navigating.
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
            return;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return;
        }

        event.preventDefault();
        showOverlay();

        // The overlay needs one frame on screen before the browser starts
        // tearing the page down, or it may never paint.
        window.setTimeout(function () {
            window.location.href = link.href;
        }, MINIMUM_MS);
    });

    /* -------------------------------------------------------------- rail -- */

    /*
     * The side rail: which section is being read, and how far down the page the
     * reader is.
     *
     * The progress fill is driven by scroll position rather than by which
     * section is current, because the two answer different questions. A reader
     * halfway through a long Team section is halfway down the page, and a rail
     * that only moved when a section changed would sit still for a screen and a
     * half and then jump.
     */
    const rail = document.getElementById("railNav");
    if (rail) {
        const items = Array.prototype.slice.call(rail.querySelectorAll(".rail-item"));
        const fill = document.getElementById("rail-fill");

        // Only the items that point at a section of this page.
        const targets = items
            .map(function (item) {
                const href = item.getAttribute("href") || "";
                const hash = href.indexOf("#") === 0 ? href : null;
                return { item: item, section: hash ? document.querySelector(hash) : null };
            })
            .filter(function (entry) {
                return entry.section;
            });

        /*
         * How far down the page the reader is, measured once a frame.
         *
         * Three things were wrong with doing it per scroll event. A trackpad
         * reports many small deltas, so the work ran far more often than the
         * screen refreshes. `scrollHeight` is a layout read, so each event
         * forced the browser to lay the page out again before it could answer.
         * And the answer was written to `height`, a layout property, so it had
         * to lay it out once more afterwards.
         *
         * Now: the page's own measurements are cached and only taken again when
         * something could have changed them, the scroll position is read at most
         * once a frame, and the fill is scaled rather than resized.
         */
        let scrollable = 0;

        function measure() {
            scrollable = document.documentElement.scrollHeight - window.innerHeight;
            paint();
        }

        function paint() {
            if (!fill) {
                return;
            }
            // A page shorter than the viewport has no progress to report, and
            // dividing by zero would fill the rail completely.
            const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
            fill.style.transform =
                "scaleY(" + Math.max(0, Math.min(1, progress)) + ")";
        }

        let ticking = false;

        function onScroll() {
            if (ticking) {
                return;
            }
            ticking = true;
            window.requestAnimationFrame(function () {
                ticking = false;
                paint();
            });
        }

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", measure);

        /*
         * The page gets taller and shorter without a resize: the panel slides,
         * a search returns a different number of rows, an image loads. Watching
         * the document is how the cached height learns about all of them without
         * this file having to be told by each one.
         */
        if ("ResizeObserver" in window) {
            new ResizeObserver(measure).observe(document.documentElement);
        }

        measure();

        const visible = new Set();

        /*
         * Which dot is lit has two claimants, and they have to take turns.
         *
         * A click asks the browser to scroll somewhere. That scroll passes
         * over every section in between, and the observer reports each one
         * as it goes, so the dot walks down the rail and lands on the right
         * one only at the end. The reader sees their click apparently
         * ignored, and for a moment two dots look live: the one they
         * pressed, which still has focus, and the one the scroll is passing.
         *
         * So: a click takes the state and holds it until that scroll
         * finishes; after that, and at every other time, the scroll has it.
         * Neither is allowed to write it while the other owns it.
         */
        let claimed = null;

        function paintCurrent(section) {
            targets.forEach(function (entry) {
                const active = section && entry.section === section;
                entry.item.classList.toggle("is-current", Boolean(active));
                if (active) {
                    entry.item.setAttribute("aria-current", "true");
                } else if (entry.item.getAttribute("aria-current") === "true") {
                    // Only clear what this set: `aria-current="page"` on the
                    // Solvers link is not ours to remove.
                    entry.item.removeAttribute("aria-current");
                }
            });
        }

        function highlight() {
            if (claimed) {
                return;
            }
            // Among the sections on screen, the one nearest the top of the
            // viewport is the one being read.
            let current = null;
            let best = Infinity;
            visible.forEach(function (section) {
                const top = Math.abs(section.getBoundingClientRect().top);
                if (top < best) {
                    best = top;
                    current = section;
                }
            });
            paintCurrent(current);
        }

        /*
         * Handing the state back when the scroll a click started has
         * stopped.
         *
         * `scrollend` says exactly that and is the right answer where it
         * exists. Where it does not, quiet is the only available signal: a
         * smooth scroll fires scroll events continuously, so 140ms without
         * one means it has arrived or the reader has stopped. The timer is
         * reset by every scroll event, so a long scroll is not cut short.
         */
        const release = function () {
            claimed = null;
            highlight();
        };

        let settleTimer = null;
        const supportsScrollEnd = "onscrollend" in window;

        if (supportsScrollEnd) {
            window.addEventListener("scrollend", function () {
                if (claimed) {
                    release();
                }
            }, { passive: true });
        } else {
            window.addEventListener("scroll", function () {
                if (!claimed) {
                    return;
                }
                window.clearTimeout(settleTimer);
                settleTimer = window.setTimeout(release, 140);
            }, { passive: true });
        }

        /*
         * The click itself. The dot lights at once, before any scrolling,
         * because the answer to "which one did I press" is not something the
         * reader should have to wait half a second to see.
         */
        rail.addEventListener("click", function (event) {
            const item = event.target.closest ? event.target.closest(".rail-item") : null;
            if (!item) {
                return;
            }
            const entry = targets.filter(function (t) {
                return t.item === item;
            })[0];
            if (!entry) {
                return;
            }
            claimed = entry.section;
            paintCurrent(entry.section);
            window.clearTimeout(settleTimer);
            /*
             * A click on the dot for the section already on screen scrolls
             * nowhere, so neither `scrollend` nor a quiet timer will ever
             * arrive to hand the state back. This is the floor.
             */
            settleTimer = window.setTimeout(release, 1200);
        });

        if (targets.length && "IntersectionObserver" in window) {
            const observer = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting) {
                            visible.add(entry.target);
                        } else {
                            visible.delete(entry.target);
                        }
                    });
                    highlight();
                },
                // Discount the bottom half of the viewport, so a section counts
                // as current once it is properly in view rather than as soon as
                // its first pixel appears.
                { rootMargin: "0px 0px -55% 0px" }
            );

            targets.forEach(function (entry) {
                observer.observe(entry.section);
            });
        }
    }

    /* ------------------------------------------------------ scroll reveal -- */

    /*
     * Fade and lift elements in as they arrive, once each.
     *
     * Opacity and transform only, because those are the two properties a browser
     * can animate on the compositor without laying the page out again. Animating
     * height or margin here would cost a reflow per frame, per item.
     */
    const revealables = document.querySelectorAll("[data-reveal]");
    if (revealables.length) {
        const reduced =
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (reduced || !("IntersectionObserver" in window)) {
            // Nothing to animate, but the elements must still be visible: they
            // start transparent in CSS.
            Array.prototype.forEach.call(revealables, function (node) {
                node.classList.add("is-revealed");
            });
        } else {
            const revealer = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        if (!entry.isIntersecting) {
                            return;
                        }
                        const node = entry.target;
                        // Items in a list come in one after another. The delay is
                        // an inline style rather than a class per position,
                        // because the number of items is not known here.
                        const index = Number(node.getAttribute("data-reveal-index") || 0);
                        node.style.transitionDelay = index * 90 + "ms";
                        node.classList.add("is-revealed");
                        revealer.unobserve(node);
                    });
                },
                { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
            );

            Array.prototype.forEach.call(revealables, function (node, i) {
                if (!node.hasAttribute("data-reveal-index")) {
                    // Position within its own list, so two lists do not stagger
                    // as though they were one.
                    const siblings = node.parentElement
                        ? Array.prototype.filter.call(node.parentElement.children, function (child) {
                            return child.hasAttribute("data-reveal");
                        })
                        : [node];
                    node.setAttribute("data-reveal-index", String(siblings.indexOf(node)));
                }
                revealer.observe(node);
            });
        }
    }

    /* -------------------------------------------------- the code example -- */

    /*
     * Type the VNN-LIB example out when it first scrolls into view.
     *
     * It is the one place on the home page that shows what the standard actually
     * looks like, and typing it draws the eye there instead of letting it read
     * as a screenshot.
     *
     * Two things it must not do. It must not shift the layout: the box is given
     * the height of the finished text before a character is removed, so nothing
     * below it moves. And it must not cost the reader anything: it runs once,
     * never on a repeat visit to the section, and a copy taken at any point
     * copies the whole example because the source text is restored the moment it
     * finishes.
     */
    const example = document.querySelector("[data-typewriter]");
    if (example) {
        const full = example.textContent;
        const reduced =
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!reduced && "IntersectionObserver" in window) {
            // Freeze the height first, while the finished text is still in place.
            example.style.minHeight = example.getBoundingClientRect().height + "px";

            let started = false;
            const watcher = new IntersectionObserver(
                function (entries) {
                    if (started || !entries[0].isIntersecting) {
                        return;
                    }
                    started = true;
                    watcher.disconnect();

                    example.textContent = "";
                    example.classList.add("is-typing");

                    // A fixed total, not a fixed rate, so the whole example
                    // always takes the same time however long it gets. Around
                    // 500 characters over this duration is around ten
                    // milliseconds a character, slow enough to read along with
                    // rather than a block appearing.
                    const DURATION_MS = 5000;
                    const start = performance.now();

                    function frame(now) {
                        const progress = Math.min((now - start) / DURATION_MS, 1);
                        example.textContent = full.slice(0, Math.ceil(full.length * progress));
                        if (progress < 1) {
                            window.requestAnimationFrame(frame);
                        } else {
                            example.classList.remove("is-typing");
                            example.style.minHeight = "";
                        }
                    }
                    window.requestAnimationFrame(frame);
                },
                { threshold: 0.25 }
            );
            watcher.observe(example);
        }
    }

    /* ------------------------------------------------------ the citations -- */

    /*
     * Copy a citation when it is clicked.
     *
     * What goes on the clipboard is the line on screen, and nothing else. It is
     * read from the element at click time rather than kept in an attribute, so
     * there is no second copy of the reference to drift from the one the reader
     * is looking at.
     *
     * The whitespace has to be collapsed. The markup wraps the reference over
     * three indented lines, and `textContent` returns every one of those
     * newlines and every run of leading spaces, which pasted into a document is
     * a reference with the middle of its title on a line of its own.
     *
     * The confirmation is a class on the button, which the stylesheet animates.
     * It is deliberately not an alert: an alert blocks the page and has to be
     * dismissed to carry on reading, for news the reader can see for themselves.
     * The class is removed again after a moment so a second copy of the same
     * reference still animates, and the button never ends up stuck in a state
     * that claims something is on the clipboard long after it was replaced.
     *
     * The screen reader hears it from one shared live region instead, because an
     * animated badge is not an announcement.
     */
    const citations = document.querySelectorAll(".citation");
    const citationStatus = document.getElementById("citation-status");

    const citationText = function (button) {
        const source = button.querySelector(".citation-text") || button;
        return source.textContent.replace(/\s+/g, " ").trim();
    };

    if (citations.length) {
        const CONFIRM_MS = 2000;
        let clearing = null;

        const announce = function (message) {
            if (citationStatus) {
                citationStatus.textContent = message;
            }
        };

        const settle = function (button, state, message) {
            citations.forEach(function (other) {
                other.classList.remove("is-copied", "is-manual");
            });
            button.classList.add(state);
            announce(message);

            window.clearTimeout(clearing);
            clearing = window.setTimeout(function () {
                button.classList.remove("is-copied", "is-manual");
                announce("");
            }, CONFIRM_MS);
        };

        citations.forEach(function (button) {
            button.addEventListener("click", function () {
                const text = citationText(button);
                if (!text) {
                    return;
                }

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(
                        function () {
                            settle(button, "is-copied", "Citation copied");
                        },
                        function () {
                            selectCitation(button);
                        }
                    );
                } else {
                    // No clipboard API, which also covers any page not served
                    // over https. Select the reference so the reader's own copy
                    // shortcut works on it.
                    selectCitation(button);
                }
            });
        });

        function selectCitation(button) {
            const text = button.querySelector(".citation-text") || button;
            const range = document.createRange();
            range.selectNodeContents(text);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            settle(button, "is-manual", "Citation selected, press Control and C to copy");
        }
    }

    /* --------------------------------------------------- the solver panel -- */

    /*
     * Sliding the solver search in over the news and the solver list.
     *
     * Three things this has to get right, and each one is a way the same
     * feature is usually broken:
     *
     *   The URL. `#find-a-solver` is pushed when the panel opens, so the
     *   browser's own Back button reverses the slide, a reload comes back to
     *   the search rather than the top of the page, and the search can be
     *   linked to from anywhere. The Back button in the panel does exactly what
     *   the browser's does, because it calls it.
     *
     *   The height. The two panels are very different heights, so the box is
     *   pinned to the outgoing height, released to the incoming one, and set
     *   back to `auto` when the slide ends. Without the last step the box stays
     *   frozen at whatever it measured, and a search returning fifty rows
     *   overflows it.
     *
     *   Focus. The panel that is off screen is `hidden` as well as translated,
     *   so a keyboard user cannot tab into a form they cannot see, and focus is
     *   moved into whichever panel arrives.
     */
    const swap = document.getElementById("solver-swap");
    const overview = document.getElementById("panel-overview");
    const searchPanel = document.getElementById("panel-search");
    const openLink = document.getElementById("search-open");
    const backButton = document.getElementById("search-back");
    const SEARCH_HASH = "#find-a-solver";
    const SLIDE_MS = 440;

    if (swap && overview && searchPanel && openLink && backButton) {
        let sliding = false;

        const reduced = window.matchMedia
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : { matches: false };

        function showing() {
            return swap.dataset.showing;
        }

        /*
         * `hidden` is removed before measuring and re-applied after the slide,
         * because a display:none element measures as zero and cannot be
         * transitioned at all.
         */
        function slide(to) {
            if (sliding || showing() === to) {
                return;
            }
            const incoming = to === "search" ? searchPanel : overview;
            const outgoing = to === "search" ? overview : searchPanel;
            const fromEdge = to === "search" ? "is-right" : "is-left";
            const toEdge = to === "search" ? "is-left" : "is-right";

            incoming.hidden = false;
            incoming.removeAttribute("aria-hidden");
            outgoing.setAttribute("aria-hidden", "true");

            // Measure both, with the incoming panel in flow and the outgoing
            // one out of it, which is the arrangement that will be true once
            // the slide is done.
            const startHeight = swap.offsetHeight;
            outgoing.classList.remove("is-active");
            incoming.classList.add("is-active");
            const endHeight = swap.offsetHeight;

            swap.dataset.showing = to;
            if (to === "search") {
                // js/solver-search.js waits for this before its first fetch, so
                // the database is not downloaded by readers who never open the
                // search.
                document.dispatchEvent(new CustomEvent("solver-search:open"));
            }

            if (reduced.matches || !startHeight || !endHeight) {
                // Nothing to animate: either the reader asked for less motion,
                // or nothing has been laid out yet, which is what a zero height
                // means. Land on the end state directly.
                incoming.classList.remove("is-right", "is-left");
                outgoing.classList.add(toEdge);
                outgoing.hidden = true;
                swap.style.height = "";
                focusPanel(incoming);
                keepInView();
                return;
            }

            sliding = true;
            swap.style.height = startHeight + "px";
            // Read, to force the height above to be the start of the
            // transition rather than being collapsed into the line below it.
            void swap.offsetHeight;

            incoming.classList.remove(fromEdge);
            outgoing.classList.add(toEdge);
            swap.style.height = endHeight + "px";

            let done = false;
            function finish() {
                if (done) {
                    return;
                }
                done = true;
                window.clearTimeout(timer);
                swap.removeEventListener("transitionend", onEnd);
                // Back to auto, so the box follows its content from here on.
                swap.style.height = "";
                outgoing.hidden = true;
                sliding = false;
                focusPanel(incoming);
                keepInView();
            }
            function onEnd(event) {
                if (event.target === swap && event.propertyName === "height") {
                    finish();
                }
            }
            swap.addEventListener("transitionend", onEnd);
            // Backstop, for a browser that skips the transition and so never
            // fires the event, which would leave the box pinned forever.
            const timer = window.setTimeout(finish, SLIDE_MS + 120);
        }

        /*
         * Scroll only when the box has left the screen, never otherwise.
         *
         * The search panel can be several screens tall and the overview is not,
         * so a reader who was at the bottom of fifty results and pressed Back
         * can be left below everything the section contains, looking at
         * Documents. Correcting that is worth a scroll. Being moved while the
         * section is already in front of you is not.
         */
        function keepInView() {
            if (typeof swap.getBoundingClientRect !== "function") {
                return;
            }
            const box = swap.getBoundingClientRect();
            const viewport = window.innerHeight || 0;
            if (!viewport || !box.height) {
                return;
            }
            const offScreen = box.bottom < 0 || box.top > viewport;
            if (offScreen) {
                bringIntoView(swap);
            }
        }

        /*
         * Focus goes to the panel itself, not to the first control in it. The
         * first control in the search is a text box, and focusing it would make
         * a phone open its keyboard over the results the reader came to see.
         */
        function focusPanel(panel) {
            panel.setAttribute("tabindex", "-1");
            panel.focus({ preventScroll: true });
        }

        // Guarded, because scrollIntoView is missing in a few environments and
        // failing to scroll should never take the slide down with it.
        function bringIntoView(element) {
            if (element && typeof element.scrollIntoView === "function") {
                element.scrollIntoView({
                    block: "start",
                    behavior: reduced.matches ? "auto" : "smooth",
                });
            }
        }

        function openSearch(pushState) {
            if (pushState && window.history && window.history.pushState) {
                window.history.pushState({ solverSearch: true }, "", SEARCH_HASH);
            }
            slide("search");
            // The search starts at the top of the box, which is where the
            // toolbar is. Without this the reader is left looking at wherever
            // the solver list happened to be scrolled to.
            bringIntoView(swap);
        }

        function closeSearch() {
            // Delegated to the browser, so the Back button and this button are
            // the same action and cannot get out of step.
            if (window.history && window.history.state && window.history.state.solverSearch) {
                window.history.back();
                return;
            }
            leaveSearch();
        }

        /*
         * Going back does not scroll.
         *
         * Both panels live in the same box in the same section, so when the
         * search slides away the reader is already looking at the thing that
         * replaced it. Scrolling `#solvers` to the top of the viewport, which is
         * what this used to do, moved the page *down* past the Latest News
         * column to reach it, which reads as being thrown somewhere else for
         * pressing Back.
         *
         * The one case that does need correcting is handled in slide(): if the
         * reader had scrolled deep into a long results list, the overview is far
         * shorter and the section can end up off screen entirely.
         */
        function leaveSearch() {
            slide("overview");
        }

        openLink.addEventListener("click", function (event) {
            event.preventDefault();
            openSearch(true);
        });

        backButton.addEventListener("click", function () {
            closeSearch();
        });

        // Escape, while the search is showing and nothing has claimed it. The
        // details dialog is a <dialog>, which takes Escape for itself, so this
        // only ever fires when no dialog is open.
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && showing() === "search") {
                closeSearch();
            }
        });

        window.addEventListener("popstate", function () {
            slide(window.location.hash === SEARCH_HASH ? "search" : "overview");
        });

        // A link or a reload landing on #find-a-solver opens the search with no
        // animation, because there is nothing to animate away from.
        if (window.location.hash === SEARCH_HASH) {
            searchPanel.hidden = false;
            searchPanel.removeAttribute("aria-hidden");
            searchPanel.classList.remove("is-right");
            searchPanel.classList.add("is-active");
            overview.classList.remove("is-active");
            overview.classList.add("is-left");
            overview.setAttribute("aria-hidden", "true");
            overview.hidden = true;
            swap.dataset.showing = "search";
            // solver-search.js checks the panel itself in this case, since it
            // runs after this file and the event would already have been missed.
        }

        /*
         * Any rail dot is a jump to a section of the overview, so it has to put
         * the overview back first, or the reader is sent to an anchor inside a
         * panel that is not on screen.
         */
        if (rail) {
            rail.addEventListener("click", function (event) {
                const item = event.target.closest ? event.target.closest(".rail-item") : null;
                if (item && showing() === "search") {
                    slide("overview");
                }
            });
        }
    }

    /* ------------------------------------------------------ back to top --- */

    const toTop = document.getElementById("to-top");
    if (toTop) {
        /*
         * Also once a frame. The work itself is two class toggles and costs
         * almost nothing, but a second listener on the same event is a second
         * thing the browser has to run before it can scroll, and on a trackpad
         * that is hundreds of times a second for a button that changes state
         * twice a page.
         */
        let shown = null;
        let pending = false;

        const update = function () {
            pending = false;
            const next = window.scrollY > 400;
            if (next === shown) {
                return;
            }
            shown = next;
            toTop.classList.toggle("opacity-0", !next);
            toTop.classList.toggle("pointer-events-none", !next);
        };

        window.addEventListener("scroll", function () {
            if (pending) {
                return;
            }
            pending = true;
            window.requestAnimationFrame(update);
        }, { passive: true });
        update();
    }
})();
