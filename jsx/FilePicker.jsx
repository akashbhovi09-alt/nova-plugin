// =================================================================================
// ExtendScript (JSX) File System Handler & Grid Manager
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
    app.settings.saveSetting("CEP", prefKey, path);
    $._ext.baseDirPath = path;
}

// --- FOLDER SELECTION ---
$._ext.pickBaseFolder = function() {
    try {
        var baseFolder = Folder.selectDialog("Pick Presets Folder");
        if (baseFolder === null) return "ERROR:CANCELED";

        var presetsFolder = new Folder(baseFolder.fsName + "/" + "DTC_Presets");
        if (!presetsFolder.exists) presetsFolder.create();

        $._ext.storeBasePath(presetsFolder.fsName);
        return presetsFolder.fsName;
    } catch(e) {
        return "ERROR:" + e.toString();
    }
}

// --- FILE OPERATIONS ---
$._ext.readTextFile = function(filePath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    if (!file.exists) {
        if (filePath.endsWith("presets_index.json")) return "ERROR:INDEX_NOT_FOUND";
        return "ERROR:File not found at " + fullPath;
    }

    try {
        file.open("r");
        file.encoding = "UTF-8";
        var content = file.read();
        file.close();
        return content;
    } catch (e) {
        return "ERROR:Read failed: " + e.toString();
    }
}

$._ext.writeTextFile = function(filePath, content) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    try {
        var parentFolder = file.parent;
        if (!parentFolder.exists) parentFolder.create();

        file.open("w");
        file.encoding = "UTF-8";
        file.write(content);
        file.close();
        return "SUCCESS";
    } catch (e) {
        return "ERROR:Write failed: " + e.toString();
    }
}

$._ext.readBase64File = function(filePath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    if (!file.exists) return "ERROR:File not found " + fullPath;

    try {
        file.open('r');
        file.encoding = 'BINARY';
        var binaryContent = file.read();
        file.close();
        return binaryContent.toSource();
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

$._ext.copyFile = function(sourcePath, destRelPath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    
    var destFullPath = $._ext.baseDirPath + "/" + destRelPath;
    var sourceFile = new File(sourcePath);
    var destFile = new File(destFullPath);

    if (!sourceFile.exists) return "ERROR:Source file missing at " + sourcePath;

    try {
        var targetFolder = destFile.parent;
        if (!targetFolder.exists) {
            var foldersToCreate = [];
            var currentFolder = targetFolder;
            while (!currentFolder.exists) {
                foldersToCreate.push(currentFolder);
                currentFolder = currentFolder.parent;
                if (!currentFolder) break;
            }
            while (foldersToCreate.length > 0) {
                var folder = foldersToCreate.pop();
                if (!folder.create()) return "ERROR:Could not create folder " + folder.fsName;
            }
        }
        if (sourceFile.copy(destFile)) return "SUCCESS";
        else return "ERROR:Copy failed";
    } catch (e) {
        return "ERROR:Copy Exception: " + e.toString();
    }
}

// =================================================================================
// DTC GRID MANAGER (Snapshot & Renumbering)
// =================================================================================

$._ext.saveSnapshot = function() {
    try {
        // 1. Validate Base Path
        if (!$._ext.baseDirPath) $._ext.getStoredBasePath();
        if (!$._ext.baseDirPath) {
            return JSON.stringify({ status: "error", message: "Base path not set. Please pick a folder in Settings." });
        }

        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        if (!gridsFolder.exists) gridsFolder.create();

        // 2. Find "Grid" Comp
        var gridCompName = "Grid";
        var proj = app.project;
        if (!proj) return JSON.stringify({ status: "error", message: "No project open." });

        var gridComp = null;
        for (var i = 1; i <= proj.numItems; i++) {
            var item = proj.item(i);
            if (item instanceof CompItem && item.name === gridCompName) {
                gridComp = item;
                break;
            }
        }

        if (!gridComp) {
            return JSON.stringify({ status: "error", message: "Composition named 'Grid' was not found in the project." });
        }

        // 3. Determine Next ID (Scan existing numbers)
        var files = gridsFolder.getFiles();
        var maxId = 0;
        if (files) {
            for (var f = 0; f < files.length; f++) {
                var match = files[f].name.match(/^(\d+)\.(png|jpg)$/i);
                if (match) {
                    var fid = parseInt(match[1]);
                    if (fid > maxId) maxId = fid;
                }
            }
        }
        
        var newId = maxId + 1;
        var fileName = newId + ".png";
        var destFile = new File(gridsFolder.fsName + "/" + fileName);

        // 4. Save Image
        var originalRes = gridComp.resolutionFactor.slice();
        gridComp.resolutionFactor = [1, 1]; // Set resolution to Full for clear snapshot

        try {
            gridComp.saveFrameToPng(0, destFile);
        } catch (e) {
            gridComp.resolutionFactor = originalRes;
            return JSON.stringify({ status: "error", message: "SaveFrame failed: " + e.toString() });
        }
        gridComp.resolutionFactor = originalRes;

        return JSON.stringify({
            status: "success",
            id: newId,
            fileName: fileName
        });

    } catch(err) {
        return JSON.stringify({ status: "error", message: "Unexpected JSX Error: " + err.toString() });
    }
};

$._ext.getGridFiles = function() {
    try {
        if (!$._ext.baseDirPath) $._ext.getStoredBasePath();
        if (!$._ext.baseDirPath) return "[]";

        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        if (!gridsFolder.exists) return "[]";

        var files = gridsFolder.getFiles();
        if (!files) return "[]";

        var gridList = [];
        for (var f = 0; f < files.length; f++) {
            // Only accept Number.png (strict naming to avoid junk)
            var match = files[f].name.match(/^(\d+)\.png$/i);
            if (match) {
                gridList.push({
                    id: parseInt(match[1]),
                    fileName: files[f].name
                });
            }
        }
        // Sort numerically
        gridList.sort(function(a,b){ return a.id - b.id });

        return JSON.stringify(gridList);
    } catch(e) {
        return "[]";
    }
};

$._ext.deleteGridFile = function(fileName) {
    try {
        if (!$._ext.baseDirPath) return "ERROR:Base path not set";
        
        var gridsFolder = new Folder($._ext.baseDirPath + "/DTC_Grids");
        if (!gridsFolder.exists) return "ERROR: Grid folder missing";

        // 1. Delete the specific file
        var fileToDelete = new File(gridsFolder.fsName + "/" + fileName);
        if (fileToDelete.exists) {
            if(!fileToDelete.remove()) return "ERROR: Could not delete file (Locked?)";
        } else {
            // If file doesn't exist, we still proceed to renumbering/healing
        }

        // 2. SELF-HEALING RENUMBERING
        // Scan folder for ALL valid pngs
        var files = gridsFolder.getFiles();
        var remainingGrids = [];

        for (var i = 0; i < files.length; i++) {
            var m = files[i].name.match(/^(\d+)\.png$/i);
            if (m) {
                remainingGrids.push({
                    id: parseInt(m[1]),
                    file: files[i]
                });
            }
        }

        // Sort numerically (Critical)
        remainingGrids.sort(function(a,b){ return a.id - b.id });

        // Iterate and enforce sequential numbering (1, 2, 3...)
        for (var k = 0; k < remainingGrids.length; k++) {
            var grid = remainingGrids[k];
            var expectedId = k + 1;
            
            if (grid.id !== expectedId) {
                var newName = expectedId + ".png";
                // Only rename if it's different (File.rename() in ExtendScript works on disk)
                if (!grid.file.rename(newName)) {
                    // If rename fails, we abort renumbering to prevent data loss
                    return "ERROR: Renumbering failed at " + grid.id + " -> " + expectedId;
                }
            }
        }
        
        // Optional: Clean up grid_index.json if it exists (since we don't use it anymore)
        var legacyJson = new File(gridsFolder.fsName + "/grid_index.json");
        if (legacyJson.exists) legacyJson.remove();

        return "SUCCESS";

    } catch(e) {
        return "ERROR: " + e.toString();
    }
};

// Automatically try to load the path on script load
$._ext.getStoredBasePath();