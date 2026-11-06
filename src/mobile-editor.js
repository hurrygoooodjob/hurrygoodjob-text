(function () {
  'use strict';
  const categories = {Layout:'排布',Style:'字效',Motion:'动态',ASCII:'ASCII'};
  function banksFor(effect, category) {
    if (category === 'Style') return [
      ['文字外观','textSize','textColor','textOpacity'],
      ['字体与显示','fontSelect','textEnabled'],
      ['描边','textStrokeEnabled','textStrokeWidth','textStrokeColor'],
      ['外发光','textGlowEnabled','textGlow','textGlowColor'],
      ['投影颜色','textShadowEnabled','textShadowOpacity','textShadowColor'],
      ['投影位置','textShadowBlur','textShadowX','textShadowY']
    ];
    if (category === 'Motion') return [
      ['播放与速度','modeToggle','speed','playToggle'],['视频时长','duration']
    ];
    if (category === 'ASCII') return [
      ['密度与对比','asciiDensity','asciiCoverage','asciiContrast'],
      ['字符与混合','asciiEdge','asciiCharset','asciiBlend'],
      ['字符效果','asciiInvert','asciiGlow','asciiAnimate'],
      ['扫描与图层','asciiScanlines','asciiLayerOrder']
    ];
    if (effect === 'wrap') return [
      ['环绕角度','wrapRoll','wrapTilt','wrapPhase'],
      ['位置与宽度','groupOffsetX','groupOffsetY','groupRadiusScale'],
      ['深度与透视','groupDepthScale','depthFade','wrapPerspective']
    ];
    if (effect === 'helix') return [
      ['螺旋形状','wrapTurns','wrapHeight','wrapRoll'],
      ['转向与深度','wrapTilt','wrapPhase','groupDepthScale'],
      ['位置与宽度','groupOffsetX','groupOffsetY','groupRadiusScale'],
      ['明暗与透视','depthFade','wrapPerspective']
    ];
    if (effect === 'contour') return [
      ['主体轮廓','contourGap','contourCount','contourSpacing'],['环绕位置','wrapPhase']
    ];
    if (effect === 'spiral') return [
      ['螺旋形状','spiralTurns','wrapRadius','wrapPhase'],['中心位置','wrapX','wrapY']
    ];
    if (effect === 'customPath') return [
      ['沿线排列','pathPhase','pathSpacing','pathDirection'],['路径设置','pathClosed','pathRepeat']
    ];
    const result=[['文字分布','density','spread','rowGap']];
    if (['hud','wave','flag'].includes(effect)) result.push(['沿图分布','imagePathMode']);
    return result;
  }
  function create(options = {}) {
    const $ = id => document.getElementById(id);
    const body=document.body, media=window.matchMedia('(max-width:600px)');
    const homes=new Map(), controls=new Map(), listeners=[];
    let active=false, detail=false, textOpen=false, category='Layout', currentField='wrapRoll';
    let renderKey='', bankKey='', detailKey='', scheduled=0, destroyed=false;
    const bankSelections=new Map();
    const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const button=(cls,text,label)=>{const n=node('button','small-button '+cls,text);n.type='button';if(label)n.setAttribute('aria-label',label);return n;};
    const listen=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
    function remember(el){if(!el||homes.has(el))return;const anchor=document.createComment('mobile-home:'+el.id);el.before(anchor);homes.set(el,anchor);}
    function move(el,parent){if(!el)return;remember(el);if(el.parentNode!==parent)parent.append(el);}
    function restore(el){const anchor=homes.get(el);if(anchor?.parentNode&&el.parentNode!==anchor.parentNode)anchor.after(el);}
    function layout(){if(scheduled||destroyed)return;scheduled=requestAnimationFrame(()=>{scheduled=0;options.onLayout?.();});}
    const dock=node('div','mobile-dock');dock.id='mobileDock';dock.hidden=true;
    const main=node('div','mobile-main-row');
    const effectSlot=node('div','mobile-effect-slot'),groupSlot=node('div','mobile-group-slot');
    const summary=button('mobile-text-summary','改文字','编辑当前文字');
    const summaryText=node('span','mobile-summary-copy');summary.replaceChildren(node('span','mobile-summary-label','文字'),summaryText);
    const groupMenu=button('mobile-group-menu','⋯','管理当前文字组');
    const detailLabel=node('span','mobile-detail-effect');
    const detailSelect=node('select','mobile-detail-select');detailSelect.id='mobileDetailParameter';detailSelect.setAttribute('aria-label','细节调节参数');
    main.append(effectSlot,groupSlot,summary,groupMenu,detailLabel,detailSelect);
    const nav=node('div','mobile-bank-nav');
    const categorySelect=node('select','mobile-category-select');categorySelect.id='mobileCategory';categorySelect.setAttribute('aria-label','调节分类');
    Object.entries(categories).forEach(([value,label])=>{const o=node('option','',label);o.value=value;categorySelect.append(o);});
    const bankSelect=node('select','mobile-bank-select');bankSelect.id='mobileParameterBank';bankSelect.setAttribute('aria-label','选择更多参数');
    nav.append(categorySelect,bankSelect);
    const tray=node('div','mobile-control-tray');tray.id='mobileControlTray';
    const edit=node('div','mobile-text-sheet');edit.hidden=true;
    const editHeading=node('div','mobile-text-heading');
    const editTitle=node('label','mobile-text-title','编辑文字');editTitle.id='mobileTextTitle';editTitle.htmlFor='textInput';
    const textDone=button('mobile-text-done green','完成');textDone.id='mobileTextDone';
    editHeading.append(editTitle,textDone);edit.append(editHeading);
    dock.append(main,nav,tray,edit);$('controlColumn').append(dock);
    const toolbar=node('div','mobile-canvas-tools');toolbar.id='mobileCanvasTools';toolbar.hidden=true;
    const asciiSlot=node('div','mobile-ascii-slot'),contextSlot=node('div','mobile-context-slot');
    toolbar.append(asciiSlot);$('pathDrawBar').after(toolbar);
    const groupDialog=node('dialog','export-dialog mobile-group-dialog');groupDialog.id='mobileGroupDialog';
    const groupHead=node('div','dialog-header');const groupClose=button('','完成');groupHead.append(node('h2','','文字组'),groupClose);
    const groupNameSlot=node('div','mobile-group-name'),groupActions=node('div','mobile-group-actions');
    const groupHelp=node('p','','当前选择的文字组独立保存旋转、位置和字效。');
    groupDialog.append(groupHead,groupHelp,groupNameSlot,groupActions);body.append(groupDialog);
    const originalLabels={
      ascii:$('asciiEnabled').closest('label').querySelector('span')?.textContent,
      add:$('addGroup').textContent,remove:$('removeGroup').textContent,
      detail:$('detailToggle').textContent,textLabelledBy:$('textInput').getAttribute('aria-labelledby')
    };
    function fieldNode(id){
      if(controls.has(id))return controls.get(id);
      const input=$(id);if(!input)return null;
      const el=input.closest('label')||input;
      remember(el);controls.set(id,el);return el;
    }
    function fieldTitle(id){
      const el=fieldNode(id),input=$(id);if(!el)return id;
      if(input.tagName==='BUTTON')return '播放控制';
      const span=el.querySelector('span');
      return (span?Array.from(span.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():input.getAttribute('aria-label'))||id;
    }
    // Register controls once; original listeners, labels and output nodes remain intact.
    for(const effect of ['wrap','helix','contour','spiral','customPath','hud']){
      for(const cat of Object.keys(categories))for(const bank of banksFor(effect,cat))bank.slice(1).forEach(fieldNode);
    }
    function getEffect(){return $('effectSelect').value||'wrap';}
    function isGrouped(){return ['wrap','helix'].includes(getEffect());}
    function getBanks(){return banksFor(getEffect(),category);}
    function getBankIndex(banks){const key=getEffect()+':'+category;return Math.max(0,Math.min(banks.length-1,bankSelections.get(key)||0));}
    function returnTray(){for(const child of Array.from(tray.children))restore(child);}
    function syncSummary(){
      const text=$('textInput').value.replace(/\s+/g,' ').trim();summaryText.textContent=text||'点此输入';summary.title=text;
      summary.setAttribute('aria-label','编辑文字：'+(text||'空文字'));
      editTitle.textContent=isGrouped()?($('groupName').value||'当前组')+' · 编辑文字':'编辑文字';
      const busy=$('studio').getAttribute('aria-busy')==='true';summary.disabled=busy;groupMenu.disabled=busy;
    }
    function compactGroupLabels(){
      for(const option of $('groupSelect').options){
        if(!option.dataset.mobileFullLabel)option.dataset.mobileFullLabel=option.textContent;
        const name=option.dataset.mobileFullLabel.split(' · ')[0];
        option.textContent=name.replace(/^文字组\s*(\d+)$/,'组 $1');
      }
      $('groupSelect').title=$('groupSelect').selectedOptions[0]?.dataset.mobileFullLabel||'';
    }
    function render(){
      if(!active)return;
      const effect=getEffect(),grouped=isGrouped(),banks=getBanks(),index=getBankIndex(banks),bank=banks[index];
      compactGroupLabels();
      dock.classList.toggle('is-grouped',grouped);groupSlot.hidden=!grouped;groupMenu.hidden=!grouped;
      categorySelect.value=category;
      const nextBankKey=effect+':'+category;
      if(bankKey!==nextBankKey){
        bankKey=nextBankKey;bankSelect.replaceChildren();banks.forEach((entry,i)=>{const o=node('option','',entry[0]+(banks.length>1?' · '+(i+1)+'/'+banks.length:''));o.value=String(i);bankSelect.append(o);});
      }
      bankSelect.value=String(index);
      const allFields=Object.keys(categories).flatMap(cat=>banksFor(effect,cat).flatMap(entry=>entry.slice(1).map(id=>({id,title:categories[cat]+' · '+fieldTitle(id)}))));
      const uniqueFields=allFields.filter((f,i)=>allFields.findIndex(other=>other.id===f.id)===i);
      if(!uniqueFields.some(f=>f.id===currentField))currentField=bank[1];
      const nextDetailKey=effect+':'+uniqueFields.map(f=>f.id).join(',');
      if(detailKey!==nextDetailKey){detailKey=nextDetailKey;detailSelect.replaceChildren();uniqueFields.forEach(field=>{const o=node('option','',field.title);o.value=field.id;detailSelect.append(o);});}
      detailSelect.value=currentField;
      detailLabel.textContent=$('effectSelect').selectedOptions[0]?.textContent||'文字';
      detailLabel.hidden=grouped;
      const ids=detail?[currentField]:bank.slice(1),nextRenderKey=(detail?'detail:':'bank:')+ids.join(',');
      if(renderKey!==nextRenderKey){
        returnTray();ids.forEach(id=>{const control=fieldNode(id);if(control)move(control,tray);});
        renderKey=nextRenderKey;tray.dataset.count=String(ids.length);layout();
      }
      if(effect==='customPath')move($('drawPath'),contextSlot);
      else if(['wrap','helix','contour','spiral'].includes(effect))move($('selectSubject'),contextSlot);
      // Restore the inactive contextual button before showing the other one.
      if(effect!=='customPath')restore($('drawPath'));
      if(!['wrap','helix','contour','spiral'].includes(effect))restore($('selectSubject'));
      contextSlot.hidden=detail||!['wrap','helix','contour','spiral','customPath'].includes(effect);
      toolbar.classList.toggle('without-context',contextSlot.hidden);
      syncSummary();
      if(groupDialog.open&&!grouped)groupDialog.close();
      const busy=$('studio').getAttribute('aria-busy')==='true';
      categorySelect.disabled=busy;bankSelect.disabled=busy;detailSelect.disabled=busy;
    }
    function activate(){
      if(active)return;active=true;body.classList.add('mobile-editor');dock.hidden=false;toolbar.hidden=false;
      $('effectSelect').setAttribute('aria-label','文字效果');$('groupSelect').setAttribute('aria-label','编辑文字组');
      $('textInput').setAttribute('aria-labelledby','mobileTextTitle');
      move($('effectSelect'),effectSlot);move($('groupSelect'),groupSlot);
      move($('textInput'),edit);
      move($('projectMenuButton'),document.querySelector('.top-actions'));
      move($('asciiEnabled').closest('label'),asciiSlot);
      const asciiText=$('asciiEnabled').closest('label').querySelector('span');if(asciiText)asciiText.textContent='ASCII';
      for(const id of ['zoomOut','zoomReset','zoomIn'])move($(id),toolbar);
      toolbar.append(contextSlot);move($('detailToggle'),toolbar);
      move($('groupNameControl'),groupNameSlot);move($('addGroup'),groupActions);move($('removeGroup'),groupActions);
      $('addGroup').textContent='添加一组';$('removeGroup').textContent='删除当前组';
      if(body.classList.contains('detail-view'))setDetail(true);
      render();layout();
    }
    function deactivate(){
      if(!active)return;closeText();if(groupDialog.open)groupDialog.close();
      active=false;detail=false;body.classList.remove('mobile-editor','mobile-detail','mobile-text-edit');
      // Restore labels first, then the controls originally nested inside them.
      for(const el of Array.from(homes.keys()))restore(el);
      const asciiText=$('asciiEnabled').closest('label').querySelector('span');if(asciiText)asciiText.textContent=originalLabels.ascii;
      $('addGroup').textContent=originalLabels.add;$('removeGroup').textContent=originalLabels.remove;
      for(const option of $('groupSelect').options){if(option.dataset.mobileFullLabel){option.textContent=option.dataset.mobileFullLabel;delete option.dataset.mobileFullLabel;}}
      $('groupSelect').removeAttribute('title');
      if(originalLabels.textLabelledBy===null)$('textInput').removeAttribute('aria-labelledby');
      else $('textInput').setAttribute('aria-labelledby',originalLabels.textLabelledBy);
      dock.hidden=true;toolbar.hidden=true;renderKey='';bankKey='';detailKey='';
      options.onDetail?.(false);layout();
    }
    function sync(){
      if(destroyed)return;
      const shouldActivate=media.matches&&body.classList.contains('editor-active');
      if(shouldActivate){activate();render();}else deactivate();
    }
    function selectCategory(next){if(!categories[next])return;category=next;currentField=getBanks()[getBankIndex(getBanks())][1];render();}
    function setDetail(value){
      if(!active)return;const next=!!value;if(detail===next)return;
      closeText();detail=next;body.classList.toggle('mobile-detail',detail);render();options.onDetail?.(detail);layout();
    }
    function openText(){
      if(!active||textOpen)return;textOpen=true;edit.hidden=false;body.classList.add('mobile-text-edit');
      syncSummary();options.onTextEdit?.(true);layout();$('textInput').focus({preventScroll:true});
    }
    function closeText(){
      if(!textOpen)return;textOpen=false;$('textInput').blur();edit.hidden=true;body.classList.remove('mobile-text-edit');
      options.onTextEdit?.(false);syncSummary();layout();
    }
    listen(categorySelect,'change',()=>selectCategory(categorySelect.value));
    listen(bankSelect,'change',()=>{bankSelections.set(getEffect()+':'+category,Number(bankSelect.value));const bank=getBanks()[getBankIndex(getBanks())];currentField=bank[1];render();});
    listen(detailSelect,'change',()=>{currentField=detailSelect.value;render();});
    listen(tray,'pointerdown',event=>{const input=event.target.closest('input,select,button');if(input?.id)currentField=input.id;});
    listen(tray,'focusin',event=>{if(event.target.id)currentField=event.target.id;});
    listen(summary,'click',openText);listen(textDone,'click',closeText);
    listen($('textInput'),'input',syncSummary);
    listen(groupMenu,'click',()=>{syncSummary();groupDialog.showModal();});
    listen(groupClose,'click',()=>groupDialog.close());
    listen(groupDialog,'click',event=>{if(event.target===groupDialog){const r=groupDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)groupDialog.close();}});
    listen(document,'keydown',event=>{if(event.key==='Escape'&&textOpen){event.preventDefault();closeText();}});
    listen($('asciiSettings'),'click',()=>selectCategory('ASCII'));
    listen($('asciiEnabled'),'change',()=>{if(active&&$('asciiEnabled').checked)selectCategory('ASCII');});
    for(const cat of Object.keys(categories))listen($('tab'+cat),'click',()=>selectCategory(cat));
    listen(media,'change',sync);
    sync();
    return {
      sync,setDetail,closeText,selectCategory,isActive:()=>active,isDetail:()=>detail,isTextEditing:()=>textOpen,
      destroy(){if(destroyed)return;deactivate();destroyed=true;cancelAnimationFrame(scheduled);listeners.forEach(remove=>remove());dock.remove();toolbar.remove();groupDialog.remove();for(const anchor of homes.values())anchor.remove();}
    };
  }
  window.KineticMobileEditor={create,banksFor};
})();
