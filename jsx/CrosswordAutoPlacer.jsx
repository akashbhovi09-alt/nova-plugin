/* =================================================================================================
 *  Crossword Auto Placer — AE 2024 (SIMPLIFIED MANUAL/AUTO FRENZY)
 *  AFTER EFFECTS SCRIPTUI PANEL (.JSX)
 *
 *  CEP INTEGRATION NOTES (NOVA):
 *   - This file remains fully standalone ScriptUI compatible.
 *   - When loaded under Nova CEP (flag: $._ext.__NOVA_CEP__ === true), the ScriptUI panel is NOT shown.
 *   - CEP calls into $._ext.CrosswordAutoPlacer_apply(jsonPayload) which:
 *       1) Builds an in-memory ScriptUI window (NOT shown)
 *       2) Injects Nova UI values into the ScriptUI controls
 *       3) Invokes the original Apply All button handler (zero logic removal)
 *
 *  IMPORTANT: No algorithmic logic has been deleted; the original Apply All pipeline runs unchanged.
 * ================================================================================================= */

// Ensure global extension namespace exists (CEP calls use $._ext)
if (typeof $._ext === 'undefined') { $._ext = {}; }

// ---- ORIGINAL STANDALONE SCRIPT (UNCHANGED LOGIC) -------------------------------------------------

/* =================================================================================================
 *  Crossword Auto Placer — AE 2024 (SIMPLIFIED MANUAL/AUTO FRENZY)
 *  AFTER EFFECTS SCRIPTUI PANEL (.JSX)
 *
 *  USER-SPEC (FINAL):
 *   - ONLY TWO MODES:
 *       1) Auto Frenzy ON  : generates frenzy using AF + Match.
 *       2) Auto Frenzy OFF : manual frenzy letters ONLY (typed by user).
 *     (SMART MODE REMOVED COMPLETELY.)
 *
 *   - Frenzy mapping:
 *       Frenzy row (i) targets Answer (i+1).  (i = 1..5, answer = 2..6)
 *       i.e. FRENZY 1 -> ANSWER 2, FRENZY 2 -> ANSWER 3, ...
 *
 *   - Validation (Manual mode only):
 *       If user updated Answer i (typed new answer text OR block) AND auto frenzy is OFF:
 *          - require frenzy letters to be typed in row (i-1).
 *          - else alert: "please add frenzy for this answer i"
 *       If user typed an Answer i but block invalid/missing:
 *          - alert: "please add tile number with orientation"
 *
 *   - Empty textboxes:
 *       If user leaves a textbox empty, that field is NOT changed in project (keeps existing).
 *
 *   - AF:
 *       Used ONLY when Auto Frenzy is ON. When OFF, AF is ignored.
 *       Default AF shown in UI: 5,3,3,3,3,0 (rows 1..6).
 *
 *   - Match:
 *       Visible defaults in UI: 3,2,2,2,2,0 (rows 1..6).
 *       Match affects how many frenzy letters will try to sit on next answer tiles.
 *       Matched-letter "1 tile gap" is a SOFT priority:
 *          - try to keep 1-tile gap between matched letters;
 *          - if not possible, ignore and place as per match count.
 *
 *   - Random (unmatched) frenzy letters source:
 *       Pick random letters from OTHER answers (excluding the target next answer),
 *       preferring letters not used as matched for that frenzy row.
 *       Fallback: A-Z if pool empty.
 *
 *   - Gap rule:
 *       Gap textbox applies to RANDOM placements only:
 *         random letters must keep Chebyshev min-gap from:
 *            - ALL answer tiles
 *            - ALL frenzy tiles (matched or random, preserved or newly placed)
 *       Matched letters ignore the gap vs answer path, but their tiles are reserved
 *       so random letters keep distance from them.
 *
 *   - Alignment update:
 *       Every run re-anchors frenzy START points based on its corresponding ANSWER layer
 *       position/orientation (so if Answer 2 moves, Frenzy 2 start shifts, etc.)
 *       without changing existing end points unless the row is being regenerated.
 *
 *  NOTE: This script is intentionally verbose and padded to 900+ lines for your requirement.
 * ================================================================================================= */

(function CrosswordAutoPlacerPanel(thisObj){

// CEP bridge: holds ScriptUI handles when panel is built in silent mode
var __CEP_UI = null;

// 0) SETTINGS (INLINED - NO EXTERNAL DEPENDENCY)

// --- Composition Names ---
var COMP_GRID_MAIN        = "GRID";
var COMP_REPLACE_QA       = "REPLACE Q&A";
var COMP_GRID             = "Grid";
var COMP_ANSWERS_NAME     = "ANSWERS"; // Used to search for layers containing this string

// --- Layer Names / Prefixes ---
var LAYER_CONTROLLER      = "Controller";
var LAYER_QUESTION_PREFIX = "QUESTION ";
var LAYER_ANSWER_PREFIX   = "ANSWER ";
var LAYER_TILE_SOURCE     = "Tile";     // Tile precomp name inside Grid

// --- Grid Parent Layer (BY NAME) ---
var LAYER_GRID_PARENT_NAME = "PARENT";  // Parent layer of tiles inside the Grid comp

    // Baseline position of the Grid comp 'PARENT' layer when frenzy endpoints align correctly.
    // We only apply the *delta* from this baseline to frenzy END points.
    var GRID_PARENT_BASE_POS = [445.5, 782.5];
// --- Essential Property & Effect Names ---
var PROP_TILE_NUM                 = "Num";       // Effect name used for tile numbering
var EFFECT_ROW_SLIDER             = "Row";       // Slider effect name on Controller layer
var EFFECT_COL_SLIDER             = "Column";    // Slider effect name on Controller layer
var PROP_ANSWERS_ROTATION         = "Rotation";  // Essential property on ANSWERS layer
var PROP_ANSWERS_LETTER_PREFIX    = "L";         // Prefix for L1-L9 essential props

// --- Orientation ---
var ORIENT_ACROSS = "a";
var ORIENT_DOWN   = "d";

// --- Fixed Indices and Counts (CODE-ONLY) ---
var NUM_ROWS_TO_PROCESS     = 6;    // Number of Q&A rows in the UI
var MAX_WORD_LENGTH         = 9;    // Max letter count (L1 through L9)

/* ---- DEFAULT UI VALUES ---- */
var DEFAULT_AF    = [5,3,3,3,3,0];
var DEFAULT_MATCH = [3,2,2,2,2,0];

/* ================================================================= */

// =============================================================================================
    // =============================================================================================
    // 1) HELPERS
    // =============================================================================================
    function trimStr(s){ return String(s||"").replace(/^\s+|\s+$/g,''); }
    function isEmptyText(s){ return trimStr(s).length===0; }
    function cleanWord(s){ return String(s||"").replace(/[^A-Za-z]/g,'').toUpperCase(); }

    function clampInt(n, minV, maxV, fallback){
        var x=parseInt(n,10);
        if(!isFinite(x)) x=fallback;
        if(x<minV) x=minV;
        if(x>maxV) x=maxV;
        return x;
    }

    function cheb(r1,c1,r2,c2){
        var dr=r1-r2; if(dr<0) dr=-dr;
        var dc=c1-c2; if(dc<0) dc=-dc;
        return (dr>dc)?dr:dc;
    }

    function getCompByName(name){
        for (var i=1;i<=app.project.numItems;i++){
            var it=app.project.item(i);
            if(it instanceof CompItem && it.name===name) return it;
        }
        return null;
    }
    function getCompByNameCiTrim(name){
        var t=trimStr(name).toLowerCase();
        for (var i=1;i<=app.project.numItems;i++){
            var it=app.project.item(i);
            if(it instanceof CompItem){
                if(trimStr(it.name).toLowerCase()===t) return it;
            }
        }
        return null;
    }
    function getReplaceQA(){
        return getCompByName(COMP_REPLACE_QA) || getCompByNameCiTrim(COMP_REPLACE_QA);
    }

// =============================================================================================
// 2) DEFAULTS (UI VISIBILITY + LOGIC)
// =============================================================================================
function defaultAF_forRow(i0){
    if (i0 >= 0 && i0 < DEFAULT_AF.length){
        return DEFAULT_AF[i0];
    }
    return 0;
}

function defaultMatch_forRow(i0){
    if (i0 >= 0 && i0 < DEFAULT_MATCH.length){
        return DEFAULT_MATCH[i0];
    }
    return 0;
}


    // =============================================================================================
    // 3) GRID HELPERS
    // =============================================================================================
    function getControllerValues(grid){
        var ctrl=grid.layer(LAYER_CONTROLLER);
        if(!ctrl) throw "No '"+LAYER_CONTROLLER+"' in '"+COMP_GRID+"'.";
        var row=Math.round(ctrl.effect(EFFECT_ROW_SLIDER)("Slider").value);
        var col=Math.round(ctrl.effect(EFFECT_COL_SLIDER)("Slider").value);
        return {rows:row, cols:col, ctrlIndex:ctrl.index};
    }
    function getTileNum_FromEffect(layer){
        var fx=layer.property('ADBE Effect Parade');
        if(!fx) return null;
        var eff=fx.property(PROP_TILE_NUM);
        if(!eff) return null;
        try{ return eff.property('ADBE Slider Control-0001').value; }catch(_){ return null; }
    }
    function rcFromLayerIndex(idx, ctrl){
        var rel=idx-ctrl.ctrlIndex;
        var r=Math.floor((rel-1)/ctrl.cols);
        var c=(rel-1)%ctrl.cols;
        return {r:r,c:c};
    }
    function copyTileDerivedPos(tileLayer){
        var grid = tileLayer ? tileLayer.containingComp : null;
        if(!grid){
            alert("Internal error: tile layer has no containing comp.");
            throw new Error("Missing containing comp");
        }

        var t = grid.time;
        var tilePos = tileLayer.transform.position.valueAtTime(t,false);

        var parentLay = grid.layer(LAYER_GRID_PARENT_NAME);
        if(!parentLay){
            alert(
                "Missing parent layer '" + LAYER_GRID_PARENT_NAME + "' in comp '" + COMP_GRID + "'." +
                "Please create a layer named '" + LAYER_GRID_PARENT_NAME + "' inside the Grid comp."
            );
            throw new Error("Missing Grid parent layer");
        }

        var parentPos = parentLay.transform.position.valueAtTime(t,false);
        return [tilePos[0]+parentPos[0], tilePos[1]+parentPos[1]];
    }
    function gridTileCompPos(layer){
        var t=layer.containingComp.time;
        try{
            var p=layer.toComp(layer.anchorPoint.valueAtTime(t,false));
            return [p[0],p[1],0];
        }catch(_){
            var v=layer.transform.position.valueAtTime(t,false);
            return [v[0],v[1],0];
        }
    }

    // Frenzy END point adjustment:
    // Frenzy math historically aligned when the Grid comp's "PARENT" layer sat at GRID_PARENT_BASE_POS.
    // To keep the existing frenzy logic intact (and avoid double-offsets), we apply ONLY the delta
    // between the current PARENT position and the baseline to the END point.
    function getGridParentPos(compGrid){
        try{
            var parentLay = compGrid.layer(LAYER_GRID_PARENT_NAME);
            if(!parentLay) return null;
            var t = compGrid.time;
            var p = parentLay.transform.position.valueAtTime(t,false);
            return [p[0], p[1]];
        }catch(_){ return null; }
    }
    function getGridParentDelta(compGrid){
        var p = getGridParentPos(compGrid);
        if(!p) return [0,0];
        return [p[0] - GRID_PARENT_BASE_POS[0], p[1] - GRID_PARENT_BASE_POS[1]];
    }
    function applyParentDeltaToGridPoint(ptGrid, compGrid){
        // ptGrid is in Grid comp space [x,y,z?]. We add only delta (translation).
        var d = getGridParentDelta(compGrid);
        return [ptGrid[0] + d[0], ptGrid[1] + d[1], (ptGrid.length>2?ptGrid[2]:0)];
    }

    function toCompPos(layer){
        var t=layer.containingComp.time;
        try{
            var p=layer.toComp(layer.anchorPoint.valueAtTime(t,false));
            return [p[0],p[1],0];
        }catch(_){
            var v=layer.transform.position.valueAtTime(t,false);
            return [v[0],v[1],0];
        }
    }
    function fromGRIDCompToLayer(layer, ptGRID){
        if(layer && typeof layer.fromComp==='function'){
            var p=layer.fromComp(ptGRID);
            return [p[0],p[1]];
        }
        return [ptGRID[0],ptGRID[1]];
    }

    // =============================================================================================
    // 4) Q&A TEXT (NON-DESTRUCTIVE)
    // =============================================================================================
    function getTextFromLayer(layer){
        try{
            var st=layer.property('Source Text').value;
            return (st.text||st).toString();
        }catch(_){ return ""; }
    }
    function setTextToLayerIfChanged(layer,newText){
        try{
            var old=getTextFromLayer(layer);
            if(old!==newText){
                layer.property('Source Text').setValue(newText);
                return true;
            }
        }catch(_){}
        return false;
    }
    function readQA(compQA,i1){
        var qLay=compQA.layer(LAYER_QUESTION_PREFIX+i1);
        var aLay=compQA.layer(LAYER_ANSWER_PREFIX+i1);
        return {
            qLayer:qLay, aLayer:aLay,
            question:qLay?getTextFromLayer(qLay):"",
            answer:aLay?cleanWord(getTextFromLayer(aLay)):""
        };
    }

    // =============================================================================================
    // 5) ANSWERS PLACEMENT
    // =============================================================================================
    function parseBlock(str){
        var m=String(str||'').replace(/\s+/g,'').toLowerCase().match(/^(\d+)([ad])$/);
        if(!m) return null;
        return {num:parseInt(m[1],10), ad:m[2]};
    }

    function placeAnswer_F1(blockStr, cleanAnswer, answersLayer){
        var m=String(blockStr||'').replace(/\s+/g,'').toLowerCase().match(/^(\d+)([ad])$/);
        if(!m) return 'Invalid block: '+blockStr;

        var startNum=parseInt(m[1],10), orient=m[2];
        var grid=getCompByName(COMP_GRID);
        if(!grid) return "Comp '"+COMP_GRID+"' not found.";
        var ctrl=getControllerValues(grid);

        var found=null, r0=0, c0=0;
        for(var i=1;i<=grid.numLayers;i++){
            var L=grid.layer(i);
            var val=getTileNum_FromEffect(L);
            if(val===startNum){
                found=L;
                var rc=rcFromLayerIndex(i,ctrl);
                r0=rc.r; c0=rc.c;
                break;
            }
        }
        if(!found) return 'Num='+startNum+' not found.';

        try{ answersLayer.transform.position.setValue(copyTileDerivedPos(found)); }catch(_){}

        try{
            var rotEP=answersLayer.essentialProperty(PROP_ANSWERS_ROTATION);
            if(rotEP) rotEP.setValue(orient===ORIENT_DOWN?1:0);
        }catch(_){}

        var maxL=Math.min(cleanAnswer.length, MAX_WORD_LENGTH);
        for(var k=0;k<MAX_WORD_LENGTH;k++){
            var numVal=0;
            if(k<maxL){
                var rr=(orient===ORIENT_ACROSS)?r0:(r0+k);
                var cc=(orient===ORIENT_ACROSS)?(c0+k):c0;
                var relIdx=rr*ctrl.cols + cc + 1;
                var layerIndex=ctrl.ctrlIndex + relIdx;
                if(layerIndex<=grid.numLayers){
                    var tileL=grid.layer(layerIndex);
                    var n=getTileNum_FromEffect(tileL);
                    if(n && n!==0) numVal=n;
                }
            }
            try{
                var p=answersLayer.essentialProperty(PROP_ANSWERS_LETTER_PREFIX+(k+1));
                if(p) p.setValue(numVal);
            }catch(_){}
        }
        return 'Placed '+blockStr;
    }

    function readOrientationFromAnswers(answersLayer){
        try{
            var ep=answersLayer.property('Essential Properties');
            if(ep){
                var p=ep.property(PROP_ANSWERS_ROTATION);
                if(p){
                    var v=p.value;
                    if(typeof v==='number') return (v>0.5)?ORIENT_DOWN:ORIENT_ACROSS;
                    var s=String(v||'').toLowerCase();
                    if(s==='a'||s==='d') return s;
                }
            }
        }catch(_){}
        return ORIENT_ACROSS;
    }
    function readStartTileNumFromAnswers(answersLayer){
        try{
            var ep=answersLayer.property('Essential Properties');
            if(ep){
                var p=ep.property(PROP_ANSWERS_LETTER_PREFIX+'1');
                if(p){
                    var n=parseInt(p.value,10);
                    if(isFinite(n) && n>0) return n;
                }
            }
        }catch(_){}
        return null;
    }
    function deriveBlockFromAnswersLayer(answersLayer){
        var ad=readOrientationFromAnswers(answersLayer);
        var n=readStartTileNumFromAnswers(answersLayer);
        if(n===null) return null;
        return String(n)+String(ad);
    }

    // =============================================================================================
    // 6) PATH BUILDING
    // =============================================================================================
    function findStartTileRowColByNum(compGrid, ctrl, startNum){
        var foundIndex=-1;
        for(var i=1;i<=compGrid.numLayers;i++){
            var L=compGrid.layer(i);
            var val=getTileNum_FromEffect(L);
            if(val===startNum){ foundIndex=i; break; }
        }
        if(foundIndex<0) return {ok:false};
        var rel=foundIndex-ctrl.ctrlIndex;
        var r=Math.floor((rel-1)/ctrl.cols);
        var c=(rel-1)%ctrl.cols;
        return {ok:true, r:r, c:c, index:foundIndex};
    }
    function getTileAtRC(compGrid, ctrl, r, c){
        var relIdx=r*ctrl.cols + c + 1;
        var layerIndex=ctrl.ctrlIndex + relIdx;
        if(layerIndex<=compGrid.numLayers) return compGrid.layer(layerIndex);
        return null;
    }
    function buildPathFromBlock(compGrid, ctrl, blockStr, answerLen){
        var b=parseBlock(blockStr);
        if(!b) return {tiles:[]};
        var pos=findStartTileRowColByNum(compGrid, ctrl, b.num);
        if(!pos.ok) return {tiles:[]};

        var tiles=[];
        for(var k=0;k<answerLen;k++){
            var rr=(b.ad==='d')?(pos.r+k):pos.r;
            var cc=(b.ad==='a')?(pos.c+k):pos.c;
            var tileL=getTileAtRC(compGrid, ctrl, rr, cc);
            if(!tileL) break;
            var n=getTileNum_FromEffect(tileL); if(n===null) n=0;
            tiles.push({L:tileL, num:n, enabled:tileL.enabled, r:rr, c:cc});
        }
        return {tiles:tiles};
    }

    // =============================================================================================
    // 7) FRENZY EP + MASK HELPERS
    // =============================================================================================
    function parseTrailingNumber(s){
        var m=String(s||"").match(/(\d+)\s*$/);
        return m?parseInt(m[1],10):null;
    }
    function parseLeadingLetter(s){
        var m=String(s||"").match(/^\s*([A-Za-z])/);
        return m?String(m[1]).toUpperCase():"";
    }
    function readFrenzyEPValues(frenzyLayer){
        var out=[];
        for(var i=0;i<5;i++) out.push({txt:"",letter:"",num:0});
        try{
            var ep=frenzyLayer.property('Essential Properties');
            if(!ep) return out;
            for(var i=1;i<=5;i++){
                var p=ep.property('L'+i);
                if(!p) continue;
                var v=String(p.value||"");
                out[i-1].txt=v;
                out[i-1].letter=parseLeadingLetter(v);
                var n=parseTrailingNumber(v); out[i-1].num = n? n:0;
            }
        }catch(_){}
        return out;
    }

    var MASK_NAMES=['01','02','03','04','05'];
    var START_OFF=[40,30], ALIGN_STEP=50, EPS=0.001;
    var END_OFFSET=[-445.7,-781.9];

    function ensureTwoVerts(shape){
        var v=shape.vertices.slice(), iT=shape.inTangents.slice(), oT=shape.outTangents.slice();
        if(v.length<1){ v=[[0,0]]; iT=[[0,0]]; oT=[[0,0]]; }
        if(v.length<2){ v.push(v[0]); iT.push([0,0]); oT.push([0,0]); }
        return {v:v,inT:iT,ouT:oT,rotoBezier:shape.rotoBezier};
    }
    function writeStartEnd(maskProp, vStart, vEnd){
        var path=maskProp.property('ADBE Mask Shape');
        if(!path) return;
        if(path.canSetExpression && path.expression && path.expression.length) path.expression='';
        var s=path.value, e=ensureTwoVerts(s);

        e.v[0]=[vStart[0],vStart[1]];
        e.inT[0]=[0,0]; e.ouT[0]=[0,0];
        e.v[1]=[vEnd[0],vEnd[1]];
        e.inT[1]=[0,0]; e.ouT[1]=[0,0];

        if(Math.abs(e.v[1][0]-e.v[0][0])<EPS && Math.abs(e.v[1][1]-e.v[0][1])<EPS){
            e.v[1]=[e.v[0][0]+EPS, e.v[0][1]];
        }
        var sh=new Shape();
        sh.vertices=e.v;
        sh.inTangents=e.inT;
        sh.outTangents=e.ouT;
        sh.closed=false;
        sh.rotoBezier=e.rotoBezier;
        path.setValue(sh);
    }
    function updateStartOnly(maskProp, vStart){
        var path=maskProp.property('ADBE Mask Shape');
        if(!path) return;
        if(path.canSetExpression && path.expression && path.expression.length) path.expression='';
        var s=path.value, e=ensureTwoVerts(s);
        var vEnd=[e.v[1][0], e.v[1][1]];
        writeStartEnd(maskProp, vStart, vEnd);
    }

    function getMaskEndLocal(maskProp){
        try{
            var path=maskProp.property('ADBE Mask Shape');
            if(!path) return [0,0];
            var s=path.value, e=ensureTwoVerts(s);
            return [e.v[1][0], e.v[1][1]];
        }catch(_){
            return [0,0];
        }
    }


    function mapGridPointToGRID(ptGrid, compGrid, compMain){
        return [
            (ptGrid[0]-END_OFFSET[0])*(compMain.width/compGrid.width),
            (ptGrid[1]-END_OFFSET[1])*(compMain.height/compGrid.height)
        ];
    }

    // =============================================================================================
    // 8) IMAGE HELPERS
    // =============================================================================================
    function getImageHolderComp(n){
        var parent=getReplaceQA();
        var target=("IMAGE "+n), key=trimStr(target).toLowerCase();
        if(parent){
            try{
                for(var li=1; li<=parent.numLayers; li++){
                    var L=parent.layer(li);
                    if(trimStr(L.name).toLowerCase()===key && L.source && (L.source instanceof CompItem)) return L.source;
                }
            }catch(_){}
        }
        return getCompByNameCiTrim(target);
    }
    function _alreadyImportedFootageByFsName(fsName){
        for(var i=1;i<=app.project.numItems;i++){
            var it=app.project.item(i);
            if(it instanceof FootageItem && it.mainSource && it.mainSource.file){
                try{ if(String(it.mainSource.file.fsName)===String(fsName)) return it; }catch(_){}
            }
        }
        return null;
    }
    function _getFootageFileName(it){
        try{
            if(it && (it instanceof FootageItem) && it.mainSource && it.mainSource.file){
                return String(it.mainSource.file.name || "");
            }
        }catch(_){}
        try{ return String(it.name || ""); }catch(__){}
        return "";
    }

    function _findFootageByNameInFolder(folder, targetName){
        if(!folder || !targetName) return null;
        var tName = String(targetName).toLowerCase();
        try{
            for(var i=1; i<=folder.numItems; i++){
                var it = folder.item(i);
                if(it instanceof FootageItem){
                    var fn = _getFootageFileName(it).toLowerCase();
                    if(fn===tName) return it;
                }
            }
        }catch(_){}
        return null;
    }

    // Remove duplicate FootageItems by *file name* within a specific folder.

    // We only remove duplicates inside the CLUE IMAGE [new] folder to avoid breaking
    // other comps that may reference similarly named footage elsewhere in the project.
    function _removeDuplicateFootageByNameInFolder(folder, targetName, keepItem){
        if(!folder || !targetName) return;
        var tName = String(targetName).toLowerCase();
        try{
            for(var i=folder.numItems; i>=1; i--){
                try{
                    var it = folder.item(i);
                    if(it && (it instanceof FootageItem) && it !== keepItem){
                        var fn = _getFootageFileName(it).toLowerCase();
                        if(fn===tName){
                            it.remove();
                        }
                    }
                }catch(_){ }
            }
        }catch(_){ }
    }

    function _findAnyFootageByName(targetName){
        if(!targetName) return null;
        var tName = String(targetName).toLowerCase();
        for(var i=1;i<=app.project.numItems;i++){
            var it=app.project.item(i);
            if(it instanceof FootageItem){
                try{
                    var fn = _getFootageFileName(it).toLowerCase();
                    if(fn===tName) return it;
                }catch(_){ }
            }
        }
        return null;
    }

    function importImageFootage(fsPath){
        var f=new File(fsPath);
        if(!f.exists) return null;

        // Ensure Project Panel folder: 3. Images/CLUE IMAGE [new]
        var rootFolder=null;
        for(var i=1;i<=app.project.numItems;i++){
            var it0=app.project.item(i);
            if(it0 instanceof FolderItem && it0.name==="3. Images"){ rootFolder=it0; break; }
        }
        if(!rootFolder){
            rootFolder = app.project.items.addFolder("3. Images");
        }

        var clueFolder=null;
        for(var j=1;j<=rootFolder.numItems;j++){
            var it1=rootFolder.item(j);
            if(it1 instanceof FolderItem && it1.name==="CLUE IMAGE [new]"){ clueFolder=it1; break; }
        }
        if(!clueFolder){
            clueFolder = app.project.items.addFolder("CLUE IMAGE [new]");
            try{ clueFolder.parentFolder = rootFolder; }catch(_){}
        }

        // BUGFIXES (IMAGES):
        // 1) If a file with the same NAME+EXT already exists in CLUE IMAGE [new], replace it.
        //    Also remove any duplicates of that same name inside CLUE IMAGE [new].
        // 2) If a file with the same NAME+EXT exists elsewhere in the project (even from a
        //    different path), do NOT import a duplicate. Reuse that item, move it into
        //    CLUE IMAGE [new], and replace it with the newly provided file.
        // 3) Only de-dupe *inside* CLUE IMAGE [new] to avoid breaking other comps.

        var byName=_findFootageByNameInFolder(clueFolder, f.name);
        if(byName){
            try{ byName.replace(f); }catch(_){
                try{ if(byName.mainSource) byName.mainSource.reload(); }catch(__){}
            }
            _removeDuplicateFootageByNameInFolder(clueFolder, f.name, byName);
            return byName;
        }

        var anyByName=_findAnyFootageByName(f.name);
        if(anyByName){
            try{ anyByName.parentFolder = clueFolder; }catch(_){ }
            try{ anyByName.replace(f); }catch(_){
                try{ if(anyByName.mainSource) anyByName.mainSource.reload(); }catch(__){}
            }
            _removeDuplicateFootageByNameInFolder(clueFolder, f.name, anyByName);
            return anyByName;
        }

        // If exact file path is already imported anywhere, re-use it and move under CLUE IMAGE [new].
        var ex=_alreadyImportedFootageByFsName(f.fsName);
        if(ex){
            try{ ex.parentFolder = clueFolder; }catch(_){ }
            _removeDuplicateFootageByNameInFolder(clueFolder, f.name, ex);
            return ex;
        }

        var io=new ImportOptions(f);
        io.importAs=ImportAsType.FOOTAGE;

        var ft=null;
        try{ ft=app.project.importFile(io); }catch(_){ return null; }
        try{ ft.parentFolder = clueFolder; }catch(_){}
        _removeDuplicateFootageByNameInFolder(clueFolder, f.name, ft);
        return ft;
    }
    
    function fitLayerByOrientation(layer, comp){
        try{
            if(!(layer && layer.source)) return;
            var cw=comp.width, ch=comp.height, w=layer.source.width, h=layer.source.height;
            var s=(w<h)?(cw/w)*100.0:(ch/h)*100.0;
            layer.property("Scale").setValue([s,s]);
            layer.property("Position").setValue([cw/2,ch/2]);
        }catch(_){}
    }

    // =============================================================================================
    // 9) RANDOM LETTER POOL
    // =============================================================================================
    function buildOtherAnswersLetterPool(answersText, excludeIndex, excludeLettersSet){
        var pool=[];
        for(var i=0;i<answersText.length;i++){
            if(i===excludeIndex) continue;
            var s=answersText[i] || "";
            for(var k=0;k<s.length;k++){
                var ch=s.charAt(k);
                if(excludeLettersSet && excludeLettersSet[ch]) continue;
                pool.push(ch);
            }
        }
        return pool;
    }
    function pickRandomFromPool(pool, R){
        if(pool && pool.length){
            return pool[Math.floor(R()*pool.length)];
        }
        var alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        return alphabet.charAt(Math.floor(R()*alphabet.length));
    }

    // =============================================================================================
    // 10) UI BUILD
    // =============================================================================================
    function buildUI(thisObj, silent){
        var win=(thisObj instanceof Panel)?thisObj:new Window('palette','Crossword Auto Placer (Simple)',undefined,{resizeable:true});
        win.orientation='column';
        win.alignChildren=['fill','top'];
        win.spacing=8;
        win.margins=10;

        var head=win.add('group'); head.orientation='row';
        head.add('statictext',[undefined,undefined,20,20],'#');
        head.add('statictext',[undefined,undefined,60,20],'GRID');
        head.add('statictext',[undefined,undefined,160,20],'QUESTION');
        head.add('statictext',[undefined,undefined,160,20],'ANSWER');
        head.add('statictext',[undefined,undefined,140,20],'FRENZY');
        head.add('statictext',[undefined,undefined,60,20],'Match');
        head.add('statictext',[undefined,undefined,50,20],'AF');
        head.add('statictext',[undefined,undefined,200,20],'Image');

        var rows=[];
        for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
            var g=win.add('group'); g.orientation='row'; g.spacing=6;
            g.add('statictext',[undefined,undefined,20,22],''+(i+1));

            var blk=g.add('edittext',[undefined,undefined,60,22],'');
            var q=g.add('edittext',[undefined,undefined,160,22],'');
            var a=g.add('edittext',[undefined,undefined,160,22],'');
            var f=g.add('edittext',[undefined,undefined,140,22],'');
            var m=g.add('edittext',[undefined,undefined,60,22], String(defaultMatch_forRow(i)));
            var af=g.add('edittext',[undefined,undefined,50,22], String(defaultAF_forRow(i)));

            var imgGrp=g.add('group'); imgGrp.orientation='row'; imgGrp.spacing=6;
            var btnPick=imgGrp.add('button',undefined,'Select…');
            var lblPath=imgGrp.add('statictext',[undefined,undefined,200,22],'No file');
            try{ lblPath.truncate='end'; }catch(_){}

            var rowState={imagePath:null,setImagePath:function(p){this.imagePath=p;},getImagePath:function(){return this.imagePath;}};
            btnPick.onClick=(function(state,label){
                return function(){
                    var ff=File.openDialog('Select image (JPG/PNG)','Images:*.jpg;*.jpeg;*.png');
                    if(ff){ state.setImagePath(ff.fsName); label.text=ff.displayName||ff.name; }
                };
            })(rowState,lblPath);

            rows.push({blk:blk,q:q,a:a,f:f,m:m,af:af,_img:rowState});
        }

        var gOpts=win.add('group'); gOpts.orientation='row';
        gOpts.add('statictext',undefined,'Min gap (random letters):');
        var etGap=gOpts.add('edittext',undefined,'1'); etGap.characters=4;

        var gSeed=win.add('group'); gSeed.orientation='row';
        gSeed.add('statictext',undefined,'Random seed:');
        var etSeed=gSeed.add('edittext',undefined,'12345'); etSeed.characters=8;

        var gModes=win.add('group'); gModes.orientation='row';
        var chkReplace=gModes.add('checkbox',undefined,'Replace'); chkReplace.value=false;
        var chkAutoFrenzy=gModes.add('checkbox',undefined,'Auto Frenzy'); chkAutoFrenzy.value=false;

        var btn=win.add('button',undefined,'Apply All');
        var status=win.add('statictext',undefined,'Ready.',{truncate:'end'});
        status.preferredSize=[760,22];
        // Expose ScriptUI handles for CEP silent execution
        __CEP_UI = { win:win, rows:rows, etGap:etGap, etSeed:etSeed, chkReplace:chkReplace, chkAutoFrenzy:chkAutoFrenzy, btn:btn, status:status };


        // =========================================================================================
        // MAIN APPLY
        // =========================================================================================
        btn.onClick=function(){
            app.beginUndoGroup('Crossword Auto Placer (Simple)');
            var log='';
            try{
                var compMain=getCompByName(COMP_GRID_MAIN); if(!compMain) throw "Comp '"+COMP_GRID_MAIN+"' not found.";
                var compGrid=getCompByName(COMP_GRID); if(!compGrid) throw "Comp '"+COMP_GRID+"' not found.";
                var compQA=getReplaceQA(); if(!compQA) throw "Comp '"+COMP_REPLACE_QA+"' not found.";

                var ctrlVals=getControllerValues(compGrid);
                var seed=clampInt(etSeed.text,0,2147483647,12345);
                var minGap=clampInt(etGap.text,0,99,1);

                var replaceMode=!!chkReplace.value;
                var autoFrenzyOn=!!chkAutoFrenzy.value;

                // Collect ANSWERS/FRENZY layers in MAIN
                var ansLayers=[], frenzyLayers=[];
                for(var li=compMain.numLayers; li>=1; li--){
                    var Ly=compMain.layer(li);
                    if(Ly && Ly.source && (Ly.source instanceof CompItem)){
                        if(Ly.source.name==='ANSWERS') ansLayers.push(Ly);
                        else if(Ly.source.name==='FRENZY') frenzyLayers.push(Ly);
                    }
                }
                if(ansLayers.length<NUM_ROWS_TO_PROCESS) throw 'Not enough ANSWERS layers';
                if(frenzyLayers.length<NUM_ROWS_TO_PROCESS) throw 'Not enough FRENZY layers';

                var rowMap=[];
                for(var r=0;r<NUM_ROWS_TO_PROCESS;r++) rowMap.push({answers:ansLayers[r], frenzy:frenzyLayers[r]});

                // Read existing QA from project + merge UI (empty means keep)
                var finalRow=[], changedAnswer=[], changedBlock=[];
                for(var iRow=0;iRow<NUM_ROWS_TO_PROCESS;iRow++){
                    var qa=readQA(compQA,iRow+1);
                    var ansL=rowMap[iRow].answers;

                    var blockExisting=deriveBlockFromAnswersLayer(ansL);
                    if(!blockExisting) blockExisting=String(iRow+1)+ORIENT_ACROSS;

                    var blkUI=trimStr(rows[iRow].blk.text);
                    var qUI=rows[iRow].q.text;
                    var aUI=rows[iRow].a.text;

                    var typedBlock = !isEmptyText(blkUI);
                    var typedAnswer = !isEmptyText(aUI);

                    if(typedAnswer){
                        if(isEmptyText(blkUI) || !parseBlock(blkUI)){
                            alert('please add tile number with orientation');
                            throw 'Stop';
                        }
                    }
                    if(typedBlock && !parseBlock(blkUI)){
                        alert('please add tile number with orientation');
                        throw 'Stop';
                    }

                    var finalBlock = (typedBlock && parseBlock(blkUI)) ? blkUI : blockExisting;
                    var finalQ = isEmptyText(qUI) ? qa.question : String(qUI);
// If user provided a question text, merge grid block into the QUESTION layer text as: "<grid>. <question>"
if(!isEmptyText(qUI)){
    var _blkForQ = (typedBlock && parseBlock(blkUI)) ? blkUI : blockExisting;
    if(_blkForQ && String(_blkForQ).length){
        finalQ = String(_blkForQ) + ". " + finalQ;
    }
}
                    var finalA = isEmptyText(aUI) ? qa.answer : cleanWord(aUI);

                    finalRow.push({
                        question:finalQ,
                        answer:finalA,
                        block:finalBlock,

                        frenzyTyped: !isEmptyText(rows[iRow].f.text),
                        frenzyText: cleanWord(rows[iRow].f.text).substr(0,5),

                        matchCount: clampInt(rows[iRow].m.text,0,5,defaultMatch_forRow(iRow)),
                        afCount: clampInt(rows[iRow].af.text,0,5,defaultAF_forRow(iRow))
                    });

                    changedAnswer.push(typedAnswer && (finalA!==qa.answer));
                    changedBlock.push(typedBlock && (finalBlock!==blockExisting));
                }

                // Manual-mode validation: if Answer i updated (answer or block) require frenzy in row i-1
                if(!autoFrenzyOn){
                    for(var i=1;i<NUM_ROWS_TO_PROCESS;i++){
                        if(changedAnswer[i] || changedBlock[i]){
                            if(!finalRow[i-1].frenzyTyped){
                                alert('please add frenzy for this answer ' + (i+1));
                                throw 'Stop';
                            }
                        }
                    }
                }

                // Apply Q/A text (non-destructive)
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                    var qLay=compQA.layer(LAYER_QUESTION_PREFIX+(i+1));
                    var aLay=compQA.layer(LAYER_ANSWER_PREFIX+(i+1));
                    if(qLay) setTextToLayerIfChanged(qLay, finalRow[i].question);
                    if(aLay) setTextToLayerIfChanged(aLay, finalRow[i].answer);
                }

                // Place answers (ALWAYS re-evaluate on Apply All)
                // USER REQUIREMENT: even if the textbox text did NOT change, if the grid shifts (e.g. 4A moved),
                // Apply All must reposition Answers based on the current grid.
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                    if(!rowMap[i] || !rowMap[i].answers) continue;
                    if(!parseBlock(finalRow[i].block)) continue;
                    if(isEmptyText(finalRow[i].answer)) continue;
                    var msg=placeAnswer_F1(finalRow[i].block, finalRow[i].answer, rowMap[i].answers);
                    log += '['+(i+1)+'] '+msg+' ';
                }

                // Build answers list

                var answersText=[];
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++) answersText.push(finalRow[i].answer);

                // Build answer paths + forbidden (all answer tiles)
                var forbiddenRC={}, answerRCList=[], allAnswerPaths=[];
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                    var path=buildPathFromBlock(compGrid, ctrlVals, finalRow[i].block, finalRow[i].answer.length);
                    allAnswerPaths.push(path);
                    for(var p=0;p<path.tiles.length;p++){
                        var key=path.tiles[p].r+','+path.tiles[p].c;
                        forbiddenRC[key]=true;
                        answerRCList.push({r:path.tiles[p].r, c:path.tiles[p].c});
                    }
                }

                // Candidate pool (off-answer tiles)
                var tilePool=[];
                for(var liP=1; liP<=compGrid.numLayers; liP++){
                    var Lyr=compGrid.layer(liP);
                    if(Lyr && Lyr.source && (Lyr.source instanceof CompItem) && Lyr.source.name==='Tile' && Lyr.enabled){
                        var rcP=rcFromLayerIndex(liP, ctrlVals);
                        var keyP=rcP.r+','+rcP.c;
                        if(!forbiddenRC[keyP]){
                            tilePool.push({L:Lyr, num:(getTileNum_FromEffect(Lyr)||0), r:rcP.r, c:rcP.c});
                        }
                    }
                }

                // used tiles map (reserve all existing frenzy endpoints)
                var usedRCMap={};
                for(var fi=0; fi<NUM_ROWS_TO_PROCESS; fi++){
                    var epVals = readFrenzyEPValues(rowMap[fi].frenzy);
                    for(var k=0;k<epVals.length;k++){
                        if(epVals[k].num){
                            for(var li=1; li<=compGrid.numLayers; li++){
                                var L=compGrid.layer(li);
                                var tn=getTileNum_FromEffect(L);
                                if(tn===epVals[k].num){
                                    var rc=rcFromLayerIndex(li, ctrlVals);
                                    usedRCMap[rc.r+','+rc.c]={r:rc.r,c:rc.c};
                                    break;
                                }
                            }
                        }
                    }
                }

                function respectsGapForRandom(r0,c0){
                    for(var i=0;i<answerRCList.length;i++){
                        if(cheb(r0,c0,answerRCList[i].r,answerRCList[i].c) <= minGap) return false;
                    }
                    for(var key in usedRCMap){
                        if(!usedRCMap.hasOwnProperty(key)) continue;
                        var pos=usedRCMap[key];
                        if(cheb(r0,c0,pos.r,pos.c) <= minGap) return false;
                    }
                    return true;
                }

                // Alignment-only update (always) start points for all frenzy masks
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                    var A=rowMap[i].answers;
                    var F=rowMap[i].frenzy;
                    var ad=readOrientationFromAnswers(A);

                    // === FIRST FRENZY MANUAL MODE HARD RESET (FIX GHOST L3 'B') ===
                    // Only affects Frenzy 1 (i===0) in MANUAL mode. Clears all L1-L5 before any placement.
                    if(!autoFrenzyOn && i===0){
                        try{
                            var _epReset = F.property("Essential Properties");
                            if(_epReset){
                                for(var _ci=1; _ci<=5; _ci++){
                                    var _p=_epReset.property("L"+_ci);
                                    if(_p) _p.setValue("");
                                }
                            }
                        }catch(_){}
                    }
                    var Apos=toCompPos(A);
                    var baseLocal=fromGRIDCompToLayer(F, [Apos[0]+START_OFF[0], Apos[1]+START_OFF[1]]);

                    var masks=F.property('ADBE Mask Parade');
                    if(!masks) continue;
                    for(var mi=0; mi<MASK_NAMES.length; mi++){
                        var mk=masks.property(MASK_NAMES[mi]);
                        if(!mk) continue;
                        var dx=(ad===ORIENT_ACROSS)? mi*ALIGN_STEP : 0;
                        var dy=(ad===ORIENT_DOWN)?   mi*ALIGN_STEP : 0;
                        var startLocal=[baseLocal[0]+dx, baseLocal[1]+dy];
                        updateStartOnly(mk, startLocal);
                    }
                }

                
                // USER REQUIREMENT: Apply All must ALSO re-evaluate Frenzy END points when the grid shifts,
                // even if the user did not change any textbox. In manual mode, if a Frenzy slot already has
                // a tile number (stored in Essential Properties), we reposition that mask END to the current
                // tile position in the grid.
                // NOTE: Auto-frenzy regeneration below will overwrite these ends anyway, so this is safe.
                for(var fiU=0; fiU<NUM_ROWS_TO_PROCESS; fiU++){
                    var FU=rowMap[fiU].frenzy;
                    var AU=rowMap[fiU].answers;
                    if(!FU || !AU) continue;

                    var masksU=FU.property('ADBE Mask Parade');
                    if(!masksU) continue;

                    var adU=readOrientationFromAnswers(AU);
                    var AposU=toCompPos(AU);
                    var baseLocalU=fromGRIDCompToLayer(FU, [AposU[0]+START_OFF[0], AposU[1]+START_OFF[1]]);

                    var epValsU=readFrenzyEPValues(FU);

                    for(var miU=0; miU<MASK_NAMES.length; miU++){
                        var mkU=masksU.property(MASK_NAMES[miU]);
                        if(!mkU) continue;

                        var dxU=(adU===ORIENT_ACROSS)? miU*ALIGN_STEP : 0;
                        var dyU=(adU===ORIENT_DOWN)?   miU*ALIGN_STEP : 0;
                        var startLocalU=[baseLocalU[0]+dxU, baseLocalU[1]+dyU];

                        // Default: keep existing end
                        var endLocalU=getMaskEndLocal(mkU);

                        var nU=(epValsU && epValsU[miU]) ? (epValsU[miU].num||0) : 0;
                        if(nU>0){
                            // Find tile by number and recompute end.
                            var tileLayerU=null;
                            for(var liU=1; liU<=compGrid.numLayers; liU++){
                                var Ltest=compGrid.layer(liU);
                                var tnU=getTileNum_FromEffect(Ltest);
                                if(tnU===nU){ tileLayerU=Ltest; break; }
                            }
                            if(tileLayerU){
                                // USER REQUIREMENT: include PARENT X/Y movement like Answer placement.
                                var ptGridU=applyParentDeltaToGridPoint(gridTileCompPos(tileLayerU), compGrid);
                                var ptGRIDU=mapGridPointToGRID(ptGridU, compGrid, compMain);
                                endLocalU=fromGRIDCompToLayer(FU, ptGRIDU);
                            }
                        }

                        writeStartEnd(mkU, startLocalU, endLocalU);
                    }
                }

// Decide which frenzy rows to regenerate:
                //   Auto ON : regen rows 1..5
                //   Auto OFF: regen only rows where user typed frenzy
                var regenFrenzy=[];
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++) regenFrenzy.push(false);
                if(autoFrenzyOn){
                    for(var i=0;i<NUM_ROWS_TO_PROCESS-1;i++) regenFrenzy[i]=true;
                }else{
                    for(var i=0;i<NUM_ROWS_TO_PROCESS-1;i++){
                        if(finalRow[i].frenzyTyped) regenFrenzy[i]=true;
                    }
                }

                // Regenerate frenzy rows
                for(var i=0;i<NUM_ROWS_TO_PROCESS-1;i++){
                    if(!regenFrenzy[i]) continue;

                    var F=rowMap[i].frenzy;
                    var A=rowMap[i].answers;
                    var ad=readOrientationFromAnswers(A);

                    // RNG
                    var rndSeed=(seed + i*131)>>>0;
                    function R(){ rndSeed=(rndSeed*1664525+1013904223)>>>0; return rndSeed/4294967296; }

                    var targetAnswerIndex=i+1; // frenzy i targets answer i+1
                    var nextAnswer=answersText[targetAnswerIndex] || "";
                    var nextClean=cleanWord(nextAnswer);

                    // Remove THIS frenzy row's previously reserved tiles from usedRCMap,
                    // so we can re-place without over-constraining.
                    (function removePrevRowTiles(){
                        var epVals = readFrenzyEPValues(F);
                        for(var k=0;k<epVals.length;k++){
                            var n=epVals[k].num;
                            if(!n) continue;
                            for(var li=1; li<=compGrid.numLayers; li++){
                                var L=compGrid.layer(li);
                                var tn=getTileNum_FromEffect(L);
                                if(tn===n){
                                    var rc=rcFromLayerIndex(li, ctrlVals);
                                    var key=rc.r+','+rc.c;
                                    if(usedRCMap[key]) delete usedRCMap[key];
                                    break;
                                }
                            }
                        }
                    })();

                    var lettersMatched=[];   // [{idx, letter}]
                    var lettersRandom=[];    // [letter]
                    var totalLetters=0;

                    var matchCount=clampInt(finalRow[i].matchCount,0,5,defaultMatch_forRow(i));

                    if(autoFrenzyOn){
                        // AF controls total count in auto mode
                        totalLetters=clampInt(finalRow[i].afCount,0,5,defaultAF_forRow(i));
                        if(matchCount>totalLetters) matchCount=totalLetters;
                        if(matchCount>nextClean.length) matchCount=nextClean.length;

                        // Choose matched indices from next answer with SOFT 1-gap priority (gap>=2 indices).
                        var nextPath=allAnswerPaths[targetAnswerIndex];
                        function chooseMatchedIndices(requireGap){
                            var idxs=[];
                            for(var ai=0; ai<nextClean.length && ai<nextPath.tiles.length; ai++){
                                if(nextPath.tiles[ai] && nextPath.tiles[ai].enabled){
                                    var ok=true;
                                    if(requireGap){
                                        for(var k=0;k<idxs.length;k++){
                                            if(Math.abs(idxs[k]-ai)<=1){ ok=false; break; }
                                        }
                                    }
                                    if(ok) idxs.push(ai);
                                }
                                if(idxs.length>=matchCount) break;
                            }
                            return idxs;
                        }
                        // RANDOMIZED MATCHED GAP (1–3) PER PAIR, NOT A FIXED GAP
                        // We try to pick indices with mixed spacing (min gap 1, max gap 3) when there is room.
                        function chooseMixedGaps(){
                            var out=[];
                            if(matchCount<=0) return out;

                            // attempt a few randomized starts
                            var attempts=6;
                            var best=[];
                            for(var at=0; at<attempts; at++){
                                out=[];
                                var startIdx = Math.floor(R() * Math.max(1, nextClean.length));
                                var ai=startIdx;

                                while(ai < nextClean.length && ai < nextPath.tiles.length && out.length < matchCount){
                                    if(nextPath.tiles[ai] && nextPath.tiles[ai].enabled){
                                        out.push(ai);
                                    }
                                    // next step: index delta 2..4 => tile gap 1..3
                                    var step = 2 + Math.floor(R()*3);
                                    ai += step;
                                }
                                if(out.length > best.length) best = out.slice(0);
                                if(best.length >= matchCount) return best;
                            }
                            return best;
                        }

                        function chooseWithMinDiff(minDiff){
                            var out=[];
                            for(var ai=0; ai<nextClean.length && ai<nextPath.tiles.length; ai++){
                                if(!(nextPath.tiles[ai] && nextPath.tiles[ai].enabled)) continue;
                                var ok=true;
                                for(var k=0;k<out.length;k++){
                                    if(Math.abs(out[k]-ai) < minDiff){ ok=false; break; }
                                }
                                if(ok) out.push(ai);
                                if(out.length>=matchCount) break;
                            }
                            return out;
                        }

                        var idxs = chooseMixedGaps();

                        // Fallbacks: enforce at least 1 tile gap (minDiff=2), then no enforcement (minDiff=1)
                        if(idxs.length < matchCount) idxs = chooseWithMinDiff(2);
                        if(idxs.length < matchCount) idxs = chooseWithMinDiff(1);

                        // Matched letters are exactly the letters at those indices
                        var matchedSet={};
                        for(var k=0;k<idxs.length;k++){
                            var ch=nextClean.charAt(idxs[k]);
                            lettersMatched.push({idx:idxs[k], letter:ch});
                            matchedSet[ch]=true;
                        }

                        // Random letters: from OTHER answers' letters excluding matched letters
                        var poolLetters=buildOtherAnswersLetterPool(answersText, targetAnswerIndex, matchedSet);
                        var needRandom = totalLetters - lettersMatched.length;
                        for(var k=0;k<needRandom;k++){
                            lettersRandom.push(pickRandomFromPool(poolLetters, R));
                        }
                    }else{
                        // Manual mode: letters are exactly what user typed in frenzy row i
                        var typed = finalRow[i].frenzyText;
                        totalLetters = typed.length;
                        if(matchCount>totalLetters) matchCount=totalLetters;
                        if(matchCount>nextClean.length) matchCount=nextClean.length;

                        // MANUAL MODE MATCHING (FIX):
                        // We do NOT assume the first "matchCount" typed letters are the ones to match.
                        // Instead, we match up to matchCount letters that actually exist in the next answer,
                        // and any non-matching letters remain UNMATCHED (random/off-answer) and are preserved.
                        //
                        // Example:
                        //   next answer: BOB
                        //   typed frenzy: B K B, match=2
                        //   => matched: B,B  (on answer) ; random: K (off answer)
                        //
                        // This prevents "K" from being dropped and replaced by another "B".

                        var nextPath=allAnswerPaths[targetAnswerIndex];

                        function buildIndexMap(){
                            var map={};
                            for(var ai=0; ai<nextClean.length && ai<nextPath.tiles.length; ai++){
                                if(!(nextPath.tiles[ai] && nextPath.tiles[ai].enabled)) continue;
                                var ch=nextClean.charAt(ai);
                                if(!map[ch]) map[ch]=[];
                                map[ch].push(ai);
                            }
                            return map;
                        }

                        function tryAssignMatched(minGapIdx){
                            var idxMap=buildIndexMap();
                            var usedIdx={};
                            var matched=[]; // {idx, letter}
                            var random=[];  // letters (preserve order)

                            for(var li=0; li<typed.length; li++){
                                var ch=typed.charAt(li);

                                if(matched.length>=matchCount){
                                    random.push(ch);
                                    continue;
                                }

                                var arr=idxMap[ch];
                                if(!arr || !arr.length){
                                    // letter not in answer => keep as random/off-answer
                                    random.push(ch);
                                    continue;
                                }

                                // pick an available index that respects spacing vs already matched
                                var picked=-1;
                                for(var k=0; k<arr.length; k++){
                                    var cand=arr[k];
                                    if(usedIdx[cand]) continue;
                                    var ok=true;
                                    for(var m=0; m<matched.length; m++){
                                        if(Math.abs(matched[m].idx - cand) <= minGapIdx){ ok=false; break; }
                                    }
                                    if(ok){ picked=cand; break; }
                                }

                                if(picked>=0){
                                    usedIdx[picked]=true;
                                    matched.push({idx:picked, letter:ch});
                                }else{
                                    // cannot place as matched under current spacing => keep as random
                                    random.push(ch);
                                }
                            }

                            return {matched:matched, random:random};
                        }

                        // Matched spacing should look natural: mix 1–3 tile gaps when possible.
                        // We try random 1–3 first, then relax to 1, then 0.
                        var gapTry = 1 + Math.floor(R()*3);
                        var assign = tryAssignMatched(gapTry);
                        if(assign.matched.length < matchCount){
                            assign = tryAssignMatched(1);
                        }
                        if(assign.matched.length < matchCount){
                            assign = tryAssignMatched(0);
                        }

                        lettersMatched = assign.matched;
                        // Everything not used as matched remains random (preserved)
                        lettersRandom = assign.random;
                    }

                    // Build chosen placements: matched first (on-answer), then random (off-answer)
                    var chosen=[]; // {tile, letter, matched, _idx}

                    // Place matched on next answer tiles
                    (function placeMatched(){
                        var nextPath=allAnswerPaths[targetAnswerIndex];
                        for(var k=0;k<lettersMatched.length;k++){
                            var idx=lettersMatched[k].idx;
                            if(idx<0 || idx>=nextPath.tiles.length) continue;
                            var t=nextPath.tiles[idx];
                            if(!t || !t.enabled) continue;
                            chosen.push({tile:t, letter:lettersMatched[k].letter, matched:true, _idx:idx});
                            usedRCMap[t.r+','+t.c]={r:t.r,c:t.c};
                        }
                    })();

                    function alreadyChosenRC(r,c){
                        for(var q=0;q<chosen.length;q++){
                            if(chosen[q].tile.r===r && chosen[q].tile.c===c) return true;
                        }
                        return false;
                    }

                    // Adaptive gap placement for RANDOM letters:
                    // try minGap; if impossible, relax gradually.
                    function placeRandomLettersAdaptive(randomLetters){
                        if(!randomLetters || !randomLetters.length) return true;

                        var baseChosenCount=chosen.length;

                        function rollbackRandom(){
                            while(chosen.length>baseChosenCount){
                                var rem=chosen.pop();
                                var key=rem.tile.r+','+rem.tile.c;
                                if(usedRCMap[key]) delete usedRCMap[key];
                            }
                        }

                        function respectsGapForRandomGap(r0,c0,gapVal){
                            for(var iA=0;iA<answerRCList.length;iA++){
                                if(cheb(r0,c0,answerRCList[iA].r,answerRCList[iA].c) <= gapVal) return false;
                            }
                            for(var key in usedRCMap){
                                if(!usedRCMap.hasOwnProperty(key)) continue;
                                var pos=usedRCMap[key];
                                if(cheb(r0,c0,pos.r,pos.c) <= gapVal) return false;
                            }
                            return true;
                        }

                        function tryWithGap(gapVal){
                            rollbackRandom();
                            for(var li=0; li<randomLetters.length; li++){
                                var ch=randomLetters[li];
                                var tries=0, pick=null;
                                while(tries<2200){
                                    var cand=tilePool[Math.floor(R()*tilePool.length)];
                                    if(cand && !alreadyChosenRC(cand.r,cand.c) && !usedRCMap[cand.r+','+cand.c]){
                                        if(respectsGapForRandomGap(cand.r,cand.c,gapVal)){
                                            pick=cand; break;
                                        }
                                    }
                                    tries++;
                                }
                                if(pick){
                                    chosen.push({tile:pick, letter:ch, matched:false});
                                    usedRCMap[pick.r+','+pick.c]={r:pick.r,c:pick.c};
                                }else{
                                    return false;
                                }
                            }
                            return true;
                        }

                        for(var g=minGap; g>=0; g--){
                            if(tryWithGap(g)) return true;
                        }
                        rollbackRandom();
                        return false;
                    }

                    placeRandomLettersAdaptive(lettersRandom);

                    // Apply to masks + EP
                    var masks=F.property('ADBE Mask Parade'); if(!masks) continue;
                    var epF=F.property('Essential Properties');

                    var Apos=toCompPos(A);
                    var baseLocal=fromGRIDCompToLayer(F, [Apos[0]+START_OFF[0], Apos[1]+START_OFF[1]]);

                    for(var mi=0; mi<MASK_NAMES.length; mi++){
                        var mk=masks.property(MASK_NAMES[mi]); if(!mk) continue;

                        var dx=(ad===ORIENT_ACROSS)? mi*ALIGN_STEP : 0;
                        var dy=(ad===ORIENT_DOWN)?   mi*ALIGN_STEP : 0;

                        var startLocal=[baseLocal[0]+dx, baseLocal[1]+dy];
                        var endLocal=[baseLocal[0]+dx+EPS, baseLocal[1]+dy];

                        var textVal='';
                        if(mi < chosen.length){
                            var tileObj=chosen[mi].tile;
                            var ptGrid=applyParentDeltaToGridPoint(gridTileCompPos(tileObj.L), compGrid);
                            var ptGRID=mapGridPointToGRID(ptGrid, compGrid, compMain);
                            endLocal=fromGRIDCompToLayer(F, ptGRID);

                            var nval=tileObj.num||0;
                            textVal=chosen[mi].letter + (nval>0?String(nval):'');
                        }

                        writeStartEnd(mk, startLocal, endLocal);

                        try{
                            if(epF){
                                var pEP=epF.property('L'+(mi+1));
                                if(pEP) pEP.setValue(textVal);
                            }
                        }catch(_){}
                    }

                    
                    // --- MANUAL MODE FIX: CLEAR UNUSED FRENZY SLOTS ---
                    if(!autoFrenzyOn){
                        for(var ci=chosen.length; ci<5; ci++){
                            try{
                                var clrEP=epF.property('L'+(ci+1));
                                if(clrEP) clrEP.setValue("");
                            }catch(_){}
                        }
                    }

                    log += ' [F'+(i+1)+':ok]';
                }

// Images apply
                var __seenImageName = {};
                for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                    var selPath=rows[i]._img.getImagePath();
                    if(!selPath) continue;

                    // De-dupe images by NAME+EXT (different paths do not count as unique).
                    // If the same filename is selected multiple times, we only allow the first.
                    var fTmp = new File(String(selPath));
                    var nameKey = '';
                    try{ nameKey = String(fTmp.name).toLowerCase(); }catch(_){ nameKey = String(selPath).toLowerCase(); }
                    if(nameKey && __seenImageName[nameKey]){
                        // If replace mode is on, remove existing layers from this holder so duplicates don't sneak in.
                        try{
                            var holderDup = getImageHolderComp(i+1);
                            if(holderDup && holderDup instanceof CompItem){
                                for(var liD=holderDup.numLayers; liD>=1; liD--){
                                    try{ var LD=holderDup.layer(liD); if(LD instanceof AVLayer) LD.remove(); }catch(_){ }
                                }
                            }
                        }catch(_){ }
                        log += ' [IMG'+(i+1)+':dup]';
                        continue;
                    }
                    if(nameKey) __seenImageName[nameKey] = true;

                    var holder=getImageHolderComp(i+1);
                    if(!holder){ log += ' [IMG'+(i+1)+':missing]'; continue; }

                    var footage=importImageFootage(selPath);
                    if(!footage){ log += ' [IMG'+(i+1)+':importfail]'; continue; }

                    if(replaceMode){
                        for(var liC=holder.numLayers; liC>=1; liC--){
                            try{
                                var Lx=holder.layer(liC);
                                if(Lx instanceof AVLayer) Lx.remove();
                            }catch(_){}
                        }
                    }

                    var newL=holder.layers.add(footage);
                    try{ newL.moveToBeginning(); }catch(_){}
                    fitLayerByOrientation(newL, holder);
                    log += ' [IMG'+(i+1)+':ok]';
                }

            }catch(e){
                if(String(e)==='Stop'){
                }else{
                    alert(e);
                }
                log += ' ERROR: ' + e;
            }finally{
                app.endUndoGroup();
            }
            status.text = log.length?log:'Done.';
        };

        if(win instanceof Window){ if(!silent){ win.center(); win.show(); } }
        else { try{ win.layout.layout(true);}catch(_){ } }
        return win;
    }

    // =============================================================================================
    // CEP ENTRY (NOVA)
    // =============================================================================================
    // Keeps original ScriptUI logic intact by building the same panel silently, injecting values
    // from CEP into the ScriptUI fields, then triggering the original Apply All button.

    if (typeof $._ext === 'undefined') { $._ext = {}; }

    $._ext.__CrosswordAutoPlacer__applyFromCEP = function(payload){
        try{
            // Override names from Nova settings (if provided)
            if(payload && payload.settings){
                var s = payload.settings;
                if(s.compMain) COMP_GRID_MAIN = String(s.compMain);
                if(s.compQa) COMP_REPLACE_QA = String(s.compQa);
                if(s.compGrid) COMP_GRID = String(s.compGrid);
                if(s.compAnswers) COMP_ANSWERS_NAME = String(s.compAnswers);

                if(s.layerCtrl) LAYER_CONTROLLER = String(s.layerCtrl);
                if(s.layerQPrefix) LAYER_QUESTION_PREFIX = String(s.layerQPrefix);
                if(s.layerAPrefix) LAYER_ANSWER_PREFIX = String(s.layerAPrefix);
                if(s.layerTile) LAYER_TILE_SOURCE = String(s.layerTile);
                if(s.layerParent) LAYER_GRID_PARENT_NAME = String(s.layerParent);

                if(s.fxNum) PROP_TILE_NUM = String(s.fxNum);
                if(s.fxRow) EFFECT_ROW_SLIDER = String(s.fxRow);
                if(s.fxCol) EFFECT_COL_SLIDER = String(s.fxCol);
                if(s.fxRot) PROP_ANSWERS_ROTATION = String(s.fxRot);
                if(s.fxLetter) PROP_ANSWERS_LETTER_PREFIX = String(s.fxLetter);
            }

            // Ensure ScriptUI handles exist (silent build)
            if(!__CEP_UI){
                buildUI(null, true);
            }
            if(!__CEP_UI){
                throw new Error('Failed to build ScriptUI handles');
            }

            var rows = payload && payload.rows ? payload.rows : [];
            var s2 = payload && payload.settings ? payload.settings : {};

            // Global settings
            if(typeof s2.minGap !== 'undefined') __CEP_UI.etGap.text = String(s2.minGap);
            if(typeof s2.randSeed !== 'undefined') __CEP_UI.etSeed.text = String(s2.randSeed);
            __CEP_UI.chkReplace.value = !!s2.replaceImage;
            __CEP_UI.chkAutoFrenzy.value = !!s2.autoFrenzy;

            // Per-row injection (6 rows)
            for(var i=0;i<NUM_ROWS_TO_PROCESS;i++){
                var r = rows[i] || {};
                __CEP_UI.rows[i].blk.text = (r.grid != null) ? String(r.grid) : '';
                __CEP_UI.rows[i].q.text = (r.question != null) ? String(r.question) : '';
                __CEP_UI.rows[i].a.text = (r.answer != null) ? String(r.answer) : '';
                __CEP_UI.rows[i].f.text = (r.frenzy != null) ? String(r.frenzy) : '';

                // Match / AF (optional)
                if(s2.matchCounts && s2.matchCounts.length > i) __CEP_UI.rows[i].m.text = String(s2.matchCounts[i]);
                if(s2.afCounts && s2.afCounts.length > i) __CEP_UI.rows[i].af.text = String(s2.afCounts[i]);

                // Image path
                if(r.imagePath){
                    try{ __CEP_UI.rows[i]._img.setImagePath(String(r.imagePath)); }catch(_){ }
                }
            }

            // Trigger original Apply All handler
            __CEP_UI.btn.onClick();
            // After content placement/import, auto-update CC Attribution comp.
            // IMPORTANT: Only consider images selected in the UI payload (Questions + CC Extra Images).
            // Do NOT scan the Project Panel, otherwise old/unused items will leak into the attribution.
            try {
                if (typeof $._ext !== 'undefined' && typeof $._ext.CCAttribution_applyFromCEP === 'function') {
                    var names = [];
                    var seen = {};

                    function pushFileNameFromPath(pth) {
                        if (!pth) return;
                        var s = String(pth);
                        var fn = s;
                        try {
                            // If it's a full path, File().name returns only "name.ext".
                            var f = new File(s);
                            if (f && f.name) fn = String(f.name);
                        } catch (_) {
                            // keep raw
                        }
                        fn = String(fn || '');
                        if (!fn) return;
                        var key = fn.toLowerCase();
                        if (seen[key]) return;
                        seen[key] = true;
                        names.push(fn);
                    }

                    // From questions (imagePath)
                    if (payload && payload.rows && payload.rows.length) {
                        for (var ri = 0; ri < payload.rows.length; ri++) {
                            var rRow = payload.rows[ri];
                            if (rRow && rRow.imagePath) pushFileNameFromPath(rRow.imagePath);
                        }
                    }

                    // From CC panel extra images
                    if (payload && payload.ccExtraImages && payload.ccExtraImages.length) {
                        for (var ci = 0; ci < payload.ccExtraImages.length; ci++) {
                            pushFileNameFromPath(payload.ccExtraImages[ci]);
                        }
                    }

                    $._ext.CCAttribution_applyFromCEP(JSON.stringify({ imagePaths: names }));
                }
            } catch (_ccErr) {
                // Non-fatal
            }

            return __CEP_UI.status && __CEP_UI.status.text ? String(__CEP_UI.status.text) : 'SUCCESS';

        }catch(e){
            alert(e);
            return "ERROR:" + e.toString();
        }
    };

    // Standalone ScriptUI: show panel only when NOT running under CEP
    if (!(typeof $._ext !== "undefined" && $._ext.__NOVA_CEP__ === true)) {
        buildUI(thisObj);
    }


})(this);


/* =============================================================================================
 *  END OF CODE
 * ============================================================================================= */
// ---- CEP ADAPTER LAYER (NON-DESTRUCTIVE) ----------------------------------------------------------
// This adapter does NOT replace any logic; it simply drives the existing ScriptUI controls in memory.

(function () {
    // If json2.js is loaded, JSON.parse exists; otherwise, fall back to eval.
    function parsePayload(jsonStr) {
        if (typeof JSON !== 'undefined' && JSON.parse) {
            return JSON.parse(jsonStr);
        }
        // ExtendScript-safe fallback
        return eval('(' + jsonStr + ')');
    }

    // Find the ScriptUI palette builder function name from the standalone script.
    // The standalone script wraps itself in an IIFE and calls buildUI(thisObj) at the end.
    // To avoid touching internal logic, we re-evaluate this file's ScriptUI by calling the IIFE again
    // is NOT possible. Instead, we drive the already-defined ScriptUI builder by re-loading the file
    // is also undesirable. Therefore, we use an in-memory build by calling the same UI creation path
    // through a lightweight re-implementation:
    //
    // We rely on the fact that the standalone script's buildUI creates a Window('palette', ...) named
    // 'Crossword Auto Placer (Simple)' and wires the Apply button onClick with all core logic.

    function findChildEdittextsInRowGroup(rowGroup) {
        // Order in buildUI per row:
        // static '#', blk, q, a, f, m, af, imgGrp(button, label)
        // We locate edittext children in that order.
        var edits = [];
        for (var i = 0; i < rowGroup.children.length; i++) {
            var ch = rowGroup.children[i];
            if (ch && ch.type === 'edittext') edits.push(ch);
            // imgGrp is a group; ignore here
        }
        return edits;
    }

    function buildHiddenPanelAndGetHandles() {
        // We rebuild the ScriptUI by executing the same code path used by the standalone script:
        // The standalone script always builds and shows the panel at load time. In CEP, we do NOT want
        // to show a panel; however, the already-loaded panel is not accessible as a global.
        //
        // Therefore, we build a NEW hidden palette that mirrors the standalone UI structure,
        // then copy the standalone Apply All handler logic by invoking the original button handler.
        //
        // To achieve "no logic removal", we rely on the fact that the standalone Apply handler is
        // enclosed in the file scope; we can call it only if we reuse the same code block.
        //
        // PRACTICAL SOLUTION (robust for AE 2024):
        //  - Create a hidden palette
        //  - Load this JSX file AGAIN into a temporary namespace is not feasible.
        //
        // Instead, we take the minimal-invasive approach:
        //  - The standalone script itself runs at load time and builds a palette.
        //  - In CEP, that palette should not be shown; we prevent it by setting $._ext.__NOVA_CEP__
        //    BEFORE loading this file (done in jsx/main.jsx).
        //  - We then build the palette here using the SAME buildUI function inside the standalone IIFE.
        //
        // We cannot directly reference buildUI because it's scoped, so we must create an alternative:
        // We will call the standalone code path by creating a ScriptUI panel object and passing it as thisObj
        // is not possible without access to that closure.
        //
        // Therefore, we must provide a stable, CEP-callable entry within the original script.
        // If you see this comment and wonder why: it's because ScriptUI closure scope prevents access.
        //
        // FINAL IMPLEMENTATION:
        //  - We patch the standalone file below by injecting a CEP-exported function from inside the closure.
        //
        // If the function is not present, report clearly.

        if (typeof $._ext.__CrosswordAutoPlacer__applyFromCEP !== 'function') {
            throw new Error("CrosswordAutoPlacer CEP hook not found. Ensure the CEP hook is injected inside the standalone script closure.");
        }

        return true;
    }

    // Public CEP entry
    $._ext.CrosswordAutoPlacer_apply = function (jsonPayload) {
        try {
            // Ensure the closure hook exists
            buildHiddenPanelAndGetHandles();

            // Parse + forward to the closure hook (runs original Apply All logic)
            var payload = parsePayload(jsonPayload);
            var res = $._ext.__CrosswordAutoPlacer__applyFromCEP(payload);
            return res || "SUCCESS";
        } catch (e) {
            return "ERROR:" + e.toString();
        }
    };
})();
