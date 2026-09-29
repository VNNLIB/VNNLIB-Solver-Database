/*
 * The masthead field: drifting nodes that find each other, hold a link for a
 * while, and let go.
 *
 * It is a neural network read as a night sky, which is the one visual metaphor
 * this site has earned: the whole standard is about what a solver can say
 * about a network's nodes and the edges between them.
 *
 * Four decisions worth knowing about, because each is the difference between an
 * effect and a nuisance:
 *
 *   It connects itself, and randomly. Two nodes in range *may* bond; the one
 *   that does is chosen at random from those available, holds for a while and
 *   then lets go. Deciding it by distance alone made the field deterministic,
 *   so nothing ever changed unless something moved, and the same arrangement
 *   always drew the same web.
 *
 *   It ignores the mouse entirely. There is no pointer tracking and no
 *   attraction, so the field behaves the same whether anyone is moving a mouse
 *   over it or not, and on a touch screen, where there is no pointer at all, it
 *   is not a lesser version of itself. The canvas is `pointer-events: none`, so
 *   the heading stays selectable and anything over it stays clickable.
 *
 *   It stops when nobody is looking. Off screen, or in a background tab, the
 *   loop does no work at all. A canvas animation that keeps running while the
 *   reader is four sections further down is a battery drain with no audience.
 *
 *   It respects `prefers-reduced-motion`. Someone who asked for less movement
 *   gets a still field rather than nothing, so the masthead does not look
 *   broken, and gets it drawn once rather than sixty times a second.
 */
(function () {
    "use strict";

    const header = document.querySelector("[data-neurons]");
    if (!header) {
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "neurons";
    canvas.setAttribute("aria-hidden", "true");
    header.insertBefore(canvas, header.firstChild);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
        return;
    }

    const reduced =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* --------------------------------------------------------------- tuning */

    // One node per this many square pixels, so a wide screen gets a fuller
    // field and a phone does not get a swarm it has to draw sixty times a
    // second.
    const AREA_PER_NODE = 8500;
    const MIN_NODES = 12;
    const MAX_NODES = 160;

    /*
     * Linking.
     *
     * A link is a thing with its own lifetime, not a fact about distance. Two
     * nodes within LINK_DISTANCE *may* bond, and once bonded they hold it for a
     * while and then let go, so the web keeps rewiring even where the nodes have
     * barely moved. Deciding it purely by distance made the field deterministic:
     * the same arrangement always produced the same web, and nothing ever
     * changed unless something moved.
     */
    const LINK_DISTANCE = 135;

    /*
     * The cursor's reach, and how quickly it arrives and leaves.
     *
     * Shorter than LINK_DISTANCE on purpose: the cursor should pick up the
     * handful of nodes it is actually among, not rope in half the field, which
     * looks like a starburst rather than like touching a network.
     *
     * The alpha is eased rather than switched, so moving off the banner does not
     * cut a dozen lines at once. 0.08 a frame is about a fifth of a second.
     */
    const CURSOR_DISTANCE = 120;
    const CURSOR_FADE = 0.08;
    // Past this a held link snaps, however much life it had left.
    const LINK_BREAK_DISTANCE = 190;
    // How long a bond lasts, in frames. Short enough that the web visibly
    // rewires, long enough that it is not a flicker.
    const LINK_MIN_LIFE = 60;
    const LINK_MAX_LIFE = 260;
    // How many bonds one node will hold at once. Without a cap the dense parts
    // of the field mat together and the sparse parts stay empty.
    const MAX_DEGREE = 3;
    // Bonds attempted per frame. Each attempt is one node against the others,
    // so this is the only per-frame cost that scales with node count.
    const LINK_ATTEMPTS = 6;
    // Links in total, as a multiple of the node count.
    const LINKS_PER_NODE = 1.1;

    const SPEED = 0.16;
    // A small random nudge each frame. Without it the nodes travel in straight
    // lines forever and the field reads as a screensaver; with it the paths
    // wander and the whole thing looks alive.
    const JITTER = 0.008;
    const MAX_SPEED = 0.45;

    /*
     * One colour for the whole field.
     *
     * It used to pick from nine, which meant the masthead had a different colour
     * mix on every load and no two screenshots matched. A single hue also lets
     * the size and the linking carry the variation, which is what the field is
     * actually about.
     *
     * This tone rather than `brand` itself: #008ae6 is the blue for links on
     * white, and against the navy gradient it is too close to the background to
     * read. This is the lighter brand tone the wordmark already uses on hover.
     */
    const NODE_COLOUR = "#4db8ff";

    /*
     * How large a node is drawn, as a radius.
     *
     * A wide range on purpose. Every node the same size reads as a regular
     * pattern however randomly they are placed, while a spread of radii gives
     * the field depth: the small ones sit back, the large ones come forward.
     * The distribution is squared below, so small is the common case and a
     * large node is an occasional event rather than a third of the field.
     */
    const MIN_RADIUS = 1.2;
    const MAX_RADIUS = 7;

    /* ---------------------------------------------------------------- state */

    let width = 0;
    let height = 0;
    let ratio = 1;
    let nodes = [];
    let links = [];
    let frame = null;
    let visible = true;

    function random(min, max) {
        return min + Math.random() * (max - min);
    }

    function makeNode(seeded) {
        /*
         * `life` and `maxLife` are what make nodes appear and disappear rather
         * than simply existing. A node fades in, drifts, fades out and is
         * replaced somewhere else, so the field keeps reorganising instead of
         * settling into a fixed constellation.
         *
         * On the first build they start at a random point in their life, or
         * every node would fade in together and the field would pulse.
         */
        const maxLife = random(500, 1400);
        return {
            x: random(0, width),
            y: random(0, height),
            vx: random(-SPEED, SPEED),
            vy: random(-SPEED, SPEED),
            /*
             * Squared, so the radii bunch towards the small end. A flat random
             * spread puts as many 7px nodes on screen as 1.2px ones, and at
             * this density that is a field of blobs rather than a field with a
             * few bright points in it.
             */
            radius: MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.pow(Math.random(), 2),
            life: seeded ? random(0, maxLife) : 0,
            maxLife: maxLife,
            /*
             * `dead` is how a link knows its endpoint is gone. A node at the end
             * of its life is replaced by a new object rather than reset, so any
             * link still holding the old one has to drop it, and comparing
             * object identity is not enough once the array slot has been reused.
             */
            dead: false,
            degree: 0,
        };
    }

    function build() {
        const rect = header.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        if (!width || !height) {
            return;
        }

        // Draw at device resolution, lay out in CSS pixels. Without this the
        // lines are visibly soft on any modern display.
        ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        const count = Math.max(
            MIN_NODES,
            Math.min(MAX_NODES, Math.round((width * height) / AREA_PER_NODE))
        );

        nodes = [];
        for (let i = 0; i < count; i += 1) {
            nodes.push(makeNode(true));
        }

        /*
         * Links are dropped, not kept. They hold references to node objects, and
         * every node has just been replaced, so anything surviving a rebuild
         * would be drawing lines between points that no longer move. `build` also
         * runs on resize, where that would be very visible.
         */
        links = [];
        seedLinks();
    }

    /*
     * Fill the web before the first frame, so the field arrives already
     * connected rather than wiring itself up in front of the reader. Also the
     * only thing that gives the reduced-motion still frame any links at all,
     * since that path draws once and never calls step().
     *
     * Bounded rather than looping until full: a sparse arrangement may simply not
     * have enough pairs in range, and this should not spin looking for them.
     */
    function seedLinks() {
        for (let pass = 0; pass < 60; pass += 1) {
            formLinks();
        }
        // Spread their ages, or every seeded bond would expire at once and the
        // whole web would blink out together a few seconds in.
        links.forEach(function (link) {
            link.life = random(0, link.maxLife);
        });
    }

    /*
     * How visible a node is: it fades in over the first tenth of its life and
     * out over the last quarter, and is fully present in between.
     */
    /*
     * The cursor, as a node the reader moves.
     *
     * Read from the header rather than the canvas: the canvas is
     * `pointer-events: none` so that it never intercepts a selection or a click
     * on the heading, which means it never sees a pointer either. The header
     * still receives events and is the same box.
     *
     * `cursorAlpha` is a separate value from "is the pointer here", so the links
     * fade in and out instead of appearing and vanishing with the pointer.
     */
    const cursor = { clientX: 0, clientY: 0, x: 0, y: 0, here: false, alpha: 0 };

    if (!reduced) {
        /*
         * The handler stores the viewport coordinates and nothing else.
         *
         * Turning them into canvas coordinates needs the canvas's position,
         * and `getBoundingClientRect` is a layout read. A pointer reports far
         * more often than the screen refreshes, so doing it here would force a
         * layout per move; it is done once a frame in `place()` instead, which
         * is also the only way it stays right while the page scrolls under a
         * still pointer.
         */
        header.addEventListener("pointermove", function (event) {
            /*
             * A coarse pointer is a finger, and a finger on the banner is
             * usually on its way to scrolling past it. Lighting the field up
             * under it would be an effect nobody asked for, in the way of the
             * thing they were doing.
             */
            if (event.pointerType === "touch") {
                return;
            }
            cursor.clientX = event.clientX;
            cursor.clientY = event.clientY;
            cursor.here = true;
        }, { passive: true });

        header.addEventListener("pointerleave", function () {
            cursor.here = false;
        }, { passive: true });
    }

    /* One layout read a frame, and only while there is something to draw. */
    function place() {
        if (!cursor.here && cursor.alpha <= 0) {
            return;
        }
        const box = canvas.getBoundingClientRect();
        cursor.x = cursor.clientX - box.left;
        cursor.y = cursor.clientY - box.top;
    }

    function alphaOf(node) {
        const t = node.life / node.maxLife;
        if (t < 0.1) {
            return t / 0.1;
        }
        if (t > 0.75) {
            return (1 - t) / 0.25;
        }
        return 1;
    }

    /* ----------------------------------------------------------- the links */

    /*
     * Links age, break and form, once per frame.
     *
     * Three ways a bond ends, and each is wanted: its life runs out, an endpoint
     * reaches the end of *its* life, or the two drift too far apart. The first is
     * what makes the web rewire on its own; the third is what stops a bond
     * stretching across the whole masthead as its ends wander.
     */
    function ageLinks() {
        links = links.filter(function (link) {
            link.life += 1;

            if (link.a.dead || link.b.dead) {
                return false;
            }
            if (link.life >= link.maxLife) {
                link.a.degree -= 1;
                link.b.degree -= 1;
                return false;
            }

            const dx = link.a.x - link.b.x;
            const dy = link.a.y - link.b.y;
            if (dx * dx + dy * dy > LINK_BREAK_DISTANCE * LINK_BREAK_DISTANCE) {
                link.a.degree -= 1;
                link.b.degree -= 1;
                return false;
            }
            return true;
        });

        /*
         * A dead endpoint leaves its partner's degree overstated, because the
         * branch above returns before decrementing: the dead node's count no
         * longer matters, but the survivor's does. Recounting from the links is
         * cheaper and less error-prone than tracking every exit path.
         */
        nodes.forEach(function (node) {
            node.degree = 0;
        });
        links.forEach(function (link) {
            link.a.degree += 1;
            link.b.degree += 1;
        });
    }

    function linked(a, b) {
        return links.some(function (link) {
            return (link.a === a && link.b === b) || (link.a === b && link.b === a);
        });
    }

    /*
     * Try to form a few bonds.
     *
     * Randomly, deliberately. A node picks one partner from all of those in
     * range rather than bonding with every one of them, so two nodes sitting
     * together are not necessarily connected and the web is not a function of
     * the arrangement. It also means the same field looks different every time
     * it is watched.
     */
    function formLinks() {
        const ceiling = Math.round(nodes.length * LINKS_PER_NODE);

        for (let attempt = 0; attempt < LINK_ATTEMPTS; attempt += 1) {
            if (links.length >= ceiling) {
                return;
            }

            const a = nodes[Math.floor(Math.random() * nodes.length)];
            if (!a || a.degree >= MAX_DEGREE || alphaOf(a) <= 0) {
                continue;
            }

            // Everything in range and willing, then one of them at random.
            const candidates = [];
            for (let i = 0; i < nodes.length; i += 1) {
                const b = nodes[i];
                if (b === a || b.degree >= MAX_DEGREE || alphaOf(b) <= 0) {
                    continue;
                }
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                if (dx * dx + dy * dy > LINK_DISTANCE * LINK_DISTANCE) {
                    continue;
                }
                if (linked(a, b)) {
                    continue;
                }
                candidates.push(b);
            }
            if (!candidates.length) {
                continue;
            }

            const b = candidates[Math.floor(Math.random() * candidates.length)];
            a.degree += 1;
            b.degree += 1;
            links.push({
                a: a,
                b: b,
                life: 0,
                maxLife: random(LINK_MIN_LIFE, LINK_MAX_LIFE),
            });
        }
    }

    /*
     * How visible a link is: it fades in and out over its own life, so a bond
     * arrives and leaves rather than blinking on. Multiplied by a distance
     * falloff, so one that is stretching thins out as it goes.
     */
    function linkAlpha(link) {
        const fade = 0.18;
        const t = link.life / link.maxLife;
        let envelope = 1;
        if (t < fade) {
            envelope = t / fade;
        } else if (t > 1 - fade) {
            envelope = (1 - t) / fade;
        }

        const distance = Math.hypot(link.a.x - link.b.x, link.a.y - link.b.y);
        const reach = Math.max(0, 1 - distance / LINK_BREAK_DISTANCE);

        return envelope * reach * alphaOf(link.a) * alphaOf(link.b);
    }

    function step() {
        nodes.forEach(function (node, index) {
            node.life += 1;
            if (node.life >= node.maxLife) {
                // Replaced rather than reset, so it reappears somewhere else
                // with a new speed and lifetime. Marked dead first, so the
                // links holding it drop it on this same frame.
                node.dead = true;
                nodes[index] = makeNode(false);
                return;
            }

            node.vx += random(-JITTER, JITTER);
            node.vy += random(-JITTER, JITTER);

            // Clamp the speed, or the random walk accumulates and the nodes
            // eventually streak across the frame.
            const speed = Math.hypot(node.vx, node.vy);
            if (speed > MAX_SPEED) {
                node.vx = (node.vx / speed) * MAX_SPEED;
                node.vy = (node.vy / speed) * MAX_SPEED;
            }

            node.x += node.vx;
            node.y += node.vy;

            // Wrap at the edges. Bouncing would collect nodes along the sides,
            // which is exactly where the field should be thinnest.
            const margin = 30;
            if (node.x < -margin) node.x = width + margin;
            if (node.x > width + margin) node.x = -margin;
            if (node.y < -margin) node.y = height + margin;
            if (node.y > height + margin) node.y = -margin;
        });

        ageLinks();
        formLinks();
    }

    /*
     * The halo, drawn once into its own canvas and reused.
     *
     * It was a `createRadialGradient` per node per frame: at 160 nodes and 60
     * frames a second that is nearly ten thousand gradient objects a second,
     * each one built, rasterised and thrown away. The cost is not only the work
     * but the garbage, and a collection pause in the middle of an animation is
     * exactly the stutter it looked like.
     *
     * Every halo is the same picture at a different size, so one bitmap and a
     * scaled `drawImage` says the same thing. 64px is comfortably larger than
     * the biggest halo drawn, which is 3 times the 7px maximum radius, so it is
     * always scaled down and never blurred by scaling up.
     */
    const haloSprite = (function () {
        const size = 64;
        const sprite = document.createElement("canvas");
        sprite.width = size;
        sprite.height = size;
        const sctx = sprite.getContext("2d");
        const r = size / 2;
        const glow = sctx.createRadialGradient(r, r, 0, r, r, r);
        glow.addColorStop(0, NODE_COLOUR);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        sctx.fillStyle = glow;
        sctx.beginPath();
        sctx.arc(r, r, r, 0, Math.PI * 2);
        sctx.fill();
        return sprite;
    })();

    function draw() {
        ctx.clearRect(0, 0, width, height);

        /*
         * Links first, so the nodes sit on top of them.
         *
         * One pass over the links that exist, rather than over every pair of
         * nodes. The old version tested all 12,800 pairs a frame to rediscover a
         * web it then threw away; holding the links as state means drawing them
         * costs one pass over about as many links as there are nodes.
         */
        links.forEach(function (link) {
            const alpha = linkAlpha(link);
            if (alpha <= 0.01) {
                return;
            }
            ctx.strokeStyle = NODE_COLOUR;
            ctx.globalAlpha = alpha * 0.34;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(link.a.x, link.a.y);
            ctx.lineTo(link.b.x, link.b.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        nodes.forEach(function (node) {
            const alpha = alphaOf(node);
            if (alpha <= 0) {
                return;
            }

            ctx.save();
            ctx.translate(node.x, node.y);

            /*
             * The halo, and then the disc, composited differently on purpose.
             *
             * The halo is the large-area one, and it is drawn `source-over`.
             * Additively, overlapping halos accumulate without any ceiling, so
             * the header visibly brightened and dimmed as the field drifted
             * through it: the gradient behind stopped looking like a fixed
             * background and started looking like weather. Normal alpha
             * compositing approaches the halo colour and never exceeds it, so a
             * dense patch is tinted rather than blown out, and the gradient
             * holds still.
             *
             * The disc keeps `lighter`, because it is a few pixels across: it is
             * what makes two nodes passing over each other flare, and what keeps
             * a node from cutting a hole in a link it crosses, without covering
             * enough of the header to affect it.
             *
             * The halo is scaled to the node, so a large node carries a large
             * glow and the size difference reads at a glance.
             */
            const halo = node.radius * 3;
            ctx.globalAlpha = alpha * 0.14;
            // The prepared sprite, scaled to this node, rather than a gradient
            // built here. See haloSprite.
            ctx.drawImage(haloSprite, -halo, -halo, halo * 2, halo * 2);

            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = NODE_COLOUR;
            ctx.beginPath();
            ctx.arc(0, 0, node.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalCompositeOperation = "source-over";
            ctx.restore();
        });

        drawCursor();
    }

    /*
     * The nodes near the cursor, joined to it.
     *
     * Drawn after the nodes rather than with the links, so these lines read as
     * something happening on top of the field rather than as part of it.
     *
     * Each line fades with distance, so the reach has no edge: a node does not
     * snap into the web as it crosses a boundary, it arrives. `1 - d / reach`
     * squared, because linear fading leaves faint lines visible almost to the
     * edge and the effect looks like a disc rather than like a reach.
     *
     * No allocation per frame and no work at all when the cursor is away, which
     * is the usual case: the whole thing is one loop over the nodes, and the
     * loop does not run unless a line would be visible.
     */
    function drawCursor() {
        if (cursor.alpha <= 0) {
            return;
        }

        const reach = CURSOR_DISTANCE;
        ctx.strokeStyle = NODE_COLOUR;
        ctx.lineWidth = 0.9;

        nodes.forEach(function (node) {
            const dx = node.x - cursor.x;
            const dy = node.y - cursor.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach * reach) {
                return;
            }
            const near = 1 - Math.sqrt(d2) / reach;
            const alpha = alphaOf(node) * cursor.alpha * near * near * 0.55;
            if (alpha <= 0.01) {
                return;
            }
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(cursor.x, cursor.y);
            ctx.lineTo(node.x, node.y);
            ctx.stroke();
        });

        // A node of its own at the pointer, so the lines have somewhere to meet
        // rather than converging on nothing.
        const halo = 9;
        ctx.globalAlpha = cursor.alpha * 0.18;
        ctx.drawImage(haloSprite, cursor.x - halo, cursor.y - halo, halo * 2, halo * 2);

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = cursor.alpha * 0.9;
        ctx.fillStyle = NODE_COLOUR;
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
    }

    function loop() {
        frame = window.requestAnimationFrame(loop);
        if (!visible || document.hidden) {
            return;
        }
        step();
        cursor.alpha += ((cursor.here ? 1 : 0) - cursor.alpha) * CURSOR_FADE;
        if (cursor.alpha < 0.005) {
            cursor.alpha = 0;
        }
        place();
        draw();
    }

    /* --------------------------------------------------------------- wiring */

    let resizeTimer = null;
    window.addEventListener("resize", function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            build();
            if (reduced) {
                draw();
            }
        }, 200);
    });

    // Only run while the masthead is actually on screen.
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
            visible = entries[0].isIntersecting;
        }).observe(header);
    }

    /*
     * Nothing to load. The nodes are drawn with arcs, so the field is there on
     * the first frame rather than waiting on an image that may never arrive.
     */
    build();

    if (reduced) {
        // One frame, held. The field is there, it simply does not move.
        draw();
    } else {
        loop();
    }
})();
