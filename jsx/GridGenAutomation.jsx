function GridGenAutomation_Run(jsonStr){
function getCompByName(name){
    for (var i=1;i<=app.project.numItems;i++){
      var it=app.project.item(i);
      if (it instanceof CompItem && it.name===name) return it;
    }
    return null;
  }

  function run(){
    var cfg=null; try{ cfg=jsonStr?JSON.parse(jsonStr):null; }catch(e){ cfg=null; }
    var COMP_GRID = (cfg && cfg.compGrid) ? cfg.compGrid : "Grid";
    var LAYER_CTRL = (cfg && cfg.layerCtrl) ? cfg.layerCtrl : "Controller";
    var FX_ROW = (cfg && cfg.fxRow) ? cfg.fxRow : "Row";
    var FX_COL = (cfg && cfg.fxCol) ? cfg.fxCol : "Column";
    var TILE_SRC = (cfg && cfg.layerTile) ? cfg.layerTile : "Tile";
    var EP_NUM = (cfg && cfg.fxNum) ? cfg.fxNum : "Num";

    var comp=getCompByName(COMP_GRID);
    if(!comp){ alert("Comp 'Grid' not found"); return; }

    var ctrl=null;
    try{ ctrl=comp.layer(LAYER_CTRL); }catch(e){}
    if(!ctrl){ alert("Layer 'Controller' not found in 'Grid'"); return; }

    var rows=Math.round(ctrl.effect(FX_ROW)("Slider").value);
    var cols=Math.round(ctrl.effect(FX_COL)("Slider").value);
    if(!(rows>0 && cols>0)){ alert("Controller Row/Column must be > 0"); return; }

    // collect Tile layers only
    var tiles=[];
    for (var i=1;i<=comp.numLayers;i++){
      var L=comp.layer(i);
      if (L.source && L.source instanceof CompItem && L.source.name===TILE_SRC){
        var p=L.property("Position").value; // [x,y]
        tiles.push({L:L,x:p[0],y:p[1]});
      }
    }
    if (tiles.length===0){ alert("No 'Tile' layers found in 'Grid'"); return; }

    // sort reading order: top->bottom, left->right
    tiles.sort(function(a,b){
      if (Math.abs(a.y-b.y)>0.5) return a.y-b.y;
      return a.x-b.x;
    });

    // sanity: expect rows*cols tiles (we'll clamp to min to avoid crashes)
    var total = Math.min(tiles.length, rows*cols);
    if (tiles.length !== rows*cols){
      // not fatal; proceed with min count
      // Uncomment if you want a warning:
      // alert("Tile count ("+tiles.length+") != rows*cols ("+(rows*cols)+"). Using "+total+".");
    }

    // grid helpers on the sorted array
    function idx(r,c){ return r*cols+c; }
    function tileAt(r,c){
      var i=idx(r,c);
      if (r<0||c<0||r>=rows||c>=cols||i>=total) return null;
      return tiles[i].L;
    }
    function isOnAt(r,c){
      var t=tileAt(r,c);
      return t ? t.enabled : false;
    }

    app.beginUndoGroup("Crossword Numbering (Script)");

    // clear all numbers first (avoid leftovers if count shrinks)
    for (var i=0;i<total;i++){
      var L=tiles[i].L;
      var ep=L.property("Essential Properties");
      if (ep && ep.property(EP_NUM)) ep.property(EP_NUM).setValue("");
    }

    var num=0;
    for (var i=0;i<total;i++){
      var r=Math.floor(i/cols);
      var c=i%cols;
      var L=tiles[i].L;

      if (!L.enabled){ // treat disabled as black
        var ep0=L.property("Essential Properties");
        if (ep0 && ep0.property(EP_NUM)) ep0.property(EP_NUM).setValue("");
        continue;
      }

      // start rules with length>=2 validation
      var startAcross = ( (c===0 || !isOnAt(r,c-1)) && (c+1<cols && isOnAt(r,c+1)) );
      var startDown   = ( (r===0 || !isOnAt(r-1,c)) && (r+1<rows && isOnAt(r+1,c)) );
      var isStart = startAcross || startDown;

      if (isStart){
        // count prior starts
        var prior=0;
        for (var j=0;j<i;j++){
          var rr=Math.floor(j/cols), cc=j%cols;
          if (!isOnAt(rr,cc)) continue;

          var psa = ( (cc===0 || !isOnAt(rr,cc-1)) && (cc+1<cols && isOnAt(rr,cc+1)) );
          var psd = ( (rr===0 || !isOnAt(rr-1,cc)) && (rr+1<rows && isOnAt(rr+1,cc)) );
          if (psa || psd) prior++;
        }
        num = prior+1;

        var ep=L.property("Essential Properties");
        if (ep && ep.property(EP_NUM)) ep.property(EP_NUM).setValue(String(num));
      } else {
        var ep2=L.property("Essential Properties");
        if (ep2 && ep2.property(EP_NUM)) ep2.property(EP_NUM).setValue("");
      }
    }

    app.endUndoGroup();
  }

  run();
}
