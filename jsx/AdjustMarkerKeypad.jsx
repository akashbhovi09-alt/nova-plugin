/***********************************************
 * AdjustMarkerKeypad — Dockable Panel (Solve A3)
 *
 * INSTALL:
 *   Place this .jsx in:
 *     After Effects/Scripts/ScriptUI Panels/
 *   Restart After Effects
 *   Open via: Window > AdjustMarkerKeypad
 *
 * Mohammed Ansari — AKASH
 *
 * NOTES:
 *  - Dockable panel ONLY (no Window() fallback)
 *  - Adds "Solve A3" checkbox that appears only when "60 sec video" is OFF
 *  - When 30s mode + Solve A3 OFF:
 *      • In MAIN COMP: removes A3 and T3 markers
 *      • End shot starts at C3 + 60 frames (constant)
 *      • In CLUE comp: on 3rd IMAGE layer (from bottom), removes marker "O" and keeps "I"
 *  - When 30s mode + Solve A3 ON:
 *      • In CLUE comp: ensures I at start, O at I+37f, both Yellow label=2
 *      • MAIN COMP behavior remains standard (endshot based on A3 length logic)
 ***********************************************/

(function () {

  // =========================
  // Config (EDITABLE CONTROLS)
  // =========================
  var MAIN_COMP_NAME    = "MAIN COMP";

  var GRID_LAYER_NAME   = "GRID";
  var QBG_LAYER_NAME    = "Questions & BG";
  var CLUE_LAYER_NAME   = "CLUE";
  var KEYPAD_LAYER_NAME = "KEYPAD"; // layer in MAIN COMP that contains T markers

  var REPLACE_QA_COMP_NAME = "REPLACE Q&A"; // contains answer text layers "ANSWER i"

  var KEYPAD_COMP_NAME  = "KEYPAD"; // comp we open to program markers
  var KEYPAD_MARKER_LAYER_NAME = "KEYPAD MARKER";
  var ANS_KEYPAD_LAYER_NAME    = "ANS Keypad";
  var LETTER_TAP_SFX_LAYER_NAME = "LETTER TAP SFX";

  // Answer length rule
  var COUNT_SPACES_FOR_LEN = false;          // false = ignore spaces (recommended)
  var IGNORE_IN_ANS_CHARS  = /[\s]/g;        // removed from letters

  // A->F spacing rule (PER REQUEST)
  // Distance from Aᵢ to Fᵢ = baseFrames + (answerLength * perLetterFrames)
  var AF_BASE_FRAMES_DEFAULT = 30;
  var AF_PER_LETTER_FRAMES_DEFAULT = 13;

  // KEYPAD spacing rule
  var FIRST_GAP_FRAMES = 5;
  var LETTER_GAP_FRAMES = 13;

  // Clear old markers on ANS Keypad / LETTER TAP SFX before writing new
  var CLEAR_ANS_KEYPAD_MARKERS = true;
  var CLEAR_LETTER_TAP_SFX_MARKERS = true;

  // Manual defaults (used when Preserve checkbox is NOT checked)
  // Frames between C & H (C - H) : 0f => H at same time as C
  var CH_FRAMES_DEFAULT = 0;

  // Frames between Q & C (C - Q)
  // Q1 - C1 : 32f means C1 = Q1 + 32f
  var QC_FRAMES_DEFAULTS = {
    1: 32,
    2: 48,
    3: 59,
    4: 62,
    5: 62,
    6: 60
  };

  // Frames between C & A (A - C)
  var CA_FRAMES_DEFAULTS = {
    1: 76,
    2: 76,
    3: 66,
    4: 66,
    5: 66,
    6: 66
  };

  // Frames between F & Q (Q_next - F_i)
  // F1->Q2 = 108, F2->Q3=55, others=50
  var FQ_FRAMES_F1 = 108;
  var FQ_FRAMES_F2 = 50;
  var FQ_FRAMES_OTHER = 50;

  // End shot placement
  var END_SHOT_LAYER_NAME = "END SHOT";
  var END_SHOT_EXTRA_FRAMES = 2;

  // 60 sec checkbox behavior:
  // - If checked: build through A6 (max 6 answers if present)
  // - If unchecked: only first 3 answers (A3 context), sets work area to 30s
  var LIMIT_30S_TO = 3;
  var LIMIT_60S_TO = 6;
  var WORKAREA_30S = 30;
  var WORKAREA_60S = 60;

  // =========================
  // MARKER LABEL COLORS
  // =========================
  // Yellow for H1,H2,... and also I/O in CLUE->IMAGE layer
  // Aqua for A1,A2,... and T1,T2,...
  var MARKER_LABEL_YELLOW = 2;
  var MARKER_LABEL_AQUA   = 3;

  // =========================
  // Solve A3 behavior constants
  // =========================
  var SOLVEA3_IMAGE_LAYER_NAME = "IMAGE"; // inside CLUE comp (multiple layers named "IMAGE")
  var SOLVEA3_IMAGE_TARGET_INDEX_FROM_BOTTOM = 3; // 3rd IMAGE from bottom
  var SOLVEA3_I_MARKER_NAME = "I";
  var SOLVEA3_O_MARKER_NAME = "O";
  var SOLVEA3_O_OFFSET_FRAMES = 37; // O after I by 37 frames
  var SOLVEA3_ENDSHOT_FROM_C3_FRAMES = 60; // when Solve A3 OFF: endshot = C3 + 60f
  // =========================
  // Core Logic
  // =========================
  function runOrchestrator(preserveGaps, is60Sec, solveA3){
    app.beginUndoGroup("AdjustMarkerKeypad (Dockable) + Solve A3");

    var proj = app.project;
    if(!proj){ alert("No project open."); app.endUndoGroup(); return; }

    //--Newly added I and O marker function for 60 sec checked
    // ===== CLUE IMAGE #3 MARKER ENFORCEMENT (60s FIX) =====
function enforceClueImage3Markers(forceO){
  var clueComp = findCompByName("CLUE");
  if (!(clueComp instanceof CompItem)) return;

  // Find IMAGE layers from bottom
  var images = [];
  for (var i = clueComp.numLayers; i >= 1; i--) {
    var L = clueComp.layer(i);
    if (L && L.name === "IMAGE") {
      images.push(L);
      if (images.length === 3) break;
    }
  }
  if (images.length < 3) return;

  var img3 = images[2]; // 3rd from bottom
  var mp = img3.property("Marker");
  if (!mp) return;

  var fps = clueComp.frameRate;
  var tI = img3.inPoint;

  // Always enforce I marker
  var mvI = new MarkerValue("I");
  mvI.label = 2;
  mp.setValueAtTime(tI, mvI);

  // Handle O marker
  var tO = tI + (37 / fps);

  // Remove existing O
  for (var k = mp.numKeys; k >= 1; k--) {
    if (mp.keyValue(k).comment === "O") {
      mp.removeKey(k);
    }
  }

  if (forceO) {
    var mvO = new MarkerValue("O");
    mvO.label = 2;
    mp.setValueAtTime(tO, mvO);
  }
}

if (is60Sec) {
  enforceClueImage3Markers(true);   // FORCE I + O
} else {
  enforceClueImage3Markers(false);  // KEEP I, REMOVE O
}


    // -------- Utils --------
    function findCompByName(name){
      for(var i=1;i<=proj.numItems;i++){
        var it = proj.item(i);
        if(it instanceof CompItem && it.name === name) return it;
      }
      return null;
    }
    function layerByName(comp, nm){
      if(!comp) return null;
      var L = comp.layer(nm);
      return L || null;
    }
    function getMP(layer){ return layer ? layer.property("Marker") : null; }
    function idxByName(mp, name){
      if(!mp) return -1;
      for(var k=1;k<=mp.numKeys;k++){
        var mv = mp.keyValue(k);
        if(mv && mv.comment === name) return k;
      }
      return -1;
    }
    function timeByName(layer, name){
      var mp = getMP(layer);
      var idx = idxByName(mp, name);
      return (idx>0) ? mp.keyTime(idx) : null;
    }
    function cloneMV(mv){
      var n = new MarkerValue(mv.comment);
      try{ n.duration = mv.duration; }catch(e){}
      try{ n.url = mv.url; }catch(e){}
      try{ n.chapter = mv.chapter; }catch(e){}
      try{ n.cuePointName = mv.cuePointName; }catch(e){}
      try{ n.eventCuePoint = mv.eventCuePoint; }catch(e){}
      try{ n.frameTarget = mv.frameTarget; }catch(e){}
      try{ n.parameters = mv.parameters; }catch(e){}
      try{ n.label = mv.label; }catch(e){}
      return n;
    }

    // Cross-version safe: remove+recreate (creates if missing)
    function setTimeByName(layer, name, newTime){
      var mp = getMP(layer); if(!mp) return;
      var idx = idxByName(mp, name);
      if(idx>0){
        var mv = cloneMV(mp.keyValue(idx));
        mp.removeKey(idx);
        mp.setValueAtTime(newTime, mv);
      }else{
        mp.setValueAtTime(newTime, new MarkerValue(name));
      }
    }

    // Cross-version safe marker set WITH COLOR
    function setTimeByNameColored(layer, name, newTime, labelIndex){
      var mp = getMP(layer); if(!mp) return;
      var idx = idxByName(mp, name);
      var mv;
      if(idx>0){
        mv = cloneMV(mp.keyValue(idx));
        mp.removeKey(idx);
      }else{
        mv = new MarkerValue(name);
      }
      try{ mv.label = labelIndex; }catch(e){}
      mp.setValueAtTime(newTime, mv);
    }

    function addMarker(layer, name, time, labelIndex){
      var mp = getMP(layer); if(!mp) return;
      var mv = new MarkerValue(name);
      try{
        if(labelIndex!=null) mv.label = labelIndex;
      }catch(e){}
      mp.setValueAtTime(time, mv);
    }

    function removeMarkerByName(layer, name){
      var mp = getMP(layer); if(!mp) return;
      var idx = idxByName(mp, name);
      if(idx>0) mp.removeKey(idx);
    }

    function clearAllMarkers(layer){
      var mp = getMP(layer); if(!mp) return;
      for(var i=mp.numKeys; i>=1; i--) mp.removeKey(i);
    }

    function removeMarkersByPrefixFromIndex(layer, prefix, fromIndex){
      var mp = getMP(layer); if(!mp) return;
      for(var i=mp.numKeys; i>=1; i--){
        var mv = mp.keyValue(i);
        if(!mv) continue;
        var c = mv.comment;
        if(c.indexOf(prefix) !== 0) continue;
        var n = parseInt(c.substring(prefix.length), 10);
        if(!isNaN(n) && n >= fromIndex) mp.removeKey(i);
      }
    }

    // -------- Find comps --------
    var mainComp = findCompByName(MAIN_COMP_NAME);
    if(!(mainComp instanceof CompItem)){
      alert('Comp "' + MAIN_COMP_NAME + '" not found in project.');
      app.endUndoGroup();
      return;
    }

    var replaceQA = findCompByName(REPLACE_QA_COMP_NAME);
    if(!(replaceQA instanceof CompItem)){
      alert('Comp "' + REPLACE_QA_COMP_NAME + '" not found in project.');
      app.endUndoGroup();
      return;
    }

    // -------- Layers in MAIN COMP --------
    var gridL   = layerByName(mainComp, GRID_LAYER_NAME);
    var qbgL    = layerByName(mainComp, QBG_LAYER_NAME);
    var clueL   = layerByName(mainComp, CLUE_LAYER_NAME);
    var keypadL = layerByName(mainComp, KEYPAD_LAYER_NAME);

    if(!gridL){ alert('Layer "'+GRID_LAYER_NAME+'" not found in "'+MAIN_COMP_NAME+'".'); app.endUndoGroup(); return; }
    if(!qbgL){  alert('Layer "'+QBG_LAYER_NAME+'" not found in "'+MAIN_COMP_NAME+'".'); app.endUndoGroup(); return; }
    if(!clueL){ alert('Layer "'+CLUE_LAYER_NAME+'" not found in "'+MAIN_COMP_NAME+'".'); app.endUndoGroup(); return; }
    if(!keypadL){ alert('Layer "'+KEYPAD_LAYER_NAME+'" not found in "'+MAIN_COMP_NAME+'".'); app.endUndoGroup(); return; }

    var fpsMain = mainComp.frameRate;

    // -------- Answer access (REPLACE Q&A) --------
    function getAnswerText(i){
      var lyr = replaceQA.layer("ANSWER " + i);
      if(!lyr) return "";
      var tp = lyr.property("Source Text");
      if(!tp) return "";
      return "" + tp.value.text;
    }
    function getAnswerLength(i){
      var txt = getAnswerText(i);
      if(!COUNT_SPACES_FOR_LEN) txt = txt.replace(/\s+/g, "");
      return Math.max(0, txt.length);
    }
    function getAnswerCharsFiltered(i){
      var raw = getAnswerText(i);
      var stripped = raw.replace(IGNORE_IN_ANS_CHARS, "");
      var arr = [];
      for(var k=0;k<stripped.length;k++) arr.push(stripped.charAt(k));
      return arr;
    }

    // Count answers by scanning ANSWER i layers
    function countAnswers(){
      var i=1;
      while(replaceQA.layer("ANSWER " + i)) i++;
      return i-1;
    }

    var totalAnswersFound = countAnswers();
    if(totalAnswersFound < 1){
      alert('No layers named "ANSWER i" found in "' + REPLACE_QA_COMP_NAME + '".');
      app.endUndoGroup();
      return;
    }

    var maxN = is60Sec ? LIMIT_60S_TO : LIMIT_30S_TO;
    var N = Math.min(totalAnswersFound, maxN);

    var FINAL_A_INDEX = is60Sec ? N : Math.min(N, LIMIT_30S_TO);

    // -------- Snapshot current times & offsets (for Preserve mode) --------
    var tH={}, tA={}, tF={}, tQ={}, tC={}, tT={}, len={};

    var dGapF_to_nextH = {};
    var dCminusQ = {};
    var dTminusA = {};
    var dHA = {};

    for(var i=1;i<=N;i++){
      tH[i] = timeByName(gridL, "H"+i);
      tA[i] = timeByName(gridL, "A"+i);
      tF[i] = timeByName(gridL, "F"+i);
      tQ[i] = timeByName(qbgL,  "Q"+i);
      tC[i] = timeByName(clueL, "C"+i);
      tT[i] = timeByName(keypadL, "T"+i);

      len[i] = getAnswerLength(i);

      dHA[i] = (tH[i]!=null && tA[i]!=null) ? (tA[i]-tH[i]) : null;
      dCminusQ[i] = (tQ[i]!=null && tC[i]!=null) ? (tC[i]-tQ[i]) : null;
      dTminusA[i] = (tA[i]!=null && tT[i]!=null) ? (tT[i]-tA[i]) : null;

      if(i < N && tF[i]!=null && tH[i+1]!=null){
        dGapF_to_nextH[i] = tH[i+1] - tF[i];
      }else{
        dGapF_to_nextH[i] = null;
      }
    }

    // -------- Default gap helpers --------
    function framesToSec(fr){ return fr / fpsMain; }

    function getQCFrames(i){
      return (QC_FRAMES_DEFAULTS[i]!=null) ? QC_FRAMES_DEFAULTS[i] : QC_FRAMES_DEFAULTS[6];
    }
    function getCAFrames(i){
      return (CA_FRAMES_DEFAULTS[i]!=null) ? CA_FRAMES_DEFAULTS[i] : CA_FRAMES_DEFAULTS[6];
    }
    function getFQFrames(i){
      if(i===1) return FQ_FRAMES_F1;
      if(i===2) return FQ_FRAMES_F2;
      return FQ_FRAMES_OTHER;
    }
    function distAF_frames(answerLen){
      return AF_BASE_FRAMES_DEFAULT + (answerLen * AF_PER_LETTER_FRAMES_DEFAULT);
    }

    // -------- Compute NEW timeline (left → right) --------
    var tH_new={}, tA_new={}, tF_new={}, tQ_new={}, tC_new={}, tT_new={};

    tQ_new[1] = (tQ[1]!=null) ? tQ[1] : 0;

    for(var i=1;i<=N;i++){
      // C_i
      if(preserveGaps && dCminusQ[i]!=null){
        tC_new[i] = tQ_new[i] + dCminusQ[i];
      }else{
        tC_new[i] = tQ_new[i] + framesToSec(getQCFrames(i));
      }
      // H_i
      tH_new[i] = tC_new[i] + framesToSec(CH_FRAMES_DEFAULT);

      // A_i
      if(preserveGaps && dHA[i]!=null){
        tA_new[i] = tH_new[i] + dHA[i];
      }else{
        tA_new[i] = tC_new[i] + framesToSec(getCAFrames(i));
      }

      // F_i
      var AFsec = distAF_frames(len[i]) / fpsMain;
      tF_new[i] = tA_new[i] + AFsec;

      // Q_{i+1}
      tQ_new[i+1] = tF_new[i] + framesToSec(getFQFrames(i));

      // Preserve F->nextH gap
      if(i < N){
        if(preserveGaps && dGapF_to_nextH[i]!=null){
          tH_new[i+1] = tF_new[i] + dGapF_to_nextH[i];
          var cNext = tH_new[i+1] - framesToSec(CH_FRAMES_DEFAULT);
          var cqOff = (dCminusQ[i+1]!=null) ? dCminusQ[i+1] : framesToSec(getQCFrames(i+1));
          tQ_new[i+1] = cNext - cqOff;
        }
      }
    }

    // -------- Apply NEW times (MAIN COMP) --------
    for(var i=1;i<=N;i++){
      setTimeByNameColored(gridL, "H"+i, tH_new[i], MARKER_LABEL_YELLOW);
      setTimeByNameColored(gridL, "A"+i, tA_new[i], MARKER_LABEL_AQUA);

      if(i < N){
        setTimeByName(gridL, "F"+i, tF_new[i]);
      }
    }

    for(var i=1;i<=N;i++){
      setTimeByName(qbgL, "Q"+i, tQ_new[i]);
    }

    for(var i=1;i<=N;i++){
      setTimeByName(clueL, "C"+i, tC_new[i]);
    }

    // Terminal safety
    removeMarkersByPrefixFromIndex(gridL, "F", FINAL_A_INDEX);
    removeMarkersByPrefixFromIndex(qbgL,  "Q", FINAL_A_INDEX + 1);

    // T_i re-anchor
    for(var i=1;i<=N;i++){
      if(preserveGaps && dTminusA[i]!=null){
        tT_new[i] = tA_new[i] + dTminusA[i];
      }else{
        tT_new[i] = (tT[i]!=null && tA[i]!=null) ? (tA_new[i] + (tT[i]-tA[i])) : tA_new[i];
      }
      setTimeByNameColored(keypadL, "T"+i, tT_new[i], MARKER_LABEL_AQUA);
    }

    // =====================================================
    // SOLVE A3 FEATURE (ONLY WHEN 60 SEC IS OFF)
    // =====================================================
    if(!is60Sec){
      // ---- Update CLUE comp IMAGE layer markers ----
      var clueComp = null;
      try{
        if(clueL.source && (clueL.source instanceof CompItem)) clueComp = clueL.source;
      }catch(e){ clueComp = null; }
      if(!clueComp) clueComp = findCompByName(CLUE_LAYER_NAME);

      if(clueComp && (clueComp instanceof CompItem)){
        var targetImageLayer = null;
        var foundCount = 0;

        for(var li = clueComp.numLayers; li >= 1; li--){
          var L = clueComp.layer(li);
          if(L && L.name === SOLVEA3_IMAGE_LAYER_NAME){
            foundCount++;
            if(foundCount === SOLVEA3_IMAGE_TARGET_INDEX_FROM_BOTTOM){
              targetImageLayer = L;
              break;
            }
          }
        }

        if(targetImageLayer){
          var fpsClue = clueComp.frameRate;

          // "I at start" => layer inPoint in CLUE comp
          var tI = 0;
          try{ tI = targetImageLayer.inPoint; }catch(e){ tI = 0; }

          setTimeByNameColored(targetImageLayer, SOLVEA3_I_MARKER_NAME, tI, MARKER_LABEL_YELLOW);

          if(solveA3){
            var tO = tI + (SOLVEA3_O_OFFSET_FRAMES / fpsClue);
            setTimeByNameColored(targetImageLayer, SOLVEA3_O_MARKER_NAME, tO, MARKER_LABEL_YELLOW);
          }else{
            removeMarkerByName(targetImageLayer, SOLVEA3_O_MARKER_NAME);
          }
        }
      }

      // ---- MAIN COMP adjustments when Solve A3 OFF ----
      if(!solveA3){
        removeMarkerByName(gridL, "A3");
        removeMarkerByName(keypadL, "T3");
        removeMarkerByName(gridL, "F3");
        removeMarkerByName(qbgL,  "Q4");
      }
    }

    var __ENDSHOT_START__ = null;

    // -------- End Shot placement --------
    var endShotLayer = layerByName(mainComp, END_SHOT_LAYER_NAME);
    if(endShotLayer){
      // reset drift
      try{ endShotLayer.startTime = 0; }catch(e){}
      try{ endShotLayer.inPoint = 0; }catch(e){}

      var endShotStart = 0;

      if(!is60Sec && !solveA3){
        if(tC_new[3] != null){
          endShotStart = tC_new[3] + (SOLVEA3_ENDSHOT_FROM_C3_FRAMES / fpsMain);
        }else{
          endShotStart = (SOLVEA3_ENDSHOT_FROM_C3_FRAMES / fpsMain);
        }
      }else{
        var last = FINAL_A_INDEX;
        if(tA_new[last] != null){
          endShotStart =
            tA_new[last] +
            ((distAF_frames(len[last]) + END_SHOT_EXTRA_FRAMES) / fpsMain);
        }else{
          endShotStart = 0;
        }
      }

      __ENDSHOT_START__ = endShotStart;

      try{
        endShotLayer.startTime = endShotStart - endShotLayer.inPoint;
      }catch(e){
        try{ endShotLayer.inPoint = endShotStart; }catch(e2){}
      }
    }

// ===== AUDIO KEYFRAME RESET + REBUILD (FIX) =====
var bgmLayer = layerByName(mainComp, "Puzzle Book_BGM");
if (bgmLayer) {
    var audioGroup = bgmLayer.property("ADBE Audio Group");
    if (audioGroup) {
        var audioLevels = audioGroup.property("ADBE Audio Levels");
        if (audioLevels && audioLevels.isTimeVarying !== undefined) {

            // REMOVE ALL EXISTING AUDIO LEVEL KEYS
            while (audioLevels.numKeys > 0) {
                audioLevels.removeKey(1);
            }

            // ADD FRESH KEYS
            var key1Time = endShotStart + (40 / fpsMain);
            var key2Time = key1Time + (70 / fpsMain);

            audioLevels.setValueAtTime(key1Time, [-5, -5]);
            audioLevels.setValueAtTime(key2Time, [-30, -30]);

            // FORCE LINEAR KEYS
            for (var k = 1; k <= audioLevels.numKeys; k++) {
                audioLevels.setInterpolationTypeAtKey(
                    k,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.LINEAR
                );
            }
        }
    }
}



    // -------- Audio ramp on END SHOT (Puzzle Book_BGM) --------
    // From END SHOT start:
    //   +40 frames => -5 dB
    //   +70 frames after that => -30 dB
    // Linear keyframes (no easing)
    function ensureAudioKeyLinear(audioProp, t, v){
      if(!audioProp) return;
      try{ audioProp.setValueAtTime(t, v); }catch(e){ return; }
      // Find the key we just set (by time within epsilon)
      var eps = 1.0 / (fpsMain * 10.0);
      var kFound = -1;
      try{
        for(var kk=1; kk<=audioProp.numKeys; kk++){
          var kt = audioProp.keyTime(kk);
          if(Math.abs(kt - t) <= eps){ kFound = kk; break; }
        }
        if(kFound<0) kFound = audioProp.nearestKeyIndex(t);
      }catch(e2){ kFound = -1; }
      if(kFound>0){
        try{
          audioProp.setInterpolationTypeAtKey(kFound, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
        }catch(e3){}
      }
    }

    if(__ENDSHOT_START__ != null){
      var bgmL = layerByName(mainComp, "Puzzle Book_BGM");
      if(bgmL){
        var audioProp = null;
        // Robust access for "Audio Levels" (aka .audio.audioLevels)
        // Some projects expose it under the Audio Group.
        try{
          audioProp = bgmL.property("ADBE Audio Group").property("ADBE Audio Levels");
        }catch(e){
          try{ audioProp = bgmL.property("ADBE Audio Levels"); }catch(e2){}
        }
        if(audioProp){
          var tKey1 = __ENDSHOT_START__ + (40 / fpsMain);
          var tKey2 = tKey1 + (70 / fpsMain);
          ensureAudioKeyLinear(audioProp, tKey1, [-5, -5]);
          ensureAudioKeyLinear(audioProp, tKey2, [-30, -30]);
        }
      }
    }

    // -------- 30s mode cleanup: remove markers beyond A3 (always) --------
    // BUGFIX: Even if N=3, old markers H4.., A4.., C4.., T4.. can remain from previous runs.
    // Always remove beyond LIMIT_30S_TO when 60s is unchecked.
    if(!is60Sec){
      removeMarkersByPrefixFromIndex(gridL, "H", LIMIT_30S_TO+1);
      removeMarkersByPrefixFromIndex(gridL, "A", LIMIT_30S_TO+1);
      removeMarkersByPrefixFromIndex(gridL, "F", LIMIT_30S_TO+1);
      removeMarkersByPrefixFromIndex(qbgL,  "Q", LIMIT_30S_TO+1);
      removeMarkersByPrefixFromIndex(clueL, "C", LIMIT_30S_TO+1);
      removeMarkersByPrefixFromIndex(keypadL, "T", LIMIT_30S_TO+1);
    }

// -------- Work area --------
    if(!is60Sec){
      try{ if(mainComp.duration < WORKAREA_30S) mainComp.duration = WORKAREA_30S; }catch(eDur30){}
      try{ mainComp.workAreaStart = 0; mainComp.workAreaDuration = WORKAREA_30S; }catch(e){}
    }else{
      // Ensure comp is at least 60s long; work area cannot exceed comp duration.
      // Add 1 frame headroom to avoid rounding/clamping issues.
      try{
        var minDur = WORKAREA_60S + (1 / fpsMain);
        if(mainComp.duration < minDur) mainComp.duration = minDur;
      }catch(eDur60){}
      try{ mainComp.workAreaStart = 0; mainComp.workAreaDuration = WORKAREA_60S; }catch(e){}
    }

    // =========================
    // KEYPAD COMP: Answer Sequencer
    // =========================
    var keypadComp = findCompByName(KEYPAD_COMP_NAME);
    if(!(keypadComp instanceof CompItem)){
      alert('Comp "' + KEYPAD_COMP_NAME + '" not found in project.');
      app.endUndoGroup();
      return;
    }

    var keypadMarkerLayer = layerByName(keypadComp, KEYPAD_MARKER_LAYER_NAME);
    var ansKeypadLayer    = layerByName(keypadComp, ANS_KEYPAD_LAYER_NAME);
    var tapSfxLayer       = layerByName(keypadComp, LETTER_TAP_SFX_LAYER_NAME);

    if(!keypadMarkerLayer){ alert('Layer "'+KEYPAD_MARKER_LAYER_NAME+'" not found in "'+KEYPAD_COMP_NAME+'".'); app.endUndoGroup(); return; }
    if(!ansKeypadLayer){ alert('Layer "'+ANS_KEYPAD_LAYER_NAME+'" not found in "'+KEYPAD_COMP_NAME+'".'); app.endUndoGroup(); return; }
    if(!tapSfxLayer){ alert('Layer "'+LETTER_TAP_SFX_LAYER_NAME+'" not found in "'+KEYPAD_COMP_NAME+'".'); app.endUndoGroup(); return; }

    var fpsKey = keypadComp.frameRate;

    if(CLEAR_ANS_KEYPAD_MARKERS) clearAllMarkers(ansKeypadLayer);
    if(CLEAR_LETTER_TAP_SFX_MARKERS) clearAllMarkers(tapSfxLayer);

    for(var i=1;i<=N;i++){
      if(!is60Sec && !solveA3 && i===3) continue;

      var tTi = timeByName(keypadMarkerLayer, "T"+i);
      if(tTi==null) continue;

      var chars = getAnswerCharsFiltered(i);
      if(chars.length === 0) continue;

      var firstChar = chars[0];
      var inName = firstChar + "in";
      addMarker(ansKeypadLayer, inName, tTi, null);

      addMarker(tapSfxLayer, String(chars.length), tTi, null);

      var t = tTi + (FIRST_GAP_FRAMES / fpsKey);
      addMarker(ansKeypadLayer, firstChar, t, null);

      for(var k=1; k<chars.length; k++){
        t += (LETTER_GAP_FRAMES / fpsKey);
        addMarker(ansKeypadLayer, chars[k], t, null);
      }

      t += (LETTER_GAP_FRAMES / fpsKey);
      var outName = chars[chars.length-1] + "out";
      addMarker(ansKeypadLayer, outName, t, null);
    }

    app.endUndoGroup();
  }

  // =========================
  // CEP ENTRYPOINT (NO UI)
  // =========================
  function AdjustMarkerKeypad_run(preserveGaps, is60Sec, solveA3) {
    try {
      runOrchestrator(preserveGaps, is60Sec, solveA3);
      return "OK";
    } catch (e) {
      return "ERROR:" + e.toString();
    }
  }

  // Expose to global scope for CEP dispatcher in jsx/main.jsx
  try { $.global.AdjustMarkerKeypad_run = AdjustMarkerKeypad_run; } catch (e) {}

})();
