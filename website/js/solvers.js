(function () {
    "use strict";

    var DATA_SOURCES = [
        "https://12er90.pythonanywhere.com/solvers",
        "../data/solvers.json"
    ];

    var THEORY_FIELDS = [
        "hidden_nodes",
        "multiple_io",
        "multiple_networks",
        "node_comparisons",
        "arithmetic"
    ];

    var RANGE_FIELDS = ["onnx_opset", "vnnlib_version"];

    var BOOLEAN_FIELDS = ["serialise_assignments"];

    var COMMON_ONNX_OPERATORS = [
        "Abs", "Acos", "Add", "ArgMax", "AveragePool", "BatchNormalization", "Cast",
        "Clip", "Concat", "Constant", "ConstantOfShape", "Conv", "ConvTranspose", "Cos",
        "Div", "Dropout", "Equal", "Exp", "Expand", "Flatten", "Floor", "Gather",
        "Gemm", "GlobalAveragePool", "Identity", "LeakyRelu", "Log", "MatMul", "Max",
        "MaxPool", "Min", "Mul", "Neg", "Pad", "Pow", "ReduceMean", "ReduceSum",
        "Relu", "Reshape", "Resize", "Shape", "Sigmoid", "Sign", "Sin", "Slice",
        "Softmax", "Split", "Squeeze", "Sub", "Tanh", "Transpose", "Unsqueeze",
        "Upsample", "Where"
    ];

    var FILTER_LABELS = {
        text: "Search",
        arithmetic: "Arithmetic",
        hidden_nodes: "Hidden nodes",
        multiple_io: "Input/output",
        multiple_networks: "Networks",
        node_comparisons: "Node comparisons",
        operators: "ONNX operators",
        element_types: "Element types",
        serialise_assignments: "Serialise assignments",
        onnx_opset: "Supported ONNX opset versions",
        vnnlib_version: "Supported VNN-LIB versions"
    };

    var VALUE_LABELS = {
        BND: "BND - variable bound comparisons",
        OUTC: "OUTC - output comparisons",
        LIN: "LIN - linear expressions",
        POLY: "POLY - polynomial expressions",
        NH: "NH - no hidden node declarations",
        H: "H - hidden node declarations allowed",
        SIO: "SIO - single input and output",
        MIO: "MIO - multiple inputs or outputs",
        SNET: "SNET - single network",
        MENET: "MENET - multiple equal networks",
        MINET: "MINET - multiple isomorphic networks",
        MNET: "MNET - arbitrary multiple networks",
        SNC: "SNC - no same-network node comparisons",
        MNC: "MNC - node comparisons allowed"
    };

    var PILL_FIELDS = {
        arithmetic: "filter-arithmetic",
        hidden_nodes: "filter-hidden-nodes",
        multiple_io: "filter-multiple-io",
        multiple_networks: "filter-multiple-networks",
        node_comparisons: "filter-node-comparisons",
        element_types: "filter-element-types"
    };

    var state = {
        solvers: [],
        filtered: [],
        query: null
    };

    function $(id) {
        return document.getElementById(id);
    }

    function valuesFrom(select) {
        return Array.prototype.slice.call(select.selectedOptions)
            .map(function (option) { return option.value; })
            .filter(Boolean);
    }

    function buildPillGroup(selectId) {
        var select = $(selectId);
        var group = document.createElement("div");
        group.className = "pill-group";
        group.setAttribute("role", "group");

        Array.prototype.forEach.call(select.options, function (option) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.className = "pill";
            pill.textContent = option.textContent;
            pill.dataset.value = option.value;
            pill.setAttribute("aria-pressed", option.selected ? "true" : "false");
            pill.addEventListener("click", function () {
                option.selected = !option.selected;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            group.appendChild(pill);
        });

        select.insertAdjacentElement("afterend", group);
        select._pillGroup = group;
    }

    function syncPillGroup(selectId) {
        var select = $(selectId);
        if (!select || !select._pillGroup) {
            return;
        }
        var selected = {};
        Array.prototype.forEach.call(select.selectedOptions, function (option) {
            selected[option.value] = true;
        });
        Array.prototype.forEach.call(select._pillGroup.children, function (pill) {
            var isActive = !!selected[pill.dataset.value];
            pill.classList.toggle("is-active", isActive);
            pill.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
    }

    function syncAllPillGroups() {
        Object.keys(PILL_FIELDS).forEach(function (field) {
            syncPillGroup(PILL_FIELDS[field]);
        });
    }

    function commaValues(value) {
        return value.split(",")
            .map(function (item) { return item.trim(); })
            .filter(Boolean);
    }

    function valuesFromParams(params, field) {
        var values = [];
        params.getAll(field).forEach(function (raw) {
            values = values.concat(commaValues(raw));
        });
        return values;
    }

    function setSelectValues(id, values) {
        var wanted = {};
        values.forEach(function (value) {
            wanted[value] = true;
        });
        Array.prototype.forEach.call($(id).options, function (option) {
            option.selected = !!wanted[option.value];
        });
    }

    function applyQueryFromUrl() {
        var params = new URLSearchParams(window.location.search);
        $("filter-text").value = params.get("q") || "";
        setSelectValues("filter-arithmetic", valuesFromParams(params, "arithmetic"));
        setSelectValues("filter-hidden-nodes", valuesFromParams(params, "hidden_nodes"));
        setSelectValues("filter-multiple-io", valuesFromParams(params, "multiple_io"));
        setSelectValues("filter-multiple-networks", valuesFromParams(params, "multiple_networks"));
        setSelectValues("filter-node-comparisons", valuesFromParams(params, "node_comparisons"));
        setSelectValues("filter-element-types", valuesFromParams(params, "element_types"));
        setSelectValues("filter-serialise-assignments", valuesFromParams(params, "serialise_assignments"));
        $("filter-operators").value = valuesFromParams(params, "operators").join(", ");
        $("filter-onnx-opset").value = params.get("onnx_opset") || "";
        $("filter-vnnlib-version").value = params.get("vnnlib_version") || params.get("vnnlib_versions") || "";
    }

    function updateUrl(query) {
        var params = new URLSearchParams();
        if (query.text) {
            params.set("q", query.text);
        }
        [
            "arithmetic",
            "hidden_nodes",
            "multiple_io",
            "multiple_networks",
            "node_comparisons",
            "element_types",
            "serialise_assignments",
            "operators"
        ].forEach(function (field) {
            (query[field] || []).forEach(function (value) {
                params.append(field, value);
            });
        });

        RANGE_FIELDS.forEach(function (field) {
            if (query[field]) {
                params.set(field, query[field]);
            }
        });

        var queryString = params.toString();
        var next = window.location.pathname + (queryString ? "?" + queryString : "");
        window.history.replaceState(null, "", next);
    }

    function unique(values) {
        var seen = {};
        return values.filter(function (value) {
            if (!value || seen[value]) {
                return false;
            }
            seen[value] = true;
            return true;
        });
    }

    function mergeCommaInput(existing, additions) {
        return unique(commaValues(existing).concat(additions)).join(", ");
    }

    function inRange(pair, wanted) {
        if (!wanted) {
            return true;
        }
        if (!pair || pair.length !== 2) {
            return false;
        }
        var low = Number(pair[0]);
        var high = Number(pair[1]);
        var numberWanted = Number(wanted);
        if (!Number.isNaN(low) && !Number.isNaN(high) && !Number.isNaN(numberWanted)) {
            return low <= numberWanted && numberWanted <= high;
        }
        return String(pair[0]) <= String(wanted) && String(wanted) <= String(pair[1]);
    }

    function operatorMatches(capabilities, wanted) {
        var operators = capabilities.operators || {};
        var parts = wanted.split(":");
        var name = parts[0];
        var wantedType = parts[1];
        var restrictedTo = operators[name];

        if (restrictedTo === undefined) {
            return false;
        }
        if (!wantedType) {
            return true;
        }
        if (restrictedTo.length > 0) {
            return restrictedTo.indexOf(wantedType) !== -1;
        }
        return (capabilities.element_types || []).indexOf(wantedType) !== -1;
    }

    function booleanMatches(actual, wanted) {
        if (!wanted.length) {
            return true;
        }
        return wanted.indexOf(String(actual)) !== -1;
    }

    function solverTextMatches(solver, queryText) {
        if (!queryText) {
            return true;
        }
        var haystack = [
            solver.id,
            solver.name
        ].join(" ").toLowerCase();
        return haystack.indexOf(queryText.toLowerCase()) !== -1;
    }

    function hasCapabilityFilters(query) {
        return THEORY_FIELDS.some(function (field) {
            return (query[field] || []).length > 0;
        }) || RANGE_FIELDS.some(function (field) {
            return !!query[field];
        }) || BOOLEAN_FIELDS.some(function (field) {
            return (query[field] || []).length > 0;
        }) || query.operators.length > 0 || query.element_types.length > 0;
    }

    function versionMatches(version, query) {
        var capabilities = version.capabilities;
        var satisfies = version.satisfies || {};
        if (version.status !== "ok") {
            return false;
        }
        if (!capabilities) {
            return !hasCapabilityFilters(query);
        }

        for (var i = 0; i < THEORY_FIELDS.length; i += 1) {
            var field = THEORY_FIELDS[i];
            var wantedValues = query[field] || [];
            for (var j = 0; j < wantedValues.length; j += 1) {
                if ((satisfies[field] || []).indexOf(wantedValues[j]) === -1) {
                    return false;
                }
            }
        }

        for (var r = 0; r < RANGE_FIELDS.length; r += 1) {
            var rangeField = RANGE_FIELDS[r];
            var capabilityField = rangeField === "vnnlib_version" ? "vnnlib_versions" : rangeField;
            if (!inRange(capabilities[capabilityField], query[rangeField])) {
                return false;
            }
        }

        for (var b = 0; b < BOOLEAN_FIELDS.length; b += 1) {
            var booleanField = BOOLEAN_FIELDS[b];
            if (!booleanMatches(capabilities[booleanField], query[booleanField])) {
                return false;
            }
        }

        for (var o = 0; o < query.operators.length; o += 1) {
            if (!operatorMatches(capabilities, query.operators[o])) {
                return false;
            }
        }

        for (var e = 0; e < query.element_types.length; e += 1) {
            if ((capabilities.element_types || []).indexOf(query.element_types[e]) === -1) {
                return false;
            }
        }

        return true;
    }

    function currentQuery() {
        return {
            text: $("filter-text").value.trim(),
            arithmetic: valuesFrom($("filter-arithmetic")),
            hidden_nodes: valuesFrom($("filter-hidden-nodes")),
            multiple_io: valuesFrom($("filter-multiple-io")),
            multiple_networks: valuesFrom($("filter-multiple-networks")),
            node_comparisons: valuesFrom($("filter-node-comparisons")),
            operators: commaValues($("filter-operators").value),
            element_types: valuesFrom($("filter-element-types")),
            serialise_assignments: valuesFrom($("filter-serialise-assignments")),
            onnx_opset: $("filter-onnx-opset").value.trim(),
            vnnlib_version: $("filter-vnnlib-version").value.trim()
        };
    }

    function latestVersion(versions) {
        return versions.length ? versions[versions.length - 1] : null;
    }

    function search() {
        syncAllPillGroups();
        var query = currentQuery();
        state.query = query;
        updateUrl(query);
        state.filtered = state.solvers.map(function (solver) {
            if (!solverTextMatches(solver, query.text)) {
                return null;
            }
            var versions = (solver.versions || []).filter(function (version) {
                return versionMatches(version, query);
            });
            if (!hasCapabilityFilters(query)) {
                var latest = latestVersion(versions);
                versions = latest ? [latest] : [];
            }
            if (!versions.length) {
                return null;
            }
            return Object.assign({}, solver, { versions: versions });
        }).filter(Boolean);
        render();
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function statusClass(status) {
        if (status === "ok") {
            return "status-ok";
        }
        if (status === "incomplete") {
            return "status-incomplete";
        }
        return "status-failed";
    }

    function badges(items, limit) {
        var visible = (items || []).slice(0, limit || 12);
        var html = visible.map(function (item) {
            return '<span class="solver-badge">' + escapeHtml(item) + '</span>';
        }).join("");
        if ((items || []).length > visible.length) {
            html += '<span class="solver-badge">+' + ((items || []).length - visible.length) + " more</span>";
        }
        return html;
    }

    function rangeText(pair) {
        if (!pair || pair.length !== 2) {
            return "Unknown";
        }
        return escapeHtml(pair[0]) + " to " + escapeHtml(pair[1]);
    }

    function listText(items, fallback) {
        if (!items || !items.length) {
            return fallback || "Unknown";
        }
        return items.map(escapeHtml).join(", ");
    }

    function labelledList(items, fallback) {
        if (!items || !items.length) {
            return fallback || "Unknown";
        }
        return items.map(function (item) {
            return escapeHtml(VALUE_LABELS[item] || item);
        }).join(", ");
    }

    function allOperators(solvers) {
        var seen = {};
        solvers.forEach(function (solver) {
            (solver.versions || []).forEach(function (version) {
                var capabilities = version.capabilities || {};
                Object.keys(capabilities.operators || {}).forEach(function (operator) {
                    seen[operator] = true;
                });
            });
        });
        return Object.keys(seen).sort();
    }

    function knownOperators() {
        return unique(allOperators(state.solvers).concat(COMMON_ONNX_OPERATORS))
            .sort(function (a, b) { return b.length - a.length; });
    }

    function extractOperatorsFromText(text) {
        var found = [];
        knownOperators().forEach(function (operator) {
            var escaped = operator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var pattern = new RegExp("(^|[^A-Za-z0-9_])" + escaped + "([^A-Za-z0-9_]|$)");
            if (pattern.test(text)) {
                found.push(operator);
            }
        });
        return unique(found).sort();
    }

    function populateOperatorSuggestions(solvers) {
        $("operator-suggestions").innerHTML = allOperators(solvers).map(function (operator) {
            return '<option value="' + escapeHtml(operator) + '"></option>';
        }).join("");
    }

    function activeFilterItems(query) {
        var items = [];
        if (!query) {
            return items;
        }
        if (query.text) {
            items.push({ field: "text", value: null, label: FILTER_LABELS.text + ": " + query.text });
        }
        [
            "operators",
            "arithmetic",
            "element_types",
            "hidden_nodes",
            "multiple_io",
            "multiple_networks",
            "node_comparisons",
            "serialise_assignments"
        ].forEach(function (field) {
            (query[field] || []).forEach(function (value) {
                items.push({
                    field: field,
                    value: value,
                    label: FILTER_LABELS[field] + ": " + (VALUE_LABELS[value] || value)
                });
            });
        });
        RANGE_FIELDS.forEach(function (field) {
            if (query[field]) {
                items.push({ field: field, value: null, label: FILTER_LABELS[field] + ": " + query[field] });
            }
        });
        return items;
    }

    function removeFilterValue(field, value) {
        if (field === "text") {
            $("filter-text").value = "";
            $("filter-text").dispatchEvent(new Event("input", { bubbles: true }));
            return;
        }
        if (field === "onnx_opset" || field === "vnnlib_version") {
            $("filter-" + field.replace(/_/g, "-")).value = "";
            $("filter-" + field.replace(/_/g, "-")).dispatchEvent(new Event("input", { bubbles: true }));
            return;
        }
        if (field === "operators") {
            var remaining = commaValues($("filter-operators").value).filter(function (item) {
                return item !== value;
            });
            $("filter-operators").value = remaining.join(", ");
            $("filter-operators").dispatchEvent(new Event("input", { bubbles: true }));
            return;
        }
        var selectId = PILL_FIELDS[field] || "filter-" + field.replace(/_/g, "-");
        var select = $(selectId);
        if (!select) {
            return;
        }
        Array.prototype.forEach.call(select.options, function (option) {
            if (option.value === value) {
                option.selected = false;
            }
        });
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function renderActiveFilters(query) {
        var target = $("active-filters");
        var items = activeFilterItems(query);
        if (!items.length) {
            target.innerHTML = '<span class="active-filter-note">No filters selected. Showing the latest working version of each solver.</span>';
            return;
        }
        target.innerHTML = items.map(function (item) {
            return '<button type="button" class="active-filter-chip" data-field="' + escapeHtml(item.field) + '" data-value="' + escapeHtml(item.value === null ? "" : item.value) + '">'
                + escapeHtml(item.label) + ' <span class="chip-remove" aria-hidden="true">&times;</span></button>';
        }).join("");
    }

    function versionDetails(version) {
        var capabilities = version.capabilities || {};
        var operators = Object.keys(capabilities.operators || {}).sort();
        var notes = (version.notes || []).map(function (note) {
            var prefix = note.field && note.identifier ? note.field + " " + note.identifier + ": " : "";
            return "<li>" + escapeHtml(prefix + note.text) + "</li>";
        }).join("");
        var errors = (version.errors || []).map(function (error) {
            return "<li>" + escapeHtml(error) + "</li>";
        }).join("");

        return [
            '<div class="solver-detail-panel">',
            '<div class="solver-section-title">Supported theories</div>',
            '<div class="solver-badges">',
            badges((capabilities.arithmetic || []).map(function (item) { return VALUE_LABELS[item] || item; }), 6),
            badges((capabilities.hidden_nodes || []).map(function (item) { return VALUE_LABELS[item] || item; }), 4),
            badges((capabilities.multiple_io || []).map(function (item) { return VALUE_LABELS[item] || item; }), 4),
            badges((capabilities.multiple_networks || []).map(function (item) { return VALUE_LABELS[item] || item; }), 6),
            badges((capabilities.node_comparisons || []).map(function (item) { return VALUE_LABELS[item] || item; }), 4),
            "</div>",
            '<div class="solver-section-title">Element types and assignments</div>',
            '<div class="solver-badges">',
            badges((capabilities.element_types || []).map(function (item) { return "Type " + item; }), 6),
            capabilities.serialise_assignments === undefined ? "" : badges(["Serialise assignments " + capabilities.serialise_assignments], 1),
            "</div>",
            '<div class="solver-section-title">Supported versions</div>',
            '<div class="solver-badges">',
            capabilities.vnnlib_versions ? '<span class="solver-badge">VNN-LIB ' + rangeText(capabilities.vnnlib_versions) + "</span>" : "",
            capabilities.onnx_opset ? '<span class="solver-badge">ONNX opset ' + rangeText(capabilities.onnx_opset) + "</span>" : "",
            "</div>",
            '<div class="solver-section-title">Operators</div>',
            '<div class="solver-operators"><div class="solver-badges">' + badges(operators, 40) + "</div></div>",
            notes ? '<div class="solver-section-title">Notes</div><ul>' + notes + "</ul>" : "",
            errors ? '<div class="solver-section-title">Errors</div><ul>' + errors + "</ul>" : "",
            "</div>"
        ].join("");
    }

    function solverVersionRows(solver, solverIndex) {
        return (solver.versions || []).map(function (version, versionIndex) {
            return solverRow(solver, version, solverIndex + "-" + versionIndex);
        }).join("");
    }

    function solverRow(solver, version, rowId) {
        var capabilities = version.capabilities || {};
        var detailId = "solver-detail-" + rowId;
        var repo = solver.repo
            ? '<a href="' + escapeHtml(solver.repo) + '" target="_blank" rel="noopener">' + escapeHtml(solver.repo) + "</a>"
            : "Unknown";

        return [
            "<tr>",
            '<td><strong>' + escapeHtml(solver.name || solver.id) + '</strong><div class="solver-meta">' + escapeHtml(solver.id) + "</div></td>",
            "<td>" + escapeHtml(version.version || "Unknown") + "</td>",
            "<td>" + rangeText(capabilities.vnnlib_versions) + "</td>",
            "<td>" + repo + "</td>",
            '<td><button class="btn btn-sm btn-outline-primary" type="button" data-toggle="collapse" data-target="#' + detailId + '" aria-expanded="false" aria-controls="' + detailId + '">Details</button></td>',
            "</tr>",
            '<tr class="solver-detail-row"><td colspan="5"><div class="collapse" id="' + detailId + '">' + versionDetails(version) + "</div></td></tr>"
        ].join("");
    }

    function matchingVersionCount() {
        return state.filtered.reduce(function (total, solver) {
            return total + (solver.versions || []).length;
        }, 0);
    }

    function render() {
        var list = $("solver-results");
        var summary = $("solver-summary");
        var releaseCount = matchingVersionCount();
        renderActiveFilters(state.query);
        summary.textContent = state.filtered.length + " matching solver" + (state.filtered.length === 1 ? "" : "s")
            + ", " + releaseCount + " matching release" + (releaseCount === 1 ? "" : "s");

        if (!state.filtered.length) {
            list.innerHTML = '<div class="solver-empty">No solvers match the selected filters.</div>';
            return;
        }

        list.innerHTML = [
            '<div class="solver-table-shell">',
            '<table class="table table-hover solver-table">',
            "<thead>",
            "<tr>",
            "<th>Solver</th>",
            "<th>Version</th>",
            "<th>Supported VNN-LIB versions</th>",
            "<th>Link</th>",
            "<th></th>",
            "</tr>",
            "</thead>",
            "<tbody>",
            state.filtered.map(solverVersionRows).join(""),
            "</tbody>",
            "</table>",
            "</div>"
        ].join("");
    }

    function loadData() {
        var attempt = function (index) {
            return fetch(DATA_SOURCES[index]).then(function (response) {
                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }
                return response.json();
            }).catch(function (error) {
                if (index + 1 < DATA_SOURCES.length) {
                    return attempt(index + 1);
                }
                throw error;
            });
        };

        attempt(0).then(function (data) {
            if (Array.isArray(data)) {
                data = { solvers: data };
            }
            state.solvers = data.solvers || [];
            populateOperatorSuggestions(state.solvers);
            applyQueryFromUrl();
            $("database-meta").textContent = "Database generated at " + (data.generated_at || "unknown time");
            search();
        }).catch(function (error) {
            $("solver-results").innerHTML = '<div class="solver-error">Could not load solver data: ' + error.message + "</div>";
        });
    }

    function bindEvents() {
        Object.keys(PILL_FIELDS).forEach(function (field) {
            buildPillGroup(PILL_FIELDS[field]);
        });

        $("active-filters").addEventListener("click", function (event) {
            var chip = event.target.closest(".active-filter-chip");
            if (!chip) {
                return;
            }
            removeFilterValue(chip.dataset.field, chip.dataset.value || null);
        });

        [
            "filter-text",
            "filter-arithmetic",
            "filter-hidden-nodes",
            "filter-multiple-io",
            "filter-multiple-networks",
            "filter-node-comparisons",
            "filter-element-types",
            "filter-serialise-assignments",
            "filter-onnx-opset",
            "filter-vnnlib-version",
            "filter-operators"
        ].forEach(function (id) {
            $(id).addEventListener("input", search);
            $(id).addEventListener("change", search);
        });

        $("filter-model-file").addEventListener("change", function (event) {
            var file = event.target.files && event.target.files[0];
            var status = $("model-file-status");
            if (!file) {
                status.textContent = "Upload an ONNX model or operator list.";
                return;
            }
            file.arrayBuffer().then(function (buffer) {
                var text = new TextDecoder("utf-8").decode(buffer);
                var operators = extractOperatorsFromText(text);
                if (!operators.length) {
                    status.textContent = "No known ONNX operators found in " + file.name + ".";
                    return;
                }
                $("filter-operators").value = mergeCommaInput($("filter-operators").value, operators);
                status.textContent = "Added " + operators.length + " operator" + (operators.length === 1 ? "" : "s") + " from " + file.name + ".";
                search();
            }).catch(function () {
                status.textContent = "Could not read " + file.name + ".";
            });
        });

        $("clear-filters").addEventListener("click", function () {
            document.querySelectorAll(".solver-filter-panel select").forEach(function (select) {
                Array.prototype.forEach.call(select.options, function (option) {
                    option.selected = false;
                });
            });
            document.querySelectorAll(".solver-filter-panel input").forEach(function (input) {
                input.value = "";
            });
            $("model-file-status").textContent = "Upload an ONNX model or operator list.";
            search();
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindEvents();
        loadData();
    });
}());
