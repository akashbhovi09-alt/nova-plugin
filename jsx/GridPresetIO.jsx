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

        var tiles = getTileLayers(grid);
        if (!tiles || tiles.length === 0) return "ERROR:No Tile layers found inside Grid";
        if (!preset || !preset.tileCount || preset.tileCount !== tiles.length) return "ERROR:Tile count mismatch";

        app.beginUndoGroup("Load Grid Preset");

        for (var i = 0; i < tiles.length; i++) {
            try { tiles[i].enabled = !!preset.tileVisibility[i]; } catch (e) {}
        }

        var controller = getLayerByName(grid, "Controller");
        if (controller && preset.controller) {
            setEffectValue(controller, "X space", preset.controller.xSpace);
            setEffectValue(controller, "Y space", preset.controller.ySpace);
            setEffectValue(controller, "Row", preset.controller.row);
            setEffectValue(controller, "Column", preset.controller.column);
            setEffectValue(controller, "Block Scale", preset.controller.blockScale);
            setEffectValue(controller, "Block Roundness", preset.controller.blockRound);
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
