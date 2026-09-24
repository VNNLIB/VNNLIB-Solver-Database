/*
 * The masthead field: drifting neurons that find each other, hold a link for a
 * while, and let go.
 *
 * It is a neural network read as a night sky, which is the one visual metaphor
 * this site has earned: the whole standard is about what a solver can say
 * about a network's nodes and the edges between them.
 *
 * Three decisions worth knowing about, because each is the difference between
 * an effect and a nuisance:
 *
 *   It is behind the text and cannot be clicked. The canvas has
 *   `pointer-events: none`, so the heading stays selectable and anything
 *   placed over it stays clickable. The pointer is tracked on the header
 *   instead.
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
    const AREA_PER_NODE = 26000;
    const MIN_NODES = 12;
    const MAX_NODES = 48;

    // Nodes closer than this are linked, and the line fades out as they part.
    const LINK_DISTANCE = 190;
    // The pointer reaches further than the nodes do, so moving through the
    // field visibly gathers it.
    const POINTER_DISTANCE = 200;

    const SPEED = 0.16;
    // A small random nudge each frame. Without it the nodes travel in straight
    // lines forever and the field reads as a screensaver; with it the paths
    // wander and the whole thing looks alive.
    const JITTER = 0.008;
    const MAX_SPEED = 0.45;

    const WHITE = "255, 255, 255";

    /*
     * The colours a neuron can be.
     *
     * Chosen to sit on the navy gradient rather than to be a spectrum: every
     * one is light enough to read against it, and the two brand tones are in
     * the set so the field still belongs to this site rather than looking like
     * a screensaver that wandered in.
     */
    const PALETTE = [
        "#7dd3fc",
        "#a5b4fc",
        "#f0abfc",
        "#86efac",
        "#fde68a",
        "#fca5a5",
        "#67e8f9",
        "#ffffff",
        "#4db8ff",
    ];

    // Where the drawn neuron comes from, and how big it is drawn.
    const SPRITE_SRC = "assets/img/neuron.png";
    const MIN_SIZE = 16;
    const MAX_SIZE = 38;

    /* --------------------------------------------------------- the sprites */

    /*
     * One tinted copy of the neuron drawing per palette colour.
     *
     * The source PNG is a black silhouette on transparency, with the nucleus
     * punched out as a hole. Painting it in a colour is therefore a composite,
     * not a filter: draw the artwork, then fill the whole box with the colour
     * under `source-in`, which keeps the colour only where the artwork had
     * pixels. The hole stays a hole, so the gradient shows through the middle
     * of every neuron.
     *
     * Built once, up front, rather than per node per frame. Nine small canvases
     * is nothing; nine hundred composites a second would not be.
     */
    const sprites = [];

    function buildSprites(image) {
        const size = image.naturalWidth || 128;
        PALETTE.forEach(function (colour) {
            const off = document.createElement("canvas");
            off.width = size;
            off.height = size;
            const octx = off.getContext("2d");
            octx.drawImage(image, 0, 0, size, size);
            octx.globalCompositeOperation = "source-in";
            octx.fillStyle = colour;
            octx.fillRect(0, 0, size, size);
            sprites.push(off);
        });
    }

    /* ---------------------------------------------------------------- state */

    let width = 0;
    let height = 0;
    let ratio = 1;
    let nodes = [];
    let frame = null;
    let visible = true;

    const pointer = { x: -9999, y: -9999, active: false };

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
            size: random(MIN_SIZE, MAX_SIZE),
            life: seeded ? random(0, maxLife) : 0,
            maxLife: maxLife,
            // Which tinted sprite to draw, and how it is turned. A neuron is a
            // six-armed shape, so without a random angle every one of them
            // points the same way and the field reads as wallpaper.
            colour: Math.floor(Math.random() * PALETTE.length),
            angle: random(0, Math.PI * 2),
            spin: random(-0.0025, 0.0025),
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
    }

    /*
     * How visible a node is: it fades in over the first tenth of its life and
     * out over the last quarter, and is fully present in between.
     */
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

    function step() {
        nodes.forEach(function (node, index) {
            node.life += 1;
            if (node.life >= node.maxLife) {
                // Replaced rather than reset, so it reappears somewhere else
                // with a new speed and lifetime.
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

            if (pointer.active) {
                // A gentle pull towards the pointer, falling off with distance,
                // so moving through the field disturbs it instead of the field
                // ignoring the reader entirely.
                const dx = pointer.x - node.x;
                const dy = pointer.y - node.y;
                const distance = Math.hypot(dx, dy);
                if (distance > 1 && distance < POINTER_DISTANCE) {
                    const pull = (1 - distance / POINTER_DISTANCE) * 0.02;
                    node.vx += (dx / distance) * pull;
                    node.vy += (dy / distance) * pull;
                }
            }

            node.x += node.vx;
            node.y += node.vy;
            node.angle += node.spin;

            // Wrap at the edges. Bouncing would collect nodes along the sides,
            // which is exactly where the field should be thinnest.
            const margin = 30;
            if (node.x < -margin) node.x = width + margin;
            if (node.x > width + margin) node.x = -margin;
            if (node.y < -margin) node.y = height + margin;
            if (node.y > height + margin) node.y = -margin;
        });
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);

        /*
         * Links first, so the nodes sit on top of them.
         *
         * This is the O(n squared) part: at 90 nodes that is about 4,000 pairs
         * a frame, which is nothing. It is worth knowing where the ceiling is,
         * though, because raising MAX_NODES raises this quadratically.
         */
        for (let i = 0; i < nodes.length; i += 1) {
            const a = nodes[i];
            const alphaA = alphaOf(a);
            if (alphaA <= 0) {
                continue;
            }

            for (let j = i + 1; j < nodes.length; j += 1) {
                const b = nodes[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                // Compare squared distances: one square root per pair saved,
                // and the only reason the real distance is needed is the fade.
                const squared = dx * dx + dy * dy;
                if (squared > LINK_DISTANCE * LINK_DISTANCE) {
                    continue;
                }

                const distance = Math.sqrt(squared);
                const strength = 1 - distance / LINK_DISTANCE;
                const alpha = strength * alphaA * alphaOf(b) * 0.45;
                if (alpha <= 0.01) {
                    continue;
                }

                // The line takes one endpoint's colour, so the web is as
                // varied as the neurons on it. Using a neutral line instead
                // made the colours look pasted on rather than connected.
                ctx.strokeStyle = PALETTE[a.colour];
                ctx.globalAlpha = alpha;
                ctx.lineWidth = strength * 1.1;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // And a link to the pointer, which is what makes the field feel
            // like it noticed you.
            if (pointer.active) {
                const dx = a.x - pointer.x;
                const dy = a.y - pointer.y;
                const distance = Math.hypot(dx, dy);
                if (distance < POINTER_DISTANCE) {
                    const strength = 1 - distance / POINTER_DISTANCE;
                    ctx.strokeStyle =
                        "rgba(" + WHITE + ", " + (strength * alphaA * 0.35).toFixed(3) + ")";
                    ctx.lineWidth = strength * 1.2;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(pointer.x, pointer.y);
                    ctx.stroke();
                }
            }
        }

        nodes.forEach(function (node) {
            const alpha = alphaOf(node);
            if (alpha <= 0 || !sprites.length) {
                return;
            }

            const sprite = sprites[node.colour % sprites.length];
            const half = node.size / 2;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(node.x, node.y);
            ctx.rotate(node.angle);

            /*
             * A halo under the drawing.
             *
             * The artwork is thin-limbed, so on the navy it would otherwise
             * read as a scratch rather than a cell. `lighter` adds the glow to
             * what is behind it instead of covering it, which is what makes
             * overlapping neurons brighten each other rather than punching
             * holes in one another.
             */
            ctx.globalCompositeOperation = "lighter";
            const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, half * 1.5);
            glow.addColorStop(0, PALETTE[node.colour]);
            glow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.globalAlpha = alpha * 0.16;
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(0, 0, half * 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = alpha * 0.9;
            ctx.drawImage(sprite, -half, -half, node.size, node.size);
            ctx.restore();
        });
    }

    function loop() {
        frame = window.requestAnimationFrame(loop);
        if (!visible || document.hidden) {
            return;
        }
        step();
        draw();
    }

    /* --------------------------------------------------------------- wiring */

    header.addEventListener("pointermove", function (event) {
        const rect = header.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.active = true;
    });
    header.addEventListener("pointerleave", function () {
        pointer.active = false;
    });

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
     * Nothing is drawn until the artwork has loaded, because every neuron is a
     * tinted copy of it. A failure to load is not worth a broken masthead, so
     * the field simply never appears and the heading is unaffected.
     */
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", function () {
        buildSprites(image);
        build();

        if (reduced) {
            // One frame, held. The field is there, it simply does not move.
            draw();
            return;
        }
        loop();
    });
    image.addEventListener("error", function () {
        canvas.remove();
    });
    image.src = SPRITE_SRC;
})();
