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
          // Adjust this path if your file structure is different (e.g., just "/FilePicker.jsx")
          var scriptPath = extensionRoot + "/jsx/FilePicker.jsx";
          
          // Normalize path for ExtendScript (forward slashes)
          var safePath = scriptPath.replace(/\\/g, "/");

          console.log("[Nova] Attempting to load host script at:", safePath);

          var loadCmd = '$.evalFile("' + safePath + '")';
          
          csi.evalScript(loadCmd, function(result) {
              // If the first attempt fails (maybe it's in the root, not jsx folder), try root
              if (!result || result === "undefined" || result.toString().indexOf("Error") !== -1) {
                  console.warn("[Nova] Failed to load from /jsx/, trying root...");
                  var rootPath = extensionRoot + "/FilePicker.jsx";
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