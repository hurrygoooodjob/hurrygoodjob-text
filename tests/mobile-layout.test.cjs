'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fitArtwork,keyboardVisible,preservePan}=require('../src/view-layout.js');

test('artwork fits all seven supported ratios without stretching or cropping',()=>{
  const ratios=[[1080,1080],[900,1200],[1200,900],[900,1600],[1600,900],[1200,800],[800,1200]];
  for(const [vw,vh]of [[364,500],[364,390],[294,330],[820,240]])for(const [w,h]of ratios){
    const out=fitArtwork(vw,vh,w,h,12);
    assert.ok(out.width>0&&out.height>0);
    assert.ok(out.width<=vw-12&&out.height<=vh-12,'entire artwork remains visible');
    assert.ok(Math.abs(out.width/w-out.height/h)<=1/w+1/h,'only integer rounding can change the ratio');
    assert.ok((vw-12-out.width)<=1||(vh-12-out.height)<=1,'one available dimension is fully used');
  }
});

test('horizontal photos use the available width while taller space enlarges portrait artwork',()=>{
  const wideShort=fitArtwork(364,390,1600,900),wideTall=fitArtwork(364,500,1600,900);
  assert.deepEqual(wideTall,wideShort,'extra stage height must not stretch a wide photo');
  const portraitShort=fitArtwork(364,390,900,1200),portraitTall=fitArtwork(364,500,900,1200);
  assert.ok(portraitTall.height>portraitShort.height);
  assert.equal(portraitTall.width,352);
});

test('transient zero-size views remain nonzero until a real layout is available',()=>{
  for(const [vw,vh]of [[0,0],[0,400],[340,0]]){
    const out=fitArtwork(vw,vh,900,1200);
    assert.ok(Number.isFinite(out.width)&&Number.isFinite(out.height));
    assert.ok(out.width>=1&&out.height>=1);
  }
});

test('keyboard recognition needs text focus plus substantial height loss, and ignores browser zoom',()=>{
  const base={width:390,height:360,baseline:844,focused:true};
  assert.equal(keyboardVisible(base),true);
  assert.equal(keyboardVisible({...base,focused:false}),false);
  assert.equal(keyboardVisible({...base,height:760}),false,'browser bars alone should not trigger keyboard layout');
  assert.equal(keyboardVisible({...base,scale:1.5}),false,'page zoom is not a keyboard');
  assert.equal(keyboardVisible({...base,width:1200}),false);
  assert.equal(keyboardVisible({...base,width:844,height:390,baseline:390}),false,'landscape has no height loss');
});

test('pan preserves the observed image location across dock sizes and reverses without drift',()=>{
  for(const pan of [-110,-37.5,0,42,115]){
    const resized=preservePan(pan,280,352);
    assert.ok(Math.abs(resized/352-pan/280)<1e-12);
    assert.ok(Math.abs(preservePan(resized,352,280)-pan)<1e-10);
  }
  assert.equal(preservePan(44,0,352),0,'unknown prior layout centers safely');
});

test('compact banks keep every existing parameter reachable, with no more than three controls at once',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),root=path.resolve(__dirname,'..');
  const context=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(path.join(root,'src/mobile-editor.js'),'utf8'),context);
  const banksFor=context.window.KineticMobileEditor.banksFor,html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const panels=html.slice(html.indexOf('<section id="panelLayout"'),html.indexOf('<p id="message"'));
  const fields=[...panels.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]).filter(id=>id!=='groupName');
  const available=new Set();
  for(const effect of ['wrap','helix','contour','spiral','customPath','hud','wave','rain','orbit','drift','coil','flag','crash'])for(const category of ['Layout','Style','Motion','ASCII']){
    const banks=banksFor(effect,category);assert.ok(banks.length>0);
    for(const bank of banks){
      const controls=bank.slice(1);assert.ok(controls.length>=1&&controls.length<=3,`${effect}/${category}/${bank[0]} fits one compact row`);
      assert.equal(new Set(controls).size,controls.length);
      controls.forEach(id=>{assert.ok(html.includes('id="'+id+'"'),id+' is a real original control');available.add(id);});
    }
  }
  for(const id of fields)assert.ok(available.has(id),id+' remains editable in a mobile bank');
  assert.ok(available.has('playToggle'),'play/pause stays accessible in addition to form fields');
});
