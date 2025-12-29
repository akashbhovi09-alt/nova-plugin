/* PSG / Nova - main.js (bridge & loaders) */
(function () {
  // 1. Initialize CSInterface
  if (typeof window.CSInterface === "undefined") {
      console.warn("[Nova] CSInterface not found; applying mock.");
      window.CSInterface = function () {
          this.evalScript = function (script, cb) {
              console.log("[Nova][MOCK] evalScript =>", script);
              if (cb) setTimeout(() => cb("MOCK_SUCCESS"), 50);
          };
          this.getSystemPath = function() { return "/MOCK_PATH"; };
      };
      window.SystemPath = { EXTENSION: "EXTENSION" };
  }

  if (typeof window.csInterface === "undefined") {
      try { window.csInterface = new CSInterface(); } catch (e) {}
  }

  // 2. Explicitly Load the Host Script (FilePicker.jsx)
  // This fixes "Host script returned no data" by forcing AE to read the file
  function loadHostScript() {
      try {
          var csi = new CSInterface();
          var extensionRoot = csi.getSystemPath(SystemPath.EXTENSION);
          
          // Assume the file is in a 'jsx' folder inside the extension
          // Adjust this path if your file structure is different (e.g., just "/main.jsx")
          var scriptPath = extensionRoot + "/jsx/main.jsx";
          
          // Normalize path for ExtendScript (forward slashes)
          var safePath = scriptPath.replace(/\\/g, "/");

          console.log("[Nova] Attempting to load host script at:", safePath);

          var loadCmd = '$.evalFile("' + safePath + '")';
          
          csi.evalScript(loadCmd, function(result) {
              // If the first attempt fails (maybe it's in the root, not jsx folder), try root
              if (!result || result === "undefined" || result.toString().indexOf("Error") !== -1) {
                  console.warn("[Nova] Failed to load from /jsx/, trying root...");
                  var rootPath = extensionRoot + "/main.jsx";
                  var safeRoot = rootPath.replace(/\\/g, "/");
                  csi.evalScript('$.evalFile("' + safeRoot + '")', function(res2){
                      if(!res2 || res2.toString().indexOf("Error") !== -1) {
                          console.error("[Nova] CRITICAL: Could not load FilePicker.jsx. Check file location.");
                      } else {
                          console.log("[Nova] Loaded FilePicker.jsx from root.");
                      }
                  });
              } else {
                  console.log("[Nova] FilePicker.jsx loaded successfully.");
              }
          });
          
      } catch(e) {
          console.error("[Nova] Exception loading host script:", e);
      }
  }

  // Execute Loader
  loadHostScript();

})();

/* === Gen GridNum Button Wiring === */
document.addEventListener("DOMContentLoaded", function () {
    try {
        var cs = new CSInterface();

        // Apply Content (EXECUTE) binding
        var btnApply = document.getElementById("btn-apply-content");
        if (btnApply && typeof collectAndApplyContent === "function") {
            btnApply.addEventListener("click", function () {
                collectAndApplyContent();
            });
        }
        var btn = document.getElementById("genGridNumBtn");
        if (!btn) return;

        btn.addEventListener("click", function () {
            // Ensure host entry is loaded (jsx/main.jsx) then call exposed function
            cs.evalScript('$._ext && $._ext.genGridNum ? $._ext.genGridNum() : "ERR_NO_EXT"', function (res) {
                if (res && res.toString().indexOf("ERR") === 0) {
                    // Fallback: try loading host entry again, then re-run
                    var extensionRoot = cs.getSystemPath(SystemPath.EXTENSION);
                    var safePath = (extensionRoot + "/jsx/main.jsx").replace(/\\/g, "/");
                    cs.evalScript('$.evalFile("' + safePath + '")', function () {
                        cs.evalScript('$._ext && $._ext.genGridNum ? $._ext.genGridNum() : "ERR_NO_EXT_AFTER_LOAD"');
                    });
                }
            });
        });

        // Save Grid modal buttons
        var cancelSave = document.getElementById("cancelSaveGridBtn");
        if (cancelSave) cancelSave.addEventListener("click", function () {
            if (typeof closeModal === "function") closeModal();
        });
        var confirmSave = document.getElementById("confirmSaveGridBtn");
        if (confirmSave) confirmSave.addEventListener("click", function () {
            if (typeof saveGridAndCreateNew === "function") saveGridAndCreateNew();
        });

        // Load GRID button (apply selected preset to AE)
        var loadGridBtn = document.getElementById("loadGridBtn");
        if (loadGridBtn) loadGridBtn.addEventListener("click", function () {
            if (typeof loadActiveGridPreset === "function") loadActiveGridPreset();
        });
    } catch (e) {}
});
