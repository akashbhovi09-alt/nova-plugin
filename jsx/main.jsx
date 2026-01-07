// Nova CEP — single JSX entrypoint (AEFT 24 / AE 2024)
// Loads all JSX modules and exposes CEP-callable functions via $._ext

(function () {
    if (typeof $._ext === 'undefined') { $._ext = {}; }

    // Flag used by standalone JSX panels to avoid auto-opening ScriptUI inside CEP
    $._ext.__NOVA_CEP__ = true;

    var base = File($.fileName).parent.fsName;
    // Existing Nova host utilities
    try { $.evalFile(base + "/FilePicker.jsx"); } catch (e) {}

    // Crossword AutoPlacer (CEP-adapted; preserves standalone ScriptUI behavior)
    try { $.evalFile(base + "/CrosswordAutoPlacer.jsx"); } catch (e) {}

    // Grid numbering automation
    try { $.evalFile(base + "/GridGenAutomation.jsx"); } catch (e) {}

    // Grid preset save/load (png + json)
    try { $.evalFile(base + "/GridPresetIO.jsx"); } catch (e) {}

    try { $.evalFile(base + "/AdjustMarkerKeypad.jsx"); } catch (e) {}

    // CC Attribution (CEP helper)
    try { $.evalFile(base + "/CCattribution.jsx"); } catch (e) {}
    // Optional legacy modules (ignored per request)
    // try { $.evalFile(base + "/GridSave.jsx"); } catch (e) {}
    // try { $.evalFile(base + "/GridSnapshot.jsx"); } catch (e) {}

    // CEP-callable: generate crossword numbers
    $._ext.genGridNum = function () {
        GridGenAutomation_Run();
        return "OK";
    };


    // CEP-callable: adjust keypad markers (Preserve / 60 sec Video / Solve A3)
    $._ext.adjustMarkerKeypad = function (preserve, is60, solveA3) {
        if (typeof AdjustMarkerKeypad_run !== "function") { return "ERROR: AdjustMarkerKeypad_run not loaded."; }
        return AdjustMarkerKeypad_run(preserve, is60, solveA3);
    };

})();
