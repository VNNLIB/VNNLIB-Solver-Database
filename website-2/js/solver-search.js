/*
 * The capability search, in the sliding panel on index.html.
 *
 * Where a solver's `supports` command answers "what can this solver do", this
 * asks the reverse: given a query you need solved, which solvers can take it.
 *
 * Matching is done by the API, not here. That is deliberate. The rules are
 * subtle in two places, and a second implementation would eventually disagree
 * with the first:
 *
 *   Downward closure. A solver reporting POLY also handles BND, OUTC and LIN.
 *   The records carry a `satisfies` field holding that closure already, so the
 *   API tests for containment and nothing more.
 *
 *   An empty operator type list means EVERY type the solver reports, not none.
 *   Section 5.4.1 of the standard says so, and it is the easiest thing in the
 *   format to get backwards.
 *
 * So this file builds a query, renders a list, and pages through it.
 *
 * The list is deliberately thin: one row per solver carrying its name, the
 * versions that matched as a range, when the newest of them was updated, and a
 * button. The full record is far too much to read in a table, so it lives in a
 * dialog, which is also where the releases separate again.
 */
(function () {
    "use strict";

    // Where the collected database is served from. One constant, because this is
    // the line that changes when the API moves.
    const API = "https://12er90.pythonanywhere.com";

    const REPO = "https://github.com/VNNLIB/VNNLIB-Solver-Database";

    const form = document.getElementById("solver-search-form");
    const resultsHost = document.getElementById("search-results");
    const status = document.getElementById("search-status");
    const pager = document.getElementById("pagination");
    const pageSizeSelect = document.getElementById("page-size");
    const commandLine = document.getElementById("command-line");
    const copyButton = document.getElementById("copy-command");
    const copyLabel = document.getElementById("copy-command-label");

    const nameInput = document.getElementById("q-name");
    const nameSearch = document.getElementById("name-search");
    const sortSelect = document.getElementById("sort-by");
    const filtersToggle = document.getElementById("filters-toggle");
    const filtersChevron = document.getElementById("filters-chevron");
    const filterCount = document.getElementById("filter-count");
    const activeFilters = document.getElementById("active-filters");

    const dialog = document.getElementById("details-dialog");
    const dialogTitle = document.getElementById("details-title");
    const dialogSubtitle = document.getElementById("details-subtitle");
    const dialogBody = document.getElementById("details-body");
    const dialogClose = document.getElementById("details-close");

    if (!form || !resultsHost) {
        return;
    }

    const CAPABILITY_LABELS = {
        hidden_nodes: "Hidden nodes",
        multiple_io: "Inputs and outputs",
        multiple_networks: "Multiple networks",
        node_comparisons: "Node comparisons",
        arithmetic: "Arithmetic theory",
        element_types: "Element types",
        vnnlib_versions: "VNN-LIB versions",
        onnx_opset: "ONNX opset",
    };

    /*
     * API query field to the vnnfilter flag that means the same thing. They are
     * not mechanically derivable from each other: the API takes a list under
     * `vnnlib_versions` while the package's flag is singular, and the rest
     * differ by hyphenation. Spelled out so the command shown is one that
     * actually runs.
     */
    const CLI_FLAGS = {
        hidden_nodes: "--hidden-nodes",
        multiple_io: "--multiple-io",
        multiple_networks: "--multiple-networks",
        node_comparisons: "--node-comparisons",
        arithmetic: "--arithmetic",
        element_types: "--element-types",
        operators: "--operators",
        onnx_opset: "--onnx-opset",
        vnnlib_versions: "--vnnlib-version",
    };

    // Human labels for the filter chips and for the panel button's count.
    const FILTER_LABELS = {
        hidden_nodes: "Hidden nodes",
        multiple_io: "Inputs and outputs",
        multiple_networks: "Multiple networks",
        node_comparisons: "Node comparisons",
        arithmetic: "Arithmetic theory",
        element_types: "Element type",
        operators: "Operators",
        onnx_opset: "ONNX opset",
        vnnlib_versions: "VNN-LIB version",
    };

    /*
     * One page of results, and how many there are in total.
     *
     * Nothing else is held. Filtering, sorting and paging all happen in the API,
     * so `rows` is exactly what is on screen and `total` is what the pager
     * counts. The three cannot be split up: a page of ten sorted or filtered
     * here would be a page of the wrong ten, and a total counted from one page
     * is not a total.
     */
    let rows = [];
    let total = 0;
    let page = 1;

    /* ------------------------------------------------------------ helpers -- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            // textContent throughout, never innerHTML: every string here came
            // from a solver's own output by way of the API, and a solver name is
            // not something to trust as markup.
            node.textContent = String(text);
        }
        return node;
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    /*
     * Let the sliding box go back to following its content.
     *
     * js/site.js pins #solver-swap to a pixel height for the length of the slide,
     * and measures it from whatever is on screen at the time, which during the
     * first open is the loading state. Results that arrive before the slide ends
     * would otherwise sit inside a box measured for something else: too tall for
     * six rows, too short for fifty. Clearing it here means the height is only
     * ever pinned while it is actually being animated.
     */
    function releasePinnedHeight() {
        const box = document.getElementById("solver-swap");
        if (box && box.style.height) {
            box.style.height = "";
        }
    }

    // The same default the API uses when no limit is sent, so the two cannot
    // disagree about what page one holds.
    function pageSize() {
        return Number(pageSizeSelect.value) || 10;
    }

    /* -------------------------------------------------------------- query -- */

    /*
     * The advanced filter panel is a mode, not a disclosure.
     *
     * Open, the search is by capability. Closed, it is by name. Which one is
     * showing is which one applies, so a filter the reader cannot see is never
     * narrowing their results, and neither is a name they cannot see.
     *
     * Closing the panel drops the capability filters from the query without
     * clearing the controls, so reopening it and pressing Search puts them back
     * exactly as they were. The state is the form's own; only whether it counts
     * changes.
     */
    function filtersOpen() {
        const panel = document.getElementById("filters-panel");
        return Boolean(panel && panel.classList.contains("is-open"));
    }

    function currentQuery() {
        const params = new URLSearchParams();
        if (!filtersOpen()) {
            return params;
        }
        new FormData(form).forEach(function (value, key) {
            const trimmed = String(value).trim();
            if (trimmed) {
                // Commas and repeats both mean AND, which is what the API
                // expects, so a comma separated operator list passes straight
                // through.
                params.append(key, trimmed);
            }
        });
        return params;
    }

    /* --------------------------------------------------------- the pickers -- */

    /*
     * Two of the filters are lists of names chosen from the database rather than
     * typed: the ONNX operators, and the element types. They behave identically,
     * so they are one control used twice.
     *
     * Why not a text box. The operator names are case sensitive and awkward
     * (`LeakyRelu`, `ConstantOfShape`, `ScatterND`), so a typed name is usually
     * a typo, and a typo returns an empty result that looks exactly like a real
     * answer. Matching is anywhere in the name, not only at the start, because
     * the useful queries are things like "pool" or "conv" which a prefix match
     * would miss.
     *
     * Why not a multiple-select. A <select multiple> needs ctrl-clicking to add
     * a second value, gives no way to search fifty names, and shows the
     * selection as highlighted rows that scroll out of sight. Chips stay
     * visible, and each one can be removed on its own.
     *
     * The selection is written back into a hidden comma separated field, so the
     * query builder, the command banner and the API all see an ordinary text
     * field. Commas and repeats both mean AND to the API, so several chips mean
     * "all of these".
     */
    const pickers = {};

    function createPicker(config) {
        const picker = document.getElementById(config.pickerId);
        const input = document.getElementById(config.inputId);
        const list = document.getElementById(config.listId);
        const field = document.getElementById(config.fieldId);
        if (!picker || !input || !list || !field) {
            return null;
        }

        let chosen = [];
        let highlighted = -1;

        const api = {
            field: field,
            /* Used by the chips above the results, and by the form reset. */
            clear: function () {
                chosen = [];
                syncField();
                renderChips();
                closeList();
            },
            refreshList: function () {
                if (list.classList.contains("is-open")) {
                    showList();
                }
            },
        };

        function syncField() {
            field.value = chosen.join(",");
        }

        function renderChips() {
            Array.prototype.slice.call(picker.querySelectorAll("[data-chip]")).forEach(
                function (chip) {
                    picker.removeChild(chip);
                }
            );
            chosen.forEach(function (value) {
                const chip = el(
                    "span",
                    "inline-flex items-center gap-1 rounded-md bg-brand-light px-2 py-0.5 font-mono text-sm text-brand-dark"
                );
                chip.setAttribute("data-chip", value);
                chip.appendChild(document.createTextNode(value));

                const remove = el("button", "text-brand-dark/70 transition hover:text-red-600", "×");
                remove.type = "button";
                remove.setAttribute("aria-label", "Remove " + value);
                remove.addEventListener("click", function (event) {
                    event.stopPropagation();
                    remove_(value);
                });
                chip.appendChild(remove);
                picker.insertBefore(chip, input);
            });
        }

        function closeList() {
            clear(list);
            list.classList.remove("is-open");
            input.setAttribute("aria-expanded", "false");
            highlighted = -1;
        }

        function add(value) {
            if (chosen.indexOf(value) === -1) {
                chosen.push(value);
                syncField();
                renderChips();
                renderActiveFilters();
                updateCommand(currentQuery());
            }
            input.value = "";
            input.focus();
            // Left open: picking one is usually the first of several.
            showList();
        }

        function remove_(value) {
            chosen = chosen.filter(function (kept) {
                return kept !== value;
            });
            syncField();
            renderChips();
            renderActiveFilters();
            updateCommand(currentQuery());
        }

        function matching(query) {
            const needle = query.trim().toLowerCase();
            return config
                .candidates(needle)
                .filter(function (entry) {
                    return chosen.indexOf(entry.value) === -1;
                })
                .filter(function (entry) {
                    // Substring, not prefix: "pool" has to find MaxPool.
                    //
                    // `match` where an entry needs to be found by something
                    // other than its own text: `Conv` has to stay in the list
                    // once "conv:" has been typed, since "any element type" is
                    // one of the choices being offered at that point, and
                    // "Conv" does not contain "conv:".
                    const against = (entry.match || entry.value).toLowerCase();
                    return !needle || against.indexOf(needle) !== -1;
                })
                .sort(function (a, b) {
                    // The unrestricted entry first, since "this operator at all"
                    // is the more common of the two questions.
                    if (Boolean(a.note) !== Boolean(b.note)) {
                        return a.note ? -1 : 1;
                    }
                    // A name that starts with what was typed is the better
                    // guess, so it goes next; the rest keep alphabetical order.
                    const aStarts = a.value.toLowerCase().indexOf(needle) === 0;
                    const bStarts = b.value.toLowerCase().indexOf(needle) === 0;
                    if (aStarts !== bStarts) {
                        return aStarts ? -1 : 1;
                    }
                    return a.value.localeCompare(b.value);
                })
                .slice(0, 40);
        }

        function highlight(index) {
            // Only the real options: the "no match" and "loading" rows are
            // messages, and highlighting one would offer it as a choice.
            const items = Array.prototype.slice.call(list.querySelectorAll("[role='option']"));
            if (!items.length) {
                return;
            }
            highlighted = (index + items.length) % items.length;
            items.forEach(function (item, i) {
                const on = i === highlighted;
                item.classList.toggle("bg-brand-tint", on);
                item.setAttribute("aria-selected", String(on));
                if (on && typeof item.scrollIntoView === "function") {
                    item.scrollIntoView({ block: "nearest" });
                }
            });
        }

        function showList() {
            const matches = matching(input.value);
            clear(list);

            if (!matches.length) {
                list.appendChild(
                    el(
                        "li",
                        "px-3 py-2 text-base text-ink-muted",
                        config.candidates("").length ? config.emptyText : config.loadingText
                    )
                );
                list.classList.add("is-open");
                input.setAttribute("aria-expanded", "true");
                highlighted = -1;
                return;
            }

            const needle = input.value.trim();
            matches.forEach(function (entry) {
                const option = el(
                    "li",
                    "flex cursor-pointer items-baseline gap-2 px-3 py-1.5 transition hover:bg-brand-tint"
                );
                option.setAttribute("role", "option");
                option.setAttribute("aria-selected", "false");
                // What gets added, kept as data rather than read back out of the
                // text, which by then has the matched span and the type list in
                // it as well.
                option.setAttribute("data-value", entry.value);

                // Show which part of the name matched, so a substring hit does
                // not look arbitrary.
                const label = el("span", "font-mono text-base text-ink");
                const at = needle ? entry.value.toLowerCase().indexOf(needle.toLowerCase()) : -1;
                if (at === -1) {
                    label.textContent = entry.value;
                } else {
                    label.appendChild(document.createTextNode(entry.value.slice(0, at)));
                    label.appendChild(
                        el("strong", "font-bold text-brand-dark", entry.value.slice(at, at + needle.length))
                    );
                    label.appendChild(document.createTextNode(entry.value.slice(at + needle.length)));
                }
                option.appendChild(label);

                /*
                 * The element types this name can be asked for, printed after it
                 * the way the standard's own output does:
                 *
                 *     Conv float64 float32
                 *     Relu float64 float32
                 *     MatMul
                 *
                 * A name with nothing after it is not restricted, which per
                 * section 5.4.1 means every element type its solver reports, not
                 * none. That is the one thing in this format that reads
                 * backwards, so it is spelled out rather than left blank.
                 */
                if (entry.types && entry.types.length) {
                    option.appendChild(
                        el(
                            "span",
                            "ml-auto truncate font-mono text-xs text-ink-muted",
                            entry.types.join(" ")
                        )
                    );
                }
                if (entry.note) {
                    option.appendChild(el("span", "ml-auto text-xs text-ink-muted", entry.note));
                }

                // mousedown, not click: the input's blur would close the list
                // first.
                option.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                    add(entry.value);
                });

                list.appendChild(option);
            });

            list.classList.add("is-open");
            input.setAttribute("aria-expanded", "true");
            highlight(0);
        }

        // Clicking the padding around the chips should land in the input, which
        // is what the box looks like it does.
        picker.addEventListener("click", function (event) {
            if (event.target === picker) {
                input.focus();
                showList();
            }
        });

        input.addEventListener("focus", showList);
        input.addEventListener("input", showList);
        // `focus` only fires on the way in, and the input keeps focus through a
        // pick, so a click needs to open the list too.
        input.addEventListener("click", showList);
        input.addEventListener("blur", function () {
            // A tick, so a click on an option is not cancelled by the list
            // disappearing underneath it.
            window.setTimeout(closeList, 120);
        });

        input.addEventListener("keydown", function (event) {
            const items = list.querySelectorAll("[role='option']");

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!list.classList.contains("is-open")) {
                    showList();
                } else {
                    highlight(highlighted + (event.key === "ArrowDown" ? 1 : -1));
                }
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                // Enter means "the one I am looking at", never "whatever I
                // typed": a half-typed name is a filter that matches nothing.
                if (items.length && highlighted >= 0) {
                    add(items[highlighted].getAttribute("data-value"));
                }
                return;
            }
            if (event.key === "Escape") {
                closeList();
                return;
            }
            if (event.key === "Backspace" && !input.value && chosen.length) {
                // The usual behaviour of a field made of chips.
                remove_(chosen[chosen.length - 1]);
            }
        });

        return api;
    }

    /*
     * The operators, and the types each one can be asked for.
     *
     * `operatorTypes` comes from /vocabulary as a map of name to types. A query
     * containing a colon is taken as "this operator, at one type", and the list
     * offers the types that operator actually has rather than every type in the
     * database, so a combination that no solver reports is never suggested.
     */
    let operatorTypes = {};

    function operatorCandidates(needle) {
        const names = Object.keys(operatorTypes);
        const colon = needle.indexOf(":");
        if (colon === -1) {
            return names.map(function (name) {
                return { value: name, types: operatorTypes[name] || [] };
            });
        }
        /*
         * Typing a colon switches the list to that operator's types. Offering
         * every name crossed with every type unconditionally would be several
         * hundred rows, most of them combinations nobody wants; this way the
         * expansion happens only once the reader has asked for it.
         */
        const stem = needle.slice(0, colon);
        const out = [];
        names.forEach(function (name) {
            if (name.toLowerCase().indexOf(stem) === -1) {
                return;
            }
            out.push({
                value: name,
                types: [],
                note: "any element type",
                match: needle,
            });
            (operatorTypes[name] || []).forEach(function (type) {
                out.push({ value: name + ":" + type, types: [] });
            });
        });
        return out;
    }

    let knownElementTypes = [];

    function elementTypeCandidates() {
        return knownElementTypes.map(function (name) {
            return { value: name, types: [] };
        });
    }

    pickers.operators = createPicker({
        pickerId: "operator-picker",
        inputId: "operator-input",
        listId: "operator-suggestions",
        fieldId: "f-operators",
        candidates: operatorCandidates,
        emptyText: "No operator matches",
        loadingText: "Loading the operator list...",
    });

    pickers.element_types = createPicker({
        pickerId: "element-picker",
        inputId: "element-input",
        listId: "element-suggestions",
        fieldId: "f-element_types",
        candidates: elementTypeCandidates,
        emptyText: "No element type matches",
        loadingText: "Loading the element types...",
    });

    /* ------------------------------------------------- the command banner -- */

    /*
     * Shell-quote a value, but only when it needs it. Everything the filters can
     * produce is a bare identifier, so quoting unconditionally would make the
     * command noisier than anything a person would type.
     */
    function shellArg(value) {
        return /^[A-Za-z0-9._\/-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
    }

    function commandFor(params) {
        const parts = ["vnnfilter"];
        Object.keys(CLI_FLAGS).forEach(function (field) {
            const values = params.getAll(field);
            if (!values.length) {
                return;
            }
            // The list-valued flags take several words after one flag, so a
            // comma separated operator list becomes `--operators Conv Relu`.
            const words = [];
            values.forEach(function (value) {
                value.split(",").forEach(function (part) {
                    const trimmed = part.trim();
                    if (trimmed) {
                        words.push(shellArg(trimmed));
                    }
                });
            });
            parts.push(CLI_FLAGS[field], words.join(" "));
        });

        // With nothing selected, `vnnfilter` on its own lists everything, which
        // is exactly what the results below are showing.
        return parts.join(" ");
    }

    /*
     * Type the command out rather than swapping the text.
     *
     * The point is not decoration. The line changes on every filter, and a
     * wholesale swap gives no sense of what changed: adding a flag reads exactly
     * like replacing the whole command. Typing shows the edit instead.
     *
     * It edits in place. The old and new commands are compared from both ends,
     * so the shared head and the shared tail both stay on screen untouched and
     * only the span between them is rewritten. Changing `--arithmetic POLY` to
     * `LIN` moves four characters; it does not delete and retype the operator
     * list that follows, which is what a plain prefix comparison would do and
     * what made this feel like the command was being rebuilt from scratch every
     * time.
     */
    const typeCommand = (function () {
        /*
         * One pace for both directions.
         *
         * Typing advances a character at a time and deleting a word at a time,
         * so a single constant would make them wildly different speeds: a flat
         * 34ms per deletion removed `--arithmetic` five times faster than typing
         * it put it there, which read as the text being yanked away rather than
         * edited.
         *
         * So deleting is charged per character removed, at the same rate typing
         * adds them. It still steps by whole words, which is how a person edits
         * a command line, but a long word now takes a long word's worth of time.
         */
        const TYPE_MS = 14;

        // Honour a request for reduced motion by setting the text outright.
        // Someone who asked for less movement did not ask to wait for it.
        const reduced =
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        /*
         * The line is rendered in three pieces so the caret can sit at the point
         * being edited rather than at the end of the line. Only the middle one
         * changes while an edit runs.
         */
        const head = document.createTextNode("");
        const middle = document.createElement("span");
        const tail = document.createTextNode("");
        middle.className = "cmd-edit";

        // Read the placeholder before clearing, or it is lost.
        const initial = commandLine.textContent;
        clear(commandLine);
        middle.textContent = initial;
        commandLine.appendChild(head);
        commandLine.appendChild(middle);
        commandLine.appendChild(tail);

        let shown = initial;
        let target = shown;

        // The unchanging ends of the current edit, and the part still moving.
        let prefix = "";
        let suffix = "";
        let from = shown;
        let to = shown;
        let current = shown;
        let timer = null;

        function render() {
            head.nodeValue = prefix;
            middle.textContent = current;
            tail.nodeValue = suffix;
        }

        /* Where the previous word starts. Deleting a word at a time reads like
         * editing; deleting a character at a time is just slow. */
        function wordStart(text) {
            let i = text.length;
            while (i > 0 && text.charAt(i - 1) === " ") {
                i -= 1;
            }
            while (i > 0 && text.charAt(i - 1) !== " ") {
                i -= 1;
            }
            return i;
        }

        /*
         * Split the old and new commands into a shared head, a shared tail, and
         * the differing span between them.
         *
         * The tail search stops before it can reach back into the head, so the
         * two never overlap on a command that repeats itself.
         */
        function plan() {
            let p = 0;
            while (p < from.length && p < to.length && from.charAt(p) === to.charAt(p)) {
                p += 1;
            }

            let s = 0;
            const room = Math.min(from.length - p, to.length - p);
            while (
                s < room &&
                from.charAt(from.length - 1 - s) === to.charAt(to.length - 1 - s)
            ) {
                s += 1;
            }

            prefix = to.slice(0, p);
            suffix = to.slice(to.length - s);
            from = from.slice(p, from.length - s);
            to = to.slice(p, to.length - s);
            current = from;
        }

        function step() {
            if (current === to) {
                shown = prefix + current + suffix;
                if (shown === target) {
                    timer = null;
                    middle.classList.remove("is-typing");
                    return;
                }
                // The target moved while this edit was running. Fold what is on
                // screen back into one string and plan the next edit from there.
                from = shown;
                to = target;
                prefix = "";
                suffix = "";
                plan();
                render();
                timer = window.setTimeout(step, TYPE_MS);
                return;
            }

            let delay;
            if (current.length && !to.startsWith(current)) {
                // Still holding characters the new text does not want.
                const before = current.length;
                current = current.slice(0, wordStart(current));
                // Charged per character removed, so a word disappears over the
                // same span of time it would take to type.
                delay = TYPE_MS * (before - current.length);
            } else {
                current = to.slice(0, current.length + 1);
                delay = TYPE_MS;
            }

            render();
            timer = window.setTimeout(step, delay);
        }

        /*
         * The queue holds one destination, not a backlog.
         *
         * Changing a select fires several times in a row, and replaying every
         * intermediate command would fall further behind the controls with each
         * one. Keeping only the newest target means the animation always ends on
         * what is currently selected, and an edit already running finishes its
         * current span before retargeting rather than being cancelled and
         * restarted.
         */
        return function (next) {
            target = next;
            if (reduced) {
                shown = next;
                prefix = "";
                suffix = "";
                current = next;
                from = next;
                to = next;
                render();
                return;
            }
            if (timer) {
                return;
            }
            if (shown === target) {
                return;
            }
            from = shown;
            to = target;
            plan();
            middle.classList.add("is-typing");
            render();
            timer = window.setTimeout(step, TYPE_MS);
        };
    })();

    // What Copy puts on the clipboard. Kept separately from what is on screen,
    // because mid-animation the screen holds half a command.
    let finalCommand = commandLine.textContent;

    function updateCommand(params) {
        finalCommand = commandFor(params);
        typeCommand(finalCommand);
    }

    if (copyButton) {
        copyButton.addEventListener("click", function () {
            // The finished command, not whatever the animation has typed so far.
            const text = finalCommand;
            const done = function () {
                copyLabel.textContent = "Copied";
                window.setTimeout(function () {
                    copyLabel.textContent = "Copy";
                }, 1500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () {
                    copyLabel.textContent = "Press Ctrl+C";
                });
            } else {
                // Older browsers, and any page not served over https, where the
                // clipboard API is unavailable. Select the text so the keyboard
                // shortcut works.
                const range = document.createRange();
                range.selectNodeContents(commandLine);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                copyLabel.textContent = "Press Ctrl+C";
            }
        });
    }

    /* ------------------------------------------------------ detail render -- */

    function formatValue(field, value) {
        if (value === null || value === undefined) {
            return "not reported";
        }
        if (typeof value === "boolean") {
            return value ? "yes" : "no";
        }
        if (Array.isArray(value)) {
            // onnx_opset and vnnlib_versions are inclusive [min, max] pairs, so
            // they read as a range rather than as a list of two things.
            if ((field === "onnx_opset" || field === "vnnlib_versions") && value.length === 2) {
                return value[0] === value[1] ? String(value[0]) : value[0] + " to " + value[1];
            }
            return value.length ? value.join(", ") : "none";
        }
        return String(value);
    }

    function capabilityRow(label, field, value) {
        const row = el("div", "grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4");
        row.appendChild(el("dt", "font-heading text-sm font-semibold text-ink-muted", label));
        row.appendChild(el("dd", "text-base text-ink sm:col-span-2", formatValue(field, value)));
        return row;
    }

    function operatorList(operators) {
        const wrapper = el("div", "mt-5");
        const names = Object.keys(operators || {}).sort();
        wrapper.appendChild(
            el("p", "font-heading text-sm font-semibold text-ink-muted",
                "ONNX operators (" + names.length + ")")
        );

        if (!names.length) {
            wrapper.appendChild(el("p", "mt-1 text-base text-ink", "none reported"));
            return wrapper;
        }

        const list = el("div", "mt-2 flex flex-wrap gap-1.5");
        names.forEach(function (name) {
            const types = operators[name];
            // An empty list is not "no types". It means every element type the
            // solver supports, so it is shown as the unrestricted case.
            const restricted = Array.isArray(types) && types.length > 0;
            const chip = el(
                "span",
                restricted
                    ? "inline-flex items-center rounded-md bg-white px-2 py-0.5 font-mono text-xs text-ink ring-1 ring-brand/30"
                    : "inline-flex items-center rounded-md bg-brand-tint px-2 py-0.5 font-mono text-xs text-ink-muted ring-1 ring-ink/10",
                restricted ? name + ": " + types.join(", ") : name
            );
            chip.title = restricted
                ? "Restricted to " + types.join(", ")
                : "Supported for every element type this solver reports";
            list.appendChild(chip);
        });
        wrapper.appendChild(list);
        return wrapper;
    }

    function notesList(notes) {
        const wrapper = el("div", "mt-5 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200");
        wrapper.appendChild(
            el("p", "font-heading text-sm font-semibold text-amber-800", "Note")
        );
        const list = el("ul", "mt-2 space-y-1.5");
        notes.forEach(function (note) {
            const item = el("li", "text-sm leading-relaxed text-amber-900");
            if (note.identifier) {
                item.appendChild(el("span", "font-mono font-semibold", note.identifier));
                item.appendChild(document.createTextNode(" "));
            }
            // The text keeps whatever delimiter the solver printed, per
            // docs/SCHEMA.md, so it is shown as it arrived.
            item.appendChild(document.createTextNode(note.text || ""));
            list.appendChild(item);
        });
        wrapper.appendChild(list);
        return wrapper;
    }

    /*
     * A row of buttons, one per matching release, newest first.
     *
     * Newest first because that is the one a reader is most likely to want,
     * and it is the one shown when the dialog opens, so the selected button
     * should be where the eye already is rather than at the far end of the row.
     */
    function releasePicker(records, detail) {
        const wrapper = el("div", "mt-5");
        wrapper.appendChild(
            el("p", "font-heading text-sm font-semibold text-ink", "Matching releases")
        );

        const row = el("div", "mt-2 flex flex-wrap gap-2");
        const buttons = [];
        const ordered = records.slice().reverse();

        ordered.forEach(function (record, index) {
            const button = el("button", "release-tab font-mono", record.version);
            button.type = "button";
            button.setAttribute("aria-pressed", String(index === 0));
            button.addEventListener("click", function () {
                buttons.forEach(function (other) {
                    other.setAttribute("aria-pressed", String(other === button));
                });
                showRelease(record, detail);
            });
            buttons.push(button);
            row.appendChild(button);
        });

        wrapper.appendChild(row);
        return wrapper;
    }

    /* Everything one release reports, rendered into `host`. */
    function showRelease(record, host) {
        const capabilities = record.capabilities || {};
        clear(host);

        const heading = el("p", "mt-5 text-base text-ink-muted");
        heading.appendChild(document.createTextNode("Version "));
        heading.appendChild(el("span", "font-mono font-semibold text-ink", record.version || "unknown"));
        if (record.collected_at) {
            heading.appendChild(
                document.createTextNode(", updated " + String(record.collected_at).slice(0, 10))
            );
        }
        host.appendChild(heading);

        const list = el("dl", "mt-4 divide-y divide-ink/5");
        Object.keys(CAPABILITY_LABELS).forEach(function (field) {
            if (field in capabilities) {
                list.appendChild(capabilityRow(CAPABILITY_LABELS[field], field, capabilities[field]));
            }
        });
        if ("optimised_disjunction" in capabilities) {
            list.appendChild(
                capabilityRow("Optimised disjunctive reasoning", null, capabilities.optimised_disjunction)
            );
        }
        if ("serialise_assignments" in capabilities) {
            list.appendChild(
                capabilityRow("Serialises assignments", null, capabilities.serialise_assignments)
            );
        }
        host.appendChild(list);

        host.appendChild(operatorList(capabilities.operators));

        if (Array.isArray(record.notes) && record.notes.length) {
            host.appendChild(notesList(record.notes));
        }
    }

    /*
     * The dialog is per solver, and a solver can have several matching
     * releases, so the body has two parts: what is true of the solver, and
     * what is true of one release.
     *
     * A picker switches between releases in place rather than closing and
     * reopening, because the interesting question once the dialog is open is
     * usually "what changed between these two", and that is a comparison the
     * reader makes by flicking back and forth.
     */
    function openDetails(card) {
        const records = card.records || [];

        dialogTitle.textContent = card.name;
        clear(dialogSubtitle);
        dialogSubtitle.appendChild(
            document.createTextNode(
                (records.length === 1 ? "Version " : "Versions ") + rangeLabel(card.matches)
            )
        );
        if (card.matches.matched < card.matches.total) {
            dialogSubtitle.appendChild(
                document.createTextNode(
                    " (" + card.matches.matched + " of " + card.matches.total +
                    " releases match your filters)"
                )
            );
        }

        clear(dialogBody);

        if (card.repo) {
            const link = el("a", "link text-base", card.repo);
            link.href = card.repo;
            link.target = "_blank";
            link.rel = "noopener";
            const line = el("p", "text-base text-ink-muted");
            line.appendChild(document.createTextNode("Source: "));
            line.appendChild(link);
            dialogBody.appendChild(line);
        }

        // Filled by showRelease, replaced wholesale on every switch.
        const detail = el("div");

        if (records.length > 1) {
            dialogBody.appendChild(releasePicker(records, detail));
        }
        dialogBody.appendChild(detail);
        showRelease(records[records.length - 1] || {}, detail);

        if (typeof dialog.showModal === "function") {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }

        // One frame later, so the browser has painted the closed state and has
        // something to transition from. Setting the class in the same tick
        // would land in the same style recalculation as the open, and nothing
        // would animate.
        window.requestAnimationFrame(function () {
            dialog.classList.add("is-open");
        });
    }

    /*
     * Closing runs the transition first and calls close() at the end of it.
     *
     * The `transitionend` is the signal, with a timer as a backstop: a browser
     * that skips the transition, because of reduced motion or because the
     * dialog was never painted, never fires the event, and the dialog would be
     * left open forever.
     */
    function hideDialog() {
        // Mirrors the showModal fallback above. A <dialog> without close() is
        // one without showModal() either, so it was opened by attribute and is
        // closed the same way.
        if (typeof dialog.close === "function") {
            dialog.close();
        } else {
            dialog.removeAttribute("open");
        }
    }

    function closeDetails() {
        if (!dialog.classList.contains("is-open")) {
            hideDialog();
            return;
        }
        dialog.classList.remove("is-open");

        let done = false;
        function finish() {
            if (done) {
                return;
            }
            done = true;
            dialog.removeEventListener("transitionend", onEnd);
            hideDialog();
        }
        function onEnd(event) {
            // Only the dialog's own transition, not one bubbling up from a chip
            // or a link inside it.
            if (event.target === dialog) {
                finish();
            }
        }
        dialog.addEventListener("transitionend", onEnd);
        window.setTimeout(finish, 320);
    }

    if (dialogClose) {
        dialogClose.addEventListener("click", closeDetails);
    }
    if (dialog) {
        // Clicking the backdrop closes it. The dialog's own box is a child, so
        // a click landing on the element itself came from outside the content.
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) {
                closeDetails();
            }
        });

        // Escape closes a <dialog> immediately, which would skip the
        // transition. Take it over and run the same path as every other close.
        dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            closeDetails();
        });
    }

    /* ------------------------------------------------------- list render --- */

    function skeleton() {
        clear(resultsHost);
        pager.classList.add("hidden");

        const box = el("div", "overflow-hidden rounded-xl border border-ink/10 bg-white shadow-card");
        /*
         * A few rows, not a page's worth.
         *
         * Sizing this to the page size was worse: it drew a ten-row box for a
         * search that turns out to have six results, so the table looked like it
         * had a fixed height and then collapsed. The table is only ever as tall
         * as the rows in it, and this says "something is coming" without
         * claiming how much.
         */
        for (let i = 0; i < 3; i += 1) {
            const line = el(
                "div",
                "flex items-center gap-4 border-b border-ink/5 px-4 py-4 last:border-b-0"
            );
            line.appendChild(el("div", "h-4 w-40 animate-pulse rounded bg-ink/10"));
            line.appendChild(el("div", "h-4 w-16 animate-pulse rounded bg-ink/10"));
            line.appendChild(el("div", "ml-auto h-8 w-20 animate-pulse rounded-lg bg-ink/10"));
            box.appendChild(line);
        }
        resultsHost.appendChild(box);
    }

    function showError(message, detail) {
        clear(resultsHost);
        pager.classList.add("hidden");
        releasePinnedHeight();

        const panel = el("div", "rounded-2xl border border-red-200 bg-red-50 p-6");
        panel.appendChild(el("h3", "font-heading text-lg font-bold text-red-900", message));
        if (detail) {
            panel.appendChild(el("p", "mt-2 text-base leading-relaxed text-red-800", detail));
        }
        const note = el("p", "mt-4 text-base leading-relaxed text-red-800");
        note.appendChild(
            document.createTextNode("The database itself is unaffected. You can browse it directly in ")
        );
        const link = el("a", "font-semibold underline", "the repository");
        link.href = REPO + "/blob/main/data/solvers.json";
        link.target = "_blank";
        link.rel = "noopener";
        note.appendChild(link);
        note.appendChild(document.createTextNode(", or run the command above locally."));
        panel.appendChild(note);
        resultsHost.appendChild(panel);
    }

    function showEmpty(params) {
        clear(resultsHost);
        pager.classList.add("hidden");
        releasePinnedHeight();

        const panel = el("div", "rounded-2xl border border-ink/10 bg-white p-8 text-center shadow-card");
        panel.appendChild(
            el("h3", "font-heading text-lg font-bold text-ink", "No solver matches every filter")
        );
        panel.appendChild(
            el(
                "p",
                "mx-auto mt-2 max-w-prose text-base leading-relaxed text-ink-muted",
                params.toString()
                    ? "Nothing in the database satisfies all of them at once. Try removing the most specific one."
                    : "The database is empty."
            )
        );
        resultsHost.appendChild(panel);
    }

    /* `rows` is already the page the API sent, so there is nothing to slice. */
    function renderPage() {
        const pages = Math.max(1, Math.ceil(total / pageSize()));
        clear(resultsHost);
        releasePinnedHeight();

        const box = el("div", "overflow-hidden rounded-xl border border-ink/10 bg-white shadow-card");
        const table = el("table", "w-full text-left");

        const thead = el("thead");
        const headRow = el("tr", "border-b border-ink/10 bg-brand-tint");
        headRow.appendChild(el("th", "table-th", "Solver"));
        headRow.appendChild(el("th", "table-th", "Versions"));
        headRow.appendChild(el("th", "table-th hidden sm:table-cell", "Updated at"));
        const actions = el("th", "table-th text-right", "");
        actions.appendChild(el("span", "sr-only", "Details"));
        headRow.appendChild(actions);
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = el("tbody", "divide-y divide-ink/5");
        rows.forEach(function (row) {
            const tr = el("tr", "transition hover:bg-brand-tint/60");

            tr.appendChild(el("td", "table-td font-semibold", row.name));

            const versionCell = el("td", "table-td");
            versionCell.appendChild(
                el("span", "font-mono text-base", rangeLabel(row.matches))
            );
            /*
             * Only when some releases did not match. "3 of 5" next to a range
             * is the difference between "this solver does what you asked" and
             * "three of its releases do"; printing it on every row, including
             * the ones where it is 5 of 5, would be noise that hides the case
             * that matters.
             */
            if (row.matches.matched < row.matches.total) {
                const count = el(
                    "span",
                    "ml-2 whitespace-nowrap rounded-md bg-brand-tint px-1.5 py-0.5 text-xs font-semibold text-ink-muted ring-1 ring-ink/10",
                    row.matches.matched + " of " + row.matches.total
                );
                count.title =
                    row.matches.matched + " of this solver's " + row.matches.total +
                    " releases match every filter";
                versionCell.appendChild(count);
            }
            tr.appendChild(versionCell);

            const updated = (row.matches.latest || {}).collected_at;
            const updatedCell = el(
                "td",
                "table-td hidden text-base text-ink-muted sm:table-cell",
                updated ? String(updated).slice(0, 10) : "unknown"
            );
            // The date belongs to the newest matching release, not to the
            // solver, so say which one it came from.
            if (updated && row.matches.matched > 1) {
                updatedCell.title =
                    "Version " + (row.matches.latest || {}).version + ", the newest that matched";
            }
            tr.appendChild(updatedCell);

            const cell = el("td", "px-4 py-3 text-right");
            const button = el(
                "button",
                "inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 font-heading text-sm font-semibold text-ink transition hover:border-brand hover:text-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                "Details"
            );
            button.type = "button";
            button.addEventListener("click", function () {
                openDetails(row);
            });
            cell.appendChild(button);
            tr.appendChild(cell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);
        resultsHost.appendChild(box);

        renderPager(pages, rows.length);
    }

    function renderPager(pages, shown) {
        clear(pager);

        if (total <= pageSize()) {
            pager.classList.add("hidden");
            return;
        }
        pager.classList.remove("hidden");

        const first = (page - 1) * pageSize() + 1;
        pager.appendChild(
            el(
                "p",
                "text-base text-ink-muted",
                "Showing " + first + " to " + (first + shown - 1) + " of " + total
            )
        );

        const controls = el("div", "flex items-center gap-1.5");

        function button(label, target, disabled, current) {
            const node = el("button", current ? "page-button-current" : "page-button", label);
            node.type = "button";
            if (current) {
                node.setAttribute("aria-current", "page");
            }
            node.disabled = Boolean(disabled);
            if (!disabled && !current) {
                node.addEventListener("click", function () {
                    /*
                     * A page is a request now, not a slice of something already
                     * in hand, so this goes back to the API for that window.
                     * Not refresh(), which resets to page one.
                     *
                     * And nothing is scrolled. The pager is already under the
                     * reader's eyes and cursor, and the rows it replaces are
                     * above it, so the honest thing is to leave the page where
                     * they put it. Scrolling the results to the top of the
                     * viewport looks like a jump downwards whenever the toolbar
                     * was visible above them, which it usually is.
                     */
                    page = target;
                    load(currentQuery(), false, true);
                });
            }
            return node;
        }

        controls.appendChild(button("Previous", page - 1, page === 1));

        /*
         * Numbers around the current page, with gaps rather than every page
         * listed: the database will grow, and a row of forty buttons is not a
         * control anyone uses.
         */
        const numbers = [];
        for (let i = 1; i <= pages; i += 1) {
            if (i === 1 || i === pages || Math.abs(i - page) <= 1) {
                numbers.push(i);
            }
        }
        let previous = 0;
        numbers.forEach(function (i) {
            if (previous && i - previous > 1) {
                controls.appendChild(el("span", "px-1 text-ink-muted", "..."));
            }
            controls.appendChild(button(String(i), i, false, i === page));
            previous = i;
        });

        controls.appendChild(button("Next", page + 1, page === pages));

        pager.appendChild(controls);
    }

    /*
     * One row per solver, not per release.
     *
     * The grouping itself is the API's, carried in `matches`. It has to be:
     * whether two matching releases are consecutive depends on the releases
     * between them, and a search response only contains the ones that matched.
     * Given 1.0.0, 1.1.0 and 2.1.0 there is nothing here that could tell you a
     * 1.2.0 and a 2.0.0 exist and did not match, so a range drawn in the
     * browser would be claiming a measurement it does not have.
     */
    function toCards(payload) {
        return (payload.solvers || []).map(function (solver) {
            const records = solver.versions || [];
            const matches = solver.matches || fallbackMatches(records);
            return {
                id: solver.id,
                name: solver.name || solver.id,
                repo: solver.repo,
                records: records,
                matches: matches,
                // The record the row sorts and dates itself on.
                latest: records[records.length - 1] || {},
            };
        });
    }

    /*
     * What `matches` would be if the API did not send one.
     *
     * Only reachable against an older deployment of the API. Every release in
     * hand is treated as one run, which is right whenever nothing was filtered
     * out, and is the least misleading guess otherwise because the alternative
     * is showing no version at all.
     */
    function fallbackMatches(records) {
        const versions = records.map(function (r) { return r.version; });
        const last = records[records.length - 1] || {};
        return {
            ranges: versions.length
                ? [{ from: versions[0], to: versions[versions.length - 1], versions: versions }]
                : [],
            latest: { version: last.version, collected_at: last.collected_at },
            matched: versions.length,
            total: versions.length,
        };
    }

    /*
     * "1.0.0", or "1.0.0 to 2.0.0", or "1.0.0 to 1.2.0, 2.1.0".
     *
     * A run of one is printed as the bare version rather than "1.0.0 to
     * 1.0.0", and separate runs stay separate: joining them into one span
     * would assert that the releases in the gap matched too.
     */
    function rangeLabel(matches) {
        const ranges = (matches && matches.ranges) || [];
        if (!ranges.length) {
            return "unknown";
        }
        return ranges
            .map(function (range) {
                return range.from === range.to ? range.from : range.from + " to " + range.to;
            })
            .join(", ");
    }

    /* ----------------------------------------------------- name and chips --- */

    /*
     * Ordering used to be done here, over the rows already fetched, and is now
     * a `sort` parameter on the request. It had to move with the paging: the API
     * decides which ten solvers a page holds, so whatever orders them has to be
     * whatever slices them. Sorting a page of ten in the browser only reorders
     * that page, which looks right until you notice the top result is missing
     * because it was on page two.
     *
     * The same goes for the name box, which is a `name` parameter now. Filtering
     * a page locally leaves a page of ten minus however many were dropped, and a
     * total that counts solvers the reader cannot reach.
     */
    function currentName() {
        if (!nameInput || filtersOpen()) {
            return "";
        }
        return nameInput.value.trim();
    }

    /* The chips above the results, one per active filter, each one removable. */
    function renderActiveFilters() {
        if (!activeFilters) {
            return;
        }
        clear(activeFilters);

        const params = currentQuery();
        const entries = [];
        params.forEach(function (value, key) {
            entries.push([key, value]);
        });

        if (filterCount) {
            filterCount.textContent = String(entries.length);
            filterCount.classList.toggle("hidden", entries.length === 0);
        }

        const needle = currentName();
        if (needle) {
            entries.unshift(["__name", nameInput.value.trim()]);
        }

        if (!entries.length) {
            return;
        }

        entries.forEach(function (entry) {
            const key = entry[0];
            const label = key === "__name" ? "Name" : FILTER_LABELS[key] || key;

            const chip = el(
                "span",
                "inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-heading text-xs font-semibold text-ink ring-1 ring-ink/10"
            );
            chip.appendChild(el("span", "text-ink-muted", label));
            chip.appendChild(el("span", "font-mono", entry[1]));

            const remove = el("button", "text-ink-muted transition hover:text-red-600");
            remove.type = "button";
            remove.setAttribute("aria-label", "Remove the " + label + " filter");
            remove.textContent = "×";
            remove.addEventListener("click", function () {
                if (key === "__name") {
                    nameInput.value = "";
                    refresh();
                    return;
                }
                if (pickers[key]) {
                    // The hidden field is a projection of the chips, so clearing
                    // it alone would leave the chips on screen claiming a filter
                    // that is no longer applied.
                    pickers[key].clear();
                } else {
                    const field = form.elements[key];
                    if (field) {
                        field.value = "";
                        // Setting a value from script fires no event, and the
                        // replacement dropdown in js/select.js listens for one
                        // to know what to display. Without this the chip goes
                        // but the dropdown still shows the old choice.
                        field.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                }
                refresh();
            });
            chip.appendChild(remove);

            activeFilters.appendChild(chip);
        });

        const clearAll = el(
            "button",
            "font-heading text-xs font-semibold text-brand-dark underline decoration-brand/30 decoration-2 underline-offset-2 transition hover:decoration-brand",
            "Clear all"
        );
        clearAll.type = "button";
        clearAll.addEventListener("click", function () {
            if (nameInput) {
                nameInput.value = "";
            }
            // Only reset. The form's own reset handler reloads, so calling load
            // here as well would fire two requests, and the first would read the
            // fields before reset had finished clearing them.
            form.reset();
        });
        activeFilters.appendChild(clearAll);
    }

    /*
     * Ask again. Every control on this panel ends here, because every one of
     * them changes which solvers the API should return or which slice of them.
     */
    function refresh() {
        page = 1;
        load(currentQuery(), false);
    }

    function summarise() {
        const releases = rows.reduce(function (sum, row) {
            return sum + row.matches.matched;
        }, 0);
        /*
         * Counts only. When the database was generated is a fact about the
         * pipeline, not about the solvers, and it read as though the results
         * might be stale when they are fetched fresh on every load. Each
         * release carries its own measurement date in the table anyway, which
         * is the date that actually qualifies what is shown.
         *
         * The solver count is the total across every page; the release count is
         * only what is on this one, because the API does not send the releases
         * it did not send. Said as "on this page" rather than left to look like
         * a total that does not add up.
         */
        const solvers = (total === 1 ? "1 solver" : total + " solvers");
        const shown =
            total > rows.length
                ? ", " + releases + " releases on this page"
                : ", " + (releases === 1 ? "1 release" : releases + " releases");
        status.textContent = solvers + shown;
    }

    /* ----------------------------------------------------------- fetching -- */

    /*
     * The whole request, filters and presentation together.
     *
     * `params` holds the capability filters, which are also what the vnnfilter
     * command shows. The four below are added here rather than there because
     * they are not part of the query: they say how to present the answer, and
     * the package has no flags for them.
     */
    function searchUrl(params) {
        const url = new URLSearchParams(params.toString());
        const name = currentName();
        if (name) {
            url.set("name", name);
        }
        url.set("sort", sortSelect ? sortSelect.value : "date-desc");
        url.set("limit", String(pageSize()));
        url.set("offset", String((page - 1) * pageSize()));
        return API + "/search?" + url.toString();
    }

    /*
     * `inPlace` is for paging. The skeleton is the right loading state for a new
     * search, where the answer could be anything, but it is five rows tall: swap
     * it in for a page of ten and the box shrinks, the pager jumps up under the
     * cursor, and then everything grows back when the rows arrive. For paging the
     * old rows stay put and go dim, so nothing moves and the button the reader
     * just pressed is still where they pressed it.
     */
    function load(params, isFirstLoad, inPlace) {
        updateCommand(params);
        status.textContent = isFirstLoad ? "Loading the database..." : "Searching...";
        if (inPlace && rows.length) {
            resultsHost.setAttribute("aria-busy", "true");
            resultsHost.classList.add("is-loading");
        } else {
            skeleton();
        }

        fetch(searchUrl(params), { headers: { Accept: "application/json" } })
            .then(function (response) {
                return response.json().then(function (payload) {
                    if (!response.ok) {
                        // The API reports an unknown filter as a 400 rather than
                        // silently returning everything, which would look like a
                        // successful search. Pass its message through.
                        throw new Error(payload.error || "HTTP " + response.status);
                    }
                    return payload;
                });
            })
            .then(function (payload) {
                resultsHost.removeAttribute("aria-busy");
                resultsHost.classList.remove("is-loading");
                rows = toCards(payload);
                // `total` is every match, `rows` is this page of them. The pager
                // needs the first to say "of 34"; the table needs the second.
                total = typeof payload.total === "number" ? payload.total : rows.length;

                renderActiveFilters();

                if (!rows.length) {
                    status.textContent = "";
                    showEmpty(params);
                    return;
                }
                summarise();
                renderPage();
            })
            .catch(function (error) {
                resultsHost.removeAttribute("aria-busy");
                resultsHost.classList.remove("is-loading");
                status.textContent = "";
                rows = [];
                total = 0;
                renderActiveFilters();
                showError("The solver database could not be reached", String(error.message || error));
            });

        if (isFirstLoad) {
            loadVocabulary();
        }
    }

    /*
     * The operator and element type lists, from /vocabulary rather than from the
     * search response.
     *
     * A response is one page of ten now, so reading the lists off it would offer
     * a picker built from whichever ten solvers came back first, quietly missing
     * every operator only the others report. A failure here is not worth an
     * error panel: the picker simply has nothing to suggest, and a name typed by
     * hand still works.
     */
    function loadVocabulary() {
        fetch(API + "/vocabulary", { headers: { Accept: "application/json" } })
            .then(function (response) {
                return response.ok ? response.json() : null;
            })
            .then(function (payload) {
                if (payload) {
                    populateFromVocabulary(payload);
                }
            })
            .catch(function () {
                /* Left empty on purpose. */
            });
    }

    /*
     * Fill the operator and element type controls from the data rather than from
     * a list hard-coded here, which would drift as solvers are added.
     *
     * Both lists arrive already sorted and de-duplicated, which is the whole
     * reason /vocabulary exists: working them out means reading every release in
     * the database, and the database is the one thing the browser does not have.
     */
    function populateFromVocabulary(payload) {
        // A map of name to types, not a bare list: the operator rows show which
        // element types each one can be asked for.
        operatorTypes = payload.operators || {};
        knownElementTypes = (payload.element_types || []).slice();

        // A list that was open while this arrived is showing "Loading...".
        Object.keys(pickers).forEach(function (key) {
            if (pickers[key]) {
                pickers[key].refreshList();
            }
        });
    }

    /* ------------------------------------------------------------- wiring -- */

    /*
     * The name box is only usable while the panel is closed, and is turned off
     * rather than hidden: the reader can still see what they typed, and it is
     * still there when they close the panel again.
     */
    function syncNameAvailability() {
        const off = filtersOpen();
        [nameInput, nameSearch].forEach(function (control) {
            if (!control) {
                return;
            }
            control.disabled = off;
            control.classList.toggle("is-disabled", off);
            control.title = off
                ? "Close the advanced filters to search by name"
                : "";
        });
    }

    /* The filter panel, closed to begin with. */
    if (filtersToggle) {
        filtersToggle.addEventListener("click", function () {
            const panel = document.getElementById("filters-panel");
            const open = !panel.classList.contains("is-open");
            panel.classList.toggle("is-open", open);
            filtersToggle.setAttribute("aria-expanded", String(open));
            if (filtersChevron) {
                filtersChevron.classList.toggle("rotate-180", open);
            }
            syncNameAvailability();
            /*
             * Search again, because opening or closing the panel changes which
             * criteria apply: closing drops the filters, opening drops the name.
             * Leaving the old results on screen would show an answer to a
             * question the controls no longer ask.
             */
            refresh();
            if (open) {
                // Land on the first control rather than leaving focus on the
                // button that revealed it.
                const first = form.querySelector("select, input");
                if (first) {
                    first.focus();
                }
            }
        });
    }

    /*
     * The name is searched when asked for, never as it is typed.
     *
     * Searching per keystroke meant a request for every prefix on the way to the
     * word the reader wanted, results flickering through answers to half-typed
     * names, and no way to tell a finished thought from a passing one. Enter and
     * the button are both "now".
     */
    if (nameInput) {
        nameInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                // A bare input outside a form does not submit, but an input
                // inside one would, and this one may end up in either.
                event.preventDefault();
                refresh();
            }
        });
    }
    if (nameSearch) {
        nameSearch.addEventListener("click", refresh);
    }
    if (sortSelect) {
        sortSelect.addEventListener("change", refresh);
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        // Back to page one: the old page three may not exist under new filters.
        refresh();
    });

    // The command banner tracks the filters as they are chosen, without waiting
    // for a search: it is showing what the current selection means, not what was
    // last run.
    form.addEventListener("change", function () {
        updateCommand(currentQuery());
    });
    form.addEventListener("input", function () {
        updateCommand(currentQuery());
    });

    // Reset fires before the fields are actually cleared, so wait a tick.
    form.addEventListener("reset", function () {
        window.setTimeout(function () {
            /*
             * After reset has cleared the fields, not before. A reset clears the
             * hidden fields the pickers write to but knows nothing about the
             * chips, which are the only thing the reader can see, so each picker
             * has to be told.
             */
            Object.keys(pickers).forEach(function (key) {
                if (pickers[key]) {
                    pickers[key].clear();
                }
            });
            refresh();
        }, 0);
    });

    // A different page size is a different window, so it is a request too.
    pageSizeSelect.addEventListener("change", refresh);

    /*
     * The first fetch waits for the panel to be opened.
     *
     * The search shares a page with everything else now, so loading the
     * database on every visit to the home page would be a request most readers
     * never asked for. js/site.js dispatches this the first time the panel
     * slides in, including when a link lands straight on it.
     */
    let started = false;

    function start() {
        if (started) {
            return;
        }
        started = true;
        syncNameAvailability();
        load(currentQuery(), true);
    }

    document.addEventListener("solver-search:open", start);

    // Already open, because the page was loaded with the search showing and
    // js/site.js ran first.
    const panel = document.getElementById("panel-search");
    if (!panel || panel.hidden === false) {
        start();
    }
})();
