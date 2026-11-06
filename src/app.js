(function () {
  'use strict';
  const V=window.KineticViewLayout;
  const M=window.KineticModel,IO=window.KineticIO,R=window.KineticRenderer,S=window.KineticSubject,P=window.KineticPath;
  const $=id=>document.getElementById(id);
  if(!M||!IO||!R){$('message').textContent='编辑器未完整载入，请重新打开。';return;}
  const canvas=$('posterCanvas'),mount=$('canvasMount'),viewport=$('previewViewport');
  const renderer=R.create(canvas),boot=window.BootSequence?new window.BootSequence($('boot-screen')):null;
  let state=M.normalize(M.DEFAULTS),history=M.createHistory(state),images=[],maskImage=null;
  let revision=0,workToken=0,subjectToken=0,saveTimer=0,commitTimer=0,frameRequest=0,lastFrame=0,lastPaint=0;
  let previewSize=null;
  let dirty=true,playing=false,busy=false,selecting=false,segmenting=false,screen='start',disposed=false;
  let activeGroup=0,activeGroupId='',groupOptionsKey='',lastSyncedGroupId='';
  let forceGroupSync=false,valuesDirty=false,parameterTab='Layout',styleTab='Basic',pendingBoot=false;
  let photoAssets=[],saveChain=Promise.resolve(),exportController=null,exportToken=0,prepared=null,historyOperation=null;
  let zoom=1,panX=0,panY=0,fitWidth=1,fitHeight=1,pinch=null,tap=null;
  const pointers=new Map();
  let mobileEditor=null,resizeFrame=0,keyboardBaseline=window.visualViewport?.height||window.innerHeight||800,viewportWidth=window.innerWidth||1024,textView=null,restoreTextView=null;
  const selectedGroups={ringGroups:'',helixGroups:''};
  let helixLayout='Shape',drawing=false,draftPath=[],strokeBefore=[],strokePointer=null,strokeBlocked=false,drawView=null,guideDirty=false;
  const labels={wrap:'主体环绕',contour:'沿主体轮廓',spiral:'平面螺旋',helix:'立体螺旋',customPath:'自定义路径',hud:'文字连线',wave:'波浪文字',rain:'字符雨',orbit:'圆形环绕',drift:'漂浮网格',coil:'字符旋涡',flag:'旗帜波动',crash:'冲撞时钟'};
  const styleKeys=M.TEXT_STYLE_KEYS||['textOpacity','textStrokeEnabled','textStrokeWidth','textStrokeColor','textGlowEnabled','textGlow','textGlowColor','textShadowEnabled','textShadowBlur','textShadowX','textShadowY','textShadowColor','textShadowOpacity'];
  const fields={pathClosed:'pathClosed',pathRepeat:'pathRepeat',pathDirection:'pathDirection',pathPhase:'pathPhase',pathSpacing:'pathSpacing',textInput:'text',textEnabled:'textLayer',wrapTilt:'wrapTilt',wrapRoll:'wrapRoll',wrapPhase:'wrapPhase',wrapX:'wrapX',wrapY:'wrapY',wrapRadius:'wrapRadius',wrapPerspective:'wrapPerspective',depthFade:'depthFade',wrapTurns:'wrapTurns',wrapHeight:'wrapHeight',contourGap:'contourGap',contourSpacing:'contourSpacing',contourCount:'contourCount',spiralTurns:'spiralTurns',textSize:'size',textColor:'textColor',fontSelect:'font',asciiEnabled:'asciiLayer',asciiDensity:'asciiDensity',asciiCoverage:'asciiCoverage',asciiContrast:'asciiContrast',asciiEdge:'asciiEdge',asciiInvert:'asciiInvert',asciiGlow:'asciiGlow',asciiAnimate:'asciiAnimate',asciiScanlines:'asciiScanlines',asciiCharset:'asciiCharset',asciiBlend:'asciiBlend',asciiLayerOrder:'asciiLayerOrder',imageWash:'imageWash',imageFit:'imageFit',imagePathMode:'imagePathMode',speed:'speed',duration:'duration',density:'density',spread:'spread',rowGap:'rowGap',...Object.fromEntries(styleKeys.map(key=>[key,key]))};
  const numeric=new Set(['pathPhase','pathSpacing','wrapTilt','wrapRoll','wrapPhase','wrapX','wrapY','wrapRadius','wrapPerspective','depthFade','wrapTurns','wrapHeight','contourGap','contourSpacing','contourCount','spiralTurns','size','fontWeight','asciiDensity','asciiCoverage','asciiContrast','asciiEdge','imageWash','speed','duration','density','spread','rowGap',...styleKeys.filter(key=>!key.endsWith('Enabled')&&!key.endsWith('Color'))]);
  const subjectEffects=new Set(['wrap','contour','spiral','helix']),groupEffects=new Set(['wrap','helix']);
  const percentFields=new Set(['wrapX','wrapY','wrapRadius','depthFade','wrapHeight','contourGap','contourSpacing','textOpacity','textShadowOpacity']);
  const effectHints={wrap:'文字分成前后两面，点选主体后自动遮挡。',contour:'沿选中主体真实边缘排字，先点选主体。',spiral:'从中心向外盘旋，点选主体可对准主角。',helix:'连续文字上下盘绕；与主体环绕分别保存设置。',customPath:'绘制一条路径，文字沿线排列；开启动态后沿线流动。'};
  const groupFields={groupOffsetX:'offsetX',groupOffsetY:'offsetY',groupRadiusScale:'radiusScale',groupDepthScale:'depthScale'};
  const selectedFields={text:'text',textColor:'color',wrapRoll:'roll',wrapTilt:'tilt',wrapPhase:'phase',size:'size',font:'font',fontWeight:'fontWeight',depthFade:'depthFade',wrapTurns:'turns',wrapHeight:'height',...Object.fromEntries(styleKeys.map(key=>[key,key]))};
  const outputNodes=new Map(Object.keys(fields).map(id=>[id,[...document.querySelectorAll('[data-output="'+id+'"]')]]));
  const groupOutputNodes=new Map(Object.keys(groupFields).map(id=>[id,[...document.querySelectorAll('[data-group-output="'+id+'"]')]]));
  function baseGroup(){return M.makeGroup(state,0);}
  function documentGroups(){return M.groupsFor?M.groupsFor(state):(state.ringGroups?.length?state.ringGroups.map(group=>({...group})):[baseGroup()]);}
  function groupKey(){return M.groupKey?M.groupKey(state):'ringGroups';}
  function currentGroup(){const groups=documentGroups(),key=groupKey(),remembered=selectedGroups[key],byId=groups.findIndex(group=>group.id===remembered);activeGroup=byId>=0?byId:0;activeGroupId=groups[activeGroup].id;selectedGroups[key]=activeGroupId;return groups[activeGroup];}
  function groupPatch(groups){return groupKey()==='helixGroups'?{helixGroups:groups}:{ringGroups:groups,text:groups[0]?.text??state.text,textColor:groups[0]?.color??state.textColor};}
  function editGroup(patch,debounce=false){const group=currentGroup(),groups=documentGroups();const index=groups.findIndex(item=>item.id===group.id);if(index<0)return;groups[index]={...groups[index],...patch};mutate(groupPatch(groups),debounce);}
  function groupLabel(group){const words=group.text.replace(/\s+/g,' ').trim();return group.name+(words?' · '+Array.from(words).slice(0,18).join(''):' · 空文字');}
  function groupOutput(key,value){return ['roll','tilt','phase'].includes(key)?Math.round(value)+'°':['offsetX','offsetY','radiusScale','depthScale','depthFade','height'].includes(key)?Math.round(value*100)+'%':String(value);}
  function syncGroups(){
    const enabled=groupEffects.has(state.template),group=currentGroup(),groups=documentGroups();
    $('groupControls').hidden=!enabled;$('textWorkspace').classList.toggle('no-groups',!enabled);$('groupAdjustments').hidden=!enabled||(state.template==='helix'&&helixLayout==='Shape');$('groupNameControl').hidden=!enabled;
    $('textLabel').textContent=enabled?group.name+' · 仅编辑这一组':'文字';
    const key=groupKey()+'\n'+groups.map(item=>item.id+'|'+groupLabel(item)).join('\n');
    if(groupOptionsKey!==key){groupOptionsKey=key;$('groupSelect').replaceChildren();groups.forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=groupLabel(item);$('groupSelect').append(option);});}
    $('groupSelect').value=group.id;$('groupSelect').disabled=busy;$('addGroup').disabled=busy||groups.length>=6;$('removeGroup').disabled=busy||groups.length<=1;
    if(forceGroupSync||document.activeElement!==$('groupName'))$('groupName').value=group.name;$('groupName').disabled=busy;
  }
  function setVisualViewport(){
    const height=window.visualViewport?.height||window.innerHeight||800,width=window.innerWidth||1024,scale=window.visualViewport?.scale||1;
    const active=document.activeElement,focused=!!active&&(active.tagName==='TEXTAREA'||active.tagName==='INPUT'&&['text','search','email','url','tel','number'].includes(active.type));
    if(Math.abs(width-viewportWidth)>80){keyboardBaseline=height;viewportWidth=width;}
    if(!focused&&!textView&&!restoreTextView&&!document.body.classList.contains('viewport-keyboard'))keyboardBaseline=height;
    if(focused)keyboardBaseline=Math.max(keyboardBaseline,height);
    const keyboard=V.keyboardVisible({width,height,baseline:keyboardBaseline,focused,scale});
    document.documentElement?.style?.setProperty('--editor-visual-height',height+'px');
    document.documentElement?.style?.setProperty('--editor-visual-top',(window.visualViewport?.offsetTop||0)+'px');
    document.body.classList.toggle('viewport-short',width<=600&&!keyboard&&height<=700);
    document.body.classList.toggle('viewport-keyboard',keyboard);
    if(restoreTextView&&!keyboard&&height>=keyboardBaseline-80){zoom=restoreTextView.zoom;panX=restoreTextView.x*fitWidth;panY=restoreTextView.y*fitHeight;restoreTextView=null;}
  }
  function queueResize(){if(!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;setVisualViewport();resize();});}
  function mobileTextEdit(open){
    if(open){textView={zoom,x:panX/fitWidth,y:panY/fitHeight};keyboardBaseline=Math.max(keyboardBaseline,window.visualViewport?.height||window.innerHeight||800);}
    else {flush();restoreTextView=textView;textView=null;}
    queueResize();
  }
  function setDetail(detail){document.body.classList.toggle('detail-view',detail);$('detailToggle').textContent=detail?'返回':'细节';$('detailToggle').setAttribute('aria-label',detail?'返回普通调参':'进入细节调节');queueResize();window.scrollTo({top:0,behavior:'auto'});}

  function chooseGroup(id){if(drawing||busy||!groupEffects.has(state.template))return;flush();const groups=documentGroups(),index=groups.findIndex(group=>group.id===id);if(index<0)return;document.activeElement?.blur?.();activeGroup=index;activeGroupId=id;selectedGroups[groupKey()]=id;forceGroupSync=true;syncUI();}
  function showParameterTab(name){parameterTab=name;for(const key of ['Layout','Style','Motion','ASCII']){$('panel'+key).hidden=key!==name;$('tab'+key).setAttribute('aria-selected',String(key===name));$('tab'+key).tabIndex=key===name?0:-1;}$('asciiSettings').setAttribute('aria-pressed',String(name==='ASCII'));$('controlColumn').classList.toggle('ascii-mode',name==='ASCII');$('parameterPanels').scrollTop=0;mobileEditor?.sync();}
  function showStyleTab(name){styleTab=name;for(const key of ['Basic','Stroke','Glow','Shadow']){$('stylePanel'+key).hidden=key!==name;$('style'+key).setAttribute('aria-selected',String(key===name));$('style'+key).tabIndex=key===name?0:-1;}$('parameterPanels').scrollTop=0;}
  const assetLayoutKeys=new Set(['width','height','imageFit']);
  const errorText=error=>error&&error.name==='AbortError'?'操作已取消。':error&&error.message||'操作未完成，请重试。';
  function notify(text,error=false){$('message').textContent=text;$('message').classList.toggle('is-error',error);}
  function setBusy(value){busy=value;$('studio').setAttribute('aria-busy',String(value));syncUI();}
  function openEditor(){if(!images.length)return;screen='editor';document.body.classList.add('editor-active');$('startScreen').hidden=true;$('editorScreen').hidden=false;resize();dirty=true;requestPaint();window.scrollTo({top:0,behavior:'auto'});if(pendingBoot){pendingBoot=false;boot?.play();}notify('调节下方旋钮，实时查看效果。');mobileEditor?.sync();queueResize();}
  function openStart(){mobileEditor?.closeText();mobileEditor?.setDetail(false);flush();screen='start';stop();$('startScreen').hidden=false;$('editorScreen').hidden=true;document.body.classList.remove('detail-view');document.body.classList.remove('editor-active');$('detailToggle').textContent='细节';syncUI();dirty=true;requestPaint();}
  function clearPrepared(){const video=$('exportVideoPreview');video?.pause();if(video){video.hidden=true;video.removeAttribute('src');video.load();}const preview=$('exportPreview');if(preview){preview.hidden=true;preview.removeAttribute('src');}if(prepared)URL.revokeObjectURL(prepared.url);prepared=null;$('downloadResult').hidden=true;$('downloadResult').removeAttribute('href');$('shareResult').hidden=true;}
  function invalidateExport(){exportToken++;exportController?.abort();exportController=null;if(prepared)clearPrepared();if($('exportDialog').open)$('exportStatus').textContent='画面已更改，请重新准备导出。';syncExport();}
  function stop(){playing=false;lastFrame=0;syncPlayback();}
  function cancelWork(){if(drawing)endPathDrawing(false);if(historyOperation){history[historyOperation==='undo'?'redo':'undo']();historyOperation=null;}workToken++;subjectToken++;busy=false;segmenting=false;selecting=false;boot?.cancel();viewport.classList.remove('selecting');$('studio').setAttribute('aria-busy','false');}
  function clearMask(){subjectToken++;maskImage=null;state.subjectMask='';segmenting=false;selecting=false;viewport.classList.remove('selecting');}
  function scheduleSave(){clearTimeout(saveTimer);const rev=revision;$('saveStatus').textContent='正在保留草稿…';saveTimer=setTimeout(()=>{const snapshot=M.normalize(state);saveChain=saveChain.catch(()=>{}).then(()=>IO.saveDraft(snapshot)).then(result=>{if(revision===rev)$('saveStatus').textContent=result.ok?'草稿已保存在本机':'请保存项目以保留作品';}).catch(()=>{if(revision===rev)$('saveStatus').textContent='请保存项目以保留作品';});},500);}
  function commit(){clearTimeout(commitTimer);commitTimer=0;history.commit(state);syncHistory();syncGroups();mobileEditor?.sync();scheduleSave();}
  function flush(){if(commitTimer)commit();}
  function mutate(patch,debounce=false){
    if(drawing)return;
    const clear=Object.keys(patch).some(key=>assetLayoutKeys.has(key)&&patch[key]!==state[key]);
    if(clear){cancelWork();clearMask();patch={...patch,subjectMask:''};resetView();}
    revision++;state=M.normalize({...state,...patch});invalidateExport();dirty=true;if(debounce){valuesDirty=true;}else syncUI();requestPaint();
    if(debounce){clearTimeout(commitTimer);commitTimer=setTimeout(commit,300);}else commit();
  }
  function setState(next,loaded,decodedMask,{resetHistory=false,message='',bootIntro=false,destination='editor'}={}){
    cancelWork();stop();clearTimeout(commitTimer);commitTimer=0;revision++;state=M.normalize(next);images=loaded;maskImage=decodedMask||null;
    if(resetHistory)history.reset(state);else history.commit(state);
    invalidateExport();resetView();dirty=true;syncUI();pendingBoot=bootIntro;if(destination==='start')openStart();else openEditor();requestPaint();scheduleSave();
    if(message)notify(message);
  }
  async function decodeState(next){const loaded=await IO.decodeImages(next.images);const decodedMask=next.subjectMask?await IO.decodeImage(next.subjectMask):null;return {loaded,decodedMask};}
  function syncHistory(){$('undo').disabled=drawing||busy||!history.canUndo();$('setupUndo').disabled=drawing||busy||!history.canUndo();$('redo').disabled=drawing||busy||!history.canRedo();}
  function syncPlayback(){$('playToggle').textContent=playing?'暂停':'播放';$('playToggle').setAttribute('aria-pressed',String(playing));$('playToggle').disabled=drawing||busy||state.mode!=='motion'||!images.length;$('modeToggle').checked=state.mode==='motion';}
  function syncExport(){$('exportPNG').disabled=drawing||!!exportController||busy||segmenting||!images.length;$('exportVideo').disabled=drawing||!!exportController||busy||segmenting||!images.length||state.mode!=='motion'||!IO.canExportVideo();$('exportCancel').hidden=!exportController;}
  function syncValues(){
    const grouped=groupEffects.has(state.template),group=currentGroup();
    Object.entries(fields).forEach(([id,key])=>{const el=$(id);if(!el)return;const value=grouped&&selectedFields[key]?group[selectedFields[key]]:state[key];
      if(forceGroupSync||document.activeElement!==el){if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);}
      const shown=key==='pathPhase'?Math.round(value)+'%':percentFields.has(key)?Math.round(value*100)+'%':['wrapTilt','wrapRoll','wrapPhase'].includes(key)?Math.round(value)+'°':String(Math.round(Number(value)*100)/100);
      outputNodes.get(id)?.forEach(output=>{if(output.textContent!==shown)output.textContent=shown;});
    });
    Object.entries(groupFields).forEach(([id,key])=>{const el=$(id);if(forceGroupSync||document.activeElement!==el)el.value=String(group[key]);groupOutputNodes.get(id)?.forEach(output=>{const shown=groupOutput(key,group[key]);if(output.textContent!==shown)output.textContent=shown;});});
    valuesDirty=false;
  }
  function syncUI(){
    const grouped=groupEffects.has(state.template),group=currentGroup();forceGroupSync=forceGroupSync||lastSyncedGroupId!==groupKey()+':'+group.id;lastSyncedGroupId=groupKey()+':'+group.id;syncValues();syncGroups();
    Object.keys(fields).concat(Object.keys(groupFields)).forEach(id=>{if($(id))$(id).disabled=busy;});
    for(const [on,keys] of [['textStrokeEnabled',['textStrokeWidth','textStrokeColor']],['textGlowEnabled',['textGlow','textGlowColor']],['textShadowEnabled',['textShadowOpacity','textShadowColor','textShadowBlur','textShadowX','textShadowY']]])for(const key of keys)$(key).disabled=busy||!(grouped?group[on]:state[on]);
    $('continueEditing').disabled=busy||!images.length;
    ['effectSelect','canvasRatio','modeToggle','saveProject'].forEach(id=>{$(id).disabled=busy;});
    $('imagePathMode').disabled=busy||!['hud','wave','flag'].includes(state.template);$('effectSelect').value=state.template;
    const subjectEffect=subjectEffects.has(state.template),depthEffect=grouped;
    $('effectHint').textContent=effectHints[state.template]||'文字跨整张画布排列，可搭配多图、动态播放和 ASCII。';
    $('wrapControls').hidden=!subjectEffect;$('wrapTiltControl').hidden=!depthEffect;$('wrapRollControl').hidden=!depthEffect;
    $('positionControls').hidden=state.template!=='spiral';$('depthControls').hidden=!depthEffect;$('depthToneControls').hidden=!depthEffect;
    $('helixControls').hidden=state.template!=='helix';$('contourControls').hidden=state.template!=='contour';$('spiralControls').hidden=state.template!=='spiral';$('legacyControls').hidden=subjectEffect||state.template==='customPath';
    $('customPathControls').hidden=state.template!=='customPath';$('customPathActions').hidden=state.template!=='customPath';$('drawPath').textContent=state.customPath?.length?'重画路径':'绘制路径';$('pathStatus').textContent=state.customPath?.length?'路径已就绪 · 动态页可播放':'画一条线，让文字沿线流动。';
    $('helixLayoutTabs').hidden=state.template!=='helix';
    if(state.template==='helix'){const shape=helixLayout==='Shape';$('wrapControls').hidden=!shape;$('helixControls').hidden=!shape;$('groupAdjustments').hidden=shape;$('depthControls').hidden=shape;$('depthToneControls').hidden=shape;}
    for(const id of ['drawPath','saveButton','effectSelect','projectMenuButton','backStart','canvasRatio','modeToggle','saveProject'])if(drawing)$(id).disabled=true;
    $('layoutNote').textContent=grouped?'仅调整所选文字组 · 整体透视除外':subjectEffect?'调整文字路径；字号和颜色在“字效”中。':'调整分布；字号、颜色和透明度在“字效”中。';
    const ratio=state.width+'x'+state.height;if(![...$('canvasRatio').options].some(option=>option.value===ratio)){const option=document.createElement('option');option.value=ratio;option.textContent=state.width+' × '+state.height;$('canvasRatio').append(option);}$('canvasRatio').value=ratio;
    $('photoCount').textContent=state.images.length+' / 9';$('setupCount').textContent=state.images.length+' / 9';
    $('startChoose').hidden=images.length>0;$('chooseMore').hidden=!images.length;$('standby').hidden=images.length>0;$('setupCanvas').hidden=!images.length;
    $('startChoose').disabled=busy;$('trySample').disabled=busy;$('chooseMore').disabled=busy||state.images.length>=9;$('selectSubject').disabled=busy||segmenting||!images.length||!subjectEffect;$('saveButton').disabled=busy||segmenting||!images.length;$('bootReplay').disabled=busy||!images.length;
    $('selectSubject').setAttribute('aria-pressed',String(selecting));$('selectSubject').textContent=segmenting?'识别中…':selecting?'取消点选':'点选主体';
    if(!segmenting)$('subjectStatus').textContent=!subjectEffect?'双指缩放，放大后拖动查看。':selecting?'点一下画面中的人物或物体。':state.subjectMask?'主体已选中 · 文字具有前后遮挡':state.template==='contour'?'请先点选主体，选中后显示轮廓文字。':'点选主体，让文字从它身后绕过。';
    syncPlayback();syncHistory();syncPhotos();syncExport();if(drawing)for(const id of ['saveButton','effectSelect','projectMenuButton','backStart','canvasRatio','modeToggle','saveProject','drawPath','selectSubject'])$(id).disabled=true;else for(const id of ['projectMenuButton','backStart','drawPath'])$(id).disabled=busy;forceGroupSync=false;mobileEditor?.sync();
  }
  function syncPhotos(){
    const changed=state.images.length!==photoAssets.length||state.images.some((asset,i)=>asset.dataURL!==photoAssets[i]?.dataURL||asset.name!==photoAssets[i]?.name);
    if(changed){photoAssets=state.images.slice();$('photoList').replaceChildren();state.images.forEach((asset,index)=>{
      const card=document.createElement('div');card.className='photo-card';const img=document.createElement('img');img.src=asset.dataURL;img.alt='照片 '+(index+1);const label=document.createElement('span');label.className='photo-name';label.textContent=(index+1)+'. '+(asset.name||'未命名图片');
      const actions=document.createElement('div');actions.className='photo-actions';
      [{text:'前移',disabled:index===0,action:()=>reorder(index,-1)},{text:'后移',disabled:index===state.images.length-1,action:()=>reorder(index,1)},{text:'移除',disabled:false,action:()=>removePhoto(index)}].forEach(item=>{const b=document.createElement('button');b.type='button';b.textContent=item.text;b.dataset.boundDisabled=item.disabled?'1':'0';b.disabled=busy||item.disabled;b.setAttribute('aria-label','照片'+(index+1)+item.text);b.addEventListener('click',item.action);actions.append(b);});card.append(img,label,actions);$('photoList').append(card);
    });}
    $('photoList').querySelectorAll('button').forEach(button=>{button.disabled=busy||button.dataset.boundDisabled==='1';});
  }
  function requestPaint(){if(!frameRequest&&!disposed)frameRequest=requestAnimationFrame(tick);}
  function tick(stamp){
    frameRequest=0;if(disposed||document.hidden)return;if(valuesDirty)syncValues();if(guideDirty)paintPathGuide();if(screen==='start'){if(dirty)paintSetup();return;}
    if(playing&&state.mode==='motion'){if(lastFrame)state.frame=(state.frame+Math.min(.15,(stamp-lastFrame)/1000))%state.duration;lastFrame=stamp;}
    if(dirty||(playing&&stamp-lastPaint>=1000/30)){
      try{if(previewSize){canvas.width=previewSize.width;canvas.height=previewSize.height;previewSize=null;}renderer.render(drawing?{...state,customPath:draftPath}:state,drawing?0:state.frame,images,{subjectMask:maskImage});dirty=false;lastPaint=stamp;canvas.dataset.renderStatus='ready';}
      catch(error){stop();canvas.dataset.renderStatus='error';notify('画面暂时无法绘制：'+errorText(error),true);}
    }
    if(playing)requestPaint();
  }
  function resize(){
    if(screen!=='editor'||!viewport.clientWidth||!viewport.clientHeight)return;
    const fitted=V.fitArtwork(viewport.clientWidth,viewport.clientHeight,state.width,state.height,mobileEditor?.isActive()?12:20);
    panX=V.preservePan(panX,fitWidth,fitted.width);panY=V.preservePan(panY,fitHeight,fitted.height);
    fitWidth=fitted.width;fitHeight=fitted.height;mount.style.width=fitWidth+'px';mount.style.height=fitHeight+'px';
    applyView();if(drawing){guideDirty=true;requestPaint();}
  }
  function applyView(){const maxX=Math.max(0,(fitWidth*zoom-viewport.clientWidth+24)/2),maxY=Math.max(0,(fitHeight*zoom-viewport.clientHeight+24)/2);panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));mount.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';$('zoomLabel').textContent=zoom===1?'适应':Math.round(zoom*100)+'%';$('zoomReset').setAttribute('aria-label','适应画布，当前'+Math.round(zoom*100)+'%');$('zoomOut').disabled=zoom<=1;$('zoomIn').disabled=zoom>=4;updatePreviewResolution();}
  function updatePreviewResolution(){if(screen!=='editor')return;const desired=Math.max(fitWidth,fitHeight)*Math.min(2,window.devicePixelRatio||1)*zoom,long=Math.max(360,Math.min(900,Math.ceil(desired/120)*120)),scale=long/Math.max(state.width,state.height),w=Math.round(state.width*scale),h=Math.round(state.height*scale);if(canvas.width!==w||canvas.height!==h){previewSize={width:w,height:h};dirty=true;requestPaint();}else previewSize=null;}
  function paintSetup(){const target=$('setupCanvas'),scale=520/Math.max(state.width,state.height);target.width=Math.round(state.width*scale);target.height=Math.round(state.height*scale);if(images.length){R.composePhotos(target,state,images);if(state.imageWash){const c=target.getContext('2d');c.fillStyle='rgba(0,0,0,'+(state.imageWash/100)+')';c.fillRect(0,0,target.width,target.height);}}dirty=false;}
  function resetView(){zoom=1;panX=panY=0;applyView();}
  function zoomAt(value,clientX,clientY){const rect=viewport.getBoundingClientRect(),x=(clientX==null?rect.left+rect.width/2:clientX)-(rect.left+rect.width/2),y=(clientY==null?rect.top+rect.height/2:clientY)-(rect.top+rect.height/2),next=Math.max(1,Math.min(4,value)),ratio=next/zoom;panX=x+(panX-x)*ratio;panY=y+(panY-y)*ratio;zoom=next;applyView();}
  function composite(transparent=false){const c=document.createElement('canvas'),scale=768/Math.max(state.width,state.height);c.width=Math.max(1,Math.round(state.width*scale));c.height=Math.max(1,Math.round(state.height*scale));R.composePhotos(c,state,images,{transparent});return c;}
  async function alphaMask(next,loaded){
    if(!S||!S.fromAlpha||loaded.length!==1)return null;
    const raw=document.createElement('canvas'),source=loaded[0],scale=512/Math.max(source.naturalWidth||source.width,source.naturalHeight||source.height);raw.width=Math.max(1,Math.round((source.naturalWidth||source.width)*scale));raw.height=Math.max(1,Math.round((source.naturalHeight||source.height)*scale));raw.getContext('2d').drawImage(source,0,0,raw.width,raw.height);
    const native=await S.fromAlpha(raw);raw.width=raw.height=1;if(!native)return null;
    const c=document.createElement('canvas'),factor=768/Math.max(next.width,next.height);c.width=Math.round(next.width*factor);c.height=Math.round(next.height*factor);R.composePhotos(c,next,loaded,{transparent:true});const result=await S.fromAlpha(c);c.width=c.height=1;return result;
  }
  function maskPlacement(result){const b=result.bounds;return {subjectMask:result.dataURL,wrapX:Math.max(0,Math.min(1,b.x+b.width/2)),wrapY:Math.max(0,Math.min(1,b.y+b.height*.48)),wrapRadius:Math.max(.12,Math.min(.48,b.width*.7)),wrapDepth:Math.max(.06,Math.min(.28,b.width*.42)),wrapHeight:Math.max(.1,Math.min(1.2,b.height*.9))};}
  async function importFiles(list){
    const files=Array.from(list||[]);if(!files.length)return;flush();cancelWork();const token=++workToken;stop();
    if(files.length+state.images.length>M.MAX_IMAGES){notify('最多使用9张图片；请减少本次选择或先移除已有图片。',true);syncUI();return;}
    const base=state.images.slice(),existing=images.slice();setBusy(true);notify('正在读取 '+files.length+' 张图片…');
    try{
      const incoming=[];for(let i=0;i<files.length;i++){const item=await IO.loadImage(files[i]);if(token!==workToken||disposed)return;incoming.push(item);notify('正在读取图片 '+(i+1)+' / '+files.length);}
      const assets=base.concat(incoming.map(item=>({dataURL:item.dataURL,name:item.name}))),loaded=existing.concat(incoming.map(item=>item.image));let next=M.normalize({...state,images:assets,backgroundMode:'image',subjectMask:''});
      if(next.images.length!==assets.length)throw new Error('图片总量过大，请减少图片或降低尺寸。');
      const extracted=await alphaMask(next,loaded);if(token!==workToken||disposed)return;let decodedMask=null;if(extracted){next=M.normalize({...next,...maskPlacement(extracted)});decodedMask=await IO.decodeImage(next.subjectMask);if(token!==workToken||disposed)return;}
      setState(next,loaded,decodedMask,{message:'已加入 '+incoming.length+' 张图片。'+(incoming.some(item=>item.warning)?'较大图片已优化到1600像素长边。':''),bootIntro:true,destination:'start'});
    }catch(error){if(token===workToken){setBusy(false);notify('图片未加入，原作品已保留。'+errorText(error),true);}}
  }
  async function loadSample(){
    flush();cancelWork();const token=++workToken;stop();setBusy(true);notify('正在准备示例…');
    try{
      const source=window.KineticSampleData||'assets/sample.png';const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('示例图片未找到。'));image.src=source;});if(token!==workToken||disposed)return;
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);const dataURL=c.toDataURL('image/png');c.width=c.height=1;
      let next=M.normalize({...M.DEFAULTS,width:state.width,height:state.height,imageFit:state.imageFit,imageWash:state.imageWash,images:[{dataURL,name:'示例人像'}],backgroundMode:'image'});const result=await alphaMask(next,[img]);if(token!==workToken||disposed)return;let decoded=null;if(result){next=M.normalize({...next,...maskPlacement(result)});decoded=await IO.decodeImage(next.subjectMask);if(token!==workToken||disposed)return;}
      setState(next,[img],decoded,{message:'示例已载入。选择画布比例，点击“开始编辑”。',bootIntro:true,destination:'start'});
    }catch(error){if(token===workToken){setBusy(false);notify(errorText(error),true);}}
  }
  async function pickSubject(clientX,clientY){
    if(!selecting||busy||segmenting||!images.length)return;const rect=canvas.getBoundingClientRect(),point={x:(clientX-rect.left)/rect.width,y:(clientY-rect.top)/rect.height};if(point.x<0||point.y<0||point.x>1||point.y>1)return;
    selecting=false;segmenting=true;stop();viewport.classList.remove('selecting');const token=++subjectToken;const c=composite();syncUI();$('subjectStatus').textContent='正在识别点选的主体…';
    try{
      if(!S)throw new Error('主体识别组件未载入。');const result=await S.segment(c,point,{onProgress:message=>{if(token===subjectToken)$('subjectStatus').textContent=String(message);}});if(token!==subjectToken||disposed)return;
      const decoded=await IO.decodeImage(result.dataURL);if(token!==subjectToken||disposed)return;maskImage=decoded;segmenting=false;mutate(maskPlacement(result));notify(state.template==='contour'?'主体已选中，文字沿真实外边缘排列。可调整边距和圈数。':state.template==='spiral'?'螺旋已对准主体，可调整宽度和圈数。':'主体已选中。可调整环绕范围、多组文字与前后深浅。');
    }catch(error){if(token===subjectToken){segmenting=false;syncUI();notify('未能选择主体：'+errorText(error),true);}}
    finally{c.width=c.height=1;}
  }
  function reorder(index,offset){if(busy)return;const target=index+offset;if(target<0||target>=images.length)return;flush();cancelWork();const assets=state.images.slice(),loaded=images.slice();[assets[index],assets[target]]=[assets[target],assets[index]];[loaded[index],loaded[target]]=[loaded[target],loaded[index]];setState({...state,images:assets,subjectMask:''},loaded,null,{message:'图片顺序已更新，进入编辑后请重新点选主体。',destination:'start'});}
  function removePhoto(index){if(busy)return;flush();cancelWork();const assets=state.images.slice(),loaded=images.slice();assets.splice(index,1);loaded.splice(index,1);setState({...state,images:assets,subjectMask:'',asciiLayer:assets.length?state.asciiLayer:false},loaded,null,{message:'图片已移除。可撤销恢复。',destination:'start'});}
  async function historyStep(direction){if(drawing)return;const destination=screen;flush();cancelWork();stop();const token=++workToken;setBusy(true);const next=history[direction]();historyOperation=direction;try{const {loaded,decodedMask}=await decodeState(next);if(token!==workToken||disposed)return;historyOperation=null;revision++;state=next;images=loaded;maskImage=decodedMask;busy=false;invalidateExport();resetView();dirty=true;syncUI();if(destination==='start')openStart();else openEditor();requestPaint();scheduleSave();notify(direction==='undo'?'已撤销。':'已重做。');}catch(error){if(token===workToken){history[direction==='undo'?'redo':'undo']();historyOperation=null;setBusy(false);notify(errorText(error),true);}}}
  async function openProjectFile(file){if(!file)return;flush();cancelWork();stop();const token=++workToken;setBusy(true);notify('正在打开项目…');try{if(file.size>IO.MAX_PROJECT_BYTES)throw new Error('项目文件超过64MB。');const next=IO.parse(await file.text()),{loaded,decodedMask}=await decodeState(next);if(token!==workToken||disposed)return;setState(next,loaded,decodedMask,{message:'项目已打开。',bootIntro:loaded.length>0});}catch(error){if(token===workToken){setBusy(false);notify('未打开项目，原作品已保留。'+errorText(error),true);}}}
  async function restoreDraft(){flush();cancelWork();stop();const token=++workToken;setBusy(true);notify('正在读取本机草稿…');try{await saveChain;const next=await IO.loadDraft({includeLegacy:true});if(token!==workToken||disposed)return;if(!next){setBusy(false);notify('这台设备没有可恢复的作品草稿。');return;}const {loaded,decodedMask}=await decodeState(next);if(token!==workToken||disposed)return;setState(next,loaded,decodedMask,{message:'本机草稿已恢复。',bootIntro:loaded.length>0});}catch(error){if(token===workToken){setBusy(false);notify(errorText(error),true);}}}
  function exportRender(target,doc,time,loaded,mask,renderers){let r=renderers.get(target);if(!r){r=R.create(target);renderers.set(target,r);}r.render(doc,time,loaded,{subjectMask:mask});}
  async function prepareExport(kind){
    if(drawing||busy||segmenting||exportController||!images.length)return;flush();stop();clearPrepared();const token=++exportToken,rev=revision,doc=M.normalize(state),loaded=images.slice(),mask=maskImage,renderers=new Map();exportController=new AbortController();const controller=exportController;
    $('exportStatus').textContent=kind==='video'?'正在准备视频，请保持页面可见…':'正在准备图片…';syncExport();
    try{
      const options={state:doc,image:loaded,signal:controller.signal,maxPixels:12000000,render:(c,s,t,i)=>exportRender(c,s,t,i,mask,renderers),onProgress:value=>{if(token===exportToken)$('exportStatus').textContent='正在准备视频 '+Math.round(value*100)+'%';}};
      const result=kind==='video'?await IO.exportVideo(options):{blob:await IO.exportPNG(options),extension:'png'};
      if(token!==exportToken||rev!==revision||disposed||controller.signal.aborted)return;
      const filename='Hurrygoodjob-Text.'+result.extension;prepared={blob:result.blob,filename,url:URL.createObjectURL(result.blob)};if(kind==='video'){$('exportVideoPreview').src=prepared.url;$('exportVideoPreview').hidden=false;}else{$('exportPreview').src=prepared.url;$('exportPreview').hidden=false;}$('downloadResult').href=prepared.url;$('downloadResult').download=filename;$('downloadResult').hidden=false;$('shareResult').hidden=!IO.canShareFile(prepared.blob,filename);$('exportStatus').textContent=(kind==='video'?'视频':'图片')+'已准备好，点击下载保存。'+(kind==='image'?' '+doc.width+' × '+doc.height+' px':'');
    }catch(error){if(token===exportToken)$('exportStatus').textContent=controller.signal.aborted?'导出已取消。':errorText(error);}
    finally{renderers.forEach(r=>r.dispose());if(token===exportToken){exportController=null;syncExport();}}
  }
  function showHelixLayout(name){helixLayout=name;for(const key of ['Shape','Position']){$('helix'+key).setAttribute('aria-selected',String(key===name));$('helix'+key).tabIndex=key===name?0:-1;}syncUI();$('parameterPanels').scrollTop=0;}
  function pathPoint(event){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(event.clientY-r.top)/Math.max(1,r.height)))};}
  function markPathPreview(){guideDirty=true;dirty=true;requestPaint();$('pathDone').disabled=draftPath.length<2||strokePointer!==null||strokeBlocked;$('zoomIn').disabled=zoom>=4||strokePointer!==null||strokeBlocked;$('zoomOut').disabled=zoom<=1||strokePointer!==null||strokeBlocked;$('zoomReset').disabled=strokePointer!==null||strokeBlocked;}
  function paintPathGuide(){guideDirty=false;const guide=$('pathGuide');guide.hidden=!drawing;if(drawing)guide.removeAttribute('hidden');else guide.setAttribute('hidden','');guide.setAttribute('viewBox','0 0 '+state.width+' '+state.height);if(!drawing)return;
    const geometry=P?.prepare?P.prepare(draftPath,state.width,state.height,state.pathClosed):{points:draftPath.map(p=>({x:p.x*state.width,y:p.y*state.height}))};
    const points=geometry.points||[];$('pathGuideLine').setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));
    const ends=[draftPath[0],draftPath[draftPath.length-1]],radius=Math.max(state.width,state.height)/65;
    ['Start','End'].forEach((name,i)=>{const point=ends[i],dot=$('path'+name+'Dot'),label=$('path'+name+'Label');dot.hidden=!point;label.hidden=!point;for(const el of [dot,label])if(point)el.removeAttribute('hidden');else el.setAttribute('hidden','');if(!point)return;const x=point.x*state.width,y=point.y*state.height;dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',radius*.35);label.setAttribute('x',Math.max(radius,Math.min(state.width-radius*3,x+radius*.6)));label.setAttribute('y',Math.max(radius*1.5,Math.min(state.height-radius,y-radius*.6)));label.setAttribute('font-size',radius*1.25);});
  }
  function beginPathDrawing(){if(busy||segmenting||drawing||state.template!=='customPath'||!images.length)return;flush();stop();boot?.cancel();selecting=false;viewport.classList.remove('selecting');pointers.clear();drawView={detail:document.body.classList.contains('detail-view'),zoom,panX,panY};drawing=true;draftPath=(state.customPath||[]).map(p=>({...p}));strokePointer=null;strokeBlocked=false;document.body.classList.add('path-drawing');$('pathDrawBar').hidden=false;$('pathGuide').hidden=false;$('pathGuide').removeAttribute('hidden');$('pathDrawHint').textContent='按住画一条线，松手查看文字。';syncUI();resize();markPathPreview();$('pathCancel').focus();}
  function endPathDrawing(refresh=true){if(!drawing)return;drawing=false;$('zoomReset').disabled=false;strokePointer=null;strokeBlocked=false;for(const id of pointers.keys())if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);pointers.clear();document.body.classList.remove('path-drawing');$('pathDrawBar').hidden=true;$('pathGuide').hidden=true;$('pathGuide').setAttribute('hidden','');if(drawView){zoom=drawView.zoom;panX=drawView.panX;panY=drawView.panY;document.body.classList.toggle('detail-view',drawView.detail);}drawView=null;draftPath=[];dirty=true;guideDirty=false;if(refresh){syncUI();resize();requestPaint();$('drawPath').focus();}}
  function drawPointerDown(event){if(event.button!==0||event.target.closest('button,input,textarea,select'))return;event.preventDefault();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});viewport.setPointerCapture(event.pointerId);if(pointers.size>1){strokeBlocked=true;strokePointer=null;draftPath=strokeBefore.map(p=>({...p}));$('pathDrawHint').textContent='一次用一根手指绘制；这笔已取消。';markPathPreview();return;}if(strokeBlocked)return;const rect=canvas.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)return;strokeBefore=draftPath.map(p=>({...p}));strokePointer=event.pointerId;draftPath=[pathPoint(event)];$('pathDrawHint').textContent='沿画布画线，松手预览。';markPathPreview();}
  function drawPointerMove(event){if(strokeBlocked||strokePointer!==event.pointerId)return;event.preventDefault();const coalesced=event.getCoalescedEvents?.(),events=coalesced?.length?coalesced:[event];for(const sample of events){const point=pathPoint(sample),last=draftPath[draftPath.length-1];if(!last||Math.hypot(point.x-last.x,point.y-last.y)>.002){draftPath.push(point);if(draftPath.length>1024)draftPath=draftPath.filter((_,i)=>i%2===0||i===draftPath.length-1);}}markPathPreview();}
  function drawPointerEnd(event){if(!pointers.has(event.pointerId))return;pointers.delete(event.pointerId);if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(strokePointer===event.pointerId){if(event.type==='pointercancel'){draftPath=strokeBefore.map(p=>({...p}));$('pathDrawHint').textContent='这笔已取消，原路径保留。';}else{const end=pathPoint(event);draftPath.push(end);draftPath=P?.simplify?P.simplify(draftPath,.002,256):draftPath.filter((_,i)=>i%Math.max(1,Math.ceil(draftPath.length/256))===0);const length=draftPath.reduce((n,p,i)=>i?n+Math.hypot(p.x-draftPath[i-1].x,p.y-draftPath[i-1].y):0,0);if(draftPath.length<2||length<.025){draftPath=strokeBefore.map(p=>({...p}));$('pathDrawHint').textContent='请画长一点；轻点不会生成路径。';}else $('pathDrawHint').textContent='已预览文字；可重画，或完成后调节动态。';}strokePointer=null;}if(!pointers.size)strokeBlocked=false;markPathPreview();}
  $('drawPath').addEventListener('click',beginPathDrawing);
  $('pathCancel').addEventListener('click',()=>{endPathDrawing();notify('已取消绘制，原路径保留。');});
  $('pathRedraw').addEventListener('click',()=>{if(!drawing||strokePointer!==null)return;draftPath=[];strokeBefore=[];strokeBlocked=false;$('pathDrawHint').textContent='按住画一条新路径，松手预览。';markPathPreview();});
  $('pathDone').addEventListener('click',()=>{if(!drawing||strokePointer!==null||strokeBlocked||draftPath.length<2)return;const path=draftPath.map(p=>({...p}));endPathDrawing();mutate({customPath:path,frame:0});notify('路径已保存。切换到动态页可播放沿线文字。');});
  for(const name of ['Shape','Position'])$('helix'+name).addEventListener('click',()=>showHelixLayout(name));
  // The installed document is the source of truth; the viewport never changes it.
  M.TEMPLATES.forEach(template=>{const option=document.createElement('option');option.value=template.id;option.textContent=labels[template.id]||template.name;$('effectSelect').append(option);});
  Object.entries(fields).forEach(([id,key])=>{const el=$(id);if(!el)return;const event=el.type==='range'||el.tagName==='TEXTAREA'||el.type==='color'?'input':'change';el.addEventListener(event,()=>{if(drawing||busy)return;const value=el.type==='checkbox'?el.checked:numeric.has(key)?Number(el.value):el.value;if(groupEffects.has(state.template)&&selectedFields[key])editGroup({[selectedFields[key]]:value},event==='input');else mutate({[key]:value},event==='input');});});
  Object.entries(groupFields).forEach(([id,key])=>$(id).addEventListener('input',()=>{if(!drawing&&!busy)editGroup({[key]:Number($(id).value)},true);}));
  $('groupSelect').addEventListener('change',()=>chooseGroup($('groupSelect').value,false));
  $('groupName').addEventListener('input',()=>{if(!drawing&&!busy)editGroup({name:$('groupName').value},true);});
  $('addGroup').addEventListener('click',()=>{if(drawing||busy)return;flush();const current=currentGroup(),groups=documentGroups();if(groups.length>=6)return;const offsets=[0,.18,-.18,.32,-.32,.42,-.42];const offset=offsets.find(y=>groups.every(g=>Math.abs(g.offsetY-y)>.06))??offsets.reduce((best,y)=>Math.min(...groups.map(g=>Math.abs(g.offsetY-y)))>Math.min(...groups.map(g=>Math.abs(g.offsetY-best)))?y:best,0);const id=M.nextGroupId(groups);groups.push(M.makeGroup(state,groups.length,{...current,id,name:'文字组 '+id.slice(1),offsetY:offset}));activeGroup=groups.length-1;activeGroupId=id;selectedGroups[groupKey()]=id;forceGroupSync=true;mutate(groupPatch(groups));notify('已添加'+groups[activeGroup].name+'。下方参数仅调整这一组。');});
  function removeActiveGroup(){if(drawing||busy)return;flush();const current=currentGroup(),groups=documentGroups(),index=groups.findIndex(group=>group.id===current.id);if(groups.length<=1||index<0)return;groups.splice(index,1);activeGroup=Math.min(index,groups.length-1);activeGroupId=groups[activeGroup].id;selectedGroups[groupKey()]=activeGroupId;forceGroupSync=true;mutate(groupPatch(groups));notify('已移除'+current.name+'，其他组保留原名称。可撤销恢复。');}
  $('removeGroup').addEventListener('click',removeActiveGroup);
  $('effectSelect').addEventListener('change',()=>{if(drawing||busy)return;const template=$('effectSelect').value;flush();stop();subjectToken++;segmenting=false;selecting=false;viewport.classList.remove('selecting');const patch={template,frame:0,textLayer:true};if(groupEffects.has(state.template)&&!state[groupKey()]?.length)patch[groupKey()]=documentGroups();if(groupEffects.has(template)){const next={...state,...patch},key=M.groupKey(next);if(!next[key]?.length)patch[key]=M.groupsFor(next);}forceGroupSync=true;mutate(patch);notify(effectHints[template]||'已切换为'+(labels[template]||template)+'。');});
  $('canvasRatio').addEventListener('change',()=>{const value=$('canvasRatio').value.split(/[x:]/).map(Number);if(value.length===2&&value.every(n=>Number.isFinite(n)&&n>0)){const [a,b]=value;mutate({width:a<20?Math.round(a/b*1200):a,height:a<20?1200:b});}});
  $('modeToggle').addEventListener('change',()=>{if(drawing)return;mutate({mode:$('modeToggle').checked?'motion':'static'});playing=state.mode==='motion';lastFrame=0;syncPlayback();requestPaint();});
  $('playToggle').addEventListener('click',()=>{if(drawing)return;if(state.mode!=='motion')return;playing=!playing;lastFrame=0;syncPlayback();requestPaint();});
  $('startChoose').addEventListener('click',()=>$('fileInput').click());$('chooseMore').addEventListener('click',()=>$('fileInput').click());
  $('fileInput').addEventListener('change',()=>{const files=[...$('fileInput').files];$('fileInput').value='';importFiles(files);});
  $('continueEditing')?.addEventListener('click',openEditor);$('trySample').addEventListener('click',loadSample);$('backStart').addEventListener('click',openStart);
  $('bootReplay').addEventListener('click',()=>{if(!busy&&images.length){stop();boot?.play();}});
  $('selectSubject').addEventListener('click',()=>{if(!images.length||busy||segmenting)return;selecting=!selecting;viewport.classList.toggle('selecting',selecting);stop();syncUI();});
  $('undo').addEventListener('click',()=>historyStep('undo'));$('setupUndo').addEventListener('click',()=>historyStep('undo'));$('redo').addEventListener('click',()=>historyStep('redo'));
  $('newProject').addEventListener('click',()=>{if(images.length&&!window.confirm('新建作品将清空当前画面。需要时可通过撤销恢复，是否继续？'))return;flush();setState(M.DEFAULTS,[],null,{message:'已新建作品。可撤销找回之前的画面。'});openStart();});
  $('openProject').addEventListener('click',()=>$('projectInput').click());$('projectInput').addEventListener('change',()=>{const file=$('projectInput').files[0];$('projectInput').value='';openProjectFile(file);});
  $('saveProject').addEventListener('click',()=>{if(drawing)return;flush();try{IO.download(new Blob([IO.serialize(state)],{type:'application/json'}),'Hurrygoodjob-Text-project.json');notify('已发起项目文件下载，包含图片、文字与主体选择。');}catch(error){notify(errorText(error),true);}});
  $('restoreDraft').addEventListener('click',restoreDraft);
  $('zoomIn').addEventListener('click',()=>zoomAt(zoom+.25));$('zoomOut').addEventListener('click',()=>zoomAt(zoom-.25));$('zoomReset').addEventListener('click',resetView);
  $('detailToggle').addEventListener('click',()=>{if(mobileEditor?.isActive())mobileEditor.setDetail(!mobileEditor.isDetail());else setDetail(!document.body.classList.contains('detail-view'));});
  viewport.addEventListener('wheel',event=>{if(drawing)return;if(!event.ctrlKey&&!document.body.classList.contains('detail-view'))return;event.preventDefault();zoomAt(zoom*Math.exp(-event.deltaY*.002),event.clientX,event.clientY);},{passive:false});
  viewport.addEventListener('pointerdown',event=>{if(drawing){drawPointerDown(event);return;}if(event.button!==0||event.target.closest('button,input,textarea,select'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});viewport.setPointerCapture(event.pointerId);if(pointers.size===1)tap={id:event.pointerId,x:event.clientX,y:event.clientY};else tap=null;if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};}});
  viewport.addEventListener('pointermove',event=>{if(drawing){drawPointerMove(event);return;}if(!pointers.has(event.pointerId))return;const old=pointers.get(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(tap&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>8)tap=null;if(pointers.size>=2&&pinch){const [a,b]=[...pointers.values()];zoomAt(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),(a.x+b.x)/2,(a.y+b.y)/2);}else if(!selecting&&zoom>1){panX+=event.clientX-old.x;panY+=event.clientY-old.y;applyView();}});
  function pointerEnd(event){if(drawing){drawPointerEnd(event);return;}if(!pointers.has(event.pointerId))return;const hit=tap&&tap.id===event.pointerId;const chosen=hit&&selecting;pointers.delete(event.pointerId);pinch=null;tap=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(chosen&&event.type==='pointerup')pickSubject(event.clientX,event.clientY);}
  viewport.addEventListener('pointerup',pointerEnd);viewport.addEventListener('pointercancel',pointerEnd);viewport.addEventListener('dblclick',()=>{if(!drawing&&!selecting)zoomAt(zoom===1?2:1);});
  $('saveButton').addEventListener('click',()=>{if(drawing)return;flush();stop();$('exportDialog').showModal();if(!prepared)$('exportStatus').textContent='选择输出格式，然后下载文件。';syncExport();});
  $('exportPNG').addEventListener('click',()=>prepareExport('image'));$('exportVideo').addEventListener('click',()=>prepareExport('video'));$('exportCancel').addEventListener('click',()=>exportController?.abort());
  function closeExport(){exportToken++;exportController?.abort();exportController=null;clearPrepared();$('exportDialog').close();syncExport();}
  $('exportClose').addEventListener('click',closeExport);$('exportDialog').addEventListener('cancel',event=>{event.preventDefault();closeExport();});
  $('shareResult').addEventListener('click',()=>{if(!prepared)return;IO.shareFile(prepared.blob,prepared.filename).then(()=>{$('exportStatus').textContent='已完成系统分享操作。';}).catch(error=>{$('exportStatus').textContent=error.name==='AbortError'?'分享已取消，文件仍可下载。':errorText(error);});});
  $('downloadResult').addEventListener('click',()=>{$('exportStatus').textContent='已发起下载，请在浏览器下载列表查看文件。';});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();exportController?.abort();}else requestPaint();});
  window.addEventListener('resize',queueResize);window.visualViewport?.addEventListener('resize',queueResize);window.visualViewport?.addEventListener('scroll',queueResize);if(window.ResizeObserver)new ResizeObserver(queueResize).observe(viewport);
  document.addEventListener('focusin',queueResize);document.addEventListener('focusout',queueResize);
  window.addEventListener('pagehide',event=>{stop();cancelWork();clearTimeout(commitTimer);clearTimeout(saveTimer);exportController?.abort();if(event.persisted){syncUI();return;}disposed=true;cancelAnimationFrame(frameRequest);cancelAnimationFrame(resizeFrame);mobileEditor?.destroy?.();clearPrepared();renderer.dispose();boot?.destroy();S?.dispose?.();});
  document.addEventListener('keydown',event=>{const editing=event.target.matches('input,textarea,select');if(!editing&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();historyStep(event.shiftKey?'redo':'undo');}if(event.key==='Escape'&&drawing){endPathDrawing();notify('已取消绘制，原路径保留。');return;}if(event.key==='Escape'&&selecting){selecting=false;viewport.classList.remove('selecting');syncUI();}});
  for(const name of ['Layout','Style','Motion','ASCII'])$('tab'+name).addEventListener('click',()=>showParameterTab(name));
  for(const name of ['Basic','Stroke','Glow','Shadow'])$('style'+name).addEventListener('click',()=>showStyleTab(name));
  function tabKeys(prefix,names,activate){names.forEach((name,index)=>$(prefix+name).addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%names.length;else if(event.key==='ArrowLeft')next=(index+names.length-1)%names.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=names.length-1;else return;event.preventDefault();activate(names[next]);$(prefix+names[next]).focus();}));}
  tabKeys('helix',['Shape','Position'],showHelixLayout);tabKeys('tab',['Layout','Style','Motion','ASCII'],showParameterTab);tabKeys('style',['Basic','Stroke','Glow','Shadow'],showStyleTab);
  $('asciiSettings').addEventListener('click',()=>showParameterTab(parameterTab==='ASCII'?'Layout':'ASCII'));
  $('projectMenuButton').addEventListener('click',()=>{if(drawing)return;flush();$('projectDialog').showModal();});$('projectClose').addEventListener('click',()=>$('projectDialog').close());
  $('projectDialog').addEventListener('click',event=>{if(['openProject','newProject','bootReplay'].includes(event.target.id))$('projectDialog').close();});
  mobileEditor=window.KineticMobileEditor?.create({onLayout:queueResize,onTextEdit:mobileTextEdit,onDetail:setDetail})||null;
  setVisualViewport();showParameterTab('Layout');showStyleTab('Basic');syncUI();openStart();notify('先选照片与画布，再进入文字编辑。');
})();
