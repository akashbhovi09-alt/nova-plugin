// CCattribution.jsx (CEP host helper)
// Headless attribution generator for NOVA CEP extension.
// Exposes: $._ext.CCAttribution_applyFromCEP(payloadJson)
//
// payloadJson: JSON string with shape { imagePaths: [ "name_or_path.png", ... ] }
// Only the file name is used; nothing is imported into the project.

(function () {
    if (typeof $ === "undefined") return;

    if (typeof $._ext === "undefined") { $._ext = {}; }

    // ==================================================
    // CONFIGURABLE LAYOUT CONSTANTS (User Editable)
    // ==================================================
    var WIDTH_4X5_CHECKED   = 1600; // 4x5 checked max width
    var WIDTH_4X5_UNCHECKED = 1200; // 4x5 unchecked max width
    var MARGIN_SIDE         = 5;    // safe margin (left & right)

    var FIXED_H_SPACING = 10;       // horizontal space between names
    var FIXED_V_SPACING = 5;        // vertical space between rows

    // ==================================================
    // LOGIC HELPERS (from your fixed ScriptUI version)
    // ==================================================
    var FLICKR_KEYS = ["flckr", "flickr", "flicker", "fkr", "flick", "fcr", "flkr"];
    var YT_KEYS     = ["yt", "youtube", "ytb", "ytbe", "youtb", "ytube"];
    var IGNORE_KEYS = ["freepik", "freepick", "freepk", "fpk", "free", "fpick", "freepic", "fpic", "envato", "env", "ento", "evt", "envt", "envto", "en"];

    function findComp(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }

    function findKeyInfo(str, keys) {
        var lower = String(str).toLowerCase();
        for (var i = 0; i < keys.length; i++) {
            var k = String(keys[i]).toLowerCase();
            var idx = lower.indexOf(k);
            if (idx !== -1) return { index: idx, keyLength: k.length };
        }
        return null;
    }

    function extractUsernameRaw(originalName, keyInfo) {
        if (!keyInfo) return null;

        var after = originalName.substring(keyInfo.index + keyInfo.keyLength);

        // Ignore domain endings immediately after keyword (e.g. "Flickr.com_Joe" -> "Joe")
        after = after.replace(/^(\.com|\.in|\.net|\.org|\.co)/i, "");

        // Clean leading separators
        after = after.replace(/^[_\-\s]+/, "");

        return after || null;
    }

    function getLayoutWidth() {
        var c = findComp("4x5");
        var baseWidth = WIDTH_4X5_UNCHECKED;

        if (c) {
            var l = c.layer("RATIO CTRL");
            if (l) {
                var fx = l.effect("4:5");
                var isChecked = (fx && fx.property("Checkbox").value);
                baseWidth = isChecked ? WIDTH_4X5_CHECKED : WIDTH_4X5_UNCHECKED;
            }
        }

        return baseWidth - (MARGIN_SIDE * 2);
    }

    function setText(layer, txt) {
        var td = layer.property("Source Text").value;
        td.text = txt;
        layer.property("Source Text").setValue(td);
    }

    // Font-safe application (prevents missing-font crashes)
    function safeSetFont(td, fontName) {
        if (!fontName) return;
        try { td.font = fontName; } catch (e) {}
    }

    function applyLayerProperties(lyr, fontName, opacityVal, scaleVal, colorVal) {
        var td = lyr.property("Source Text").value;

        safeSetFont(td, fontName);
        td.fontSize = 35;
        td.fillColor = colorVal || [0, 0, 0];
        td.justification = ParagraphJustification.CENTER_JUSTIFY;

        // Set tracking to 0 (your bug fix)
        td.tracking = 0;

        lyr.property("Source Text").setValue(td);
        lyr.property("Scale").setValue(scaleVal || [70, 70, 100]);
        lyr.property("Opacity").setValue(opacityVal);
    }

    /**
     * Strictly fixed distribution logic.
     * Places items in rows until layoutWidth is reached, then centers each row and the whole block.
     */
    function distributeCentered(layers, comp, layoutWidth, hSpace, vSpace) {
        if (!layers || !layers.length) return;

        var compCenterX = comp.width / 2;
        var rows = [];
        var currentRow = [];
        var currentWidth = 0;

        // Step 1: Divide into rows based on fixed gap and layoutWidth
        for (var i = 0; i < layers.length; i++) {
            var lyr = layers[i];
            var rect = lyr.sourceRectAtTime(0, false);

            if (currentRow.length > 0 && (currentWidth + hSpace + rect.width > layoutWidth)) {
                rows.push({ items: currentRow, width: currentWidth });
                currentRow = [];
                currentWidth = 0;
            }

            currentRow.push({ layer: lyr, rect: rect });
            currentWidth += (currentRow.length > 1 ? hSpace : 0) + rect.width;
        }
        if (currentRow.length > 0) rows.push({ items: currentRow, width: currentWidth });

        // Step 2: Calculate heights
        var totalHeight = 0;
        for (var rIdx = 0; rIdx < rows.length; rIdx++) {
            var maxH = 0;
            for (var j = 0; j < rows[rIdx].items.length; j++) {
                maxH = Math.max(maxH, rows[rIdx].items[j].rect.height);
            }
            rows[rIdx].height = maxH;
            totalHeight += maxH + (rIdx > 0 ? vSpace : 0);
        }

        // Step 3: Set Positions
        var cursorY = (comp.height - totalHeight) / 2;

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var cursorX = compCenterX - (row.width / 2);

            for (var m = 0; m < row.items.length; m++) {
                var item = row.items[m];
                var lyr2 = item.layer;
                var rect2 = item.rect;

                var xPos = cursorX - rect2.left;
                var yPos = cursorY + (row.height / 2) - (rect2.top + rect2.height / 2);

                lyr2.property("Position").setValue([xPos, yPos]);
                cursorX += rect2.width + hSpace;
            }
            cursorY += row.height + vSpace;
        }
    }

    function normalizeToFileName(p) {
        if (!p) return "";
        var s = String(p);
        s = s.replace(/\\/g, "/");
        var parts = s.split("/");
        return parts[parts.length - 1];
    }

    // ==================================================
    // CEP ENTRYPOINT
    // ==================================================
    $._ext.CCAttribution_applyFromCEP = function (payloadJson) {
        if (!app.project) return "ERROR:No project";

        var payload = null;
        try { payload = JSON.parse(payloadJson); } catch (e) { payload = null; }

        var imgList = [];
        if (payload && payload.imagePaths && payload.imagePaths.length) {
            imgList = payload.imagePaths;
        } else if (payload && payload.images && payload.images.length) {
            imgList = payload.images;
        } else if (payload && payload.length) {
            imgList = payload; // allow direct array
        } else {
            imgList = [];
        }

        app.beginUndoGroup("Dynamic CC Attribution");

        try {
            var ccComp = findComp("CC Attribution");
            if (!ccComp) {
                app.endUndoGroup();
                return "ERROR:Comp 'CC Attribution' not found.";
            }

            var layoutWidth = getLayoutWidth();

            var attributions = [];
            var bugs = [];
            var uniqueTracker = {};

            for (var i = 0; i < imgList.length; i++) {
                var rawNameFull = decodeURIComponent(normalizeToFileName(imgList[i]));
                if (!rawNameFull) continue;

                // remove extension
                var rawName = rawNameFull.replace(/\.[^\.]+$/, "");

                var fkInfo = findKeyInfo(rawName, FLICKR_KEYS);
                var ykInfo = findKeyInfo(rawName, YT_KEYS);
                var info = fkInfo || ykInfo;

                if (!info) { bugs.push(rawNameFull); continue; }

                var prefix = rawName.substring(0, info.index).toLowerCase();
                if (findKeyInfo(prefix, IGNORE_KEYS)) continue;

                var user = extractUsernameRaw(rawName, info);
                if (!user) { bugs.push(rawNameFull); continue; }

                var finalStr = (fkInfo ? "Flickr.com/" : "Youtube.com/") + user;

                var key = finalStr.toLowerCase();
                if (!uniqueTracker[key]) {
                    attributions.push(finalStr);
                    uniqueTracker[key] = true;
                }
            }

            // Collect existing attribution layers (robust):
            // Different projects may name them "Attribution I", "Attribution1", etc.
            // We treat ANY layer whose name starts with "Attribution" (case-insensitive) as an attribution layer.
            var existingAttLayers = [];
            for (var k = 1; k <= ccComp.numLayers; k++) {
                var lyr = ccComp.layer(k);
                if (!lyr) continue;
                if (/^attribution/i.test(String(lyr.name))) existingAttLayers.push(lyr);
            }

            // Prefer an existing "Attribution 1" as template; otherwise reuse the first attribution layer found.
            var template = ccComp.layer("Attribution 1");
            if (!template && existingAttLayers.length > 0) {
                template = existingAttLayers[0];
                try { template.name = "Attribution 1"; } catch (_) {}
            }
            if (!template) {
                template = ccComp.layers.addText("");
                template.name = "Attribution 1";
                template.moveToEnd();
            }

            // Remove ALL other attribution layers so every run is fresh.
            for (var e = existingAttLayers.length - 1; e >= 0; e--) {
                var ly = existingAttLayers[e];
                if (!ly) continue;
                if (ly === template) continue;
                try { ly.remove(); }
                catch (rmErr) {
                    // Fallback: if locked / protected, neutralize it so stale text can't show.
                    try { setText(ly, ""); } catch (_) {}
                    try { ly.enabled = false; } catch (_) {}
                }
            }

            // Ensure template is enabled for this run
            try { template.enabled = true; } catch (_) {}

            // Reset template
            setText(template, "");
            applyLayerProperties(template, "Roboto-Regular", 45, [70, 70, 100], [0, 0, 0]);

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
            var resultLyr = ccComp.layer("Result");
            if (!resultLyr) {
                resultLyr = ccComp.layers.addText("");
                resultLyr.name = "Result";
                resultLyr.guideLayer = true;
                resultLyr.moveToBeginning();
            }

            applyLayerProperties(resultLyr, "Roboto-Bold", 100, [45, 45, 100], [0.5, 0, 0]);

            // Position result near top
            var resRect = resultLyr.sourceRectAtTime(0, false);
            resultLyr.property("Position").setValue([ccComp.width / 2, 10 + resRect.height / 2]);

            // Keep attributions after Result layer
            for (var l = freshLayers.length - 1; l >= 0; l--) {
                try { freshLayers[l].moveAfter(resultLyr); } catch (mvErr) {}
            }

            // Sort fresh layers by width (as in your logic) before distributing
            freshLayers.sort(function (a, b) {
                return b.sourceRectAtTime(0, false).width - a.sourceRectAtTime(0, false).width;
            });

            distributeCentered(freshLayers, ccComp, layoutWidth, FIXED_H_SPACING, FIXED_V_SPACING);

            // Update Result text
            if (resultLyr) {
                setText(resultLyr, bugs.length ? "[ " + bugs.join(", ") + " ] please enter manually" : "");
                var updatedResRect = resultLyr.sourceRectAtTime(0, false);
                resultLyr.property("Position").setValue([ccComp.width / 2, 10 + updatedResRect.height / 2]);
            }

        } catch (err) {
            app.endUndoGroup();
            return "ERROR:" + err.toString();
        }

        app.endUndoGroup();
        return "OK";
    };

})();
