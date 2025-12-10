// NOTE: The UI (Uijs.js) is responsible for calling these functions via CSInterface.evalScript()
// The path is hardcoded as per user requirement 3.
var SNAPSHOT_FOLDER_PATH = "/Users/akashbhovi/Documents/DTC_presets/Grids/";

/**
 * Saves a snapshot of the "Grid" composition at frame 0 to a specified path.
 * The function is designed to be called via CSInterface.evalScript from the UI.
 * @param {string} fileName - The name of the file to save (e.g., "Grid_1.png").
 * @returns {string} - A JSON string with success status or error message.
 */
function takeGridSnapshot(fileName) {
    var result = { status: "error", message: "Unknown error." };
    
    // Ensure the After Effects application is running
    if (typeof app === 'undefined' || app === null) {
        result.message = "Error: After Effects application object is not available.";
        return JSON.stringify(result);
    }
    
    try {
        app.beginUndoGroup("Take Grid Snapshot");

        var compName = "Grid";
        var comp = null;
        
        // Find the "Grid" composition
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i) instanceof CompItem && app.project.item(i).name === compName) {
                comp = app.project.item(i);
                break;
            }
        }

        if (!comp) {
            result.message = "Error: Composition named '" + compName + "' not found in project. Please ensure a composition with this name exists.";
            app.endUndoGroup();
            return JSON.stringify(result);
        }

        // 1. Set current time to frame 0
        comp.time = 0;
        
        // 2. Ensure the output directory exists
        var outputFolder = new Folder(SNAPSHOT_FOLDER_PATH);
        if (!outputFolder.exists) {
            outputFolder.create();
        }

        // 3. Construct the full file path
        var outputFilePath = SNAPSHOT_FOLDER_PATH + fileName;
        var outputFile = new File(outputFilePath);

        // 4. Save the snapshot (saves the current frame to the specified file)
        var saveResult = comp.saveFrameToPng(comp.time, outputFile);
        
        if (saveResult) {
            result.status = "success";
            result.message = "Snapshot saved successfully.";
            result.filePath = outputFilePath;
        } else {
            result.message = "Error: Could not save the snapshot file to disk: " + outputFile.fsName + ". Check permissions.";
        }

    } catch (e) {
        result.message = "AE Script Exception: " + e.toString();
    } finally {
        app.endUndoGroup();
    }
    return JSON.stringify(result);
}

/**
 * Deletes a grid snapshot file from the specified path.
 * @param {string} fileName - The name of the file to delete (e.g., "Grid_1.png").
 * @returns {string} - A JSON string with success status or error message.
 */
function deleteGridSnapshot(fileName) {
    var result = { status: "error", message: "Unknown error." };
    
    // Ensure the After Effects application is running
    if (typeof app === 'undefined' || app === null) {
        result.message = "Error: After Effects application object is not available.";
        return JSON.stringify(result);
    }
    
    try {
        var filePath = SNAPSHOT_FOLDER_PATH + fileName;
        var file = new File(filePath);

        if (file.exists) {
            if (file.remove()) {
                result.status = "success";
                result.message = "File deleted successfully.";
                result.filePath = filePath;
            } else {
                result.message = "Error: Could not delete the file. Check write permissions: " + file.fsName;
            }
        } else {
            // File not found on disk, but the goal is achieved (file is gone)
            result.status = "success"; 
            result.message = "File not found on disk. Deletion considered successful.";
        }
    } catch (e) {
        result.message = "AE Script Exception during deletion: " + e.toString();
    }
    return JSON.stringify(result);
}