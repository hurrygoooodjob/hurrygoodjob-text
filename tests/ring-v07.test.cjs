'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/projection.js');
const R=require('../src/ring.js');
const opts=(patch={})=>P.normalizeOptions({width:900,height:1200,radiusX:300,radiusZ:180,ringCenterX:450,ringCenterY:600,tilt:0,roll:0,...patch},900,1200,900,1200);
const close=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('a helix has continuous top-to-bottom rise and a finite endpoint, rather than stacked rings',()=>{
  const o=opts({path:'helix',turns:3,helixHeight:900,phase:0});
  const start=P.helixPoint(0,0,o),mid=P.helixPoint(3*Math.PI,0,o),end=P.helixPoint(6*Math.PI,0,o);
  close(start.x,300);close(start.y,-450);close(start.z,0);
  close(mid.x,-300);close(mid.y,0);close(mid.z,0);
  close(end.x,300);close(end.y,450);close(end.z,0);
  const arc=P.arcTable(o);assert.equal(arc.closed,false);
  close(P.thetaAtDistance(arc,arc.length),6*Math.PI);
  assert.ok(P.thetaAtDistance(arc,arc.length+10)>6*Math.PI,'padding must extrapolate, never wrap to the top');
  const ellipse=P.arcTable(opts());assert.ok(arc.length>ellipse.length*3,'vertical pitch adds real arc length');
  let previous=-Infinity;
  for(let i=0;i<=100;i++){const theta=P.thetaAtDistance(arc,arc.length*i/100);assert.ok(theta>previous);previous=theta;}
});

test('helix letters form a perpendicular ribbon frame with preserved physical thickness',()=>{
  const o=opts({path:'helix',turns:2.5,helixHeight:850,tilt:-18,roll:-14,phase:23});
  for(const t of [.1,1.5,3.1,6.2,12]){
    const a=P.helixPoint(t,-20,o),b=P.helixPoint(t,20,o),before=P.helixPoint(t-1e-5,0,o),after=P.helixPoint(t+1e-5,0,o);
    const v=[b.x-a.x,b.y-a.y,b.z-a.z],tangent=[after.x-before.x,after.y-before.y,after.z-before.z];
    close(Math.hypot(...v),40);
    close(v.reduce((sum,n,i)=>sum+n*tangent[i],0),0,1e-6);
  }
});

test('phase rotates the finite helix around its axis without moving its top to the bottom',()=>{
  const a=opts({path:'helix',tilt:0,phase:0}),b=opts({path:'helix',tilt:0,phase:180});
  const arcA=P.arcTable(a),arcB=P.arcTable(b);
  const startA=P.ribbonVertex(arcA,0,0,0,.5,.5,a),startB=P.ribbonVertex(arcB,0,0,0,.5,.5,b);
  close(startA.y,startB.y);close(startA.x,-startB.x);
  const next=P.ribbonVertex(arcA,arcA.length*.25,0,0,.5,.5,a);
  assert.ok(next.y>startA.y,'successive letters progress vertically');
});

test('depth shading changes white and black ink in opposite directions and remains optional',()=>{
  const o=opts({depthFade:.6}),z=o.radiusZ;
  assert.equal(R.shadeColor('#ffffff',z,o),'#ffffff');
  assert.equal(R.shadeColor('#000000',z,o),'#000000');
  const whiteFar=parseInt(R.shadeColor('#ffffff',-z,o).slice(1,3),16),whiteMiddle=parseInt(R.shadeColor('#ffffff',0,o).slice(1,3),16);
  const blackFar=parseInt(R.shadeColor('#000000',-z,o).slice(1,3),16),blackMiddle=parseInt(R.shadeColor('#000000',0,o).slice(1,3),16);
  assert.ok(whiteFar<whiteMiddle&&whiteMiddle<255);
  assert.ok(blackFar>blackMiddle&&blackMiddle>0);
  assert.equal(R.shadeColor('#f72',-z,{...o,depthFade:0}),'#f72');
  assert.equal(R.shadeColor('#000000',-1e9,o),R.shadeColor('#000000',-z,o));
});

function recordingCanvas(width=320,height=480){
  const records=[];
  const ownerDocument={createElement(){return recordingCanvas(1,1);}};
  const canvas={width,height,ownerDocument,records};
  const context={canvas,fillStyle:'#000',font:'',globalAlpha:1,globalCompositeOperation:'source-over',matrix:[],stack:[],
    measureText(text){const fontSize=Number(this.font.match(/([\d.]+)px/)?.[1])||20;return {width:fontSize*.55*Array.from(text).length};},fillText(text){canvas.ink=this.fillStyle;canvas.text=text;},
    save(){this.stack.push({matrix:this.matrix.slice(),globalCompositeOperation:this.globalCompositeOperation});},restore(){Object.assign(this,this.stack.pop());},
    setTransform(...m){this.matrix=m;},transform(...m){this.matrix=m;},scale(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},
    drawImage(texture){records.push({ink:texture.ink,text:texture.text,matrix:this.matrix.slice(),operation:this.globalCompositeOperation,nested:texture.records?.length?texture.records.slice():undefined});}};
  canvas.getContext=()=>context;return canvas;
}

test('reordering distinct text groups leaves the globally depth-sorted draw sequence unchanged',()=>{
  const a=recordingCanvas(),b=recordingCanvas();
  const groups=[{text:'FRONT',textColor:'#ff3300',radiusX:102,radiusZ:58,phase:13,ringCenterY:210},{text:'BACK',textColor:'#0033ff',radiusX:122,radiusZ:86,phase:27,ringCenterY:270}];
  const input={width:320,height:480,fontSize:24,tilt:-18,segments:2,depthFade:.58,layers:{background:false},groups};
  const first=R.render(a.getContext('2d'),null,input),second=R.render(b.getContext('2d'),null,{...input,groups:groups.slice().reverse()});
  assert.equal(first.groupCount,2);assert.equal(second.groupCount,2);
  assert.ok(first.nearGlyphCount>0&&first.farGlyphCount>0);
  assert.ok(first.depthColors.length>2,'each group should have shades as well as its own color');
  assert.deepEqual(a.records,b.records,'painter order must be across groups, not one complete group at a time');
});

test('all rear groups are drawn before one subject mask, then all front groups',()=>{
  const c=recordingCanvas(),mask={width:320,height:480,ink:'mask'};
  const stats=R.render(c.getContext('2d'),mask,{width:320,height:480,segments:2,path:'helix',turns:3,helixHeight:340,fontSize:24,depthFade:.58,groups:[{text:'HELIX'},{text:'SECOND',phase:90}],layers:{background:false}});
  const masks=c.records.map((r,i)=>r.ink==='mask'?i:-1).filter(i=>i>=0);
  assert.equal(masks.length,1);assert.ok(masks[0]>0&&masks[0]<c.records.length-1);
  assert.equal(c.records[masks[0]].operation,'destination-out');
  assert.ok(stats.groups.every(g=>g.path==='helix'&&g.phraseRepetitions>1));
  assert.equal(stats.cameraClippedTriangles,0);
  assert.ok(stats.quads.every(q=>q.points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))));
});

test('group radius scale endpoints remain effective and share one safe camera',()=>{
  const c=recordingCanvas(900,1200);
  const stats=R.render(c.getContext('2d'),null,{width:900,height:1200,fontSize:40,segments:2,perspective:540,layers:{background:false},groups:[
    {text:'SMALL',radiusX:900*.08*.35,radiusZ:900*.035*.35},
    {text:'LARGE',radiusX:900*.62*1.8,radiusZ:900*.5*1.8}
  ]});
  const [small,large]=stats.groups.map(g=>g.options);
  close(small.radiusX,25.2);close(small.radiusZ,11.025);close(large.radiusX,1004.4);close(large.radiusZ,810);
  close(small.perspective,large.perspective);
  assert.ok(large.perspective>large.radiusZ+large.fontSize);
  assert.equal(stats.cameraClippedTriangles,0);
  // The ordinary single-ring interface retains its historical guardrails.
  const single=opts({radiusX:1,radiusZ:1});close(single.radiusX,72);close(single.radiusZ,31.5);
});

test('the full document font range reaches the projected ribbon without a hidden cap',()=>{
  close(opts({fontSize:162}).fontSize,162);
  close(opts({fontSize:200}).fontSize,200);
  assert.ok(opts({fontSize:200}).fontSize>opts({fontSize:180}).fontSize);
});

test('letter height grows continuously even while closed-phrase repetition stays unchanged',()=>{
  const input={width:900,height:1200,radiusX:300,radiusZ:180,ringCenterX:450,ringCenterY:600,tilt:0,roll:0,segments:2,letterSpacing:0,text:'ABCDEFGHIJKLMNOPQRSTUVWXYZ • ABCDEFGHIJKLMNOPQRSTUVWXYZ •',layers:{background:false}};
  const a=R.render(recordingCanvas(900,1200).getContext('2d'),null,{...input,fontSize:40});
  const b=R.render(recordingCanvas(900,1200).getContext('2d'),null,{...input,fontSize:44});
  assert.equal(a.phraseRepetitions,b.phraseRepetitions);
  assert.equal(a.quads.length,b.quads.length);
  const center=q=>q.points.reduce((sum,p)=>sum+p.y,0)/4;
  const tall=q=>Math.max(...q.points.map(p=>p.y))-Math.min(...q.points.map(p=>p.y));
  const i=a.quads.findIndex(q=>q.centerDepth>100);
  assert.ok(i>=0);
  assert.ok(tall(b.quads[i])>tall(a.quads[i])*1.05,'physical text height must grow rather than be cancelled by width fitting');
  close(center(a.quads[i]),center(b.quads[i]));
});
