/* PSG / Nova - main.js (bridge & guards) */
(function () {
  // Defensive CSInterface mock (in case your HTML is tested outside AE)
  if (typeof window.CSInterface === "undefined") {
    console.warn("[Nova] CSInterface not found; applying secondary mock.");
    window.CSInterface = function () {
      this.evalScript = function (script, cb) {
        console.log("[Nova][MOCK] evalScript =>", script);
        if (typeof cb === "function") setTimeout(() => cb("Simulated Success (Mock Environment)"), 50);
      };
    };
  }

  // Ensure a single shared instance for convenience
  if (typeof window.csInterface === "undefined") {
    try { window.csInterface = new CSInterface(); } catch (e) {}
  }

  // $._ext shim so evalFile & batch entry point calls are always safe
  if (typeof $ === "undefined") window.$ = {};
  if (typeof $._ext === "undefined") $._ext = {};

  // Safe evalFile: try to load, otherwise no-op (prevents your loadJSX alert loop)
  $._ext.evalFile = $._ext.evalFile || function (path) {
    try {
      var f = new File(path);
      if (f.exists) {
        $.evalFile(f);
        return "OK";
      } else {
        // If the requested path doesn't exist, that's fine because
        // CrosswordMapper.jsx is already loaded via ScriptPath in manifest.
        return "Skipped (file not found, but core JSX should already be loaded).";
      }
    } catch (e) {
      return "Error: " + e.message;
    }
  };

  // Optional helper if you ever want to call from elsewhere
  window.NovaBridge = {
    sendBatchToAE: function (dataArray) {
      try {
        const json = JSON.stringify(dataArray).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const cmd = `applyBatchQA("${json}");`;
        (window.csInterface || new CSInterface()).evalScript(cmd, function (res) {
          console.log("[Nova] AE returned:", res);
        });
      } catch (e) {
        console.error("[Nova] Failed to send batch:", e);
      }
    }
  };
})();
