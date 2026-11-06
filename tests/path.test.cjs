const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/path.js');

function context() {
  const stack = [], calls = [];
  const ctx = { canvas: { width: 900, height: 1200 }, font: '700 50px sans-serif', globalAlpha: 1, fillStyle: '#fff', calls,
    save() { stack.push({ font: this.font, globalAlpha: this.globalAlpha, fillStyle: this.fillStyle }); },
    restore() { Object.assign(this, stack.pop()); }, translate(x,y) { calls.push(['translate',x,y]); }, rotate(a) { calls.push(['rotate',a]); },
    measureText(s) { calls.push(['measure',s]); return { width: (parseFloat(this.font.match(/([\d.]+)px/)[1])) * .6 }; },
    fillText(s,x,y) { calls.push(['fill',s,x,y]); }, strokeText(s,x,y) { calls.push(['stroke',s,x,y]); },
    clearRect() { throw Error('path renderer must not clear photos'); }, getImageData() { throw Error('path renderer must not read pixels'); }
  };
  return ctx;
}
const line = [{x:.1,y:.5},{x:.9,y:.5}];
const base = { points:line,width:1000,height:800,text:'HELLO',fontSize:40,fontWeight:700,fontFamily:'sans-serif',spacing:2,color:'#ffffff',repeat:false,phase:40,speed:48 };

test('simplify bounds a long stroke and preserves its two endpoints',()=>{
  const points=Array.from({length:10000},(_,i)=>({x:i/9999,y:.5+Math.sin(i*.03)*.3}));
  const simple=K.simplify(points,.001,256);
  assert.ok(simple.length<=256);assert.deepEqual(simple[0],points[0]);assert.deepEqual(simple.at(-1),points.at(-1));
  assert.equal(K.simplify(Array.from({length:100},(_,i)=>({x:i/99,y:.4}))).length,2);
});
test('empty, invalid and zero-length strokes wait without touching the canvas',()=>{
  for(const points of [[],null,[{x:NaN,y:.1}],[{x:.4,y:.4},{x:.4,y:.4}]]) {
    const c=context(),s=K.render(c,{...base,points});assert.equal(s.waiting,true);assert.equal(s.glyphCount,0);assert.equal(c.calls.length,0);
  }
});
test('straight path has correct arc length, endpoints and tangent',()=>{
  const p=K.prepare(line,1000,800,false);assert.ok(Math.abs(p.length-800)<1e-8);
  assert.deepEqual(p.points[0],{x:100,y:400});assert.deepEqual(p.points.at(-1),{x:900,y:400});
  const mid=K.sample(p,400);assert.ok(Math.abs(mid.x-500)<1e-8);assert.equal(mid.y,400);assert.equal(mid.angle,0);
});
test('closed spline meets smoothly while an open return-to-start stroke retains its last segment',()=>{
  const points=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8},{x:.2,y:.2}];
  const closed=K.prepare(points,900,900,true),open=K.prepare(points,900,900,false);
  assert.equal(closed.closed,true);assert.deepEqual(closed.points[0],closed.points.at(-1));assert.deepEqual(open.points[0],open.points.at(-1));
  assert.ok(open.length>1800);const a=K.sample(closed,.01),b=K.sample(closed,closed.length-.01);assert.ok(Math.abs(a.angle-b.angle)<.02);
});
test('motion follows the same text direction; reverse changes travel rather than glyph orientation',()=>{
  const a=K.render(context(),{...base,motion:true,time:0});
  const f=K.render(context(),{...base,motion:true,time:1});
  const r=K.render(context(),{...base,motion:true,time:1,direction:'reverse'});
  assert.ok(f.glyphs[0].x>a.glyphs[0].x);assert.ok(r.glyphs[0].x<a.glyphs[0].x);
  assert.equal(f.glyphs[0].char,'H');assert.equal(r.glyphs[0].char,'H');assert.equal(f.glyphs[0].angle,0);assert.equal(r.glyphs[0].angle,0);
});
test('static mode and zero-speed motion do not drift across time',()=>{
  const a=K.render(context(),{...base,time:0,motion:false}),b=K.render(context(),{...base,time:9,motion:false});assert.deepEqual(a,b);
  const c=K.render(context(),{...base,time:0,motion:true,speed:0}),d=K.render(context(),{...base,time:9,motion:true,speed:0});assert.deepEqual(c,d);
});
test('the tail of a phrase longer than the path eventually enters both open and closed paths',()=>{
  for(const closed of [false,true])for(const repeat of [false,true]){
    const points=closed?[{x:.1,y:.2},{x:.4,y:.2},{x:.3,y:.5}]:line;
    const options={...base,points,closed,repeat,text:'A'.repeat(90)+'Z',phase:0,motion:true,speed:100};
    assert.equal(K.render(context(),{...options,time:0}).glyphs.some(g=>g.char==='Z'),false);
    let tailSeen=false;
    for(let t=0;t<25;t+=.2)if(K.render(context(),{...options,time:t}).glyphs.some(g=>g.char==='Z')){tailSeen=true;break;}
    assert.equal(tailSeen,true,`closed=${closed}, repeat=${repeat}`);
  }
});
test('repeat extends the phrase over the path and typography still respects the glyph budget',()=>{
  const once=K.render(context(),{...base,phase:0}),repeat=K.render(context(),{...base,phase:0,repeat:true});assert.equal(once.glyphCount,5);assert.ok(repeat.glyphCount>once.glyphCount);
  const zigzag=Array.from({length:256},(_,i)=>({x:i%2?.95:.05,y:i/255}));
  const bounded=K.render(context(),{...base,points:zigzag,width:16000,height:16000,text:'X',fontSize:1,spacing:0,repeat:true,phase:0});
  assert.ok(bounded.glyphCount<=K.MAX_GLYPHS);assert.equal(bounded.limited,true);
});
test('equivalent copied points reuse geometry and moving frames reuse text measurements',()=>{
  K.clearCaches();const c=context();
  for(let i=0;i<30;i++)K.render(c,{...base,points:line.map(p=>({...p})),motion:true,time:i/30});
  const d=K.diagnostics();assert.equal(d.geometryBuilds,1);assert.equal(d.measurementBuilds,1);
  assert.equal(c.calls.filter(x=>x[0]==='measure').length,5);
});
test('Unicode grapheme clusters stay together and overall opacity belongs to the caller',()=>{
  const c=context();c.globalAlpha=.35;
  const s=K.render(c,{...base,text:'👩‍💻Á中',phase:0,textOpacity:.1});
  assert.deepEqual(s.glyphs.map(g=>g.char),['👩‍💻','Á','中']);assert.equal(c.globalAlpha,.35);
  assert.equal(c.calls.filter(x=>x[0]==='fill').length,3);
});
test('geometry and measurement caches have bounded entry counts',()=>{
  K.clearCaches();for(let i=0;i<100;i++)K.render(context(),{...base,text:'TEXT '+i,points:[{x:.1,y:.1+i*.005},{x:.9,y:.7}],fontSize:40});
  const d=K.diagnostics();assert.ok(d.geometryEntries<=8);assert.ok(d.measurementEntries<=64);
});
