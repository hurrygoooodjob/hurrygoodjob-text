'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../src/projection.js'),Ring=require('../src/ring.js'),Contour=require('../src/contour.js');
function recordingCanvas(width=360,height=480){
 const canvas={width,height,records:[]};canvas.ownerDocument={createElement:()=>recordingCanvas(1,1)};
 const context=new Proxy({canvas,fillStyle:'#000',font:'',globalAlpha:1,globalCompositeOperation:'source-over',stack:[],
  measureText(text){const n=Number(this.font.match(/([\d.]+)px/)?.[1])||20;return{width:n*.55*Array.from(text).length};},
  save(){this.stack.push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation});},restore(){Object.assign(this,this.stack.pop());},
  fillText(text){canvas.records.push({type:'fill',text,color:this.fillStyle,alpha:this.globalAlpha,shadow:this.shadowColor,blur:this.shadowBlur});},
  strokeText(text){canvas.records.push({type:'stroke',text,width:this.lineWidth,color:this.strokeStyle,alpha:this.globalAlpha});},
  drawImage(source,...args){canvas.records.push({type:'image',source,args,alpha:this.globalAlpha});},
  getImageData(){throw Error('ordinary text rendering attempted a pixel readback');}
 },{get:(t,k)=>k in t?t[k]:()=>{}});canvas.getContext=()=>context;return canvas;
}
function environment(){const e={console,KineticProjection:P,KineticRing:Ring,KineticContour:Contour};e.window=e;vm.createContext(e);for(const n of ['model','renderer'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/'+n+'.js'),'utf8'),e);return e;}
test('style dimensions normalize once before export scaling and font weight retains950',()=>{
 const o=P.normalizeOptions({width:3600,height:4800,fontWeight:950,textStyleScale:4,textStrokeEnabled:true,textStrokeWidth:12,textGlowEnabled:true,textGlow:40,textShadowX:50,textShadowY:-50,textShadowBlur:40},900,1200);
 assert.equal(o.textStrokeWidth,48);assert.equal(o.textGlow,160);assert.equal(o.textShadowX,200);assert.equal(o.textShadowY,-200);assert.equal(o.textShadowBlur,160);assert.equal(o.fontWeight,950);
 assert.ok(P.stylePadding(o)>=322,'glow padding must remain in scaled pixels');
});
test('default text effects are disabled and legacy direct ring rendering has no picking surface',()=>{
 const s=P.textStyle();assert.equal(s.textOpacity,1);assert.equal(s.textStrokeEnabled,false);assert.equal(s.textGlowEnabled,false);assert.equal(s.textShadowEnabled,false);
 const c=recordingCanvas(),r=Ring.render(c.getContext('2d'),null,{width:360,height:480,text:'LEGACY',layers:{background:false}});
 assert.equal(r.opacityCompositing,'glyph-depth');assert.equal(r.hasTranslucentText,false);assert.equal('pickGroup'in r,false);assert.equal('groupTargets'in r,false);assert.equal(Ring.decodePickColor,undefined);
});
test('each group sends its own style and opacity to the3D renderer',()=>{
 const e=environment(),M=e.KineticModel,r=e.KineticRenderer.create(recordingCanvas());
 const state=M.normalize({width:900,height:1200,template:'wrap',text:'DEFAULT',textStrokeEnabled:true,textStrokeWidth:3,ringGroups:[{text:'FIRST',textOpacity:1,textStrokeEnabled:false},{text:'SECOND',textOpacity:.4,textGlowEnabled:true,textGlow:30,textShadowEnabled:true,textShadowX:-20,textShadowY:25,textShadowOpacity:.7}]});
 const result=r.render(state).wrap,[a,b]=result.groups.map(g=>g.options);
 assert.equal(a.textStrokeEnabled,false);assert.equal(a.textOpacity,1);assert.equal(b.textOpacity,.4);assert.equal(b.textGlow,30);assert.equal(b.textShadowX,-20);assert.equal(b.textShadowY,25);assert.equal(b.textShadowOpacity,.7);assert.equal(result.opacityCompositing,'glyph-depth');
 assert.equal(r.pickGroup,undefined);assert.equal(r.groupTargets,undefined);r.dispose();
});
test('an invisible extra group generates no glyphs and does not count as visible transparency',()=>{
 const c=recordingCanvas(),result=Ring.render(c.getContext('2d'),null,{width:360,height:480,text:'BASE',groups:[{text:'VISIBLE',textOpacity:1},{text:'HIDDEN',textOpacity:0,radiusZ:350,fontSize:100}],layers:{background:false}});
 assert.equal(result.opacityCompositing,'glyph-depth');assert.equal(result.hasTranslucentText,false);assert.ok(result.quads.length>0);assert.ok(result.quads.every(q=>q.group===0));
});
test('cached ring glyph textures do not rebuild when only opacity changes',()=>{
 Ring.clearGlyphCache();const c=recordingCanvas(),input={width:360,height:480,text:'AA',textGlowEnabled:true,textGlow:12,textStrokeEnabled:true,textStrokeWidth:2,layers:{background:false}};
 const a=Ring.render(c.getContext('2d'),null,input);const firstTexture=[...textures(c.records)][0];
 assert.ok(firstTexture,'opaque glyph texture captured');c.records.length=0;Ring.render(c.getContext('2d'),null,{...input,textOpacity:.5});
 function textures(records,found=new Set()){for(const r of records){if(r.type==='image'){if(r.source.records?.some(e=>e.type==='fill'))found.add(r.source);else if(r.source.records)textures(r.source.records,found);}}return found;}
 assert.ok(textures(c.records).has(firstTexture),'opacity should reuse the previously generated ink texture');assert.ok(a.drawnTriangles>0);
});
