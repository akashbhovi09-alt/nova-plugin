// Nova CEP — single JSX entrypoint (AEFT 24 / AE 2024)
// Loads all JSX modules and exposes CEP-callable functions via $._ext

(function () {
    if (typeof $._ext === 'undefined') { $._ext = {}; }

    // Flag used by standalone JSX panels to avoid auto-opening ScriptUI inside CEP
    $._ext.__NOVA_CEP__ = true;

    var base = File($.fileName).parent.fsName;

    // NOTE: Load order matters (json2 first for JSON.parse in older engines)
    try { $.evalFile(base + "/json2.js"); } catch (e) {}

    // Existing Nova host utilities
    try { $.evalFile(base + "/FilePicker.jsx"); } catch (e) {}

    // Crossword AutoPlacer (CEP-adapted; preserves standalone ScriptUI behavior)
    try { $.evalFile(base + "/CrosswordAutoPlacer.jsx"); } catch (e) {}

    // Grid numbering automation
    try { $.evalFile(base + "/GridGenAutomation.jsx"); } catch (e) {}

    // Grid preset save/load (png + json)
    try { $.evalFile(base + "/GridPresetIO.jsx"); } catch (e) {}

    // Optional legacy modules (ignored per request)
    // try { $.evalFile(base + "/GridSave.jsx"); } catch (e) {}
    // try { $.evalFile(base + "/GridSnapshot.jsx"); } catch (e) {}

    // CEP-callable: generate crossword numbers
    $._ext.genGridNum = function () {
        GridGenAutomation_Run();
        return "OK";
    };

})();
