/*
 * The capability search on solvers.html.
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
 * The list is deliberately thin: name, version, when it was last updated, and a
 * button. The full record is far too much to read in a table, so it lives in a
 * dialog opened per release.
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

    const operatorPicker = document.getElementById("operator-picker");
    const operatorInput = document.getElementById("operator-input");
    const operatorSuggestions = document.getElementById("operator-suggestions");
    const operatorField = document.getElementById("f-operators");

    const nameInput = document.getElementById("q-name");
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
     * Everything the API returned for the last capability search, and the subset
     * of it left after the name box and the sort are applied.
     *
     * The split matters: capability matching is the API's job, for the reasons at
     * the top of this file, but a name is not a capability. Sending it to
     * /search would be inventing a filter the endpoint does not have, and it
     * would also mean a request per keystroke. So the name narrows what is
     * already in hand, which is why typing in it is instant and does not touch
     * the network.
     */
    let allRows = [];
    let rows = [];
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

    function pageSize() {
        return Number(pageSizeSelect.value) || 25;
    }

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

    /* ------------------------------------------------- the operator picker -- */

    /*
     * Choosing ONNX operators from the list the database actually contains,
     * rather than typing them.
     *
     * Two things make this worth the code. The names are case sensitive and
     * awkward (`LeakyRelu`, `ConstantOfShape`, `ScatterND`), so a typed name is
     * usually a typo, and a typo returns an empty result that looks exactly
     * like a real answer. And matching is done anywhere in the name, not just
     * at the start, because the useful queries are things like "pool" or
     * "conv", which a prefix match would miss entirely.
     *
     * The selection is written back into a hidden comma separated field, so the
     * query builder, the command banner and the API all see an ordinary text
     * field.
     */
    let knownOperators = [];
    let chosenOperators = [];
    let highlighted = -1;

    function syncOperatorField() {
        operatorField.value = chosenOperators.join(",");
    }

    function renderOperatorChips() {
        Array.prototype.slice.call(operatorPicker.querySelectorAll("[data-chip]")).forEach(
            function (chip) {
                operatorPicker.removeChild(chip);
            }
        );

        chosenOperators.forEach(function (name) {
            const chip = el(
                "span",
                "inline-flex items-center gap-1 rounded-md bg-brand-light px-2 py-0.5 font-mono text-sm text-brand-dark"
            );
            chip.setAttribute("data-chip", name);
            chip.appendChild(document.createTextNode(name));

            const remove = el("button", "text-brand-dark/70 transition hover:text-red-600", "×");
            remove.type = "button";
            remove.setAttribute("aria-label", "Remove " + name);
            remove.addEventListener("click", function (event) {
                event.stopPropagation();
                removeOperator(name);
            });
            chip.appendChild(remove);

            // Before the input, so the text cursor stays at the end of the row.
            operatorPicker.insertBefore(chip, operatorInput);
        });
    }

    function closeSuggestions() {
        clear(operatorSuggestions);
        operatorSuggestions.classList.remove("is-open");
        operatorInput.setAttribute("aria-expanded", "false");
        highlighted = -1;
    }

    function addOperator(name) {
        if (chosenOperators.indexOf(name) === -1) {
            chosenOperators.push(name);
            syncOperatorField();
            renderOperatorChips();
            renderActiveFilters();
            updateCommand(currentQuery());
        }
        operatorInput.value = "";
        operatorInput.focus();
        // Left open: picking one operator is usually the first of several.
        showSuggestions();
    }

    function removeOperator(name) {
        chosenOperators = chosenOperators.filter(function (chosen) {
            return chosen !== name;
        });
        syncOperatorField();
        renderOperatorChips();
        renderActiveFilters();
        updateCommand(currentQuery());
    }

    function matchingOperators(query) {
        const needle = query.trim().toLowerCase();
        return knownOperators
            .filter(function (name) {
                return chosenOperators.indexOf(name) === -1;
            })
            .filter(function (name) {
                // Substring, not prefix: "pool" has to find MaxPool.
                return !needle || name.toLowerCase().indexOf(needle) !== -1;
            })
            .sort(function (a, b) {
                // A name that starts with what was typed is the better guess, so
                // it goes first; the rest keep alphabetical order.
                const aStarts = a.toLowerCase().indexOf(needle) === 0;
                const bStarts = b.toLowerCase().indexOf(needle) === 0;
                if (aStarts !== bStarts) {
                    return aStarts ? -1 : 1;
                }
                return a.localeCompare(b);
            })
            .slice(0, 30);
    }

    function highlight(index) {
        const options = operatorSuggestions.querySelectorAll("[role='option']");
        if (!options.length) {
            return;
        }
        highlighted = (index + options.length) % options.length;
        Array.prototype.forEach.call(options, function (option, i) {
            const on = i === highlighted;
            option.classList.toggle("bg-brand-tint", on);
            option.setAttribute("aria-selected", String(on));
            if (on && typeof option.scrollIntoView === "function") {
                option.scrollIntoView({ block: "nearest" });
            }
        });
    }

    function showSuggestions() {
        const matches = matchingOperators(operatorInput.value);
        clear(operatorSuggestions);

        if (!matches.length) {
            const empty = el(
                "li",
                "px-3 py-2 text-base text-ink-muted",
                knownOperators.length ? "No operator matches" : "Loading the operator list..."
            );
            operatorSuggestions.appendChild(empty);
            operatorSuggestions.classList.add("is-open");
            operatorInput.setAttribute("aria-expanded", "true");
            highlighted = -1;
            return;
        }

        matches.forEach(function (name) {
            const option = el(
                "li",
                "cursor-pointer px-3 py-1.5 font-mono text-base text-ink transition hover:bg-brand-tint"
            );
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");

            // Show which part of the name matched, so a substring hit does not
            // look arbitrary.
            const needle = operatorInput.value.trim();
            const at = needle ? name.toLowerCase().indexOf(needle.toLowerCase()) : -1;
            if (at === -1) {
                option.textContent = name;
            } else {
                option.appendChild(document.createTextNode(name.slice(0, at)));
                option.appendChild(
                    el("strong", "font-bold text-brand-dark", name.slice(at, at + needle.length))
                );
                option.appendChild(document.createTextNode(name.slice(at + needle.length)));
            }

            // mousedown, not click: the input's blur would close the list first.
            option.addEventListener("mousedown", function (event) {
                event.preventDefault();
                addOperator(name);
            });

            operatorSuggestions.appendChild(option);
        });

        operatorSuggestions.classList.add("is-open");
        operatorInput.setAttribute("aria-expanded", "true");
        highlight(0);
    }

    if (operatorPicker && operatorInput) {
        // Clicking the padding around the chips should land in the input, which
        // is what the box looks like it does.
        operatorPicker.addEventListener("click", function (event) {
            if (event.target === operatorPicker) {
                operatorInput.focus();
                showSuggestions();
            }
        });

        operatorInput.addEventListener("focus", showSuggestions);
        operatorInput.addEventListener("input", showSuggestions);
        // `focus` only fires on the way in, and the input keeps focus through a
        // pick, so a click needs to open the list too.
        operatorInput.addEventListener("click", showSuggestions);
        operatorInput.addEventListener("blur", function () {
            // A tick, so a click on an option is not cancelled by the list
            // disappearing underneath it.
            window.setTimeout(closeSuggestions, 120);
        });

        operatorInput.addEventListener("keydown", function (event) {
            const options = operatorSuggestions.querySelectorAll("[role='option']");

            if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!operatorSuggestions.classList.contains("is-open")) {
                    showSuggestions();
                } else {
                    highlight(highlighted + 1);
                }
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                highlight(highlighted - 1);
                return;
            }
            if (event.key === "Enter") {
                // Never submit the form from here: Enter means "take the
                // operator I am looking at".
                event.preventDefault();
                if (options.length && highlighted >= 0) {
                    addOperator(options[highlighted].textContent);
                }
                return;
            }
            if (event.key === "Escape") {
                closeSuggestions();
                return;
            }
            if (event.key === "Backspace" && !operatorInput.value && chosenOperators.length) {
                // The usual behaviour of a field made of chips.
                removeOperator(chosenOperators[chosenOperators.length - 1]);
            }
        });
    }

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

    function openDetails(row) {
        const record = row.record;
        const capabilities = record.capabilities || {};

        dialogTitle.textContent = row.name;
        clear(dialogSubtitle);
        dialogSubtitle.appendChild(document.createTextNode("Version " + record.version));
        if (record.collected_at) {
            dialogSubtitle.appendChild(
                document.createTextNode(", updated " + String(record.collected_at).slice(0, 10))
            );
        }

        clear(dialogBody);

        if (row.repo) {
            const link = el("a", "link text-base", row.repo);
            link.href = row.repo;
            link.target = "_blank";
            link.rel = "noopener";
            const line = el("p", "text-base text-ink-muted");
            line.appendChild(document.createTextNode("Source: "));
            line.appendChild(link);
            dialogBody.appendChild(line);
        }

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
        dialogBody.appendChild(list);

        dialogBody.appendChild(operatorList(capabilities.operators));

        if (Array.isArray(record.notes) && record.notes.length) {
            dialogBody.appendChild(notesList(record.notes));
        }

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

        const box = el("div", "overflow-hidden rounded-xl border border-ink/10");
        for (let i = 0; i < 5; i += 1) {
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

        const panel = el("div", "rounded-2xl border border-ink/10 bg-brand-tint p-8 text-center");
        panel.appendChild(
            el("h3", "font-heading text-lg font-bold text-ink", "No release matches every filter")
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

    function renderPage() {
        const size = pageSize();
        const pages = Math.max(1, Math.ceil(rows.length / size));
        page = Math.min(Math.max(1, page), pages);

        const slice = rows.slice((page - 1) * size, page * size);

        clear(resultsHost);

        const box = el("div", "overflow-hidden rounded-xl border border-ink/10 shadow-card");
        const table = el("table", "w-full text-left");

        const thead = el("thead");
        const headRow = el("tr", "border-b border-ink/10 bg-brand-tint");
        headRow.appendChild(el("th", "table-th", "Solver"));
        headRow.appendChild(el("th", "table-th", "Version"));
        headRow.appendChild(el("th", "table-th hidden sm:table-cell", "Updated at"));
        const actions = el("th", "table-th text-right", "");
        actions.appendChild(el("span", "sr-only", "Details"));
        headRow.appendChild(actions);
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = el("tbody", "divide-y divide-ink/5");
        slice.forEach(function (row) {
            const tr = el("tr", "transition hover:bg-brand-tint/60");

            tr.appendChild(el("td", "table-td font-semibold", row.name));
            tr.appendChild(el("td", "table-td font-mono text-base", row.record.version));
            tr.appendChild(
                el(
                    "td",
                    "table-td hidden text-base text-ink-muted sm:table-cell",
                    row.record.collected_at ? String(row.record.collected_at).slice(0, 10) : "unknown"
                )
            );

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

        renderPager(pages, slice.length);
    }

    function renderPager(pages, shown) {
        clear(pager);

        if (rows.length <= pageSize()) {
            pager.classList.add("hidden");
            return;
        }
        pager.classList.remove("hidden");

        const first = (page - 1) * pageSize() + 1;
        pager.appendChild(
            el(
                "p",
                "text-base text-ink-muted",
                "Showing " + first + " to " + (first + shown - 1) + " of " + rows.length
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
                    page = target;
                    renderPage();
                    // Put the top of the results back in view, or paging feels
                    // like nothing happened.
                    resultsHost.scrollIntoView({ block: "start", behavior: "smooth" });
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
     * One row per release, not per solver. The version is a column, so a solver
     * with three releases is three rows: sorting and paging by release is what
     * the columns promise, and grouping would make the counts lie.
     */
    function flatten(payload) {
        const out = [];
        (payload.solvers || []).forEach(function (solver) {
            (solver.versions || []).forEach(function (record) {
                out.push({
                    id: solver.id,
                    name: solver.name || solver.id,
                    repo: solver.repo,
                    record: record,
                });
            });
        });
        return out;
    }

    /* ------------------------------------------------- name, sort, chips --- */

    const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    const SORTS = {
        "name-asc": function (a, b) {
            return COLLATOR.compare(a.name, b.name) || versionOrder(a, b);
        },
        "name-desc": function (a, b) {
            return COLLATOR.compare(b.name, a.name) || versionOrder(a, b);
        },
        "version-desc": function (a, b) {
            return -versionOrder(a, b) || COLLATOR.compare(a.name, b.name);
        },
        "version-asc": function (a, b) {
            return versionOrder(a, b) || COLLATOR.compare(a.name, b.name);
        },
        "date-desc": function (a, b) {
            return dateOrder(b, a) || COLLATOR.compare(a.name, b.name);
        },
        "date-asc": function (a, b) {
            return dateOrder(a, b) || COLLATOR.compare(a.name, b.name);
        },
    };

    /*
     * Natural sort, not semver. Nothing in the database says these strings are
     * semver, so it is not assumed: the collator's numeric mode gets 1.10.0
     * after 1.9.0, which plain string comparison would not, and that is as far as
     * this goes. A prerelease like 1.0.0-rc1 still sorts after 1.0.0, which is
     * wrong under semver and is a known limitation rather than a bug here.
     */
    function versionOrder(a, b) {
        return COLLATOR.compare(String(a.record.version), String(b.record.version));
    }

    function dateOrder(a, b) {
        // ISO 8601 strings compare correctly as strings, so no Date parsing. A
        // record with no timestamp sorts as the oldest rather than throwing the
        // comparison off.
        return String(a.record.collected_at || "").localeCompare(String(b.record.collected_at || ""));
    }

    function currentName() {
        return nameInput ? nameInput.value.trim().toLowerCase() : "";
    }

    /* Narrow by name, then order. Both are local to what the API already sent. */
    function applyNameAndSort() {
        const needle = currentName();
        rows = needle
            ? allRows.filter(function (row) {
                // The id is matched as well as the display name, because the id
                // is what appears in URLs and in `vnnfilter` output, so it is
                // what someone may have been given.
                return (
                    row.name.toLowerCase().indexOf(needle) !== -1 ||
                    String(row.id).toLowerCase().indexOf(needle) !== -1
                );
            })
            : allRows.slice();

        const sort = SORTS[sortSelect ? sortSelect.value : "date-desc"] || SORTS["date-desc"];
        rows.sort(sort);
        page = 1;
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
                if (key === "operators") {
                    // The hidden field is a projection of the chips, so clearing
                    // it alone would leave the chips on screen claiming a filter
                    // that is no longer applied.
                    chosenOperators = [];
                    syncOperatorField();
                    renderOperatorChips();
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
                load(currentQuery(), false);
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

    /* Re-run the local narrowing without asking the API again. */
    function refresh() {
        if (!allRows.length) {
            renderActiveFilters();
            return;
        }
        applyNameAndSort();
        renderActiveFilters();
        if (!rows.length) {
            status.textContent = "";
            showEmpty(currentQuery());
            return;
        }
        summarise();
        renderPage();
    }

    function summarise() {
        const releases = rows.length;
        const solvers = new Set(rows.map(function (row) { return row.id; })).size;
        // Counts only. When the database was generated is a fact about the
        // pipeline, not about the solvers, and it read as though the results
        // might be stale when they are fetched fresh on every load. Each
        // release carries its own measurement date in the table anyway, which
        // is the date that actually qualifies what is shown.
        status.textContent =
            (solvers === 1 ? "1 solver" : solvers + " solvers") +
            ", " +
            (releases === 1 ? "1 release" : releases + " releases");
    }

    /* ----------------------------------------------------------- fetching -- */

    function load(params, isFirstLoad) {
        updateCommand(params);
        status.textContent = isFirstLoad ? "Loading the database..." : "Searching...";
        skeleton();

        const url = isFirstLoad && !params.toString()
            ? API + "/solvers"
            : API + "/search?" + params.toString();

        fetch(url, { headers: { Accept: "application/json" } })
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
                allRows = flatten(payload);

                if (isFirstLoad) {
                    populateFromData(payload);
                }

                applyNameAndSort();
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
                status.textContent = "";
                allRows = [];
                rows = [];
                renderActiveFilters();
                showError("The solver database could not be reached", String(error.message || error));
            });
    }

    /*
     * Fill the operator and element type controls from the data rather than from
     * a list hard-coded here, which would drift as solvers are added.
     */
    function populateFromData(payload) {
        const operators = new Set();
        const elementTypes = new Set();
        (payload.solvers || []).forEach(function (solver) {
            (solver.versions || []).forEach(function (record) {
                const capabilities = record.capabilities || {};
                Object.keys(capabilities.operators || {}).forEach(function (name) {
                    operators.add(name);
                });
                (capabilities.element_types || []).forEach(function (type) {
                    elementTypes.add(type);
                });
            });
        });

        knownOperators = Array.from(operators).sort();

        const select = document.getElementById("f-element_types");
        Array.from(elementTypes).sort().forEach(function (type) {
            const option = el("option", null, type);
            option.value = type;
            select.appendChild(option);
        });
    }

    /* ------------------------------------------------------------- wiring -- */

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

    if (nameInput) {
        // Local, so it can run on every keystroke without a request.
        nameInput.addEventListener("input", refresh);
    }
    if (sortSelect) {
        sortSelect.addEventListener("change", refresh);
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        load(currentQuery(), false);
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
        chosenOperators = [];
        window.setTimeout(function () {
            // After reset has cleared the fields, so the hidden operator field
            // is not written and then wiped.
            syncOperatorField();
            renderOperatorChips();
            closeSuggestions();
            load(currentQuery(), false);
        }, 0);
    });

    pageSizeSelect.addEventListener("change", function () {
        page = 1;
        if (rows.length) {
            renderPage();
        }
    });

    load(currentQuery(), true);
})();
