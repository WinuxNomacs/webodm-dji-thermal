// A thermal dataset's Convert tab: dji-thermal-cli's settings (starting from the user's saved preferences, which can be
// saved or reset to the defaults), converting with them, and the dataset's conversions side by side, each with its
// settings, the files written and its downloads.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var esc = function (t) { return core.escapeHtml(t); };

    var STATUS_LABELS = {converting: "Converting", ready: "Converted", failed: "Failed", canceled: "Canceled"};
    // As the DJI Thermal Task panel names them (thermal/MeasurementSettings.jsx), in its order
    var DISTANCE_MODES = [["lrf", "Laser rangefinder, else as recorded"], ["embedded", "As recorded"], ["fixed", "Set for all photos"]];
    var UNIT_LABELS = {C: "°C", F: "°F", K: "K"};
    // The measurement parameters with the analysis' column of each image's recorded value (Celsius for temperatures)
    var MEASUREMENTS = [
        {key: "emissivity", label: "Emissivity", hint: "emissivity", digits: 2, step: "0.01"},
        {key: "reflected_temp", label: "Reflected temperature", hint: "reflection", temperature: true},
        {key: "ambient_temp", label: "Ambient temperature", hint: "ambient", temperature: true},
        {key: "humidity", label: "Relative humidity", unit: "%", hint: "humidity", digits: 0}
    ];
    var GIMBAL = [["gimbal_yaw", "Yaw"], ["gimbal_pitch", "Pitch"], ["gimbal_roll", "Roll"]];
    var RESULTS_SHOWN = 500;   // files listed in a conversion's results
    var FIGURES_POLL_MS = 2000;     // a conversion's Files loaded again while its frames are being measured

    // The settings that are temperatures (in the settings' unit, the files'): the form shows them in the user's
    var TEMPERATURES = ["reflected_temp", "ambient_temp", "range_min", "range_max", "replace_above", "replace_above_value",
                        "replace_below", "replace_below_value"];

    // Settings with their temperatures from one unit to another ("nodata" kept)
    function settingsIn(s, from, to) {
        var out = Object.assign({}, s);
        TEMPERATURES.forEach(function (k) {
            if (typeof out[k] === "number") out[k] = Math.round(core.convertTemp(out[k], from, to) * 10000) / 10000;
        });
        return out;
    }

    // What the flight recorded (medians of its thermal frames), shown beside each measurement parameter
    function recorded(analysis) {
        var thermal = ((analysis || {}).files || []).filter(function (f) { return f.kind === "thermal"; });
        var out = {};
        ["distance", "lrf", "humidity", "emissivity", "reflection", "ambient"].forEach(function (k) {
            out[k] = core.median(thermal.map(function (f) { return f[k]; }));
        });
        // The images' own palettes, the most used first: [[name, frames]]
        var counts = {};
        thermal.forEach(function (f) { if (f.palette) counts[f.palette] = (counts[f.palette] || 0) + 1; });
        out.palettes = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
        return out;
    }

    function blank(v) { return v === null || v === undefined || v === ""; }
    function value(v) { return blank(v) ? "" : String(v); }

    function numberInput(key, v, attrs) {
        return '<input type="number" class="form-control input-sm" name="' + key + '" value="' + esc(value(v)) + '"' + (attrs || "") + ">";
    }

    function field(label, html, help) {
        return '<div class="form-group ta-field"><label>' + esc(label) + "</label>" + html +
            (help ? '<span class="help-block">' + help + "</span>" : "") + "</div>";
    }

    function recordedText(v, digits, unit) {
        return blank(v) ? "Not recorded" : "Recorded: " + core.formatNumber(v, digits === undefined ? 1 : digits, unit || "");
    }

    // The settings form, its temperatures in the user's unit. meta: {products, palettes}; rec: recorded(analysis), in °C
    function formHtml(s, meta, rec) {
        rec = rec || {};
        var unit = core.unitOf(s.unit || core.userUnit()), u = core.unitSymbol(core.userUnit());
        var shown = settingsIn(s, unit, core.userUnit());
        TEMPERATURES.forEach(function (k) { if (typeof shown[k] === "number") shown[k] = Math.round(shown[k] * 100) / 100; });
        s = shown;
        var outputs = s.outputs || [];
        var chosen = {};
        outputs.forEach(function (o) { var p = o.split(":"); chosen[p[0]] = p[1]; });

        var products = (meta.products || []).map(function (p) {
            var on = chosen[p.product] !== undefined;
            return '<div class="ta-output"><label class="checkbox-inline" title="' + esc(p.description) + '"><input type="checkbox" name="output" value="' +
                esc(p.product) + '"' + (on ? " checked" : "") + "> " +
                (productNames[p.product] ? esc(productNames[p.product]) + " " : "") + "<code>" + esc(p.product) + "</code></label> " +
                '<select class="form-control input-sm" name="format-' + esc(p.product) + '">' + p.formats.map(function (f) {
                    return '<option value="' + esc(f) + '"' + (chosen[p.product] === f ? " selected" : "") + ">" + esc(f.toUpperCase()) + "</option>";
                }).join("") + '</select> <span class="text-muted">' + esc(p.description) + "</span></div>";
        }).join("");

        var fixed = typeof s.distance === "number";
        var distanceHelp = recordedText(rec.distance, 1, " m") + "; laser rangefinder: " +
            (blank(rec.lrf) ? "none" : core.formatNumber(rec.lrf, 1, " m")) + " (medians)";
        var distance = field("Distance to the target",
            '<div class="ta-inline"><select class="form-control input-sm" name="distance_mode">' + DISTANCE_MODES.map(function (m) {
                var sel = fixed ? m[0] === "fixed" : m[0] === s.distance;
                return '<option value="' + m[0] + '"' + (sel ? " selected" : "") + ">" + esc(m[1]) + "</option>";
            }).join("") + "</select>" + numberInput("distance", fixed ? s.distance : "", ' step="0.1" min="0.1" placeholder="m"' + (fixed ? "" : " hidden")) +
            "</div>", esc(distanceHelp));
        var measurement = MEASUREMENTS.map(function (m) {
                var hint = m.temperature ? core.convertTemp(rec[m.hint], "C") : rec[m.hint];
                var label = m.label + (m.temperature ? " (" + u + ")" : m.unit ? " (" + m.unit + ")" : "");
                var placeholder = blank(hint) ? "As recorded" : "As recorded (" + core.formatNumber(hint, m.digits === undefined ? 1 : m.digits) + ")";
                return field(label, numberInput(m.key, s[m.key], ' step="' + (m.step || "any") + '" placeholder="' + esc(placeholder) + '"'),
                    esc(recordedText(hint, m.digits, m.temperature ? " " + u : m.unit ? " " + m.unit : "")));
            }).join("") + distance +
            field("Unit of the files", '<select class="form-control input-sm" name="unit">' + ["C", "F", "K"].map(function (k) {
                return '<option value="' + k + '"' + (k === unit ? " selected" : "") + ">" + UNIT_LABELS[k] + "</option>";
            }).join("") + "</select>", "What the temperature TIFFs are written in. The temperatures here are in yours (" + esc(u) + ").");

        var own = rec.palettes || [];
        var ownText = own.length === 1 ? " (" + own[0][0] + ")" : own.length ? " (" + own.map(function (p) { return p[0] + " on " + p[1]; }).join(", ") + ")" : "";
        var look = field("Palette", '<select class="form-control input-sm" name="palette"><option value="">Each image\'s own' + esc(ownText) + "</option>" +
                (meta.palettes || []).map(function (p) {
                    return '<option value="' + esc(p) + '"' + (p === s.palette ? " selected" : "") + ">" + esc(p) + "</option>";
                }).join("") + "</select>", "Used for the colour outputs.") +
            field("Colour range (" + u + ")", '<div class="ta-inline">' + numberInput("range_min", s.range_min, ' step="any" placeholder="from"') +
                numberInput("range_max", s.range_max, ' step="any" placeholder="to"') + "</div>",
                "Both, or neither for each image's own range. Also the range of the 16-bit grey outputs.");

        var frames = '<div class="ta-normalize"><div class="checkbox"><label><input type="checkbox" name="normalize"' + (s.normalize ? " checked" : "") +
                "> Normalize: one ambient and reflected temperature for every frame</label>" +
                '<span class="help-block">The flight\'s medians of the values the camera recorded, unless given in Measurement: ' +
                "no jumps between frames where the recorded values change.</span></div>" +
            '<div class="checkbox"><label><input type="checkbox" name="harmonize"' + (harmonizes(s) ? " checked" : "") +
                "> Harmonize: each frame's drift against its overlapping neighbours removed</label>" +
                '<span class="help-block">The camera drifts between its recalibrations: removing it leaves no seams in a map. ' +
                "Compares the frames' overlaps, which takes a while; frames that can't be placed keep theirs. Normalizes too. " +
                "Recommended for processing into a map.</span></div></div>" +
            field("Only frames with a gimbal pitch at or below (°)", numberInput("max_pitch", s.max_pitch, ' step="1" min="-90" max="90" placeholder="all frames"'),
                "-80 keeps the nadir frames only.");

        var adjust = field("Gimbal override (°)", '<div class="ta-inline">' + GIMBAL.map(function (g) {
                return numberInput(g[0], s[g[0]], ' step="any" placeholder="' + g[1] + '" title="' + g[1] + '"');
            }).join("") + "</div>", "Replaces the recorded gimbal angles in every output's metadata.") +
            ["above", "below"].map(function (side) {
                var v = s["replace_" + side + "_value"];
                var nodata = v === "nodata";
                return field("Replace temperatures " + side + " (" + u + ")", '<div class="ta-inline">' +
                    numberInput("replace_" + side, s["replace_" + side], ' step="any" placeholder="threshold"') +
                    numberInput("replace_" + side + "_value", nodata ? "" : v, ' step="any" placeholder="with"' + (nodata ? " disabled" : "")) +
                    '<label class="checkbox-inline"><input type="checkbox" name="replace_' + side + '_nodata"' + (nodata ? " checked" : "") + "> with no data</label></div>");
            }).join("") +
            '<div class="checkbox"><label><input type="checkbox" name="strip_location"' + (s.strip_location ? " checked" : "") +
            "> Strip the location and identifiers from the outputs</label></div>";

        return '<div class="ta-section"><h4>Colours</h4>' + look + "</div>" +
            '<details class="ta-section ta-section-outputs"><summary><h4>Outputs</h4> <span class="ta-section-chips" data-chips="outputs"></span></summary>' + products +
            field("Compression (TIFF)", '<select class="form-control input-sm" name="compression">' + ["deflate", "none"].map(function (c) {
                return '<option value="' + c + '"' + (c === s.compression ? " selected" : "") + ">" + c + "</option>";
            }).join("") + "</select>") +
            '<div class="checkbox"><label><input type="checkbox" name="mosaics"' + (s.mosaics ? " checked" : "") +
            "> Mosaics: the frames placed side by side, as converted and harmonized, to see on a map</label>" +
            '<span class="help-block">Built after converting, from the frames\' positions and angles (no WebODM task needed).</span></div>' +
            "</details>" +
            '<details class="ta-section" open><summary><h4>Measurement</h4></summary><p class="text-muted">Left empty, each photo keeps the value its camera recorded.</p>' + measurement + "</details>" +
            '<details class="ta-section" open><summary><h4>Frames</h4></summary>' + frames + "</details>" +
            '<details class="ta-section"' + (!blank(s.gimbal_yaw) || !blank(s.gimbal_pitch) || !blank(s.gimbal_roll) || !blank(s.replace_above) ||
                !blank(s.replace_below) || s.strip_location ? " open" : "") + '><summary><h4>Adjustments</h4></summary>' + adjust + "</details>";
    }

    // The settings as the form shows them ("" for an empty number: the server keeps the embedded value), the temperatures
    // typed in the user's unit given in the files'
    function readForm(form) {
        var get = function (name) { return form.querySelector('[name="' + name + '"]'); };
        var num = function (name) { var el = get(name); return el && el.value !== "" ? Number(el.value) : null; };
        var s = {};
        var mode = get("distance_mode").value;
        s.distance = mode === "fixed" ? num("distance") : mode;
        if (mode === "fixed" && s.distance === null) s.distance = "";
        MEASUREMENTS.forEach(function (m) { s[m.key] = num(m.key); });
        s.unit = get("unit").value;
        s.palette = get("palette").value || null;
        s.range_min = num("range_min");
        s.range_max = num("range_max");
        GIMBAL.forEach(function (g) { s[g[0]] = num(g[0]); });
        ["above", "below"].forEach(function (side) {
            s["replace_" + side] = num("replace_" + side);
            s["replace_" + side + "_value"] = get("replace_" + side + "_nodata").checked ? "nodata" : num("replace_" + side + "_value");
        });
        s.strip_location = get("strip_location").checked;
        s.harmonize = get("harmonize").checked;
        s.normalize = get("normalize").checked || s.harmonize;
        s.max_pitch = num("max_pitch");
        s.compression = get("compression").value;
        s.mosaics = get("mosaics").checked;
        s.outputs = [].filter.call(form.querySelectorAll('input[name="output"]'), function (c) { return c.checked; }).map(function (c) {
            return c.value + ":" + get("format-" + c.value).value;
        });
        return settingsIn(s, core.userUnit(), s.unit);
    }

    // The settings of the WebODM plan's process command (its arguments, as dji-thermal-cli's CLI takes them), on the defaults
    var PLAN_NUMBERS = {"--max-pitch": "max_pitch", "--emissivity": "emissivity", "--humidity": "humidity",
                        "--reflected-temp": "reflected_temp", "--ambient-temp": "ambient_temp"};
    function planSettings(args, defaults) {
        var s = JSON.parse(JSON.stringify(defaults || {}));
        var outputs = [], planUnit = "C", given = {};
        for (var i = 0; i < (args || []).length; i++) {
            var a = args[i], next = args[i + 1];
            if (a === "-o" || a === "--outputs") {
                String(next).split(",").forEach(function (o) {
                    if (o) outputs.push(o.indexOf(":") < 0 ? o : o.replace(/:tif$/, ":tiff"));
                });
                i++;
            } else if (a === "--normalize") {
                s.normalize = s.harmonize = true;
            } else if (a === "--distance") {
                s.distance = isNaN(Number(next)) ? next : Number(next);
                i++;
            } else if (a === "--unit") {
                planUnit = core.unitOf(String(next).toUpperCase());
                i++;
            } else if (PLAN_NUMBERS[a]) {
                given[PLAN_NUMBERS[a]] = Number(next);
                i++;
            }
        }
        if (outputs.length) s.outputs = outputs;
        return Object.assign(s, settingsIn(given, planUnit, s.unit || "C"));
    }

    // What stops the settings from being sent, or null
    function formProblem(s) {
        if (s.distance === "") return "Enter the distance to the target, or choose another distance.";
        if (!s.outputs.length) return "Choose at least one output.";
        if ((s.range_min === null) !== (s.range_max === null)) return "Give both ends of the colour range, or neither.";
        return null;
    }

    function round2(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : v; }
    function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    function num(v, digits) { return String(Number(Number(v).toFixed(digits === undefined ? 2 : digits))); }

    // Outputs alike as sets, an output without a format (the plan's "pseudo") alike with any format of its product
    function sameOutputs(a, b) {
        var products = function (list) {
            var out = {};
            (list || []).forEach(function (o) { var p = o.split(":"); out[p[0]] = p[1] || "*"; });
            return out;
        };
        var pa = products(a), pb = products(b);
        var ka = Object.keys(pa).sort(), kb = Object.keys(pb).sort();
        return same(ka, kb) && ka.every(function (k) { return pa[k] === "*" || pb[k] === "*" || pa[k] === pb[k]; });
    }

    // The outputs' names in words, from the server (conversions.PRODUCT_NAMES, with the dataset)
    var productNames = {};
    function setProductNames(names) { productNames = names || {}; }
    var COLOURED = ["pseudo", "rjpeg"];

    // An output ("temp_c:tiff", or a product alone) in words, as conversions.output_text: "°C TIFF", "colour PNG"
    function outputText(o) {
        var p = o.split(":");
        var name = productNames[p[0]] || p[0];
        return p[0] === "rjpeg" ? name : name + " " + (p[1] ? p[1].toUpperCase() : "images");
    }
    function colouredOutputs(s) {
        return (s.outputs || []).filter(function (o) { return COLOURED.indexOf(o.split(":")[0]) >= 0; });
    }

    // The settings told apart in the summaries: each with its form fields and its text (u: the temperatures' unit symbol)
    var DIFFERENCES = [
        {key: "outputs", fields: ["output"], same: sameOutputs, text: function (s) { return (s.outputs || []).map(outputText).join(", ") || "no outputs"; }},
        {key: "compression", fields: ["compression"], text: function (s) { return s.compression === "none" ? "no compression" : s.compression + " compression"; }},
        {key: "mosaics", fields: ["mosaics"], text: function (s) { return s.mosaics ? "mosaics" : "no mosaics"; }},
        {key: "distance", fields: ["distance_mode", "distance"], text: function (s) {
            return typeof s.distance === "number" ? "distance " + num(s.distance, 1) + " m" :
                s.distance === "embedded" ? "recorded distance" : s.distance === "" ? "distance not given" : "rangefinder distance";
        }}
    ].concat(MEASUREMENTS.map(function (m) {
        var name = m.label.replace(/ temperature$/, "").replace(/^Relative /, "").toLowerCase();
        return {key: m.key, fields: [m.key], text: function (s, u) {
            return blank(s[m.key]) ? "each image's " + m.label.toLowerCase() : name + " " + num(s[m.key]) + (m.temperature ? " " + u : m.unit || "");
        }};
    })).concat([
        {key: "unit", fields: ["unit"], text: function (s) { return "files in " + UNIT_LABELS[core.unitOf(s.unit)]; }},
        {key: "normalize", fields: ["normalize", "harmonize"], text: function (s) {
            return harmonizes(s) ? "harmonized" : s.normalize ? "normalized" : "not normalized";
        }},
        {key: "max_pitch", fields: ["max_pitch"], text: function (s) { return blank(s.max_pitch) ? "all frames" : "pitch ≤ " + num(s.max_pitch) + "°"; }},
        {key: "palette", fields: ["palette"], text: function (s) {
            return colouredOutputs(s).map(outputText).join(", ") + " in " + (s.palette || "each image's palette");
        }},
        {key: "range", fields: ["range_min", "range_max"], text: function (s, u) {
            return blank(s.range_min) && blank(s.range_max) ? "each image's range" : "range " + num(s.range_min) + " to " + num(s.range_max) + " " + u;
        }},
        {key: "gimbal", fields: GIMBAL.map(function (g) { return g[0]; }), text: function (s) {
            var given = GIMBAL.filter(function (g) { return !blank(s[g[0]]); });
            return given.length ? "gimbal " + given.map(function (g) { return g[1].toLowerCase() + " " + num(s[g[0]]) + "°"; }).join(", ") : "recorded gimbal";
        }}
    ]).concat(["above", "below"].map(function (side) {
        var k = "replace_" + side;
        return {key: k, fields: [k, k + "_value", k + "_nodata"], text: function (s, u) {
            if (blank(s[k])) return "nothing replaced " + side;
            var v = s[k + "_value"];
            return side + " " + num(s[k]) + " " + u + " → " + (v === "nodata" ? "no data" : blank(v) ? "?" : num(v) + " " + u);
        }};
    })).concat([
        {key: "strip_location", fields: ["strip_location"], text: function (s) { return s.strip_location ? "location stripped" : "location kept"; }}
    ]);

    // The settings' values compared, of one difference
    function valuesOf(d, s) {
        if (d.key === "outputs") return s.outputs || [];
        var fields = {distance: ["distance"], range: ["range_min", "range_max"], replace_above: ["replace_above", "replace_above_value"],
                      replace_below: ["replace_below", "replace_below_value"], gimbal: GIMBAL.map(function (g) { return g[0]; })}[d.key] || [d.key];
        return fields.map(function (f) {
            var v = s[f];
            if (f === "unit") return core.unitOf(v);
            if (f === "harmonize") return harmonizes(s);
            if (typeof v === "boolean" || f === "normalize" || f === "strip_location" || f === "mosaics") return !!v;
            return blank(v) ? null : round2(v);
        });
    }

    // What the settings change from the defaults, and where they're off the WebODM plan (where the plan differs from
    // the defaults): [{key, text, changed, offPlan, plan (the plan's text)}], the temperatures in the unit shown
    function differences(s, defaults, plan, shown) {
        var at = function (x) { return x ? settingsIn(x, core.unitOf(x.unit), shown) : null; };
        var S = at(s), D = at(defaults || {}), P = at(plan);
        var u = core.unitSymbol(shown);
        var out = [];
        DIFFERENCES.forEach(function (d) {
            if (d.key === "palette" && !colouredOutputs(S).length) return;    // only the coloured outputs have one
            var alike = d.same ? function (a, b) { return d.same(a.outputs, b.outputs); } : function (a, b) { return same(valuesOf(d, a), valuesOf(d, b)); };
            var changed = !alike(S, D);
            var offPlan = !!P && !alike(P, D) && !alike(S, P);
            if (changed || offPlan) out.push({key: d.key, text: d.text(S, u), changed: changed, offPlan: offPlan, plan: P ? d.text(P, u) : null});
        });
        return out;
    }

    // The settings the Outputs section holds
    var OUTPUT_KEYS = ["outputs", "compression", "mosaics"];

    // The differences as chips (none: what to say when there are none), with what "≠ plan" means when one is, unless
    // said already (noLegend)
    var OFF_PLAN_TITLE = "The WebODM plan: ";
    function chipsHtml(diffs, none, noLegend) {
        if (!diffs.length) return '<span class="text-muted">' + esc(none) + "</span>";
        var offPlan = !noLegend && diffs.some(function (d) { return d.offPlan; });
        return '<span class="ta-chips">' + diffs.map(function (d) {
            return '<span class="ta-chip' + (d.changed ? " ta-chip-changed" : "") + (d.offPlan ? " ta-chip-off-plan" : "") + '" data-key="' + d.key + '"' +
                (d.offPlan ? ' title="' + esc(OFF_PLAN_TITLE + d.plan) + '"' : "") + ">" + esc(d.text) + "</span>";
        }).join("") + (offPlan ? '<span class="ta-chips-legend text-muted">≠ plan: differs from the WebODM plan (hover for its value)</span>' : "") + "</span>";
    }

    // The form's fields marked where they change the defaults (with a way back to them) or are off the plan
    function markForm(form, diffs) {
        [].forEach.call(form.querySelectorAll(".ta-changed, .ta-off-plan"), function (el) { el.classList.remove("ta-changed", "ta-off-plan"); });
        [].forEach.call(form.querySelectorAll(".ta-mark-note"), function (el) { el.parentNode.removeChild(el); });
        diffs.forEach(function (diff) {
            var d = DIFFERENCES.filter(function (x) { return x.key === diff.key; })[0];
            var input = form.querySelector('[name="' + d.fields[0] + '"]');
            var box = input && (d.key === "outputs" ? input.closest(".ta-section") : d.key === "normalize" ? input.closest(".ta-normalize") :
                input.closest(".ta-field, .checkbox, .ta-output"));
            if (!box) return;
            if (diff.changed) box.classList.add("ta-changed");
            if (diff.offPlan) box.classList.add("ta-off-plan");
            var note = form.ownerDocument.createElement("span");
            note.className = "ta-mark-note";
            note.innerHTML = (diff.offPlan ? '<span title="' + esc(OFF_PLAN_TITLE + diff.plan) + '">≠ plan: ' + esc(diff.plan) + "</span> " : "") +
                (diff.changed ? '<a href="#" data-reset="' + d.key + '" title="Back to dji-thermal-cli\'s default">default</a>' : "");
            var label = box.querySelector("label, h4");
            if (d.key === "outputs") box.querySelector("h4").appendChild(note);
            else if (label && box.classList.contains("ta-field")) label.appendChild(note);
            else box.appendChild(note);
        });
    }

    // The settings with one difference back at its default (both in their own unit)
    function resetSetting(s, defaults, key) {
        var out = Object.assign({}, s);
        if (key === "unit") return Object.assign(settingsIn(out, core.unitOf(out.unit), core.unitOf(defaults.unit)), {unit: defaults.unit});
        var d = settingsIn(defaults, core.unitOf(defaults.unit), core.unitOf(out.unit));
        var fields = {range: ["range_min", "range_max"], gimbal: GIMBAL.map(function (g) { return g[0]; }),
                      replace_above: ["replace_above", "replace_above_value"], replace_below: ["replace_below", "replace_below_value"]}[key] || [key];
        fields.forEach(function (f) { out[f] = d[f] === undefined ? null : JSON.parse(JSON.stringify(d[f])); });
        return out;
    }

    function statusLabel(c) {
        var label = STATUS_LABELS[c.status] || c.status;
        if (c.status === "converting") label += " " + Math.round((c.progress || 0) * 100) + "%";
        return label;
    }

    // A conversion's mosaics as its card shows them: being built, failed or canceled, or built with frames removed since
    // (built ones: its main action; canChange: they can be built again from here)
    function mosaicHtml(c, canChange) {
        if (c.mosaic_status === "building") {
            return '<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' +
                Math.round((c.mosaic_progress || 0) * 100) + '%;"></div></div><div class="text-muted">' +
                esc(core.mosaicLabel({stage: c.mosaic_stage})) + "</div>";
        }
        if (c.mosaic_status === "failed") return '<div class="text-danger">The mosaics failed: ' + esc(c.mosaic_error) + "</div>";
        if (c.mosaic_status === "canceled") return '<div class="text-muted">Building the mosaics was canceled.</div>';
        if (c.mosaic_status === "ready" && c.mosaic_outdated) {
            return '<div class="text-warning ta-mosaic-status"><i class="fa fa-exclamation-triangle"></i> The mosaics were built with frames since removed.' +
                (canChange ? ' <button type="button" class="btn btn-default btn-xs" data-act="mosaics" title="Build the mosaics again, of the frames the workset keeps">' +
                    '<i class="fa fa-th"></i> Build again</button>' : "") + "</div>";
        }
        return "";
    }

    var TASK_STATUS = {10: "queued", 20: "running", 30: "failed", 40: "completed", 50: "canceled"};
    function taskStatusLabel(t) {
        if (t.last_error) return "failed";
        if (TASK_STATUS[t.status]) return TASK_STATUS[t.status];
        return t.processing_node === null || t.processing_node === undefined ? "waiting for a processing node" : "queued";
    }

    // The tasks made from a conversion, each a link to it in its project (dashboard: the dashboard's URL)
    function tasksHtml(c, dashboard) {
        if (!(c.tasks || []).length) return "";
        return '<div class="ta-conversion-tasks"><i class="fa fa-tasks"></i> ' + (c.tasks.length === 1 ? "Task" : "Tasks") + ": " + c.tasks.map(function (t) {
            return '<a href="' + esc(taskUrl(dashboard, t)) + '">' + esc(t.name) + "</a> (" + esc(taskStatusLabel(t)) + ")";
        }).join(", ") + "</div>";
    }

    // Whether settings harmonize: those saved before harmonize existed did whenever they normalized
    function harmonizes(s) { return !!(s.harmonize === undefined ? s.normalize : s.harmonize); }

    function taskUrl(dashboard, t) {
        return (dashboard || "/dashboard/") + "?project_task_open=" + t.project + "&project_task_expanded=" + t.id;
    }

    function optionValue(v) {
        return v === true ? "" : value(v);
    }

    // A task from a conversion (info: its task endpoint's): its name, the WebODM plan's options to tick and edit, and
    // what stops or warns against it (draft: the fields as they were, to keep across a redraw). The processing node is
    // set in WebODM, which starts processing the task once it has one
    function taskHtml(info, draft) {
        var html = '<div class="ta-task-head"><strong>New task</strong> from ' + core.count(info.frames, "temperature TIFF", "temperature TIFFs") +
            ", in " + esc(info.project.name) + "</div>";
        var close = '<button type="button" class="btn btn-default btn-xs" data-act="task">Close</button>';
        if (info.problems.length) {
            return html + '<div class="text-danger">' + info.problems.map(esc).join("<br>") + '</div><div class="ta-task-actions">' + close + "</div>";
        }
        if (info.warnings.length) {
            html += '<div class="alert alert-warning ta-task-warnings">' + info.warnings.map(esc).join("<br>") +
                (info.process_args.length ? '<br><button type="button" class="btn btn-default btn-xs" data-act="task-plan" title="' +
                    esc(info.process_args.join(" ")) + '"><i class="fa fa-magic"></i> New workset with the plan\'s settings</button>' : "") + "</div>";
        }
        var d = draft || {};
        if (info.options.length) {
            html += optionsFormHtml(info.options, d.options);
        } else {
            html += '<p class="text-muted">The WebODM plan has no options: the task has ODM\'s defaults.</p>';
        }
        html += '<p class="text-muted ta-task-note">The task waits in the project for a processing node: WebODM\'s <em>Set a processing node</em> opens its ' +
            "own panel (the node, the options), and processing starts once it is saved.</p>";
        html += '<div class="ta-task-actions"><input type="text" class="form-control input-sm" name="task-name" maxlength="255" value="' +
            esc(d.name !== undefined ? d.name : info.name) + '" placeholder="Name" aria-label="Task name">' +
            '<button type="button" class="btn btn-primary btn-xs" data-act="task-create"' + (info.can_create ? "" : " disabled") +
            '><i class="fa fa-plus"></i> Create task</button> ' + close + '</div><div class="ta-task-message"></div>';
        return html;
    }

    // ODM options to tick and edit (options: [{name, value, reason, recommended}], the recommended ones ticked; picked:
    // readOptions' draft, to keep what was typed across a redraw)
    function optionsFormHtml(options, picked) {
        return '<table class="table table-condensed ta-task-options"><thead><tr><th></th><th>Option</th><th>Value</th><th>Why</th></tr></thead><tbody>' +
            options.map(function (o, i) {
                var was = picked && picked[o.name];
                var on = picked ? !!was : o.recommended;
                var v = was && was.value !== undefined ? was.value : o.value;
                return '<tr' + (o.recommended ? "" : ' class="ta-task-consider"') + '><td><input type="checkbox" name="task-option" value="' + i + '"' +
                    (on ? " checked" : "") + ' aria-label="' + esc(o.name) + '"></td><td>' + core.optionHtml(o.name) +
                    (o.recommended ? "" : ' <span class="text-muted">to consider</span>') + "</td><td>" +
                    (o.value === true ? '<span class="text-muted">on</span>' : '<input type="text" class="form-control input-sm" name="task-value-' + i +
                        '" value="' + esc(optionValue(v)) + '" aria-label="' + esc(o.name) + ' value">') +
                    "</td><td>" + esc(o.reason) + "</td></tr>";
            }).join("") + "</tbody></table>";
    }

    // optionsFormHtml's fields: {draft (by name: {value}, or null when unticked), options ([{name, value}] ticked),
    // problem (what stops them, or null)}
    function readOptions(el, options) {
        var draft = {}, ticked = [], problem = null;
        options.forEach(function (o, i) {
            var box = el.querySelector('input[name="task-option"][value="' + i + '"]');
            var v = o.value === true ? true : el.querySelector('[name="task-value-' + i + '"]').value.trim();
            if (typeof o.value === "number" && v !== "" && !isNaN(Number(v))) v = Number(v);
            draft[o.name] = box.checked ? {value: v} : null;
            if (!box.checked) return;
            if (v === "") problem = problem || "Give " + o.name + " a value, or untick it.";
            ticked.push({name: o.name, value: v});
        });
        return {draft: draft, options: ticked, problem: problem};
    }

    // The task panel's fields: {draft (taskHtml's), data (to send), problem (what stops it, or null)}
    function readTaskForm(el, info) {
        var name = el.querySelector('[name="task-name"]').value;
        var o = readOptions(el, info.options);
        return {draft: {name: name, options: o.draft}, data: {name: name.trim(), options: o.options}, problem: o.problem};
    }

    var USE_TITLE = "Fill the settings form with this workset's settings, to start a new workset from them";

    // The dataset's own task when it holds this conversion's TIFFs: a link to it (parent: the dataset's, see
    // conversion_tasks.parent)
    function parentHtml(c, parent, dashboard) {
        if (!parent || String(parent.conversion) !== String(c.id) || !parent.images_count) return "";
        return '<div class="ta-conversion-tasks"><i class="fa fa-file-import"></i> In the dataset\'s task: <a href="' +
            esc(taskUrl(dashboard, parent)) + '">' + esc(parent.name) + "</a> (" + esc(parent.images_count + " images, " + taskStatusLabel(parent)) + ")</div>";
    }

    // WebODM's map of the dataset's project with a workset's mosaic laid on it by the Thermal Inspector (inspector.js)
    function mapUrl(c) {
        return "/map/project/" + encodeURIComponent(c.project) + "/?dt-mosaic=" + encodeURIComponent(c.dataset + "/" + c.id);
    }

    // A conversion's actions: the one its state calls for, and the others in its menu (menu: open; viewer: the URL of
    // its mosaics' page; taskless: in no task yet, so Create task, the next step, is shown beside it)
    function actionsHtml(c, canChange, base, menu, viewer, taskless) {
        var button = function (act, icon, label, title, cls, aria) {
            return '<button type="button" class="' + (cls || "") + '" data-act="' + act + '"' + (title ? ' title="' + esc(title) + '"' : "") +
                (aria ? ' aria-label="' + esc(aria + " " + c.name) + '"' : "") + '><i class="fa fa-' + icon + '"></i> ' + esc(label) + "</button>";
        };
        var link = function (href, icon, label, cls) {
            return '<a class="' + (cls || "") + '" href="' + esc(href) + '"><i class="fa fa-' + icon + '"></i> ' + esc(label) + "</a>";
        };
        var ready = c.status === "ready", busy = c.status === "converting", building = c.mosaic_status === "building";
        var download = c.file_count && !busy ? base + c.id + "/download" : null;
        var main = "", items = [];
        var mainCls = "btn btn-default btn-xs";
        var view = viewer && c.mosaic_status === "ready";
        if (busy || building) {
            if (canChange) main = button("cancel", "stop", "Cancel", busy ? "Stop converting" : "Stop building the mosaics", mainCls);
        } else if (ready && view) {
            main = link(viewer, "map", "View mosaics", "btn btn-primary btn-xs");
        } else if (ready && download) {
            main = link(download, "download", "Download all", "btn btn-primary btn-xs");
        } else {
            main = button("use", "copy", "Copy settings to form", USE_TITLE, mainCls);
        }
        var createTask = canChange && ready && !building;
        var task = function (cls) {
            return button("task", "plus", "Create task", "A new WebODM task of this workset's temperature TIFFs, in the dataset's project", cls);
        };
        if (createTask && taskless) main += " " + task(mainCls);
        if (download && !(ready && !view && !building)) items.push(link(download, "download", "Download all"));
        if (viewer && building) items.push(link(viewer, "map", "Mosaics"));
        if (view && !building && c.project_map) items.push(link(mapUrl(c), "globe", "Open on WebODM's map"));
        if (ready || busy) items.push(button("use", "copy", "Copy settings to form", USE_TITLE));
        if (createTask) {
            items.push(button("mosaics", "th", c.mosaic_status === "ready" ? "Build mosaics again" : "Build mosaics",
                "Place the converted frames side by side, as converted and harmonized"));
            if (!taskless) items.push(task());
            items.push(button("parent", "file-import", "Use for parent task",
                "Send this workset's temperature TIFFs to the dataset's own WebODM task, in place of the images sent there before"));
        }
        if (canChange) {
            items.push(button("rename", "pencil-alt", "Rename", null, null, "Rename"));
            items.push("divider");
            items.push(button("delete", "trash", "Delete", null, "text-danger", "Delete"));
        }
        return main + ' <span class="dropdown ta-menu' + (menu === c.id ? " open" : "") + '"><button type="button" class="btn btn-default btn-xs" data-act="menu" ' +
            'aria-haspopup="true" aria-expanded="' + (menu === c.id) + '" aria-label="More for ' + esc(c.name) + '" title="More">⋯</button>' +
            '<ul class="dropdown-menu dropdown-menu-right">' + items.map(function (i) {
                return i === "divider" ? '<li role="separator" class="divider"></li>' : "<li>" + i + "</li>";
            }).join("") + "</ul></span>";
    }

    // The worksets whose Files, or Mosaics, are shown on a dataset's page, kept in the browser (none at first)
    var FILES_PREFIX = "dji-thermal-analyzer:files-shown:";
    var MOSAICS_PREFIX = "dji-thermal-analyzer:mosaics-shown:";
    function shownFiles(storage, datasetId, prefix) {
        try {
            var v = JSON.parse((storage && storage.getItem((prefix || FILES_PREFIX) + datasetId)) || "[]");
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function keepShownFiles(storage, datasetId, ids, prefix) {
        try {
            if (ids.length) storage.setItem((prefix || FILES_PREFIX) + datasetId, JSON.stringify(ids));
            else storage.removeItem((prefix || FILES_PREFIX) + datasetId);
        } catch (e) { /* this page only */ }
    }

    // A workset's Files: a toggle over its table of what it wrote for each image
    function filesToggleHtml(c, shown) {
        return '<div class="ta-conversion-files-head"><button type="button" class="ta-collapse" data-act="files" aria-expanded="' + shown +
            '" title="' + (shown ? "Hide the files" : "Show what it wrote for each image") + '"><i class="fa fa-caret-' + (shown ? "down" : "right") +
            '"></i> Files</button></div>';
    }

    var MOSAIC_KINDS = {as_converted: "As converted", harmonized: "Harmonized"};

    // A workset's Mosaics, below its Files: a toggle over the mosaics' files to download, by mosaic ("" before any is
    // built)
    function mosaicFilesHtml(c, base, shown) {
        var files = c.mosaic_files || [];
        if (!files.length) return "";
        var kinds = [];
        files.forEach(function (f) {
            var kind = f.split("/")[0];
            if (kinds.indexOf(kind) < 0) kinds.push(kind);
        });
        return '<div class="ta-conversion-files-head"><button type="button" class="ta-collapse" data-act="mosaic-files" aria-expanded="' + shown +
            '" title="' + (shown ? "Hide the mosaics' files" : "Show the mosaics' files to download") + '"><i class="fa fa-caret-' + (shown ? "down" : "right") +
            '"></i> Mosaics</button> <span class="text-muted">' + esc(core.count(files.length, "file", "files")) + "</span></div>" +
            '<div class="ta-mosaic-files"' + (shown ? "" : " hidden") + ">" + kinds.map(function (kind) {
                return "<div><strong>" + esc(MOSAIC_KINDS[kind] || kind) + ":</strong> " + files.filter(function (f) { return f.split("/")[0] === kind; }).map(function (f) {
                    return '<a href="' + esc(base + c.id + "/download?mosaic=" + encodeURIComponent(f)) + '" title="' + esc(f) + '"><i class="fa fa-download"></i> ' +
                        esc(f.slice(kind.length + 1)) + "</a>";
                }).join(" ") + "</div>";
            }).join("") + "</div>";
    }

    // The dataset's conversions, newest first (base: their API's URL; open: the ids of those whose files are shown;
    // defaults: what their settings are compared against; menu: the conversion whose menu is open; viewerBase: their mosaics' pages, followed by their id;
    // dashboard: WebODM's dashboard, where their tasks are; parent: the dataset's own task; mosaicsOpen: the ids of those
    // whose mosaics' files are shown)
    function listHtml(conversions, canChange, base, open, fresh, defaults, menu, viewerBase, dashboard, parent, mosaicsOpen) {
        if (!conversions.length) return '<p class="text-muted ta-none">No worksets yet' + (canChange ? ": choose the settings above (the WebODM plan's " +
            "are a good start), then Create Workset." : ".") + "</p>";
        open = open || [];
        return conversions.map(function (c) {
            var cls = {ready: "success", failed: "danger", canceled: "default", converting: "info"}[c.status] || "default";
            var figures = [];
            if (c.status !== "converting") {
                if (c.converted || c.skipped) figures.push(c.converted + " converted" + (c.skipped ? ", " + c.skipped + " skipped" : ""));
                if (c.removed) figures.push(c.removed + " removed");
                figures.push(c.file_count + " file(s), " + core.formatBytes(c.size));
            }
            figures.push(core.formatDate(c.created_at) + (c.created_by ? " by " + c.created_by : ""));
            var progress = c.status === "converting" ? '<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' +
                Math.round((c.progress || 0) * 100) + '%;"></div></div>' + (c.progress ? "" : '<div class="text-muted">' +
                (harmonizes(c.settings || {}) ? "Harmonizing: " + (esc(core.stageText(c.stage)) || "comparing the frames' overlaps") + "…" :
                    (c.settings || {}).normalize ? "Normalizing: reading the frames' recorded temperatures…" :
                    "Starting…") + "</div>") : "";
            // What the conversion changed from the defaults, in its files' unit
            var settings = defaults && c.settings ? '<div class="ta-conversion-chips" title="' + esc(c.description) + '">' +
                chipsHtml(differences(c.settings, defaults, null, core.unitOf(c.settings.unit)), "dji-thermal-cli's defaults") + "</div>" :
                '<div class="text-muted">' + esc(c.description) + "</div>";
            return '<div class="ta-conversion' + (c.id === fresh ? " ta-conversion-new" : "") + '" data-id="' + c.id + '">' +
                '<div class="ta-conversion-head"><strong>' + esc(c.name) + '</strong> <span class="label label-' + cls + '">' + esc(statusLabel(c)) + "</span>" +
                '<span class="ta-conversion-actions">' + actionsHtml(c, canChange, base, menu, viewerBase ? viewerBase + c.id : null,
                    !(c.tasks || []).length && !parentHtml(c, parent, dashboard)) + "</span></div>" +
                settings + progress + mosaicHtml(c, canChange) +
                (c.error ? '<div class="text-danger">' + esc(c.error) + "</div>" : "") +
                '<div class="ta-conversion-figures text-muted">' + esc(figures.join(" · ")) + "</div>" +
                parentHtml(c, parent, dashboard) + tasksHtml(c, dashboard) + '<div class="ta-conversion-task" data-task="' + c.id + '"></div>' +
                filesToggleHtml(c, open.indexOf(c.id) >= 0) +
                '<div class="ta-conversion-files" data-files="' + c.id + '"' + (open.indexOf(c.id) >= 0 ? "" : " hidden") + "></div>" +
                mosaicFilesHtml(c, base, (mosaicsOpen || []).indexOf(c.id) >= 0) + "</div>";
        }).join("");
    }

    // Why images were skipped, most common first: [[reason, count]] (the reasons without their per-image details)
    function skipReasons(files) {
        var counts = {};
        files.forEach(function (f) {
            if (f.ok) return;
            var r = String(f.reason || "unknown").replace(/\s*\(.*\)\s*$/, "");
            counts[r] = (counts[r] || 0) + 1;
        });
        return Object.keys(counts).map(function (r) { return [r, counts[r]]; }).sort(function (a, b) { return b[1] - a[1]; });
    }

    var RESULT_COLUMNS = [{key: "path", label: "Image"}, {key: "result", label: "Result"}, {key: "min", label: "Min", num: true},
        {key: "max", label: "Max", num: true}, {key: "emissivity", label: "Emissivity", num: true}, {key: "reflected", label: "Reflected", num: true}, {key: "distance", label: "Distance", num: true}];

    // A conversion's images with their figures (c: the conversion as its detail has it, with its figures), sorted as
    // the view has them (view: {sort: a sortable RESULT_COLUMNS key, desc}; by image, ascending, at first)
    function resultRows(c, view) {
        view = view || {};
        var figures = c.figures || {};
        var rows = ((c.results || {}).files || []).map(function (f) {
            return Object.assign({}, f, figures[f.path] || {}, {result: f.ok ? "Converted" : "Skipped: " + (f.reason || "")});
        });
        return core.sortRows(rows, view.sort || "path", !!view.desc);
    }

    // How far measuring the frames' figures is, above the table ("" once they are)
    function figuresHtml(c) {
        if (c.figures_status === "measuring") {
            return '<p class="text-muted ta-figures-progress"><i class="fa fa-circle-notch fa-spin"></i> Measuring the frames for the table: ' +
                Math.round((c.figures_progress || 0) * 100) + "%…</p>";
        }
        if (c.figures_status === "failed") {
            return '<p class="text-warning ta-figures-progress">Could not measure the frames for the table: ' + esc(c.figures_error) +
                ' <button type="button" class="btn btn-default btn-xs" data-act="figures-again"><i class="fa fa-redo"></i> Measure again</button></p>';
        }
        return "";
    }

    // What a conversion wrote for each image, with its figures, sorted (view: {sort, desc} as resultRows', selected:
    // the paths selected, thumbs: the source frames' thumbnail URL, followed by the path); its detail pane beside it
    function resultsHtml(c, base, view) {
        view = view || {};
        var r = c.results || {};
        var files = r.files || [];
        if (!files.length) return '<p class="text-muted">' + (c.status === "canceled" ? "Canceled before it finished: no results were kept." : "No results.") + "</p>";
        var html = "";
        var n = r.normalization;
        if (n) {
            html += '<p class="ta-normalization">Normalized: ambient ' + esc(core.formatTemp(n.ambient_c, "C", 1)) +
                ", reflected " + esc(core.formatTemp(n.reflected_c, "C", 1)) + ", " + n.frames + " frame(s) compared" +
                (n.offset_min !== null && n.offset_min !== undefined ? ", offsets " + esc(core.formatNumber(core.convertDelta(n.offset_min, "C"), 2)) + " to " +
                    esc(core.formatDelta(n.offset_max, "C", 2)) : "") + (n.without_offset ? ", " + n.without_offset + " without an offset" : "") + ".</p>";
        }
        var reasons = skipReasons(files);
        if (reasons.length) html += '<p class="ta-skip-reasons">Skipped: ' + reasons.map(function (r) {
            return esc(r[0]) + " (" + r[1] + ")";
        }).join(", ") + ".</p>";
        html += figuresHtml(c);
        var sort = view.sort || "path", selected = view.selected || [];
        var rows = resultRows(c, view);
        var temp = function (v) { return esc(core.formatTemp(v, "C", 1)); };
        html += '<div class="ta-files-layout"><div class="ta-files-table"><div class="ta-table-scroll ta-results-scroll"><table class="table table-condensed ta-results"><thead><tr>' +
            (view.thumbs ? "<th></th>" : "") + RESULT_COLUMNS.map(function (col) {
                var arrow = sort === col.key ? ' <i class="fa fa-caret-' + (view.desc ? "down" : "up") + '"></i>' : "";
                return '<th data-sort="' + col.key + '"' + (col.num ? ' class="ta-num"' : "") + ' title="Sort by ' + esc(col.label.toLowerCase()) + '">' +
                    esc(col.label) + arrow + "</th>";
            }).join("") + "</tr></thead><tbody>" +
            rows.slice(0, RESULTS_SHOWN).map(function (f) {
                return '<tr class="' + (f.ok ? "" : "ta-skipped") + (selected.indexOf(f.path) >= 0 ? " ta-selected" : "") + '" data-path="' + esc(f.path) + '">' +
                    (view.thumbs ? '<td class="ta-thumb"><img loading="lazy" alt="" src="' + esc(view.thumbs + encodeURIComponent(f.path)) + '"></td>' : "") +
                    "<td>" + esc(f.path) + "</td><td>" +
                    (f.ok ? '<span class="text-success">Converted</span>' : '<span class="text-warning">Skipped</span>: ' + esc(f.reason)) +
                    '</td><td class="ta-num">' + temp(f.min) + '</td><td class="ta-num">' + temp(f.max) + '</td><td class="ta-num">' +
                    esc(core.formatNumber(f.emissivity, 2)) + '</td><td class="ta-num">' + temp(f.reflected) + '</td><td class="ta-num"' +
                    (f.distance_source ? ' title="' + esc(f.distance_source) + '"' : "") + ">" + esc(core.formatNumber(f.distance, 1, " m")) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        if (files.length > RESULTS_SHOWN) html += '<p class="text-muted">And ' + (files.length - RESULTS_SHOWN) + " more: download all to see them.</p>";
        html += '</div><aside class="ta-file-detail" hidden></aside></div>';
        return html;
    }

    // What a conversion's detail pane shows of one image, as [label, value] (values as shown, empty ones left out)
    function resultDetailRows(f) {
        var temp = function (v) { return core.formatTemp(v, "C", 1); };
        var rows = [["Result", f.ok ? "Converted" : "Skipped"], ["Reason", f.ok ? "" : f.reason], ["Min", temp(f.min)], ["Max", temp(f.max)],
            ["Mean", temp(f.mean)], ["Emissivity", core.formatNumber(f.emissivity, 2)], ["Reflected", temp(f.reflected)], ["Ambient", temp(f.ambient)],
            ["Humidity", core.formatNumber(f.humidity, 0, " %")],
            ["Distance", core.formatNumber(f.distance, 1, " m") + (f.distance_source && f.distance !== null && f.distance !== undefined ? " (" + f.distance_source + ")" : "")],
            ["Harmonizing offset", core.formatDelta(f.offset_c, "C", 2, true)]];
        (f.notes || []).forEach(function (n) { rows.push(["Note", n]); });
        return rows.filter(function (row) { return row[1] !== "" && row[1] !== null && row[1] !== undefined; });
    }

    // The detail pane's button removing the images shown from the workset (n of them), for those who can change it: once
    // it is converted, and not while its mosaics are being built
    function removeButtonHtml(c, n) {
        var building = c.mosaic_status === "building";
        return '<div class="ta-file-detail-remove"><button type="button" class="btn btn-default btn-xs text-danger" data-act="remove-frames"' +
            (building ? ' disabled title="Wait for the mosaics to be built, or cancel them"' :
                ' title="Delete ' + (n === 1 ? "its files" : "their files") + ' from the workset: new tasks and mosaics leave ' + (n === 1 ? "it" : "them") + ' out"') +
            '><i class="fa fa-trash"></i> ' + (n === 1 ? "Remove from workset" : "Remove " + n + " from workset") + "</button></div>";
    }

    // The detail pane of a conversion's images selected, or of the one under the mouse; "" for none (urls: {picture:
    // the dataset's thumbnail URL, palette: the user's preferred DJI palette or "", download: the conversion's
    // download URL, frameDownload: its frame download URL, frame: its frame page or null, canRemove: the user can
    // remove images from the workset})
    function resultDetailHtml(c, paths, selected, urls) {
        if (!paths.length) return "";
        var close = selected ? '<button type="button" class="close" data-act="detail-close" title="Unselect" aria-label="Unselect">&times;</button>' : "";
        var rows = resultRows(c, {});
        var remove = urls.canRemove && c.status === "ready" ? removeButtonHtml(c, paths.length) : "";
        if (paths.length > 1) {
            var outputs = rows.filter(function (f) { return paths.indexOf(f.path) >= 0; }).reduce(function (n, f) { return n + (f.outputs || []).length; }, 0);
            return '<div class="ta-file-detail-head"><strong>' + paths.length + " images selected</strong>" + close + "</div>" +
                (outputs ? '<button type="button" class="btn btn-primary btn-sm" data-act="download-selected"><i class="fa fa-download"></i> Download their ' +
                    outputs + " files</button>" : '<p class="text-muted">None of them was converted.</p>') +
                '<p class="text-muted ta-files-hint">As a zip of the files the workset wrote for them. Ctrl/Cmd-click adds or removes an image, Shift-click a range.</p>' + remove;
        }
        var f = rows.filter(function (x) { return x.path === paths[0]; })[0];
        if (!f) return "";
        var picture = urls.picture + (urls.picture.indexOf("?") >= 0 ? "&" : "?") + "size=large&" + (urls.palette ? "palette=" + encodeURIComponent(urls.palette) + "&" : "") + "file=" + encodeURIComponent(f.path);
        var frame = urls.frame && f.ok ? urls.frame + "?frame=" + encodeURIComponent(f.path) : null;
        var temperatures = f.ok ? ["csv", "tiff"].map(function (kind) {
            return '<a class="btn btn-default btn-xs" href="' + esc(urls.frameDownload + "?frame=" + encodeURIComponent(f.path) + "&kind=" + kind) +
                '" title="The frame\'s temperatures, as the workset measured it, in its unit"><i class="fa fa-download"></i> ' +
                (kind === "csv" ? "Temperatures (CSV)" : "Temperatures (float TIFF)") + "</a>";
        }).join(" ") : "";
        return '<div class="ta-file-detail-head"><strong title="' + esc(f.path) + '">' + esc(f.path.split("/").pop()) + "</strong>" + close + "</div>" +
            '<a href="' + esc(picture) + '" target="_blank" rel="noopener" data-act="view-picture" data-path="' + esc(f.path) +
                '" title="View the picture"><img class="ta-file-detail-img" alt="" src="' + esc(picture) + '"></a>' +
            '<div class="ta-file-detail-actions">' + (f.outputs || []).map(function (o) {
                return '<a class="btn btn-primary btn-xs" href="' + esc(urls.download + "?file=" + encodeURIComponent(o)) + '" title="' + esc(o) +
                    '"><i class="fa fa-download"></i> ' + esc(o.split("/").pop()) + "</a>";
            }).join(" ") + (temperatures ? " " + temperatures : "") +
            (frame ? ' <a class="btn btn-default btn-xs" href="' + esc(frame) + '"><i class="fa fa-th-large"></i> Open frame</a>' : "") + "</div>" +
            '<table class="table table-condensed ta-file-detail-table"><tbody>' + resultDetailRows(f).map(function (row) {
                return "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td></tr>";
            }).join("") + "</tbody></table>" + remove;
    }

    // ctx: {doc, fetchFn, api, csrf, datasetId, onChange (the dataset's conversions changed: reload it)}
    function init(ctx) {
        var doc = ctx.doc, fetchFn = ctx.fetchFn, root$ = function (i) { return doc.getElementById(i); };
        var base = ctx.api + "datasets/" + ctx.datasetId + "/conversions/";
        var viewerBase = ctx.publicUrl ? ctx.publicUrl + "dataset/" + ctx.datasetId + "/conversion/" : null;
        var meta = null, settings = null, saved = false, dataset = null, built = false, loading = null;
        var storage = ctx.storage !== undefined ? ctx.storage : root.localStorage;
        var open = shownFiles(storage, ctx.datasetId);    // the worksets whose Files are shown, kept in the browser
        var mosaicsOpen = shownFiles(storage, ctx.datasetId, MOSAICS_PREFIX);   // and whose Mosaics are
        var results = {}, sorts = {};                     // each one's files as loaded, and how its table is sorted
        var picks = {}, polls = {};                       // each one's images selected and under the mouse; its reload while measuring
        // The source frames' thumbnails and pictures, in the user's preferred DJI palette when they have one
        var palette = core.preferences().palette || "";
        // (a workset's own frames, even in a dataset never analyzed)
        var thumbnailUrl = ctx.api + "datasets/" + ctx.datasetId + "/thumbnail";
        var thumbsUrl = function (id) { return thumbnailUrl + "?workset=" + id + "&" + (palette ? "palette=" + encodeURIComponent(palette) + "&" : "") + "file="; };
        var fresh = null; // the conversion just started, highlighted for a few seconds
        var editing = null; // the form unfolded: at first only for a dataset without conversions, then once opened
        var menu = null;    // the conversion whose menu is open
        var task = null;    // the task panel open: {id, info, draft}
        var drawnWith;      // the analysis the form shows the recorded values of (its time)
        var fromUsed = false;   // the frame page's workset and changes (ctx.from) put in the form, once
        var panel = root$("ta-tab-convert");

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": ctx.csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson);
        }

        function message(text, cls) {
            var el = root$("ta-convert-message");
            el.className = "ta-convert-message" + (cls ? " " + cls : "");
            el.innerHTML = text || "";
        }

        // The form's sections kept open or closed as they were
        function renderForm() {
            var form = root$("ta-convert-form");
            var sections = built ? [].map.call(form.querySelectorAll("details.ta-section"), function (d) { return d.open; }) : null;
            form.innerHTML = formHtml(settings, meta, recorded(dataset && dataset.analysis));
            drawnWith = dataset && dataset.analyzed_at;
            if (sections) [].forEach.call(form.querySelectorAll("details.ta-section"), function (d, i) { d.open = sections[i]; });
            root$("ta-convert-origin").textContent = saved ? "Starting from your saved defaults." : "Starting from dji-thermal-cli's defaults.";
            built = true;
            if (editing === null) editing = !((dataset && dataset.conversions) || []).length;
            summarize();
        }

        function plan() {
            var args = dataset && ((dataset.analysis || {}).webodm || {}).process_args;
            return args && meta ? planSettings(args, meta.defaults) : null;
        }

        // The form's settings as chips, and its fields marked, against the defaults and the WebODM plan
        function summarize() {
            var form = root$("ta-convert-form");
            var diffs = differences(readForm(form), meta.defaults, plan(), core.userUnit());
            // Open or closed, the settings show what differs from the defaults; so does the Outputs section closed
            root$("ta-convert-summary").innerHTML = '<button type="button" class="ta-collapse" data-act="edit" aria-expanded="' + !!editing +
                '" aria-controls="ta-convert-form" title="' + (editing ? "Hide the settings" : "Show the settings") + '"><i class="fa fa-caret-' +
                (editing ? "down" : "right") + '"></i> Workset Creation Settings:</button> ' + chipsHtml(diffs, "dji-thermal-cli's defaults");
            var outputs = form.querySelector('[data-chips="outputs"]');
            if (outputs) {
                outputs.innerHTML = chipsHtml(diffs.filter(function (d) { return OUTPUT_KEYS.indexOf(d.key) >= 0; }), "the defaults", true);
            }
            form.hidden = !editing;
            markForm(form, diffs);
        }

        function closeMenu() {
            if (menu === null) return;
            menu = null;
            [].forEach.call(root$("ta-conversions").querySelectorAll(".ta-menu.open"), function (el) {
                el.classList.remove("open");
                el.querySelector('[data-act="menu"]').setAttribute("aria-expanded", "false");
            });
        }

        function renderList() {
            var list = (dataset && dataset.conversions) || [];
            root$("ta-convert-count").textContent = list.length || "";
            var el = taskPanel();
            if (el && task.info && el.querySelector('[name="task-name"]')) task.draft = readTaskForm(el, task.info).draft;
            root$("ta-conversions").innerHTML = listHtml(list, dataset && dataset.can_change, base, open, fresh,
                dataset && dataset.defaults, menu, viewerBase, ctx.dashboard, dataset && dataset.parent, mosaicsOpen);
            open.forEach(function (id) { renderFiles(id); loadFiles(id); });
            renderTask();
        }

        function taskPanel() {
            return task ? panel.querySelector('[data-task="' + task.id + '"]') : null;
        }

        function renderTask() {
            var el = taskPanel();
            if (el && task.info) el.innerHTML = taskHtml(task.info, task.draft);
            else if (el) el.innerHTML = '<p class="text-muted">Loading…</p>';
        }

        function taskMessage(text, cls) {
            var m = taskPanel() && taskPanel().querySelector(".ta-task-message");
            if (!m) return;
            m.className = "ta-task-message" + (cls ? " " + cls : "");
            m.innerHTML = text;
        }

        // The task panel of a conversion: what its task would be
        function openTask(id) {
            task = {id: id, info: null, draft: null};
            renderTask();
            return fetchFn(base + id + "/task", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!task || task.id !== id) return;
                if (!r.ok) {
                    task = null;
                    renderList();
                    return message(esc(core.errorText(r.data, "Could not load the task's options.")), "text-danger");
                }
                task.info = r.data;
                renderTask();
            });
        }

        function createTask() {
            var el = taskPanel();
            if (!el || !task.info) return;
            var form = readTaskForm(el, task.info);
            task.draft = form.draft;
            if (form.problem) return taskMessage(esc(form.problem), "text-danger");
            var btn = el.querySelector('[data-act="task-create"]');
            btn.disabled = true;
            return send(base + task.id + "/task", "POST", form.data).then(function (r) {
                btn.disabled = false;
                if (!r.ok) return taskMessage(esc(core.errorText(r.data, "Could not create the task.")), "text-danger");
                task = null;
                message('<i class="fa fa-check"></i> Task created: <a href="' + esc(taskUrl(ctx.dashboard, r.data)) + '">' + esc(r.data.name) +
                    "</a>, waiting for a processing node: open it and choose <em>Set a processing node</em> to start it.", "text-success");
                return ctx.onChange();
            });
        }

        // The conversion's TIFFs to the dataset's own task, once what it would replace is confirmed
        function useForParent(c) {
            var parent = (dataset && dataset.parent) || {};
            if (parent.busy) return message("The dataset's task is processing in WebODM: cancel it there first, or wait for it to finish.", "text-danger");
            return fetchFn(base + c.id + "/task", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return message(esc(core.errorText(r.data, "Could not check " + c.name + ".")), "text-danger");
                if (r.data.problems.length) return message(esc(r.data.problems.join(" ")), "text-danger");
                var text = ["Send " + c.name + "'s " + r.data.frames + " temperature TIFFs to the dataset's task, " + parent.name + "?"];
                if (parent.images_count) {
                    text.push("They replace the " + parent.images_count + " images sent there before" +
                        (parent.processed ? ", and what the task processed from them (its orthophoto, models and other results) is removed." : "."));
                }
                if (r.data.warnings.length) text.push("Note: " + r.data.warnings.join("; ") + ".");
                text.push("The task then waits for a processing node: you set it, and the task's options, in WebODM.");
                return core.ask(doc, "Use for parent task", text, parent.images_count ? "Replace" : "Send", parent.images_count ? "danger" : "primary");
            }).then(function (yes) {
                return yes === true && send(base + c.id + "/parent", "POST", {});
            }).then(function (r) {
                if (!r) return;
                if (!r.ok) return message(esc(core.errorText(r.data, "Could not send " + c.name + " to the dataset's task.")), "text-danger");
                message('<i class="fa fa-check"></i> ' + esc(r.data.images_count + " TIFFs of " + c.name + " are in the dataset's task, waiting for a processing node: ") +
                    '<a href="' + esc(taskUrl(ctx.dashboard, r.data)) + '">open ' + esc(r.data.name) + "</a> and choose <em>Set a processing node</em> " +
                    "to set its node and options, then process it.", "text-success");
                return ctx.onChange();
            });
        }

        function pick(id) {
            if (!picks[id]) picks[id] = {selected: [], anchor: null, hovered: null};
            return picks[id];
        }

        function filesPanel(id) { return panel.querySelector('[data-files="' + id + '"]'); }

        function renderFiles(id) {
            var el = filesPanel(id);
            if (el && results[id]) {
                el.innerHTML = resultsHtml(results[id], base, Object.assign({}, sorts[id], {selected: pick(id).selected, thumbs: thumbsUrl(id)}));
                renderDetail(id);
            } else if (el) el.innerHTML = '<p class="text-muted">Loading…</p>';
        }

        // A workset's detail pane: the images selected, else the one under the mouse
        function detailUrls(id) {
            return {picture: thumbnailUrl + "?workset=" + id, palette: palette, download: base + id + "/download", frameDownload: base + id + "/frame/download",
                    frame: viewerBase ? viewerBase + id + "/frame" : null, canRemove: !!(dataset && dataset.can_change)};
        }

        function renderDetail(id) {
            var el = filesPanel(id), pane = el && el.querySelector(".ta-file-detail");
            if (!pane || !results[id]) return;
            var p = pick(id);
            var paths = p.selected.length ? p.selected : p.hovered ? [p.hovered] : [];
            var html = resultDetailHtml(results[id], paths, p.selected.length > 0, detailUrls(id));
            pane.hidden = !html;
            if (pane.innerHTML !== html) pane.innerHTML = html;
        }

        // The selection changed: the rows marked (the table kept as it is, scrolled where it was) and the pane
        function selectionChanged(id) {
            var el = filesPanel(id);
            if (!el) return;
            [].forEach.call(el.querySelectorAll(".ta-results tbody tr[data-path]"), function (tr) {
                tr.classList.toggle("ta-selected", pick(id).selected.indexOf(tr.getAttribute("data-path")) >= 0);
            });
            renderDetail(id);
        }

        // A click on a row: it alone selected (unselected when it was), Ctrl/Cmd adds or removes it, Shift the range
        // from the last one clicked, in the table's order
        function selectRow(id, path, e) {
            var p = pick(id);
            if (e.shiftKey && p.anchor !== null) {
                var order = resultRows(results[id], sorts[id]).map(function (f) { return f.path; });
                var i = order.indexOf(p.anchor), j = order.indexOf(path);
                if (i >= 0 && j >= 0) {
                    p.selected = order.slice(Math.min(i, j), Math.max(i, j) + 1);
                    if (root.getSelection) root.getSelection().removeAllRanges();
                    return selectionChanged(id);
                }
            }
            if (e.ctrlKey || e.metaKey) {
                p.selected = p.selected.indexOf(path) >= 0 ? p.selected.filter(function (x) { return x !== path; }) : p.selected.concat([path]);
            } else {
                p.selected = p.selected.length === 1 && p.selected[0] === path ? [] : [path];
            }
            p.anchor = path;
            selectionChanged(id);
        }

        // The picture viewer, opened at an image's frame: the image shown is the one selected, its row scrolled to
        function viewPicture(id, path) {
            var viewer = root.ThermalPictureViewer;
            var urls = detailUrls(id);
            var items = resultRows(results[id], sorts[id]).map(function (f) {
                var src = urls.picture + (urls.picture.indexOf("?") >= 0 ? "&" : "?") + "size=large&" + (palette ? "palette=" + encodeURIComponent(palette) + "&" : "") + "file=" + encodeURIComponent(f.path);
                var first = (f.outputs || [])[0];
                return {name: f.path.split("/").pop(), path: f.path, src: src, download: first ? urls.download + "?file=" + encodeURIComponent(first) : src};
            });
            var index = items.map(function (it) { return it.path; }).indexOf(path);
            if (!viewer || index < 0) return false;
            viewer.open(doc, {items: items, index: index, onShow: function (i) {
                var p = pick(id), shown = items[i].path;
                p.anchor = shown;
                if (p.selected.length === 1 && p.selected[0] === shown) return;
                p.selected = [shown];
                selectionChanged(id);
                var tr = [].filter.call(filesPanel(id).querySelectorAll(".ta-results tbody tr[data-path]"), function (row) { return row.getAttribute("data-path") === shown; })[0];
                if (tr && tr.scrollIntoView) tr.scrollIntoView({block: "nearest"});
            }});
            return true;
        }

        // The selected images' files as a zip: a form posted, so the browser downloads it however many there are
        function downloadSelected(id) {
            var chosen = pick(id).selected;
            var files = [];
            resultRows(results[id], {}).forEach(function (f) { if (chosen.indexOf(f.path) >= 0) files = files.concat(f.outputs || []); });
            var form = doc.createElement("form");
            form.method = "POST";
            form.action = base + id + "/download";
            form.hidden = true;
            [["csrfmiddlewaretoken", ctx.csrf]].concat(files.map(function (f) { return ["file", f]; })).forEach(function (f) {
                var input = doc.createElement("input");
                input.type = "hidden";
                input.name = f[0];
                input.value = f[1];
                form.appendChild(input);
            });
            doc.body.appendChild(form);
            form.submit();
            doc.body.removeChild(form);
        }

        // The images the detail pane shows (those selected, else the one under the mouse) removed from the workset, once
        // confirmed: the table, the workset's figures and its mosaics' state then reloaded
        function removeFrames(id) {
            var p = pick(id), c = results[id];
            var paths = p.selected.length ? p.selected : p.hovered ? [p.hovered] : [];
            if (!paths.length || !c) return;
            var what = paths.length === 1 ? paths[0].split("/").pop() : paths.length + " images";
            var text = ["Remove " + what + " from " + c.name + "?",
                (paths.length === 1 ? "Its files are deleted, with the measurements saved on it. New tasks and mosaics leave it out; " :
                    "Their files are deleted, with the measurements saved on them. New tasks and mosaics leave them out; ") +
                    "the tasks made before keep their images."];
            if (c.mosaic_status === "ready") text.push("The mosaics stay as they were built until you build them again.");
            text.push("This cannot be undone.");
            return core.ask(doc, "Remove from workset", text, "Remove", "danger").then(function (yes) {
                return yes && send(base + id + "/remove", "POST", {frames: paths});
            }).then(function (r) {
                if (!r) return;
                if (!r.ok) return message(esc(core.errorText(r.data, "Could not remove the images from " + c.name + ".")), "text-danger");
                results[id] = r.data;
                p.selected = [];
                p.hovered = null;
                p.anchor = null;
                renderFiles(id);
                return ctx.onChange();
            });
        }

        // A workset's files; loaded again every few seconds while its frames are being measured
        function loadFiles(id) {
            clearTimeout(polls[id]);
            return fetchFn(base + id, {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return;
                results[id] = r.data;
                renderFiles(id);
                if (r.data.figures_status === "measuring") {
                    polls[id] = setTimeout(function () { if (open.indexOf(id) >= 0) loadFiles(id); }, FIGURES_POLL_MS);
                }
            });
        }

        // The settings and what can be chosen, loaded once, for those who can convert
        function loadPreferences() {
            loading = fetchFn(ctx.api + "preferences", {credentials: "same-origin"}).then(core.readJson).then(function (r) {
                if (!r.ok) return message("Could not load the settings.", "text-danger");
                meta = r.data;
                settings = r.data.settings;
                saved = r.data.saved;
                renderForm();
                useFrom();
            });
            return loading;
        }

        // The frame page's "New workset with these": the form has its workset's settings with the parameters changed
        function useFrom() {
            var c = ctx.from && !fromUsed && meta && dataset && (dataset.conversions || []).filter(function (x) { return String(x.id) === ctx.from.id; })[0];
            if (!c) return;
            fromUsed = true;
            settings = Object.assign({}, c.settings, ctx.from.changes);
            editing = true;
            renderForm();
            var changed = Object.keys(ctx.from.changes).map(function (k) { return k.replace(/_/g, " ") + " " + ctx.from.changes[k]; }).join(", ");
            message("The form has " + esc(c.name) + "'s settings" + (changed ? " with " + esc(changed) : "") + ", from the frame page. Create Workset when the settings are ready.", "text-muted");
        }

        function update(d) {
            dataset = d;
            setProductNames(d.product_names);
            root$("ta-convert-settings").hidden = !d.can_change;
            root$("ta-convert-plan").hidden = !((d.analysis || {}).webodm || {}).process_args;
            renderList();
            if (d.can_change && !loading) loadPreferences();
            else if (meta && !built) renderForm();
            else if (built && d.analyzed_at !== drawnWith) {
                // An analysis that finished since: its recorded values beside the fields, what was typed kept
                settings = readForm(root$("ta-convert-form"));
                renderForm();
            }
            return loading;
        }

        panel.addEventListener("change", function (e) {
            var t = e.target;
            if (t.name === "distance_mode") panel.querySelector('[name="distance"]').hidden = t.value !== "fixed";
            if (/^replace_(above|below)_nodata$/.test(t.name)) panel.querySelector('[name="' + t.name.replace("_nodata", "_value") + '"]').disabled = t.checked;
        });

        ["input", "change"].forEach(function (type) {
            root$("ta-convert-form").addEventListener(type, function () { if (meta) summarize(); });
        });

        root$("ta-convert-form").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-reset]") : null;
            if (!a || !meta) return;
            e.preventDefault();
            settings = resetSetting(readForm(root$("ta-convert-form")), meta.defaults, a.getAttribute("data-reset"));
            renderForm();
        });

        root$("ta-convert-summary").addEventListener("click", function (e) {
            if (!(e.target.closest && e.target.closest('[data-act="edit"]'))) return;
            editing = !editing;
            summarize();
        });

        doc.addEventListener("click", function (e) {
            if (menu !== null && !(e.target.closest && e.target.closest(".ta-menu"))) closeMenu();
        });
        doc.addEventListener("keydown", function (e) {
            if (e.key !== "Escape") return;
            closeMenu();
            // A picture viewer open takes the key itself
            if (doc.querySelector(".ta-picture")) return;
            Object.keys(picks).forEach(function (id) {
                if (!picks[id].selected.length) return;
                picks[id].selected = [];
                selectionChanged(id);
            });
        });

        // While none of its images is selected, a workset's detail pane follows the image under the mouse
        root$("ta-conversions").addEventListener("mouseover", function (e) {
            if (!e.target.closest) return;
            var tr = e.target.closest(".ta-results tbody tr[data-path]");
            var fid = tr ? filesOf(tr) : undefined;
            if (fid === undefined) return;
            var p = pick(fid);
            if (p.selected.length || tr.getAttribute("data-path") === p.hovered) return;
            p.hovered = tr.getAttribute("data-path");
            renderDetail(fid);
        });

        root$("ta-convert-start").addEventListener("click", function () {
            var s = readForm(root$("ta-convert-form"));
            if (formProblem(s)) return message(esc(formProblem(s)), "text-danger");
            var btn = root$("ta-convert-start");
            btn.disabled = true;
            send(base.replace(/\/$/, ""), "POST", {name: root$("ta-convert-name").value.trim(), settings: s})
                .then(function (r) {
                    btn.disabled = false;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not start the workset.")), "text-danger");
                    settings = s;
                    root$("ta-convert-name").value = "";
                    message("");
                    // The new conversion shows at once, before the dataset reloads
                    if (dataset && !dataset.conversions.some(function (c) { return c.id === r.data.id; })) dataset.conversions.unshift(r.data);
                    fresh = r.data.id;
                    renderList();
                    var card = root$("ta-conversions").querySelector('.ta-conversion[data-id="' + fresh + '"]');
                    if (card && card.scrollIntoView) card.scrollIntoView({block: "nearest", behavior: "smooth"});
                    setTimeout(function () {
                        fresh = null;
                        var el = root$("ta-conversions").querySelector(".ta-conversion-new");
                        if (el) el.classList.remove("ta-conversion-new");
                    }, 4000);
                    return ctx.onChange();
                });
        });

        root$("ta-convert-save").addEventListener("click", function () {
            var s = readForm(root$("ta-convert-form"));
            if (formProblem(s)) return message(esc(formProblem(s)), "text-danger");
            send(ctx.api + "preferences", "PUT", {settings: s}).then(function (r) {
                if (!r.ok) return message(esc(core.errorText(r.data, "Could not save your defaults.")), "text-danger");
                settings = r.data.settings;
                saved = true;
                renderForm();
                message('<i class="fa fa-check"></i> Saved: new worksets start from these settings.', "text-success");
            });
        });

        // The WebODM plan's settings in the form (marked as changed), without converting; false before the form is ready
        function usePlan() {
            var plan = (((dataset || {}).analysis || {}).webodm || {}).process_args;
            if (!meta || !plan) return false;
            settings = planSettings(plan, meta.defaults);
            renderForm();
            message("The form has the WebODM plan's settings: <code>" + esc(plan.join(" ")) + "</code>", "text-muted");
            return true;
        }

        // Settings from a finding on the Problems tab ({field: value}; what: their name), the rest of the form kept
        function useSettings(changes, what) {
            if (!meta) return false;
            settings = Object.assign(readForm(root$("ta-convert-form")), changes);
            editing = true;
            renderForm();
            message("Set in the form: " + esc(what) + ". Create Workset when the settings are ready.", "text-muted");
            return true;
        }

        root$("ta-convert-plan").addEventListener("click", usePlan);

        root$("ta-convert-reset").addEventListener("click", function () {
            core.ask(doc, "Reset defaults", "Go back to dji-thermal-cli's defaults? Your saved defaults are forgotten.", "Reset").then(function (yes) {
                return yes && send(ctx.api + "preferences", "DELETE");
            }).then(function (r) {
                if (!r) return;
                if (!r.ok) return message("Could not reset your defaults.", "text-danger");
                settings = r.data.settings;
                saved = false;
                renderForm();
                message("Back to dji-thermal-cli's defaults.", "text-muted");
            });
        });

        // The workset whose Files hold an element, or undefined
        function filesOf(el) {
            var files = el.closest("[data-files]");
            if (!files) return undefined;
            var attr = files.getAttribute("data-files");
            return ((dataset && dataset.conversions) || []).map(function (x) { return x.id; }).filter(function (x) { return String(x) === attr; })[0];
        }

        root$("ta-conversions").addEventListener("click", function (e) {
            var fid = e.target.closest ? filesOf(e.target) : undefined;
            if (fid !== undefined && results[fid]) {
                var th = e.target.closest(".ta-results th[data-sort]");
                if (th) {
                    var key = th.getAttribute("data-sort"), before = sorts[fid] || {sort: "path"};
                    sorts[fid] = {sort: key, desc: before.sort === key ? !before.desc : false};
                    return renderFiles(fid);
                }
                if (e.target.closest('[data-act="detail-close"]')) {
                    pick(fid).selected = [];
                    return selectionChanged(fid);
                }
                if (e.target.closest('[data-act="download-selected"]')) return downloadSelected(fid);
                if (e.target.closest('[data-act="remove-frames"]')) return removeFrames(fid);
                if (e.target.closest('[data-act="figures-again"]')) {
                    return send(base + fid + "/figures", "POST", {}).then(function (r) {
                        if (!r.ok) return message(esc(core.errorText(r.data, "Could not measure the frames again.")), "text-danger");
                        return loadFiles(fid);
                    });
                }
                // The pane's picture opens the viewer (Ctrl/Cmd-click, or the middle button, still opens a tab)
                var picture = e.target.closest('[data-act="view-picture"]');
                if (picture && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) {
                    if (viewPicture(fid, picture.getAttribute("data-path"))) e.preventDefault();
                    return;
                }
                var tr = e.target.closest(".ta-results tbody tr[data-path]");
                if (tr && !e.target.closest("a")) return selectRow(fid, tr.getAttribute("data-path"), e);
            }
            var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!btn) return;
            var attr = btn.closest(".ta-conversion").getAttribute("data-id");
            var c = ((dataset && dataset.conversions) || []).filter(function (x) { return String(x.id) === attr; })[0];
            if (!c) return;
            var id = c.id;
            var act = btn.getAttribute("data-act");
            if (act === "menu") {
                var was = menu;
                closeMenu();
                if (was === id) return;
                menu = id;
                btn.parentNode.classList.add("open");
                btn.setAttribute("aria-expanded", "true");
                return;
            }
            closeMenu();
            if (act === "task") {
                var shown = task && task.id === id;
                task = null;
                renderList();
                if (!shown) openTask(id);
            } else if (act === "task-create") {
                createTask();
            } else if (act === "task-plan") {
                if (!meta || !task || !task.info) return;
                settings = planSettings(task.info.process_args, c.settings);
                editing = true;
                renderForm();
                message("The form has " + esc(c.name) + "'s settings with the WebODM plan's: <code>" + esc(task.info.process_args.join(" ")) +
                    "</code>. Create the workset, then create the task from it.", "text-muted");
                if (root$("ta-convert-settings").scrollIntoView) root$("ta-convert-settings").scrollIntoView();
            } else if (act === "files") {
                open = open.indexOf(id) >= 0 ? open.filter(function (x) { return x !== id; }) : open.concat([id]);
                keepShownFiles(storage, ctx.datasetId, open);
                renderList();
            } else if (act === "mosaic-files") {
                mosaicsOpen = mosaicsOpen.indexOf(id) >= 0 ? mosaicsOpen.filter(function (x) { return x !== id; }) : mosaicsOpen.concat([id]);
                keepShownFiles(storage, ctx.datasetId, mosaicsOpen, MOSAICS_PREFIX);
                renderList();
            } else if (act === "parent") {
                useForParent(c);
            } else if (act === "use") {
                settings = c.settings;
                renderForm();
                message("The form has " + esc(c.name) + "'s settings.", "text-muted");
            } else if (act === "cancel") {
                send(base + id + "/cancel", "POST", {}).then(function (r) {
                    if (!r.ok) message(esc(core.errorText(r.data, "Could not cancel " + c.name + ".")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "mosaics") {
                send(base + id + "/mosaics", "POST", {}).then(function (r) {
                    if (!r.ok) message(esc(core.errorText(r.data, "Could not build the mosaics of " + c.name + ".")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "rename") {
                core.askName(doc, "Rename workset", c.name).then(function (name) {
                    return name && send(base + id, "PATCH", {name: name});
                }).then(function (r) {
                    if (!r) return;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not rename " + c.name + ".")), "text-danger");
                    return ctx.onChange();
                });
            } else if (act === "delete") {
                var kept = (c.tasks || []).length ? " The WebODM " + (c.tasks.length === 1 ? "task" : "tasks") + " made from it " +
                    (c.tasks.length === 1 ? "is" : "are") + " kept, with " + (c.tasks.length === 1 ? "its" : "their") + " images." : "";
                core.ask(doc, "Delete workset", "Delete " + c.name + " and its files?" + kept + " This cannot be undone.", "Delete", "danger").then(function (yes) {
                    return yes && send(base + id, "DELETE");
                }).then(function (r) {
                    if (!r) return;
                    if (!r.ok) return message(esc(core.errorText(r.data, "Could not delete the workset.")), "text-danger");
                    open = open.filter(function (x) { return x !== id; });
                    keepShownFiles(storage, ctx.datasetId, open);
                    mosaicsOpen = mosaicsOpen.filter(function (x) { return x !== id; });
                    keepShownFiles(storage, ctx.datasetId, mosaicsOpen, MOSAICS_PREFIX);
                    if (task && task.id === id) task = null;
                    return ctx.onChange();
                });
            }
        });

        return {update: update, usePlan: usePlan, useSettings: useSettings};
    }

    var api = {recorded: recorded, settingsIn: settingsIn, formHtml: formHtml, readForm: readForm, formProblem: formProblem, planSettings: planSettings, statusLabel: statusLabel,
               differences: differences, chipsHtml: chipsHtml, markForm: markForm, resetSetting: resetSetting,
               mosaicHtml: mosaicHtml, mapUrl: mapUrl, actionsHtml: actionsHtml, listHtml: listHtml, mosaicFilesHtml: mosaicFilesHtml, parentHtml: parentHtml, taskStatusLabel: taskStatusLabel, tasksHtml: tasksHtml,
               taskHtml: taskHtml, readTaskForm: readTaskForm, optionsFormHtml: optionsFormHtml, readOptions: readOptions, skipReasons: skipReasons, resultRows: resultRows, resultsHtml: resultsHtml,
               resultDetailRows: resultDetailRows, resultDetailHtml: resultDetailHtml, removeButtonHtml: removeButtonHtml, init: init};
    root.ThermalAnalyzerConversions = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
