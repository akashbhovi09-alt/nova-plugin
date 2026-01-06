// =================================================================================
// ExtendScript (JSX) File System Handler & Asset Manager
// =================================================================================

if (typeof $._ext === 'undefined') {
    $._ext = {};
}

$._ext.baseDirPath = null;

// --- PREFERENCE HANDLING ---
$._ext.getStoredBasePath = function() {
    var prefKey = "com.PSG.Nova.basePresetPath";
    if (app.settings.haveSetting("CEP", prefKey)) {
        $._ext.baseDirPath = app.settings.getSetting("CEP", prefKey);
        return $._ext.baseDirPath;
    }
    return "";
}

$._ext.storeBasePath = function(path) {
    var prefKey = "com.PSG.Nova.basePresetPath";
    var safePath = path.replace(/\\/g, "/");
    app.settings.saveSetting("CEP", prefKey, safePath);
    $._ext.baseDirPath = safePath;
}

// --- FOLDER OPERATIONS ---
$._ext.pickBaseFolder = function() {
    try {
        var baseFolder = Folder.selectDialog("Pick Presets Folder");
        if (baseFolder === null) return "ERROR:CANCELED";

        var path = baseFolder.fsName.replace(/\\/g, "/");
        if (path.indexOf("DTC_Presets") === -1) {
            path += "/DTC_Presets";
        }

        var presetsFolder = new Folder(path);
        if (!presetsFolder.exists) presetsFolder.create();

        $._ext.storeBasePath(presetsFolder.fsName);
        return presetsFolder.fsName;
    } catch(e) {
        return "ERROR:" + e.toString();
    }
}

$._ext.deleteFolder = function(relPath) {
    if (!$._ext.baseDirPath) return "ERROR:Path missing";
    var targetFolder = new Folder($._ext.baseDirPath + "/" + relPath);
    
    function recursiveDelete(folder) {
        if (!folder.exists) return;
        var files = folder.getFiles();
        for (var i = 0; i < files.length; i++) {
            if (files[i] instanceof Folder) {
                recursiveDelete(files[i]);
            } else {
                files[i].remove();
            }
        }
        folder.remove();
    }

    try {
        recursiveDelete(targetFolder);
        return "SUCCESS";
    } catch(e) {
        return "ERROR:" + e.toString();
    }
};

// --- FILE OPERATIONS ---
$._ext.readTextFile = function(filePath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);
    if (!file.exists) {
        if (filePath.indexOf("presets_index.json") !== -1) return "ERROR:INDEX_NOT_FOUND";
        return "ERROR:File not found";
    }
    try {
        file.open("r");
        file.encoding = "UTF-8";
        var content = file.read();
        file.close();
        return content;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

$._ext.writeTextFile = function(filePath, content) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);
    try {
        var parentFolder = file.parent;
        // Robust directory creation for nested paths
        if (!parentFolder.exists) {
            var foldersToCreate = [];
            var curr = parentFolder;
            while (curr && !curr.exists) {
                foldersToCreate.push(curr);
                curr = curr.parent;
            }
            while (foldersToCreate.length > 0) {
                foldersToCreate.pop().create();
            }
        }
        
        file.open("w");
        file.encoding = "UTF-8";
        file.write(content);
        file.close();
        return "SUCCESS";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

$._ext.copyFile = function(sourcePath, destRelPath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    
    var destFullPath = $._ext.baseDirPath + "/" + destRelPath;
    var sourceFile = new File(sourcePath);
    var destFile = new File(destFullPath);
    
    if (!sourceFile.exists) return "ERROR:Source file missing";
    
    try {
        var targetFolder = destFile.parent;
        // Robust directory creation for assets subfolder
        if (!targetFolder.exists) {
            var foldersToCreate = [];
            var curr = targetFolder;
            while (curr && !curr.exists) {
                foldersToCreate.push(curr);
                curr = curr.parent;
            }
            while (foldersToCreate.length > 0) {
                foldersToCreate.pop().create();
            }
        }

        if (destFile.exists) destFile.remove(); 
        
        if (sourceFile.copy(destFile)) {
            return "SUCCESS";
        } else {
            return "ERROR:Copy operation failed";
        }
    } catch (e) { return "ERROR:" + e.toString(); }
}

// Delete a single file by relative path inside the base directory.
// Additive helper used by UI "Save Changes" cleanup when thumbnails are removed.
$._ext.deleteFile = function(relPath) {
    try {
        if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
        if (!relPath) return "ERROR:Missing path";
        var fullPath = $._ext.baseDirPath + "/" + relPath;
        var f = new File(fullPath);
        if (!f.exists) return "SUCCESS"; // already gone
        return f.remove() ? "SUCCESS" : "ERROR:Delete failed";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

// --- GRID OPERATIONS ---
$._ext.saveSnapshot = function() {
    try {
        if (!$._ext.baseDirPath) return JSON.stringify({ status: "error", message: "Path missing" });
        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        if (!gridsFolder.exists) gridsFolder.create();

        var gridComp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "Grid") { 
                gridComp = app.project.item(i); 
                break; 
            }
        }
        
        if (!gridComp) return JSON.stringify({ status: "error", message: "Comp 'Grid' missing" });

        var files = gridsFolder.getFiles("*.png");
        var maxId = 0;
        for (var f = 0; f < files.length; f++) {
            var match = files[f].name.match(/^(\d+)\.png$/);
            if (match) {
                var fid = parseInt(match[1]);
                if (fid > maxId) maxId = fid;
            }
        }
        
        var newId = maxId + 1;
        var destFile = new File(gridsFolder.fsName + "/" + newId + ".png");
        
        var oldRes = gridComp.resolutionFactor;
        gridComp.resolutionFactor = [1, 1];
        gridComp.saveFrameToPng(0, destFile);
        gridComp.resolutionFactor = oldRes;

        return JSON.stringify({ status: "success", id: newId, fileName: newId + ".png" });
    } catch(e) { return JSON.stringify({ status: "error", message: e.toString() }); }
};

$._ext.getGridFiles = function() {
    try {
        if (!$._ext.baseDirPath) return "[]";
        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        if (!gridsFolder.exists) return "[]";
        
        var files = gridsFolder.getFiles("*.png");
        var gridList = [];
        for (var f = 0; f < files.length; f++) {
            var match = files[f].name.match(/^(\d+)\.png$/);
            if (match) {
                gridList.push({ id: parseInt(match[1]), fileName: files[f].name });
            }
        }
        
        gridList.sort(function(a,b){ return a.id - b.id });
        return JSON.stringify(gridList);
    } catch(e) { return "[]"; }
};

$._ext.deleteGridFile = function(fileName) {
    try {
        if (!$._ext.baseDirPath) return "ERROR:Path missing";
        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        // Requirement: JSON presets live inside DTC_Grids/DTC_GridPresets
        var presetsFolder = new Folder(gridsFolder.fsName + "/DTC_GridPresets");
        if (!presetsFolder.exists) {
            // Create if missing to keep structure consistent
            try { presetsFolder.create(); } catch (e) {}
        }

        // Delete the PNG + matching JSON (if present)
        var idMatch = (fileName || "").match(/^(\d+)\.png$/);
        var deletedId = idMatch ? parseInt(idMatch[1], 10) : null;
        var fileToDelete = new File(gridsFolder.fsName + "/" + fileName);
        if (fileToDelete.exists) fileToDelete.remove();

        if (deletedId !== null && !isNaN(deletedId)) {
            var jsonToDelete = new File(presetsFolder.fsName + "/" + deletedId + ".json");
            if (jsonToDelete.exists) jsonToDelete.remove();
        }

        var files = gridsFolder.getFiles("*.png");
        files.sort(function(a, b) {
            var nA = parseInt(a.name.match(/\d+/));
            var nB = parseInt(b.name.match(/\d+/));
            return nA - nB;
        });

        // IMPORTANT: keep JSON presets in sync with PNG renumbering
        // We use the sorted list as the canonical order and renumber both png + json.
        for (var k = 0; k < files.length; k++) {
            var oldMatch = files[k].name.match(/^(\d+)\.png$/);
            var oldId = oldMatch ? parseInt(oldMatch[1], 10) : null;
            var newId = k + 1;
            var expectedName = newId + ".png";

            if (files[k].name !== expectedName) {
                // Rename PNG
                files[k].rename(expectedName);
            }

            // Rename JSON if exists and id changed
            if (oldId !== null && !isNaN(oldId) && oldId !== newId) {
                var oldJson = new File(presetsFolder.fsName + "/" + oldId + ".json");
                if (oldJson.exists) {
                    try { oldJson.rename(newId + ".json"); } catch (e) {}
                }
            }
        }
        return "SUCCESS";
    } catch(e) { return "ERROR:" + e.toString(); }
};