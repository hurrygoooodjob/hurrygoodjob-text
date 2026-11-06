'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/projection.js');
const {render}=require('../src/ring.js');
const o=P.normalizeOptions({width:900,height:1200,ringCenterX:450,ringCenterY:500,perspective:1200},900,1200,600,900);
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);

test('pinhole projection produces the expected near/far magnification',()=>{
  const near=P.project({x:100,y:0,z:200,u:0,v:0},o),far=P.project({x:100,y:0,z:-200,u:0,v:0},o);
  close(near.x-o.centerX,120);close(far.x-o.centerX,1200/14);
  assert.ok(near.scale>far.scale);assert.equal(P.project({x:0,y:0,z:1200,u:0,v:0},o),null);
});

test('ring tilt changes both vertical projection and depth, preserving 3D length',()=>{
  const q=P.ringPoint(Math.PI/2,23,{...o,tilt:40});
  close(q.y*q.y+q.z*q.z,23*23+o.radiusZ*o.radiusZ,1e-7);
  assert.notEqual(q.y,23);assert.notEqual(q.z,o.radiusZ);
});

test('z=0 split retains interpolated texture coordinates without mutating input',()=>{
  const triangle=[{x:0,y:0,z:-2,u:0,v:0},{x:4,y:0,z:2,u:4,v:0},{x:0,y:4,z:2,u:0,v:4}];
  const before=JSON.stringify(triangle),near=P.clipDepth(triangle,true),far=P.clipDepth(triangle,false);
  assert.equal(JSON.stringify(triangle),before);assert.ok(near.every(p=>p.z>=0));assert.ok(far.every(p=>p.z<=0));
  assert.ok(near.some(p=>p.z===0&&p.x===2&&p.u===2));assert.ok(far.some(p=>p.z===0&&p.y===2&&p.v===2));
  const area=poly=>P.triangulate(poly).reduce((sum,t)=>sum+Math.abs(P.signedArea(t)),0);
  close(area(near)+area(far),Math.abs(P.signedArea(triangle)));
});

test('painter sorting is far-to-near and does not modify its input',()=>{
  const make=z=>[0,1,2].map(x=>({x,y:0,z,u:0,v:0}));const input=[make(20),make(-40),make(0)];
  assert.deepEqual(P.sortFarToNear(input).map(P.depth),[-40,0,20]);assert.equal(P.depth(input[0]),20);
});

test('arc length lookup stays periodic and respects elliptical quarter turns',()=>{
  const arc=P.arcTable(o);close(P.thetaAtDistance(arc,0),0);close(P.thetaAtDistance(arc,arc.length),0);
  close(P.thetaAtDistance(arc,arc.length/4),Math.PI/2,1e-8);
  close(P.thetaAtDistance(arc,-arc.length/4),Math.PI*1.5,1e-8);
});

test('front glyph texture U and successive glyphs read left-to-right; rear is a reversed face',()=>{
  const options={...o,phase:0,tilt:-18};const arc=P.arcTable(options);
  const frontDistance=arc.length*.75;
  const left=P.ribbonVertex(arc,frontDistance,60,80,0,.5,options);
  const right=P.ribbonVertex(arc,frontDistance,60,80,1,.5,options);
  assert.ok(left.z>0&&right.z>0,'test must inspect the front half');
  assert.ok(P.project(right,options).x>P.project(left,options).x,'increasing U must move right on the front');
  const first=P.project(P.ribbonVertex(arc,frontDistance-35,50,80,.5,.5,options),options);
  const second=P.project(P.ribbonVertex(arc,frontDistance+35,50,80,.5,.5,options),options);
  assert.ok(second.x>first.x,'successive glyphs must also advance left-to-right');
  const rearLeft=P.ribbonVertex(arc,arc.length*.25,60,80,0,.5,options);
  const rearRight=P.ribbonVertex(arc,arc.length*.25,60,80,1,.5,options);
  assert.ok(rearLeft.z<0&&rearRight.z<0);
  assert.ok(P.project(rearRight,options).x<P.project(rearLeft,options).x,'rear face remains physically reversed');
});

test('unsafe inputs are bounded; options and Chinese code points survive normalization',()=>{
  const source={width:-8,height:Infinity,tilt:999,phase:-30,perspective:-8,fontSize:NaN,subjectBox:{width:-3,height:0},text:'围绕你 • 环绕文字'};
  const before=JSON.stringify(source),safe=P.normalizeOptions(source,900,1200,600,900);
  assert.equal(JSON.stringify(source),before);assert.equal(safe.width,64);assert.equal(safe.height,1200);
  assert.equal(safe.tilt,70);assert.equal(safe.phase,330);assert.ok(safe.perspective>safe.radiusZ);
  assert.equal(safe.subjectBox.width,1);assert.equal(safe.subjectBox.height,1);assert.equal(safe.text,source.text);
  assert.equal(Array.from(P.normalizeOptions({text:'中'.repeat(600)},900,1200,600,900).text).length,500);
});

test('renderer rejects missing context',()=>{assert.throws(()=>render(null,null),/Canvas 2D/);});


test('camera-plane roll preserves 3D length and depth at all ring positions',()=>{
  for(const roll of [-90,-30,-14,0,35,90])for(const theta of [0,.6,Math.PI/2,Math.PI,4.5]){
    const straight=P.ringPoint(theta,25,{...o,roll:0,tilt:-18});
    const rolled=P.ringPoint(theta,25,{...o,roll,tilt:-18});
    close(rolled.x**2+rolled.y**2+rolled.z**2,straight.x**2+straight.y**2+straight.z**2,1e-7);
    close(rolled.z,straight.z);assert.equal(Math.sign(rolled.z),Math.sign(straight.z));
  }
});
test('camera-plane roll projects as the same rotation around ring center',()=>{
  const roll=-14,a=roll*Math.PI/180;
  const straight=P.project(P.ringPoint(.8,20,{...o,roll:0}),o);
  const rolled=P.project(P.ringPoint(.8,20,{...o,roll}),o);
  const x=straight.x-o.centerX,y=straight.y-o.centerY;
  close(rolled.x,o.centerX+x*Math.cos(a)-y*Math.sin(a));
  close(rolled.y,o.centerY+x*Math.sin(a)+y*Math.cos(a));
  close(rolled.scale,straight.scale);
  const right=P.ringPoint(0,0,{...o,tilt:0,roll});assert.ok(right.x>0&&right.y<0,'negative roll raises the right side on a downward-y canvas');
  assert.equal(P.normalizeOptions({roll:500},900,1200,600,900).roll,90);
});
