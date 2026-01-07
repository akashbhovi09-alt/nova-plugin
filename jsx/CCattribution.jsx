// CCattribution.jsx (CEP helper)
// Updates "CC Attribution" comp from a list of image paths/names coming from CEP.
// The CC images are used ONLY as name references; nothing is imported into the project.
//
// CEP calls: $._ext.CCAttribution_applyFromCEP("{\"imagePaths\":[...]}" )

(function () {
    if (typeof $._ext === 'undefined') { $._ext = {}; }

    // ==================================================
    // CONFIG (mirrors your ScriptUI defaults)
    // ==================================================
    var H_SPACING = 1;
    var V_SPACING = 1;

    var FLICKR_KEYS = ["flckr", "flickr", "flicker", "fkr", "flick", "fcr", "flkr"];
    var YT_KEYS     = ["yt", "youtube", "ytb", "ytbe", "youtb", "ytube"];
    var IGNORE_KEYS = ["freepik", "freepick", "freepk", "fpk", "free", "fpick", "freepic", "fpic", "envato", "env", "ento", "evt", "envt", "envto", "en"];

    // ==================================================
    // HELPERS
    // ==================================================
    function findComp(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }

    function findKeyInfo(str, keys) {
        var lower = String(str || "").toLowerCase();
        for (var i = 0; i < keys.length; i++) {
            var k = String(keys[i] || "").toLowerCase();
            var idx = lower.indexOf(k);
            if (idx !== -1) return { index: idx, keyLength: k.length };
        }
        return null;
    }

    function extractUsernameRaw(originalName, keyInfo) {
        if (!keyInfo) return null;
        var after = originalName.substring(keyInfo.index + keyInfo.keyLength);
        after = after.replace(/^[_\-\s]+/, "");
        return after || null;
    }

    function getLayoutWidth() {
        var c = findComp("4x5");
        if (!c) return 1080;
        var l = c.layer("RATIO CTRL");
        if (!l) return 1080;
        var fx = l.effect("4:5");
        try {
            return (fx && fx.property("Checkbox").value) ? 2100 : 1080;
        } catch (e) {
            return 1080;
        }
    }

    function setText(layer, txt) {
        var td = layer.property("Source Text").value;
        td.text = txt;
        layer.property("Source Text").setValue(td);
    }

    function applyLayerPropertiesSafe(lyr, fontName, opacityVal, scaleVal, colorVal, fontSize) {
        try {
            var td = lyr.property("Source Text").value;

            // Font may not exist on the machine. Setting missing fonts can throw.
            if (fontName) {
                try { td.font = fontName; } catch (eFont) {}
            }

            td.fontSize = (typeof fontSize === "number") ? fontSize : 35;
            td.fillColor = colorVal || [0, 0, 0];
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            lyr.property("Source Text").setValue(td);

            if (scaleVal) lyr.property("Scale").setValue(scaleVal);
            else lyr.property("Scale").setValue([70, 70, 100]);

            lyr.property("Opacity").setValue((typeof opacityVal === "number") ? opacityVal : 100);
        } catch (e) {
            // Fail silently: never block the rest of the operation.
        }
    }

    function distributeCentered(layers, comp, layoutWidth) {
        if (!layers || !layers.length) return;

        var compCenterX = comp.width / 2;
        var layoutLeft = compCenterX - layoutWidth / 2;

        var rows = [];
        var currentRow = [];
        var currentWidth = 0;

        for (var i = 0; i < layers.length; i++) {
            var r = layers[i].sourceRectAtTime(0, false);
            if (currentRow.length && (currentWidth + H_SPACING + r.width > layoutWidth)) {
                rows.push(currentRow);
                currentRow = [];
                currentWidth = 0;
            }
            currentRow.push({ layer: layers[i], rect: r });
            currentWidth += (currentRow.length > 1 ? H_SPACING : 0) + r.width;
        }
        if (currentRow.length) rows.push(currentRow);

        var totalHeight = 0;
        var rowHeights = [];
        for (var rIdx = 0; rIdx < rows.length; rIdx++) {
            var maxH = 0;
            for (var j = 0; j < rows[rIdx].length; j++) {
                maxH = Math.max(maxH, rows[rIdx][j].rect.height);
            }
            rowHeights.push(maxH);
            totalHeight += maxH + (rIdx > 0 ? V_SPACING : 0);
        }

        var cursorY = (comp.height - totalHeight) / 2;
        for (var rr = 0; rr < rows.length; rr++) {
            var row = rows[rr];
            var rowWidth = 0;
            for (var k = 0; k < row.length; k++) {
                rowWidth += row[k].rect.width + (k > 0 ? H_SPACING : 0);
            }
            var cursorX = layoutLeft + (layoutWidth - rowWidth) / 2;
            for (var m = 0; m < row.length; m++) {
                var lyr = row[m].layer;
                var rect = row[m].rect;
                lyr.property("Position").setValue([cursorX + rect.width / 2, cursorY + rect.height / 2]);
                cursorX += rect.width + H_SPACING;
            }
            cursorY += rowHeights[rr] + V_SPACING;
        }
    }

    function basenameNoExt(pathOrName) {
        if (!pathOrName) return "";
        var s = String(pathOrName);
        try {
            // If it's a path, File(s).name is best.
            if (s.indexOf("/") !== -1 || s.indexOf("\\") !== -1) {
                s = File(s).name;
            }
        } catch (e) {}

        try { s = decodeURIComponent(s); } catch (e2) {}

        // strip extension
        s = s.replace(/\.[^\.]+$/, "");
        return s;
    }

    function buildAttributionStrings(imagePaths) {
        var attributions = [];
        var bugs = [];
        var uniqueTracker = {};

        for (var i = 0; i < imagePaths.length; i++) {
            var rawNameFull = basenameNoExt(imagePaths[i]);
            if (!rawNameFull) continue;

            var fkInfo = findKeyInfo(rawNameFull, FLICKR_KEYS);
            var ykInfo = findKeyInfo(rawNameFull, YT_KEYS);
            var info = fkInfo || ykInfo;

            if (!info) {
                // If no key found, report for manual entry
                bugs.push(rawNameFull);
                continue;
            }

            var prefix = rawNameFull.substring(0, info.index).toLowerCase();
            if (findKeyInfo(prefix, IGNORE_KEYS)) {
                // ignore entries that should not be credited
                continue;
            }

            var user = extractUsernameRaw(rawNameFull, info);
            if (!user) {
                bugs.push(rawNameFull);
                continue;
            }

            var finalStr = (fkInfo ? "Flickr.com/" : "Youtube.com/") + user;
            var key = finalStr.toLowerCase();
            if (!uniqueTracker[key]) {
                attributions.push(finalStr);
                uniqueTracker[key] = true;
            }
        }

        return { attributions: attributions, bugs: bugs };
    }

    function updateCCAttributionComp(imagePaths) {
        app.beginUndoGroup("Dynamic CC Attribution");

        var ccComp = findComp("CC Attribution");
        if (!ccComp) {
            app.endUndoGroup();
            return "ERROR: Comp 'CC Attribution' not found.";
        }

        var layoutWidth = getLayoutWidth();
        var data = buildAttributionStrings(imagePaths || []);
        var attributions = data.attributions;
        var bugs = data.bugs;

        // Collect existing attribution layers
        var existingAttLayers = [];
        for (var k = 1; k <= ccComp.numLayers; k++) {
            var lyr = ccComp.layer(k);
            if (lyr && lyr.name && lyr.name.indexOf("Attribution ") === 0) {
                existingAttLayers.push(lyr);
            }
        }

        existingAttLayers.sort(function (a, b) {
            var numA = parseInt(String(a.name).split(" ")[1], 10) || 0;
            var numB = parseInt(String(b.name).split(" ")[1], 10) || 0;
            return numA - numB;
        });

        // Ensure template exists
        var template = null;
        try { template = ccComp.layer("Attribution 1"); } catch (eT) {}
        if (!template) {
            template = ccComp.layers.addText("");
            template.name = "Attribution 1";
            applyLayerPropertiesSafe(template, "Roboto-Regular", 45, [70, 70, 100], [0, 0, 0], 35);
            template.moveToEnd();
        }

        // Delete all existing Attribution layers except template
        for (var e = existingAttLayers.length - 1; e >= 0; e--) {
            if (existingAttLayers[e] && existingAttLayers[e].name !== "Attribution 1") {
                try { existingAttLayers[e].remove(); } catch (eR) {}
            }
        }

        // Reset template and build fresh list
        setText(template, "");
        var freshLayers = [template];

        if (attributions.length > 0) {
            setText(template, attributions[0]);
            for (var d = 1; d < attributions.length; d++) {
                var newLyr = template.duplicate();
                newLyr.name = "Attribution " + (d + 1);
                setText(newLyr, attributions[d]);
                freshLayers.push(newLyr);
            }
        }

        // Result layer
        var resultLyr = null;
        try { resultLyr = ccComp.layer("Result"); } catch (eRes) {}
        if (!resultLyr) {
            resultLyr = ccComp.layers.addText("");
            resultLyr.name = "Result";
            resultLyr.guideLayer = true;
            resultLyr.moveToBeginning();
        }

        applyLayerPropertiesSafe(resultLyr, "Roboto-Bold", 100, [45, 45, 100], [0.5, 0, 0], 35);

        // Center result at top with padding
        try {
            var resRect = resultLyr.sourceRectAtTime(0, false);
            resultLyr.property("Position").setValue([ccComp.width / 2, 10 + resRect.height / 2]);
        } catch (ePos) {}

        // Move attribution layers after Result
        for (var l = freshLayers.length - 1; l >= 0; l--) {
            try {
                freshLayers[l].moveAfter(resultLyr);
            } catch (eMove) {}
        }

        distributeCentered(freshLayers, ccComp, layoutWidth);

        // Update result text
        if (resultLyr) {
            var msg = bugs.length ? ("[ " + bugs.join(", ") + " ] please enter manually") : "";
            setText(resultLyr, msg);
            try {
                var updatedResRect = resultLyr.sourceRectAtTime(0, false);
                resultLyr.property("Position").setValue([ccComp.width / 2, 10 + updatedResRect.height / 2]);
            } catch (ePos2) {}
        }

        app.endUndoGroup();
        return "OK";
    }

    // ==================================================
    // CEP EXPOSED ENTRY
    // ==================================================
    $._ext.CCAttribution_applyFromCEP = function (jsonStr) {
        try {
            var data = null;
            try {
                data = (jsonStr && jsonStr.length) ? JSON.parse(jsonStr) : null;
            } catch (eParse) {
                // If host passes an array directly as string
                data = null;
            }

            var imagePaths = [];
            if (data && data.imagePaths && data.imagePaths.length) {
                imagePaths = data.imagePaths;
            } else {
                // Fallback: if caller passed JSON array directly
                try {
                    var arr = JSON.parse(jsonStr);
                    if (arr && arr.length) imagePaths = arr;
                } catch (e2) {}
            }

            // Normalize + filter empties
            var cleaned = [];
            for (var i = 0; i < imagePaths.length; i++) {
                var s = String(imagePaths[i] || "");
                if (s) cleaned.push(s);
            }

            return updateCCAttributionComp(cleaned);
        } catch (e) {
            return "ERROR: CC Attribution failed: " + e.toString();
        }
    };

})();
