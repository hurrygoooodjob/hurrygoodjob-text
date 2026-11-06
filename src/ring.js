(function (root, factory) {
  'use strict';
  const P = typeof module === 'object' && module.exports ? require('./projection.js') : root.KineticProjection;
  const api = factory(P);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KineticRing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  if (!P) throw new Error('Load projection.js before render.js.');
  const glyphCache = new Map();
  let glyphCachePixels = 0;
  const GLYPH_PIXEL_BUDGET = 8 * 1024 * 1024;
  const metricsCache = new Map();
  const nearSurfaces = new WeakMap();
  const glyphSurfaces = new WeakMap();
  function surface(ctx, width, height) {
    const owner = ctx.canvas.ownerDocument;
    const canvas = owner ? owner.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width,height) : null;
    if (!canvas) throw new Error('A Canvas surface is required for the glyph texture.');
    canvas.width=Math.max(1,Math.ceil(width));canvas.height=Math.max(1,Math.ceil(height));return canvas;
  }

  function glyphMetrics(ctx, char, options) {
    const font=`${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
    const key=JSON.stringify([char,font]);
    if(metricsCache.has(key))return metricsCache.get(key);
    const probe=surface(ctx,1,1).getContext('2d'); probe.font=font;
    const width=probe.measureText(char).width, pad=Math.ceil(options.fontSize*.18);
    const result={width,pad,font};
    if(metricsCache.size>=512)metricsCache.delete(metricsCache.keys().next().value);
    metricsCache.set(key,result);return result;
  }

  function glyphTexture(ctx, char, options, textColor) {
    const metric=glyphMetrics(ctx,char,options), {width,font}=metric;
    const styled=options.textStrokeEnabled||options.textGlowEnabled||options.textShadowEnabled;
    const pad=styled?Math.max(metric.pad,P.stylePadding(options)):metric.pad;
    const key=JSON.stringify([char,font,textColor,pad,...Object.keys(P.textStyle()).filter(k=>k!=='textOpacity').map(k=>options[k])]);
    if(glyphCache.has(key)){const hit=glyphCache.get(key);glyphCache.delete(key);glyphCache.set(key,hit);return hit;}
    const texture=surface(ctx,width+pad*2,options.fontSize*1.6+pad*2), c=texture.getContext('2d');
    c.font=font;c.fillStyle=textColor;c.textAlign='left';c.textBaseline='middle';
    if(styled)P.paintStyledText(c,char,pad,texture.height/2,options);else c.fillText(char,pad,texture.height/2);
    const result={texture,width,pad};
    const pixels=texture.width*texture.height;
    while(glyphCache.size&&(glyphCache.size>=512||glyphCachePixels+pixels>GLYPH_PIXEL_BUDGET)){const oldest=glyphCache.keys().next().value,old=glyphCache.get(oldest);glyphCachePixels-=old.texture.width*old.texture.height;glyphCache.delete(oldest);}
    if(pixels<=GLYPH_PIXEL_BUDGET){glyphCache.set(key,result);glyphCachePixels+=pixels;}return result;
  }

  // RGB shading rather than alpha per triangle avoids dark overlap seams.
  // Dark ink becomes lighter at the back; light ink becomes darker, so the
  // depth remains visible for both black and white lettering.
  function shadeColor(color, depth, options) {
    if(!options.depthFade)return color;
    const hex=String(color).match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if(!hex)return color;
    const digits=hex[1].length===3?hex[1].split('').map(c=>c+c).join(''):hex[1];
    const rgb=[0,2,4].map(i=>parseInt(digits.slice(i,i+2),16));
    const extent=Math.max(1,options.radiusZ*Math.cos(options.tilt*Math.PI/180));
    const rear=P.clamp((1-depth/extent)/2,0,1);
    // Sixteen depth bands keep the glyph cache bounded while moving smoothly.
    const mix=Math.round(rear*15)/15*options.depthFade;
    const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    const target=luminance<128?205:35;
    return '#'+rgb.map(v=>Math.round(v+(target-v)*mix).toString(16).padStart(2,'0')).join('');
  }

  function affineTriangle(ctx, texture, triangle, overlap) {
    const [a,b,c]=triangle;
    if(!a||!b||!c||Math.abs(P.signedArea(triangle))<.0001)return false;
    const denominator=a.u*(b.v-c.v)+b.u*(c.v-a.v)+c.u*(a.v-b.v);
    if(Math.abs(denominator)<1e-9)return false;
    const m11=(a.x*(b.v-c.v)+b.x*(c.v-a.v)+c.x*(a.v-b.v))/denominator;
    const m21=(a.x*(c.u-b.u)+b.x*(a.u-c.u)+c.x*(b.u-a.u))/denominator;
    const dx=(a.x*(b.u*c.v-c.u*b.v)+b.x*(c.u*a.v-a.u*c.v)+c.x*(a.u*b.v-b.u*a.v))/denominator;
    const m12=(a.y*(b.v-c.v)+b.y*(c.v-a.v)+c.y*(a.v-b.v))/denominator;
    const m22=(a.y*(c.u-b.u)+b.y*(a.u-c.u)+c.y*(b.u-a.u))/denominator;
    const dy=(a.y*(b.u*c.v-c.u*b.v)+b.y*(c.u*a.v-a.u*c.v)+c.y*(a.u*b.v-b.u*a.v))/denominator;
    const center={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3};
    ctx.save();ctx.beginPath();
    triangle.forEach((p,i)=>{const length=Math.hypot(p.x-center.x,p.y-center.y)||1;const x=p.x+(p.x-center.x)/length*overlap,y=p.y+(p.y-center.y)/length*overlap;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.closePath();ctx.clip();ctx.transform(m11,m12,m21,m22,dx,dy);ctx.drawImage(texture,0,0);ctx.restore();return true;
  }

  function render(ctx, mask, input = {}) {
    if(!ctx || !ctx.canvas || typeof ctx.drawImage!=='function')throw new TypeError('render requires a Canvas 2D context.');
    const assetWidth=mask&&(mask.naturalWidth||mask.width)||ctx.canvas.width,assetHeight=mask&&(mask.naturalHeight||mask.height)||ctx.canvas.height;
    if(mask && !(mask.naturalWidth||mask.width)) throw new TypeError('The subject mask must be decoded before rendering.');
    const options=P.normalizeOptions(input,ctx.canvas.width,ctx.canvas.height,assetWidth,assetHeight);
    const requestedLayers=input&&input.layers&&typeof input.layers==='object'?input.layers:{};
    const layers={background:requestedLayers.background!==false,far:requestedLayers.far!==false,subject:!!mask && requestedLayers.subject!==false,near:requestedLayers.near!==false};
    const stats={nearGlyphCount:0,farGlyphCount:0,crossingGlyphCount:0,drawnTriangles:0,degenerateTriangles:0,clippedTriangles:0,nearTriangles:0,farTriangles:0,cameraClippedTriangles:0,quads:[],options,layers,usesPreparedSubjectAlpha:!!mask,groups:[],groupCount:0,depthColors:[],globalDepthOrder:true};
    const near=[],far=[];
    const groupInputs=Array.isArray(input.groups)&&input.groups.length?input.groups.slice(0,6):[{}];
    const colors=new Set();
    const groupOptions=groupInputs.map(value=>{
      const group=value&&typeof value==='object'?value:{};
      const merged={...input,...group,width:options.width,height:options.height,expandedRadius:Array.isArray(input.groups)&&input.groups.length>0};
      if(group.centerY!=null&&group.ringCenterY==null)merged.ringCenterY=group.centerY;
      if(group.centerX!=null&&group.ringCenterX==null)merged.ringCenterX=group.centerX;
      if(group.color!=null&&group.textColor==null)merged.textColor=group.color;
      return P.normalizeOptions(merged,options.width,options.height,assetWidth,assetHeight);
    });
    // Every group shares the same camera. If one enlarged ring requires a
    // safer focal distance, move that single camera for the whole composition.
    const visibleGroups=groupOptions.filter(group=>group.textOpacity>0&&group.text.trim());
    options.perspective=Math.max(...(visibleGroups.length?visibleGroups:groupOptions).map(group=>group.perspective));
    for(const local of groupOptions)local.perspective=options.perspective;
    // Limit automatic repetition, never the authored phrase. Long input is
    // retained once. Each group owns a fixed budget: editing another group must
    // not alter this group's repetition, fit, mesh quality or rasterized pixels.
    const plans=groupOptions.map((local,index)=>{
      const arc=P.arcTable(local),source=local.text.replace(/\s+/g,' ').trim();
      const phrase=source?source+(/[•·|]$/.test(source)?' ':' • '):'';
      const cycle=Array.from(phrase).map(char=>({char,...glyphMetrics(ctx,char,local)}));
      const cycleLength=cycle.reduce((sum,g)=>sum+g.width+local.letterSpacing,0);
      const natural=cycle.length?Math.max(1,Math.round(arc.length/Math.max(1,cycleLength))):0;
      const perGroup=300;
      const repetitions=cycle.length?Math.max(1,Math.min(natural,Math.floor(perGroup/cycle.length))):0;
      return {local,index,arc,cycle,cycleLength,natural,repetitions};
    });

    const sx=ctx.canvas.width/options.width,sy=ctx.canvas.height/options.height;
    stats.visibleGlyphs=0;stats.meshVertices=0;stats.meshTriangles=0;stats.repetitionBudget=1800;stats.meshTriangleBudget=18000;stats.perGroupRepetitionBudget=300;stats.perGroupMeshTriangleBudget=3000;
    for(const plan of plans){
      const {local,index:groupIndex,arc,cycle,cycleLength,repetitions}=plan;
      const plannedGlyphs=cycle.filter(g=>g.char.trim()).length*repetitions;
      const cellsPerGlyph=Math.max(1,Math.floor(3000/Math.max(1,plannedGlyphs*2)));
      const rawLength=cycleLength*repetitions,fitScale=rawLength?arc.length/rawLength:1;
      stats.groups.push({index:groupIndex,id:String(groupInputs[groupIndex]?.id||'g'+(groupIndex+1)),name:String(groupInputs[groupIndex]?.name||'文字组 '+(groupIndex+1)),path:local.path,phraseRepetitions:repetitions,naturalRepetitions:plan.natural,repetitionLimited:repetitions<plan.natural,naturalCycleLength:cycleLength,fitScale,ringCircumference:arc.length,options:local});
      if(local.textOpacity===0)continue;
      let cursor=0;
      for(let index=0;index<cycle.length*repetitions;index++){
        const glyph=cycle[index%cycle.length],advance=(glyph.width+local.letterSpacing)*fitScale;
        const centerDistance=cursor+glyph.width*fitScale/2;cursor+=advance;
        if(!glyph.char.trim())continue;
        const centerDepth=P.ribbonVertex(arc,centerDistance,0,0,.5,.5,local).z;
        const color=shadeColor(local.textColor,centerDepth,local);colors.add(color);
        const texture=glyphTexture(ctx,glyph.char,local,color).texture,w=texture.width*fitScale,h=texture.height;
        function vertex(u,v){const point=P.ribbonVertex(arc,centerDistance,w,h,u,v,local);point.u=u*texture.width;point.v=v*texture.height;return point;}
        const corners=[vertex(0,0),vertex(1,0),vertex(1,1),vertex(0,1)];
        const projectedCorners=corners.map(p=>P.project(p,local));
        const depths=corners.map(p=>p.z),hasNear=Math.max(...depths)>=0,hasFar=Math.min(...depths)<0;
        if(hasNear)stats.nearGlyphCount++;if(hasFar)stats.farGlyphCount++;if(hasNear&&hasFar)stats.crossingGlyphCount++;
        stats.visibleGlyphs++;stats.quads.push({group:groupIndex,index,char:glyph.char,color,centerDepth,near:hasNear,far:hasFar,points:projectedCorners});
        // Screen-space curve error chooses a small mesh for mobile previews.
        // Shared vertices and their projections are computed exactly once.
        function curveError(a,b,u,v){const m=P.project(vertex(u,v),local);return a&&b&&m?Math.hypot((m.x-(a.x+b.x)/2)*sx,(m.y-(a.y+b.y)/2)*sy):16;}
        const ex=Math.max(curveError(projectedCorners[0],projectedCorners[1],.5,0),curveError(projectedCorners[3],projectedCorners[2],.5,1));
        const ey=Math.max(curveError(projectedCorners[0],projectedCorners[3],0,.5),curveError(projectedCorners[1],projectedCorners[2],1,.5));
        let nx=Math.max(1,Math.min(local.segments,Math.ceil(Math.sqrt(ex/.6)))),ny=Math.max(1,Math.min(3,Math.ceil(Math.sqrt(ey/.6))));
        while(nx*ny>cellsPerGlyph){if(ny>1&&ey/(ny*ny)<ex/(nx*nx))ny--;else if(nx>1)nx--;else ny--;}
        const grid=[];
        for(let row=0;row<=ny;row++){const line=[];for(let col=0;col<=nx;col++){let v=vertex(col/nx,row/ny);line.push({v,p:P.project(v,local)});}grid.push(line);}
        stats.meshVertices+=(nx+1)*(ny+1);stats.meshTriangles+=nx*ny*2;
        const pieces=[false,true].map(nearPass=>({items:[],depth:centerDepth,opacity:local.textOpacity,left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity,nearPass}));
        function add(vertices,projected,nearPass){
          if(projected.some(p=>!p)){stats.cameraClippedTriangles++;return;}
          const piece=pieces[nearPass?1:0];piece.items.push({projected,texture,overlap:local.seamOverlap,depth:P.depth(vertices)});
          for(const p of projected){piece.left=Math.min(piece.left,p.x);piece.top=Math.min(piece.top,p.y);piece.right=Math.max(piece.right,p.x);piece.bottom=Math.max(piece.bottom,p.y);}
        }
        for(let row=0;row<ny;row++)for(let col=0;col<nx;col++){
          const a=grid[row][col],b=grid[row][col+1],c=grid[row+1][col+1],d=grid[row+1][col];
          for(const nodes of [[a,b,c],[a,c,d]]){
            const triangle=nodes.map(n=>n.v),lo=Math.min(...triangle.map(p=>p.z)),hi=Math.max(...triangle.map(p=>p.z));
            if(lo>=0)add(triangle,nodes.map(n=>n.p),true);
            else if(hi<=0)add(triangle,nodes.map(n=>n.p),false);
            else {stats.clippedTriangles++;for(const nearPass of [false,true])for(const clipped of P.triangulate(P.clipDepth(triangle,nearPass)))add(clipped,clipped.map(v=>P.project(v,local)),nearPass);}
          }
        }
        for(const piece of pieces)if(piece.items.length){piece.items.sort((a,b)=>a.depth-b.depth);(piece.nearPass?near:far).push(piece);}
      }
    }
    const sortedNear=near.sort((a,b)=>a.depth-b.depth),sortedFar=far.sort((a,b)=>a.depth-b.depth);
    const translucent = groupOptions.some(g => g.textOpacity > 0 && g.textOpacity < 1 && g.text.trim());
    function drawPass(target,pieces,nearPass) {
      // Every glyph follows one compositing path, regardless of another group's
      // opacity. This retains per-group pixel independence and mesh seam safety.
      let scratch=glyphSurfaces.get(ctx.canvas);
      if(!scratch){scratch=surface(ctx,ctx.canvas.width,ctx.canvas.height);glyphSurfaces.set(ctx.canvas,scratch);}
      if(scratch.width!==ctx.canvas.width)scratch.width=ctx.canvas.width;if(scratch.height!==ctx.canvas.height)scratch.height=ctx.canvas.height;
      const gc=scratch.getContext('2d');
      for(const piece of pieces) {
        const left=Math.max(0,Math.floor(piece.left*sx)-2),top=Math.max(0,Math.floor(piece.top*sy)-2),right=Math.min(ctx.canvas.width,Math.ceil(piece.right*sx)+2),bottom=Math.min(ctx.canvas.height,Math.ceil(piece.bottom*sy)+2);
        const w=right-left,h=bottom-top;if(w<=0||h<=0)continue;
        gc.setTransform(1,0,0,1,0,0);gc.globalAlpha=1;gc.globalCompositeOperation='source-over';gc.clearRect(0,0,w,h);gc.setTransform(sx,0,0,sy,-left,-top);
        for(const item of piece.items){if(affineTriangle(gc,item.texture,item.projected,item.overlap)){stats.drawnTriangles++;stats[nearPass?'nearTriangles':'farTriangles']++;}else stats.degenerateTriangles++;}
        target.save();target.globalAlpha=piece.opacity;target.drawImage(scratch,0,0,w,h,left/sx,top/sy,w/sx,h/sy);target.restore();
      }
    }
    ctx.save();
    try{
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
      ctx.scale(ctx.canvas.width/options.width,ctx.canvas.height/options.height);
      if(layers.background){ctx.fillStyle=options.background;ctx.fillRect(0,0,options.width,options.height);}
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(layers.far)drawPass(ctx,sortedFar,false);
      // Mask removes only the rear ribbon, leaving the already composed photo/ASCII untouched.
      // Never redraw the photo over the composition: that would change wash/ASCII or export alpha.
      if(layers.subject) { ctx.save(); ctx.globalCompositeOperation='destination-out'; ctx.drawImage(mask,0,0,options.width,options.height); ctx.restore(); }
      if(layers.near){
        let layer=nearSurfaces.get(ctx.canvas);
        if(!layer){layer=surface(ctx,ctx.canvas.width,ctx.canvas.height);nearSurfaces.set(ctx.canvas,layer);}
        if(layer.width!==ctx.canvas.width)layer.width=ctx.canvas.width;
        if(layer.height!==ctx.canvas.height)layer.height=ctx.canvas.height;
        const front=layer.getContext('2d');
        front.setTransform(1,0,0,1,0,0);front.globalAlpha=1;front.globalCompositeOperation='source-over';
        front.clearRect(0,0,layer.width,layer.height);
        front.scale(layer.width/options.width,layer.height/options.height);
        front.imageSmoothingEnabled=true;front.imageSmoothingQuality='high';
        // A separate near surface keeps the glyph rasterization independent
        // of earlier destination-out mask work on the far surface.
        drawPass(front,sortedNear,true);
        ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(layer,0,0);
      }
    }finally{ctx.restore();}
    stats.groupCount=stats.groups.length;stats.depthColors=Array.from(colors);
    stats.nearLayerIsolated=true;stats.opacityCompositing='glyph-depth';stats.depthOrder='glyph-pieces';stats.hasTranslucentText=translucent;
    const first=stats.groups[0];
    stats.fitScale=first.fitScale;stats.ringCircumference=first.ringCircumference;
    stats.phraseRepetitions=first.phraseRepetitions;stats.naturalCycleLength=first.naturalCycleLength;stats.addedCharacterSpacing=0;
    return stats;
  }

  return { render, shadeColor, clearGlyphCache:()=>{glyphCache.clear();glyphCachePixels=0;metricsCache.clear();} };
});
