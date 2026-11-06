const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const env={};env.window=env;
vm.createContext(env);
for(const n of ['model','renderer'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+n+'.js'),'utf8'),env);
const M=env.KineticModel,R=env.KineticRenderer;
const png='data:image/png;base64,iVBORw0KGgo=';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('new documents default to static wrap, and expose four subject effects, custom path and eight legacy motion templates',()=>{
 const s=M.normalize();assert.equal(s.mode,'static');assert.equal(s.template,'wrap');assert.equal(s.size,88);assert.equal(s.imageWash,0);assert.equal(s.smallText,false);assert.equal(s.wrapRoll,-14);
 assert.equal(M.TEMPLATES.length,13);assert.equal(R.templateIds.length,13);
 for(const id of ['editorial','swiss','typegrid','specimen']){assert.ok(!M.TEMPLATES.some(t=>t.id===id));const old=M.normalize({template:id,mode:'motion',text:'保持文字',images:[{dataURL:png,name:'photo'}]});assert.equal(old.template,'wrap');assert.equal(old.mode,'static');assert.equal(old.text,'保持文字');assert.equal(old.images.length,1);}
});
test('3D controls clamp non-finite and out-of-range values, preserve valid settings',()=>{
 const s=M.normalize({wrapTilt:Infinity,wrapRoll:300,wrapPhase:-99,wrapRadius:100,wrapDepth:0,wrapPerspective:0,wrapX:2,wrapY:-1});
 assert.equal(s.wrapTilt,-18);assert.equal(s.wrapRoll,90);assert.equal(s.wrapPhase,0);assert.equal(s.wrapRadius,.62);assert.equal(s.wrapDepth,.035);assert.equal(s.wrapPerspective,.6);assert.equal(s.wrapX,1);assert.equal(s.wrapY,0);
 const valid=M.normalize({mode:'motion',template:'wrap',wrapTilt:30,wrapPhase:120});assert.equal(valid.mode,'motion');assert.equal(valid.wrapTilt,30);assert.equal(valid.wrapPhase,120);
});
test('subject mask is bounded, embedded raster only, and cannot survive without photos',()=>{
 const s=M.normalize({images:[{dataURL:png}],subjectMask:png});assert.equal(s.subjectMask,png);
 for(const bad of ['https://example.com/mask.png','data:image/svg+xml;base64,PHN2Zz4=',png+'x'.repeat(M.SUBJECT_MASK_LIMIT)])assert.equal(M.normalize({images:[{dataURL:png}],subjectMask:bad}).subjectMask,'');
 assert.equal(M.normalize({subjectMask:png}).subjectMask,'');
});
test('history retains mask and 3D edits across undo/redo',()=>{
 const initial=M.normalize({images:[{dataURL:png}],subjectMask:png});const history=M.createHistory(initial);history.commit({...initial,wrapTilt:38,wrapPhase:260});assert.equal(history.undo().wrapTilt,-18);const next=history.redo();assert.equal(next.wrapPhase,260);assert.equal(next.subjectMask,png);
});
test('all 63 count/ratio layouts cover canvas equally without overlaps',()=>{
 for(const [w,h] of [[1,1],[3,4],[4,3],[9,16],[16,9],[3,2],[2,3]])for(let n=1;n<=9;n++){
  const W=w*120,H=h*120,cells=R.collageRects(n,W,H);assert.equal(cells.length,n);near(cells.reduce((a,c)=>a+c.w*c.h,0),W*H);
  cells.forEach((c,i)=>{near(c.w*c.h,W*H/n);assert.ok(c.x>=0&&c.y>=0&&c.x+c.w<=W+1e-8&&c.y+c.h<=H+1e-8);cells.slice(i+1).forEach(d=>assert.ok(Math.max(0,Math.min(c.x+c.w,d.x+d.w)-Math.max(c.x,d.x))*Math.max(0,Math.min(c.y+c.h,d.y+d.h)-Math.max(c.y,d.y))<1e-5));});
 }
});
test('motion template legacy workflow and pure-photo migration remain valid',()=>{
 assert.equal(M.normalize({template:'wave'}).mode,'motion');assert.equal(M.normalize({template:'wave',mode:'static'}).mode,'static');const p=M.normalize({template:'collage',images:[{dataURL:png}]});assert.equal(p.textLayer,false);assert.equal(p.template,'wrap');assert.equal(p.backgroundMode,'image');
});
