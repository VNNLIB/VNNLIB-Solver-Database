(function () {
    "use strict";

    var DATA_SOURCES = [
        "../data/solvers.json",
        "https://raw.githubusercontent.com/VNNLIB/VNNLIB-Solver-Database/main/data/solvers.json"
    ];

    var THEORY_FIELDS = [
        "hidden_nodes",
        "multiple_io",
        "multiple_networks",
        "node_comparisons",
        "arithmetic"
    ];

    var RANGE_FIELDS = ["onnx_opset", "vnnlib_versions"];

    var state = {
        solvers: [],
        filtered: []
    };

    function $(id) {
        return document.getElementById(id);
    }

    function valuesFrom(select) {
        return Array.prototype.slice.call(select.selectedOptions)
            .map(function (option) { return option.value; })
            .filter(Boolean);
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
        setSelectValues("filter-element-types", valuesFromParams(params, "element_types"));
        setSelectValues("filter-status", valuesFromParams(params, "status"));
        $("filter-operators").value = valuesFromParams(params, "operators").join(", ");
        $("filter-onnx-opset").value = params.get("onnx_opset") || "";
        $("filter-vnnlib-version").value = params.get("vnnlib_versions") || "";
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
            "element_types",
            "status",
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

    function inRange(pair, wanted) {
        if (!pair || pair.length !== 2 || !wanted) {
            return true;
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

    function solverTextMatches(solver, queryText) {
        if (!queryText) {
            return true;
        }
        var haystack = [
            solver.id,
            solver.name,
            solver.repo
        ].join(" ").toLowerCase();
        return haystack.indexOf(queryText.toLowerCase()) !== -1;
    }

    function hasCapabilityFilters(query) {
        return THEORY_FIELDS.some(function (field) {
            return (query[field] || []).length > 0;
        }) || RANGE_FIELDS.some(function (field) {
            return !!query[field];
        }) || query.operators.length > 0 || query.element_types.length > 0;
    }

    function versionMatches(version, query) {
        var capabilities = version.capabilities;
        var satisfies = version.satisfies || {};
        if (query.status.length && query.status.indexOf(version.status) === -1) {
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
            if (!inRange(capabilities[rangeField], query[rangeField])) {
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
            node_comparisons: [],
            operators: commaValues($("filter-operators").value),
            element_types: valuesFrom($("filter-element-types")),
            status: valuesFrom($("filter-status")),
            onnx_opset: $("filter-onnx-opset").value.trim(),
            vnnlib_versions: $("filter-vnnlib-version").value.trim()
        };
    }

    function search() {
        var query = currentQuery();
        updateUrl(query);
        state.filtered = state.solvers.map(function (solver) {
            if (!solverTextMatches(solver, query.text)) {
                return null;
            }
            var versions = (solver.versions || []).filter(function (version) {
                return versionMatches(version, query);
            });
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

    function populateOperatorSuggestions(solvers) {
        $("operator-suggestions").innerHTML = allOperators(solvers).map(function (operator) {
            return '<option value="' + escapeHtml(operator) + '"></option>';
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
            '<div class="solver-section-title">Core capabilities</div>',
            '<div class="solver-badges">',
            badges((capabilities.arithmetic || []).map(function (item) { return "Arithmetic " + item; }), 6),
            badges((capabilities.element_types || []).map(function (item) { return "Type " + item; }), 6),
            "</div>",
            '<div class="solver-section-title">Versions and opsets</div>',
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
        var operators = Object.keys(capabilities.operators || {});
        var detailId = "solver-detail-" + rowId;
        var repo = solver.repo
            ? '<a href="' + escapeHtml(solver.repo) + '" target="_blank" rel="noopener">Repository</a>'
            : "Unknown";

        return [
            "<tr>",
            '<td><strong>' + escapeHtml(solver.name || solver.id) + '</strong><div class="solver-meta">' + escapeHtml(solver.id) + "</div></td>",
            "<td>" + escapeHtml(version.version || "Unknown") + "</td>",
            "<td>" + rangeText(capabilities.vnnlib_versions) + "</td>",
            "<td>" + rangeText(capabilities.onnx_opset) + "</td>",
            "<td>" + listText(capabilities.arithmetic) + "</td>",
            "<td>" + listText(capabilities.element_types) + "</td>",
            "<td>" + operators.length + "</td>",
            '<td><span class="solver-badge ' + statusClass(version.status) + '">' + escapeHtml(version.status || "unknown") + "</span></td>",
            "<td>" + repo + "</td>",
            '<td><button class="btn btn-sm btn-outline-primary" type="button" data-toggle="collapse" data-target="#' + detailId + '" aria-expanded="false" aria-controls="' + detailId + '">Details</button></td>',
            "</tr>",
            '<tr class="solver-detail-row"><td colspan="10"><div class="collapse" id="' + detailId + '">' + versionDetails(version) + "</div></td></tr>"
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
            "<th>VNN-LIB</th>",
            "<th>ONNX opset</th>",
            "<th>Arithmetic</th>",
            "<th>Element types</th>",
            "<th>Operators</th>",
            "<th>Status</th>",
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
        [
            "filter-text",
            "filter-arithmetic",
            "filter-hidden-nodes",
            "filter-multiple-io",
            "filter-multiple-networks",
            "filter-element-types",
            "filter-status",
            "filter-onnx-opset",
            "filter-vnnlib-version",
            "filter-operators"
        ].forEach(function (id) {
            $(id).addEventListener("input", search);
            $(id).addEventListener("change", search);
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
            search();
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindEvents();
        loadData();
    });
}());
