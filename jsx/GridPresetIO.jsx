// GridPresetIO.jsx
// --------------------------------------------------
// CEP-safe grid preset save/load logic (no UI)
// Saves/loads:
// - Tile layer enabled states (Tile comp layers inside Grid comp)
// - Controller & Advnc_Controller effect values
// - PARENT layer position
// --------------------------------------------------

(function () {
    if (typeof $._ext === 'undefined') { $._ext = {}; }

    function findCompByName(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }

    function getTileLayers(gridComp) {
        var arr = [];
        for (var i = 1; i <= gridComp.numLayers; i++) {
            var l = gridComp.layer(i);
            try {
                if (l && l.source && (l.source instanceof CompItem) && l.source.name === "Tile") {
                    arr.push(l);
                }
            } catch (e) {}
        }
        return arr;
    }

    // Ensure Grid comp has exactly (row*column) Tile layers.
    // IMPORTANT: duplication must preserve order, effects, expressions, parents.
    // We duplicate existing Tile layers (layer.duplicate()) which preserves
    // properties, expressions and parenting. We then move the duplicates so
    // the Tile stack remains contiguous and ordered.
    function syncTileCount(gridComp, requiredCount) {
        if (!gridComp) return { ok: false, error: "Missing Grid comp" };
        requiredCount = Math.max(0, Math.round(requiredCount || 0));

        var tiles = getTileLayers(gridComp);
        if (!tiles || tiles.length === 0) {
            return { ok: false, error: "No Tile layers found inside Grid" };
        }

        // If too many, delete extras from the end (highest index tile layers).
        if (tiles.length > requiredCount) {
            for (var i = tiles.length - 1; i >= requiredCount; i--) {
                try { tiles[i].remove(); } catch (e) {}
            }
        }

        // Re-fetch after deletions.
        tiles = getTileLayers(gridComp);

        // If too few, duplicate last tile repeatedly.
        if (tiles.length < requiredCount) {
            var safety = 0;
            while (tiles.length < requiredCount && safety < 5000) {
                safety++;
                var lastTile = tiles[tiles.length - 1];
                if (!lastTile) break;

                var dup = null;
                try { dup = lastTile.duplicate(); } catch (e) { dup = null; }
                if (!dup) break;

                // Keep ordering: ensure the new duplicate sits after the current last tile.
                try { dup.moveAfter(lastTile); } catch (e) {}

                // Update list by re-fetching (indices change).
                tiles = getTileLayers(gridComp);
            }
        }

        // Final check
        tiles = getTileLayers(gridComp);
        if (!tiles || tiles.length !== requiredCount) {
            return { ok: false, error: "Tile sync failed (have " + (tiles ? tiles.length : 0) + ", need " + requiredCount + ")" };
        }
        return { ok: true, count: tiles.length };
    }

    function getLayerByName(comp, name) {
        try { return comp.layer(name); } catch (e) { return null; }
    }

    function getEffectValue(layer, effectName) {
        try { return layer.effect(effectName)(1).value; } catch (e) { return null; }
    }

    function setEffectValue(layer, effectName, value) {
        try {
            if (value === null || typeof value === "undefined") return;
            layer.effect(effectName)(1).setValue(value);
        } catch (e) {}
    }

    function toInt(v, fallback) {
        var n = parseInt(v, 10);
        return (isFinite(n) ? n : fallback);
    }

    function readRowColFromController(gridComp, controllerLayerName) {
        var controller = getLayerByName(gridComp, controllerLayerName || "Controller");
        if (!controller) return null;
        var row = getEffectValue(controller, "Row");
        var col = getEffectValue(controller, "Column");
        row = toInt(row, null);
        col = toInt(col, null);
        if (row === null || col === null) return null;
        if (row < 0) row = 0;
        if (col < 0) col = 0;
        return { row: row, col: col, count: row * col };
    }

    // Ensures Tile layer count matches requiredCount.
    // Preserves: layer order (tiles remain contiguous), effects, expressions, parents.
    // Strategy:
    //  - If too many: remove extra tiles from the END.
    //  - If too few : duplicate the LAST tile, then move the duplicate AFTER the current last tile.
    function syncTileLayersToCount(gridComp, requiredCount) {
        if (!gridComp) return { ok: false, error: "Missing grid comp" };
        requiredCount = toInt(requiredCount, 0);
        if (requiredCount < 0) requiredCount = 0;

        var tiles = getTileLayers(gridComp);
        if (!tiles || tiles.length === 0) return { ok: false, error: "No Tile layers found inside Grid" };

        // Delete extra
        if (tiles.length > requiredCount) {
            for (var i = tiles.length - 1; i >= requiredCount; i--) {
                try { tiles[i].remove(); } catch (e) {}
            }
        }

        // Re-fetch after deletions
        tiles = getTileLayers(gridComp);

        // Duplicate missing
        while (tiles.length < requiredCount) {
            try {
                var last = tiles[tiles.length - 1];
                var dup = last.duplicate();
                // AE duplicates above the original; move it after the current last tile to keep order.
                try { dup.moveAfter(last); } catch (e2) {}
            } catch (e) {
                break;
            }
            tiles = getTileLayers(gridComp);
        }

        return { ok: (getTileLayers(gridComp).length === requiredCount), count: getTileLayers(gridComp).length };
    }

    function collectGridPresetData() {
        var grid = findCompByName("Grid");
        if (!grid) return { ok: false, error: "Comp 'Grid' missing" };

        var tiles = getTileLayers(grid);
        if (!tiles || tiles.length === 0) return { ok: false, error: "No Tile layers found inside Grid" };

        var tileState = [];
        for (var i = 0; i < tiles.length; i++) {
            tileState.push(!!tiles[i].enabled);
        }

        var controller = getLayerByName(grid, "Controller");
        var controllerData = controller ? {
            xSpace: getEffectValue(controller, "X space"),
            ySpace: getEffectValue(controller, "Y space"),
            row: getEffectValue(controller, "Row"),
            column: getEffectValue(controller, "Column"),
            blockScale: getEffectValue(controller, "Block Scale"),
            blockRound: getEffectValue(controller, "Block Roundness")
        } : null;

        var adv = getLayerByName(grid, "Advnc_Controller");
        var advData = adv ? {
            blocksColor: getEffectValue(adv, "Blocks Color"),
            numberColor: getEffectValue(adv, "Number Color"),
            numberOffset: getEffectValue(adv, "Number offset"),
            numberScale: getEffectValue(adv, "Number Scale"),
            strokeWidth: getEffectValue(adv, "Block Stroke Width"),
            strokeColor: getEffectValue(adv, "Blocks Stroke color")
        } : null;

        var parent = getLayerByName(grid, "PARENT");
        var parentPos = null;
        try { parentPos = parent ? parent.transform.position.value : null; } catch (e) {}

        return {
            ok: true,
            data: {
                tileVisibility: tileState,
                tileCount: tiles.length,
                controller: controllerData,
                advController: advData,
                parentPosition: parentPos
            }
        };
    }

    function applyGridPresetData(preset) {
        var grid = findCompByName("Grid");
        if (!grid) return "ERROR:Comp 'Grid' missing";

        if (!preset) return "ERROR:Missing preset";

        // Determine required tiles from preset row/column (preferred), else fallback to tileCount.
        var req = 0;
        try {
            if (preset.controller) {
                var pr = toInt(preset.controller.row, null);
                var pc = toInt(preset.controller.column, null);
                if (pr !== null && pc !== null) req = pr * pc;
            }
            if ((req <= 0) && (typeof preset.tileCount !== "undefined" && preset.tileCount !== null)) {
                req = toInt(preset.tileCount, 0);
            }
        } catch (e) { req = 0; }

        app.beginUndoGroup("Load Grid Preset");

        // Apply controller first (so expressions depending on Row/Column settle), then sync tiles.
        var controller = getLayerByName(grid, "Controller");
        if (controller && preset.controller) {
            setEffectValue(controller, "X space", preset.controller.xSpace);
            setEffectValue(controller, "Y space", preset.controller.ySpace);
            setEffectValue(controller, "Row", preset.controller.row);
            setEffectValue(controller, "Column", preset.controller.column);
            setEffectValue(controller, "Block Scale", preset.controller.blockScale);
            setEffectValue(controller, "Block Roundness", preset.controller.blockRound);
        }

        // Sync tile count to Row*Column (or fallback).
        if (req > 0) {
            var syncRes = syncTileLayersToCount(grid, req);
            if (!syncRes.ok) {
                app.endUndoGroup();
                return "ERROR:" + syncRes.error;
            }
        }

        var tiles = getTileLayers(grid);
        if (!tiles || tiles.length === 0) {
            app.endUndoGroup();
            return "ERROR:No Tile layers found inside Grid";
        }

        // Apply visibility safely (handle older presets)
        var vis = preset.tileVisibility || [];
        for (var i = 0; i < tiles.length; i++) {
            var v = (i < vis.length) ? !!vis[i] : true;
            try { tiles[i].enabled = v; } catch (e) {}
        }

        var adv = getLayerByName(grid, "Advnc_Controller");
        if (adv && preset.advController) {
            setEffectValue(adv, "Blocks Color", preset.advController.blocksColor);
            setEffectValue(adv, "Number Color", preset.advController.numberColor);
            setEffectValue(adv, "Number offset", preset.advController.numberOffset);
            setEffectValue(adv, "Number Scale", preset.advController.numberScale);
            setEffectValue(adv, "Block Stroke Width", preset.advController.strokeWidth);
            setEffectValue(adv, "Blocks Stroke color", preset.advController.strokeColor);
        }

        var parent = getLayerByName(grid, "PARENT");
        if (parent && preset.parentPosition) {
            try { parent.transform.position.setValue(preset.parentPosition); } catch (e) {}
        }

        app.endUndoGroup();
        return "SUCCESS";
    }

    // CEP-callable: save PNG snapshot + matching JSON preset
    $._ext.saveSnapshotAndPreset = function () {
        try {
            if (!$._ext.baseDirPath) return JSON.stringify({ status: "error", message: "Path missing" });
            if (typeof $._ext.saveSnapshot !== "function") {
                return JSON.stringify({ status: "error", message: "Missing saveSnapshot()" });
            }

            // Before snapshotting, normalize Tile count to Row*Column (delete extras / duplicate missing)
            var grid = findCompByName("Grid");
            if (!grid) return JSON.stringify({ status: "error", message: "Comp 'Grid' missing" });

            var controller = getLayerByName(grid, "Controller");
            var rc = readRowColFromController(grid, "Controller");
            var required = rc ? rc.count : 0;

            if (required > 0) {
                app.beginUndoGroup("Sync Tiles Before Save");
                var syncRes = syncTileLayersToCount(grid, required);
                app.endUndoGroup();
                if (!syncRes.ok) {
                    return JSON.stringify({ status: "error", message: syncRes.error });
                }
            }

            // Let AE update after layer add/remove before snapshot
            try { $.sleep(50); } catch (e) {}

            var snapStr = $._ext.saveSnapshot();
            var snap = {};
            try { snap = JSON.parse(snapStr); } catch (e) { snap = { status: "error", message: "Invalid snapshot response" }; }
            if (!snap || snap.status !== "success") return JSON.stringify(snap);

            var collected = collectGridPresetData();
            if (!collected.ok) {
                return JSON.stringify({ status: "error", message: collected.error, id: snap.id, fileName: snap.fileName });
            }

            // Requirement: presets folder must live inside DTC_Grids
            // DTC_Grids/DTC_GridPresets/<id>.json
            var relPath = "DTC_Grids/DTC_GridPresets/" + snap.id + ".json";
            var jsonStr = JSON.stringify(collected.data);
            var writeRes = $._ext.writeTextFile(relPath, jsonStr);
            if (writeRes !== "SUCCESS") {
                return JSON.stringify({ status: "error", message: "Preset write failed: " + writeRes, id: snap.id, fileName: snap.fileName });
            }

            return JSON.stringify({ status: "success", id: snap.id, fileName: snap.fileName, presetFile: snap.id + ".json" });
        } catch (e) {
            return JSON.stringify({ status: "error", message: e.toString() });
        }
    };

    // CEP-callable: load preset by id
    $._ext.loadGridPresetById = function (id) {
        try {
            if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
            if (id === null || typeof id === "undefined") return "ERROR:Missing id";

            // Requirement: presets folder must live inside DTC_Grids
            var relPath = "DTC_Grids/DTC_GridPresets/" + id + ".json";
            var txt = $._ext.readTextFile(relPath);
            if (!txt || (typeof txt === "string" && txt.indexOf("ERROR:") === 0)) return txt || "ERROR:Read failed";

            var preset = null;
            try { preset = JSON.parse(txt); } catch (e) { return "ERROR:Invalid JSON"; }
            return applyGridPresetData(preset);
        } catch (e) {
            return "ERROR:" + e.toString();
        }
    };
})();
