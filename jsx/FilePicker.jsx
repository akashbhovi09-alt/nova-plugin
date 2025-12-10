// =================================================================================
// ExtendScript (JSX) File System Handler
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
        if (!parentFolder.exists) {
            // Create parent folders recursively if needed logic not strictly here, 
            // but standard .create() usually handles one level. 
            // The copyFile logic handles deep creation, we assume basic structure here.
            parentFolder.create();
        }

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

// --- COPY FILE (Recursive Folder Creation) ---
$._ext.copyFile = function(sourcePath, destRelPath) {
    if (!$._ext.baseDirPath) return "ERROR:Base path not set.";
    
    var destFullPath = $._ext.baseDirPath + "/" + destRelPath;
    var sourceFile = new File(sourcePath);
    var destFile = new File(destFullPath);

    if (!sourceFile.exists) return "ERROR:Source file missing at " + sourcePath;

    try {
        var targetFolder = destFile.parent;
        
        // Ensure destination folder hierarchy exists
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

        if (sourceFile.copy(destFile)) {
            return "SUCCESS";
        } else {
            return "ERROR:Copy failed";
        }
    } catch (e) {
        return "ERROR:Copy Exception: " + e.toString();
    }
}

// Automatically try to load the path on script load
$._ext.getStoredBasePath();