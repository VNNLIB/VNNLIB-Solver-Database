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

        // Only the items that point at a section of this page. On solvers.html
        // that is none of them, and the rail still shows progress and the
        // current page.
        const targets = items
            .map(function (item) {
                const href = item.getAttribute("href") || "";
                const hash = href.indexOf("#") === 0 ? href : null;
                return { item: item, section: hash ? document.querySelector(hash) : null };
            })
            .filter(function (entry) {
                return entry.section;
            });

        function updateProgress() {
            if (!fill) {
                return;
            }
            const scrollable = document.documentElement.scrollHeight - window.innerHeight;
            // A page shorter than the viewport has no progress to report, and
            // dividing by zero would fill the rail completely.
            const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
            fill.style.height = Math.max(0, Math.min(1, progress)) * 100 + "%";
        }

        window.addEventListener("scroll", updateProgress, { passive: true });
        window.addEventListener("resize", updateProgress);
        updateProgress();

        if (targets.length && "IntersectionObserver" in window) {
            const visible = new Set();

            function highlight() {
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

                targets.forEach(function (entry) {
                    const active = current && entry.section === current;
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

                    // A fixed total, not a fixed rate. The example is around 500
                    // characters; at a plausible per-character delay that would
                    // run for six seconds, which is a long time to watch a code
                    // block fill in.
                    const DURATION_MS = 2200;
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

    /* ------------------------------------------------------ back to top --- */

    const toTop = document.getElementById("to-top");
    if (toTop) {
        const onScroll = function () {
            const shown = window.scrollY > 400;
            toTop.classList.toggle("opacity-0", !shown);
            toTop.classList.toggle("pointer-events-none", !shown);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    }
})();
