const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(extra={}){const e=vm.createContext({Blob,setTimeout,clearTimeout,...extra});for(const n of ['model','io'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+n+'.js'),'utf8'),e);return {M:e.KineticModel,IO:e.KineticIO};}
const {M,IO}=load();
test('path geometry is bounded, defensive, and preserves endpoints of long input',()=>{
 const s=M.normalize({template:'customPath',customPath:[{x:NaN,y:.3},...[...Array(1000)].map((_,i)=>({x:i/999,y:.2+i/1500})),{x:Infinity,y:0}],pathPhase:200,pathSpacing:-2,pathDirection:'garbage'});
 assert.equal(s.customPath.length,256);assert.equal(s.customPath[0].x,0);assert.equal(s.customPath.at(-1).x,1);assert.equal(s.pathPhase,100);assert.equal(s.pathSpacing,0);assert.equal(s.pathDirection,'forward');
 assert.equal(M.normalize({customPath:[{x:0,y:0},{x:0,y:0}]}).customPath.length,0);
 assert.equal(M.normalize({customPath:[{x:'0',y:0},{x:1,y:1}]}).customPath.length,0);
});
test('path drawing, cancel-independent copy, undo, and schema10 round trip preserve all options',()=>{
 const a=M.normalize({template:'customPath'}),h=M.createHistory(a),b={...a,customPath:[{x:.1,y:.3},{x:.6,y:.7},{x:.9,y:.2}],pathClosed:true,pathRepeat:false,pathDirection:'reverse',pathPhase:38,pathSpacing:16,textOpacity:.4,textGlowEnabled:true};h.commit(b);
 const current=h.current();current.customPath[0].x=.99;assert.equal(h.current().customPath[0].x,.1);const encoded=IO.serialize(h.current());assert.equal(JSON.parse(encoded).version,10);assert.deepEqual(JSON.parse(JSON.stringify(h.current())),JSON.parse(JSON.stringify(IO.parse(encoded))));
 assert.equal(h.undo().customPath.length,0);assert.equal(h.redo().pathDirection,'reverse');assert.equal(h.current().textOpacity,.4);
});
test('wrap and helix persist independently including colliding IDs across their own collections',()=>{
 const a=M.normalize({...M.DEFAULTS,ringGroups:[{id:'g1',text:'RING',roll:24,turns:1}],helixGroups:[{id:'g1',text:'HELIX',roll:-12,turns:4,height:.8}]});
 const h=M.createHistory(a),b=h.current();b.helixGroups[0].roll=60;h.commit(b);assert.equal(h.current().ringGroups[0].roll,24);assert.equal(M.groupKey({...a,template:'helix'}),'helixGroups');assert.equal(M.groupsFor({...a,template:'helix'})[0].text,'HELIX');assert.equal(M.groupsFor({...a,template:'wrap'})[0].text,'RING');assert.equal(h.undo().helixGroups[0].roll,-12);
 const r=IO.parse(IO.serialize(b));assert.equal(r.helixGroups[0].roll,60);assert.equal(r.ringGroups[0].roll,24);
});
test('legacy shared groups migrate as two independent copies without changing legacy helix appearance',()=>{
 const old={template:'helix',text:'OLD',wrapRoll:32,wrapTilt:-30,size:90,wrapTurns:5,ringGroups:[{text:'PERSIST',roll:40,turns:4}]};
 const s=IO.parse(JSON.stringify({format:'kinetic-type-studio',version:9,state:old}));assert.equal(s.helixGroups[0].roll,40);assert.equal(s.helixGroups[0].turns,4);s.helixGroups[0].text='EDIT';assert.equal(s.ringGroups[0].text,'PERSIST');assert.equal(M.normalize(s).helixGroups[0].text,'EDIT');
 const empty=M.normalize({template:'helix',wrapRoll:32,wrapTilt:-30,size:90,wrapTurns:5});assert.equal(M.groupsFor(empty)[0].roll,32);assert.equal(M.groupsFor(empty)[0].size,90);
 const fresh=M.normalize({...M.DEFAULTS,template:'helix'});assert.equal(M.groupsFor(fresh)[0].roll,0);assert.equal(M.groupsFor(fresh)[0].size,64);
});
test('removed effects are absent from picker and old projects migrate with their content intact',()=>{
 assert.equal(M.TEMPLATES.length,13);assert.equal(M.TEMPLATES.some(t=>['danger','tunnel'].includes(t.id)),false);assert.equal(M.TEMPLATES.some(t=>t.id==='customPath'),true);
 for(const [before,after] of [['tunnel','wave'],['danger','crash']]){const s=IO.parse(JSON.stringify({format:'kinetic-type-studio',version:9,state:{template:before,text:'KEEP CONTENT',textOpacity:.6}}));assert.equal(s.template,after);assert.equal(s.text,'KEEP CONTENT');assert.equal(s.textOpacity,.6);}
});
test('v9 draft recovery is read-only, subsequent saves target only v10',async()=>{
 const writes=[],old=JSON.stringify({savedAt:1,json:JSON.stringify({format:'kinetic-type-studio',version:9,state:{template:'helix',text:'MY WORK',ringGroups:[{text:'USER',turns:4}]}})});
 const {IO}=load({localStorage:{getItem:k=>k==='hurrygoodjob-text.v9.draft'?old:null,setItem:(k,v)=>writes.push(k),removeItem(){}}});
 assert.equal(await IO.loadDraft(),null);const s=await IO.loadDraft({includeLegacy:true});assert.equal(s.helixGroups[0].turns,4);assert.equal(writes.length,0);await IO.saveDraft(s);assert.deepEqual(writes,['hurrygoodjob-text.v10.draft']);
});
