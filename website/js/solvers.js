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

    function versionMatches(version, query) {
        var capabilities = version.capabilities;
        var satisfies = version.satisfies || {};
        if (!capabilities) {
            return false;
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
            arithmetic: valuesFrom($("filter-arithmetic")),
            hidden_nodes: valuesFrom($("filter-hidden-nodes")),
            multiple_io: valuesFrom($("filter-multiple-io")),
            multiple_networks: valuesFrom($("filter-multiple-networks")),
            node_comparisons: [],
            operators: commaValues($("filter-operators").value),
            element_types: valuesFrom($("filter-element-types")),
            onnx_opset: $("filter-onnx-opset").value.trim(),
            vnnlib_versions: $("filter-vnnlib-version").value.trim()
        };
    }

    function search() {
        var query = currentQuery();
        state.filtered = state.solvers.map(function (solver) {
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

    function latestVersion(solver) {
        var versions = solver.versions || [];
        return versions[versions.length - 1] || {};
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
            return '<span class="solver-badge">' + item + '</span>';
        }).join("");
        if ((items || []).length > visible.length) {
            html += '<span class="solver-badge">+' + ((items || []).length - visible.length) + " more</span>";
        }
        return html;
    }

    function versionCard(solver, version) {
        var capabilities = version.capabilities || {};
        var operators = Object.keys(capabilities.operators || {}).sort();
        var repo = solver.repo ? '<a href="' + solver.repo + '" target="_blank" rel="noopener">Repository</a>' : "";
        var notes = (version.notes || []).map(function (note) {
            var prefix = note.field && note.identifier ? note.field + " " + note.identifier + ": " : "";
            return "<li>" + prefix + note.text + "</li>";
        }).join("");

        return [
            '<article class="solver-card">',
            "<h3>" + (solver.name || solver.id) + "</h3>",
            '<div class="solver-meta">Version ' + version.version + (repo ? " | " + repo : "") + "</div>",
            '<div class="solver-badges"><span class="solver-badge ' + statusClass(version.status) + '">' + version.status + "</span></div>",
            '<div class="solver-section-title">Core capabilities</div>',
            '<div class="solver-badges">',
            badges((capabilities.arithmetic || []).map(function (item) { return "Arithmetic " + item; }), 6),
            badges((capabilities.element_types || []).map(function (item) { return "Type " + item; }), 6),
            "</div>",
            '<div class="solver-section-title">Versions and opsets</div>',
            '<div class="solver-badges">',
            capabilities.vnnlib_versions ? '<span class="solver-badge">VNN-LIB ' + capabilities.vnnlib_versions.join(" to ") + "</span>" : "",
            capabilities.onnx_opset ? '<span class="solver-badge">ONNX opset ' + capabilities.onnx_opset.join(" to ") + "</span>" : "",
            "</div>",
            '<div class="solver-section-title">Operators</div>',
            '<div class="solver-operators"><div class="solver-badges">' + badges(operators, 40) + "</div></div>",
            notes ? '<div class="solver-section-title">Notes</div><ul>' + notes + "</ul>" : "",
            "</article>"
        ].join("");
    }

    function render() {
        var list = $("solver-results");
        var summary = $("solver-summary");
        summary.textContent = state.filtered.length + " matching solver" + (state.filtered.length === 1 ? "" : "s");

        if (!state.filtered.length) {
            list.innerHTML = '<div class="solver-empty">No solvers match the selected filters.</div>';
            return;
        }

        list.innerHTML = state.filtered.map(function (solver) {
            return versionCard(solver, latestVersion(solver));
        }).join("");
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
            state.filtered = state.solvers.filter(function (solver) {
                return (solver.versions || []).some(function (version) {
                    return !!version.capabilities;
                });
            });
            $("database-meta").textContent = "Database generated at " + (data.generated_at || "unknown time");
            render();
        }).catch(function (error) {
            $("solver-results").innerHTML = '<div class="solver-error">Could not load solver data: ' + error.message + "</div>";
        });
    }

    function bindEvents() {
        [
            "filter-arithmetic",
            "filter-hidden-nodes",
            "filter-multiple-io",
            "filter-multiple-networks",
            "filter-element-types",
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
