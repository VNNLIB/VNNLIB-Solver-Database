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

    const sortSelect = document.getElementById("sort-by");
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
     * Filters the package declares with `store_true`, so it can only ever
     * require the capability and never require its absence. That is why the
     * control offers Any or Required and not No, and why the chip for one reads
     * "required" rather than "true".
     */
    const VALUELESS_FLAGS = { serialise_assignments: true };

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
        serialise_assignments: "Serialises assignments",
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

    /* -------------------------------------------------------------- query -- */

    function currentQuery() {
        const params = new URLSearchParams();
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
                        "px-3 py-2 text-sm text-ink-muted",
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
                const label = el("span", "font-mono text-sm text-ink");
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
        const row = el("div", "grid gap-1 py-1.5 sm:grid-cols-3 sm:gap-4");
        row.appendChild(el("dt", "font-heading text-sm font-semibold text-ink-muted", label));
        row.appendChild(el("dd", "text-sm text-ink sm:col-span-2", formatValue(field, value)));
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
            wrapper.appendChild(el("p", "mt-1 text-sm text-ink", "none reported"));
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

        const heading = el("p", "mt-5 text-sm text-ink-muted");
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
    /* ------------------------------------------------------------ modals -- */

    /*
     * Both dialogs open and close the same way, so this is written once.
     *
     * The class is added a frame after `showModal`, not in the same tick: the
     * dialog goes from `display: none` to displayed, and setting the class in
     * the same style recalculation gives the browser one state rather than two,
     * so nothing animates. Closing is the mirror, and `close()` waits for the
     * transition to end rather than cutting it off.
     *
     * `showModal` is what makes it a modal: the browser supplies the focus trap,
     * the inert background and the backdrop. The attribute fallback is for a
     * browser without it, where the dialog is at least still usable.
     */
    function openModal(node) {
        if (!node) {
            return;
        }
        if (typeof node.showModal === "function") {
            node.showModal();
        } else {
            node.setAttribute("open", "");
        }
        window.requestAnimationFrame(function () {
            node.classList.add("is-open");
        });
    }

    function closeModal(node) {
        if (!node) {
            return;
        }
        const hide = function () {
            if (typeof node.close === "function") {
                node.close();
            } else {
                node.removeAttribute("open");
            }
        };
        if (!node.classList.contains("is-open")) {
            hide();
            return;
        }
        node.classList.remove("is-open");

        let done = false;
        function finish() {
            if (done) {
                return;
            }
            done = true;
            node.removeEventListener("transitionend", onEnd);
            hide();
        }
        function onEnd(event) {
            // The dialog's own transition, not one bubbling up from a chip or a
            // control inside it.
            if (event.target === node) {
                finish();
            }
        }
        node.addEventListener("transitionend", onEnd);
        window.setTimeout(finish, 320);
    }

    /* Backdrop clicks and Escape, for any modal. */
    function wireModal(node) {
        if (!node) {
            return;
        }
        // The dialog's own box is a child, so a click that lands on the element
        // itself came from outside the content.
        node.addEventListener("click", function (event) {
            if (event.target === node) {
                closeModal(node);
            }
        });
        // Escape closes a <dialog> outright, which would skip the transition.
        // Take it over and run the same path as every other close.
        node.addEventListener("cancel", function (event) {
            event.preventDefault();
            closeModal(node);
        });
    }

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

        if (card.url) {
            const link = el("a", "link text-sm", card.url);
            link.href = card.url;
            link.target = "_blank";
            link.rel = "noopener";
            const line = el("p", "text-sm text-ink-muted");
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

        openModal(dialog);
    }

    /*
     * Closing runs the transition first and calls close() at the end of it.
     *
     * The `transitionend` is the signal, with a timer as a backstop: a browser
     * that skips the transition, because of reduced motion or because the
     * dialog was never painted, never fires the event, and the dialog would be
     * left open forever.
     */
    function closeDetails() {
        closeModal(dialog);
    }

    if (dialogClose) {
        dialogClose.addEventListener("click", closeDetails);
    }
    wireModal(dialog);

    /* ------------------------------------------------------- list render --- */

    function skeleton() {
        clear(resultsHost);
        pager.classList.add("hidden");

        const box = el("div", "results-table rounded-xl border border-ink/10 bg-white shadow-card");
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
                "flex items-center gap-3 border-b border-ink/5 px-4 py-2.5 last:border-b-0"
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

        const panel = el("div", "rounded-2xl border border-red-200 bg-red-50 p-5");
        panel.appendChild(el("h3", "font-heading text-lg font-bold text-red-900", message));
        if (detail) {
            panel.appendChild(el("p", "mt-2 text-sm leading-relaxed text-red-800", detail));
        }
        const note = el("p", "mt-4 text-sm leading-relaxed text-red-800");
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

        const panel = el("div", "rounded-2xl border border-ink/10 bg-white p-6 text-center shadow-card");
        panel.appendChild(
            el("h3", "font-heading text-lg font-bold text-ink", "No solver matches every filter")
        );
        panel.appendChild(
            el(
                "p",
                "mx-auto mt-2 max-w-prose text-sm leading-relaxed text-ink-muted",
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

        const box = el("div", "results-table rounded-xl border border-ink/10 bg-white shadow-card");
        const table = el("table", "w-full text-left");
        table.setAttribute("role", "table");

        const thead = el("thead");
        thead.setAttribute("role", "rowgroup");
        const headRow = el("tr", "border-b border-ink/10 bg-brand-tint");
        headRow.setAttribute("role", "row");
        ["Solver", "Versions"].forEach(function (name) {
            const cell = el("th", "table-th", name);
            cell.setAttribute("role", "columnheader");
            headRow.appendChild(cell);
        });
        const updatedHead = el("th", "table-th hidden sm:table-cell", "Updated at");
        updatedHead.setAttribute("role", "columnheader");
        headRow.appendChild(updatedHead);
        const actions = el("th", "table-th text-right", "");
        actions.setAttribute("role", "columnheader");
        actions.appendChild(el("span", "sr-only", "Details"));
        headRow.appendChild(actions);
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = el("tbody", "divide-y divide-ink/5");
        tbody.setAttribute("role", "rowgroup");
        rows.forEach(function (row) {
            const tr = el("tr", "transition hover:bg-brand-tint/60");
            tr.setAttribute("role", "row");

            tr.appendChild(el("td", "table-td font-semibold", row.name));

            const versionCell = el("td", "table-td");
            versionCell.appendChild(
                el("span", "font-mono text-sm", rangeLabel(row.matches))
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
                "table-td hidden text-sm text-ink-muted sm:table-cell",
                updated ? String(updated).slice(0, 10) : "unknown"
            );
            // The date belongs to the newest matching release, not to the
            // solver, so say which one it came from.
            if (updated && row.matches.matched > 1) {
                updatedCell.title =
                    "Version " + (row.matches.latest || {}).version + ", the newest that matched";
            }
            tr.appendChild(updatedCell);

            const cell = el("td", "table-td text-right");
            const button = el(
                "button",
                "inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-white px-2 py-0.5 font-heading text-xs font-semibold text-ink transition hover:border-brand hover:text-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
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
        Array.prototype.forEach.call(tbody.querySelectorAll("td"), function (cell) {
            cell.setAttribute("role", "cell");
        });

        table.appendChild(tbody);
        /*
         * A scrollbar appears only when there are more rows than the box is
         * tall, and the box is exactly ten rows. Saying so in a class lets the
         * head reserve the same width, so its columns stay over the body's
         * instead of sitting a scrollbar to the right of them.
         */
        box.classList.toggle("is-scrolling", rows.length > 10);
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
                "text-sm text-ink-muted",
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
                url: solver.url,
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
     * The API still takes a `name` parameter, and `vnnfilter` still has the
     * flag; this page no longer offers a box for it. Nothing else changes if one
     * comes back: it would be one more entry in the query.
     */

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

        if (!entries.length) {
            return;
        }

        entries.forEach(function (entry) {
            const key = entry[0];
            const label = FILTER_LABELS[key] || key;

            const chip = el(
                "span",
                "inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-heading text-xs font-semibold text-ink ring-1 ring-ink/10"
            );
            chip.appendChild(el("span", "text-ink-muted", label));
            // A boolean filter's value is not worth showing as `true`: the chip
            // already names the capability, so the useful word is what is being
            // asked of it.
            const shown = VALUELESS_FLAGS[key] || entry[1] === "true" || entry[1] === "false"
                ? (entry[1] === "false" ? "not required" : "required")
                : entry[1];
            chip.appendChild(el("span", "font-mono", shown));

            const remove = el("button", "text-ink-muted transition hover:text-red-600");
            remove.type = "button";
            remove.setAttribute("aria-label", "Remove the " + label + " filter");
            remove.textContent = "×";
            remove.addEventListener("click", function () {
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
     * The filters, in a modal.
     *
     * Opening one runs no search. The controls say the same thing whether or
     * not they are on screen, so what is in the table is still the answer to
     * the question they ask. Only Search runs a search.
     */
    /*
     * There is no open or close. The rail is beside the table and always on
     * screen, so the controls and the answer are visible at the same time, and
     * nothing has to be reopened to see what is applied.
     */

    if (sortSelect) {
        sortSelect.addEventListener("change", refresh);
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        // Back to page one: the old page three may not exist under new filters.
        refresh();
        // Nothing to dismiss: the rail stays where it is.
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
