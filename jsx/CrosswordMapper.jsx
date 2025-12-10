// =================================================================================
// ExtendScript (JSX) File System Handler
// This script runs inside After Effects and handles file operations on behalf of the
// CEP panel (Uijs.js) to bypass file access permission issues.
// =================================================================================

// Define a function namespace if not already defined (assuming the original file didn't define one)
if (typeof $._ext === 'undefined') {
    $._ext = {};
}

/**
 * Global variable to store the persistent base directory path (e.g., "/Users/user/Documents/DTC_Presets")
 * This replaces the baseDirHandle used in Uijs.js.
 */
$._ext.baseDirPath = null;

/**
 * Helper to get the base directory path from After Effects' internal preferences.
 * @returns {string} The stored path or null.
 */
$._ext.getStoredBasePath = function() {
    // We use a specific preference key unique to this extension
    var prefKey = "com.PSG.Nova.basePresetPath";
    if (app.settings.haveSetting("CEP", prefKey)) {
        $._ext.baseDirPath = app.settings.getSetting("CEP", prefKey);
        return $._ext.baseDirPath;
    }
    return ""; // Return empty string if not found
}

/**
 * Helper to store the base directory path in After Effects' internal preferences.
 * @param {string} path - The path to store.
 */
$._ext.storeBasePath = function(path) {
    var prefKey = "com.PSG.Nova.basePresetPath";
    app.settings.saveSetting("CEP", prefKey, path);
    $._ext.baseDirPath = path;
}

/**
 * Prompts the user to pick the base directory and returns the full path.
 * The CEP panel will call this function.
 * @returns {string} The full, canonical path of the DTC_Presets folder, or "ERROR:CANCELED" if user canceled.
 */
$._ext.pickBaseFolder = function() {
    try {
        // 1. Prompt user to select the base directory (e.g., /Users/user/Documents)
        var baseFolder = Folder.selectDialog("Pick Presets Folder (e.g., your Documents folder)");

        if (baseFolder === null) {
            return "ERROR:CANCELED";
        }

        // 2. Ensure the "DTC_Presets" subfolder exists inside the chosen base folder
        var presetsFolder = new Folder(baseFolder.fsName + "/" + "DTC_Presets");
        if (!presetsFolder.exists) {
            presetsFolder.create();
        }

        // 3. Store the full path in After Effects preferences for persistence
        $._ext.storeBasePath(presetsFolder.fsName);

        // 4. Return the path of the DTC_Presets folder
        return presetsFolder.fsName;

    } catch(e) {
        return "ERROR:" + e.toString();
    }
}

/**
 * Reads the content of a file relative to the base presets directory.
 * @param {string} filePath - The file path relative to the DTC_Presets folder (e.g., "preset_id_name/preset.json").
 * @returns {string} The file content as a string, or an error string.
 */
$._ext.readTextFile = function(filePath) {
    if (!$._ext.baseDirPath) {
        return "ERROR:Base path not set. Please pick the presets folder in Settings.";
    }
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    if (!file.exists) {
        // Specifically for presets_index.json on first run
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
        return "ERROR:Could not read file " + fullPath + " | " + e.toString();
    }
}

/**
 * Writes text content to a file relative to the base presets directory, creating folders as needed.
 * @param {string} filePath - The file path relative to the DTC_Presets folder (e.g., "preset_id_name/preset.json").
 * @param {string} content - The text content to write.
 * @returns {string} "SUCCESS" or an error string.
 */
$._ext.writeTextFile = function(filePath, content) {
    if (!$._ext.baseDirPath) {
        return "ERROR:Base path not set. Please pick the presets folder in Settings.";
    }
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    try {
        // Ensure the parent folder exists (e.g., "preset_id_name")
        var parentFolder = file.parent;
        if (!parentFolder.exists) {
            parentFolder.create();
        }

        file.open("w");
        file.encoding = "UTF-8";
        file.write(content);
        file.close();
        return "SUCCESS";
    } catch (e) {
        return "ERROR:Could not write file " + fullPath + " | " + e.toString();
    }
}

/**
 * Writes a Base64 encoded file (image) to disk.
 * @param {string} filePath - The file path relative to the DTC_Presets folder (e.g., "preset_id_name/assets/image.png").
 * @param {string} base64Data - The Base64 encoded string of the file data (must exclude the data URI prefix).
 * @returns {string} "SUCCESS" or an error string.
 */
$._ext.writeBase64File = function(filePath, base64Data) {
    if (!$._ext.baseDirPath) {
        return "ERROR:Base path not set. Please pick the presets folder in Settings.";
    }
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);

    try {
        // Ensure the parent folder exists (e.g., "preset_id_name/assets")
        var parentFolder = file.parent;
        if (!parentFolder.exists) {
            parentFolder.create();
        }

        file.open("w");
        file.encoding = "BINARY";
        file.write(base64Data);
        file.close();
        return "SUCCESS";
    } catch (e) {
        return "ERROR:Could not write Base64 file " + fullPath + " | " + e.toString();
    }
}

/**
 * Checks if a file exists.
 * @param {string} filePath - The file path relative to the DTC_Presets folder.
 * @returns {string} "true" or "false".
 */
$._ext.fileExists = function(filePath) {
    if (!$._ext.baseDirPath) {
        return "false"; // Can't check if base path is not set
    }
    var fullPath = $._ext.baseDirPath + "/" + filePath;
    var file = new File(fullPath);
    return file.exists.toString();
}

// Automatically try to load the path on script load
$._ext.getStoredBasePath();

// Return an informative message if not called via evalScript
"JSX File System Handler Loaded."