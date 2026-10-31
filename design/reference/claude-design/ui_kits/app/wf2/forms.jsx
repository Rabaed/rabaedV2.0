// Action forms for transitions (pop-up shown when a button is pressed). Exposes window.AF.
const {useState:afUseState}=React;
const afL=(e,a)=>RS.S.lang==='ar'?a:e;
const AF_B={comment:{ic:'ti-message',en:'Comment',ar:'تعليق',d:['Free-text note, saved to the approvals log','ملاحظة نصية تُحفظ في سجل الاعتمادات']},
 rec:{ic:'ti-star',en:'Recommendation',ar:'توصية',d:['Reviewer recommends a code to the next holder','يوصي المراجع برمز للمتولي التالي']},
 tasks:{ic:'ti-list-check',en:'Follow-up tasks',ar:'مهام المتابعة',d:['Each task is created in the Snag List and linked back','تُنشأ كل مهمة في قائمة الملاحظات وترتبط بالعنصر']},
 files:{ic:'ti-paperclip',en:'Attachments',ar:'مرفقات',d:['Marked-up drawings or photos','مخططات أو صور مع ملاحظات']}};
const AF_ORDER=['comment','rec','tasks','files'];
const CODEH={A:'green',B:'green',C:'orange',D:'red'};
const formOf=t=>t.form||(t.code==='B'?['comment','tasks']:['comment']);
const cfgOf=(t,k)=>Object.assign({},{comment:{req:1},rec:{req:1,codes:['A','B','C','D']},tasks:{req:t.code==='B'?1:0,co:'ctr',due:7,kind:'task'},files:{req:0}}[k],(t.formCfg||{})[k]);
const SAMPLE=[{title:'Submit revised bracket fixing detail',ttl_ar:'تقديم تفصيل تثبيت الحامل المعدّل',loc:'Tower 1 · L02'},{title:'Confirm IP rating on corridor fittings',ttl_ar:'تأكيد درجة الحماية لوحدات الممرات',loc:'Tower 1 · L02 corridor'}];
const coName=k=>afL(WF.CO[k][2],WF.CO[k][3]);
/* ---------- editor (inside the transition panel) ---------- */
function FormEditor({t,sel,upd,snapH,onPreview}){const f=formOf(t);
 const setF=fn=>{snapH();upd(n=>{const x=n.T[sel];x.form=formOf(x).slice();x.formCfg=x.formCfg||{};fn(x)})};
 const setC=(k,key,v)=>setF(x=>{x.formCfg[k]=Object.assign({},cfgOf(x,k),{[key]:v})});
 const missing=AF_ORDER.filter(k=>!f.includes(k));
 return <><h6>{afL('Action form (pop-up)','نموذج الإجراء (نافذة)')}</h6>
 <div className="af-list">{f.map((k,i)=>{const b=AF_B[k],c=cfgOf(t,k);return <div key={k} className="af-blk">
  <div className="af-h"><span className="af-ic"><i className={'ti '+b.ic}></i></span><div style={{flex:1,minWidth:0}}><b>{afL(b.en,b.ar)}</b><small>{afL(b.d[0],b.d[1])}</small></div>
   <button className="cb ter sm ic" title={afL('Move up','أعلى')} disabled={!i} onClick={()=>setF(x=>{const a=x.form;[a[i-1],a[i]]=[a[i],a[i-1]]})}><i className="ti ti-arrow-up-right" style={{transform:'rotate(-45deg)'}}></i></button>
   <button className="cb ter sm ic" title={afL('Remove','إزالة')} onClick={()=>setF(x=>{x.form=x.form.filter(z=>z!==k)})}><i className="ti ti-x"></i></button></div>
  <div className="chk3" onClick={()=>setC(k,'req',c.req?0:1)}><span className={'swc'+(c.req?' on':'')}></span>{afL('Required','إلزامي')}</div>
  {k==='rec'&&<div className="af-cfg"><span>{afL('Codes the reviewer can recommend','الرموز المتاحة للتوصية')}</span><div style={{display:'flex',gap:4}}>{['A','B','C','D'].map(cd=>{const on=c.codes.includes(cd);return <button key={cd} className="cdb" style={{border:0,cursor:'pointer',background:`var(--tone-${CODEH[cd]}-${on?'solid':'tint'})`,color:on?'#fff':`var(--tone-${CODEH[cd]}-fg)`}} onClick={()=>setC(k,'codes',on?c.codes.filter(z=>z!==cd):[...c.codes,cd].sort())}>Code {cd}</button>})}</div></div>}
  {k==='tasks'&&<div className="af-cfg">
   <div className="g2"><label className="f">{afL('Assign to','إسناد إلى')}<select value={c.co} onChange={e=>setC(k,'co',e.target.value)}>{Object.keys(WF.CO).map(z=><option key={z} value={z}>{coName(z)}</option>)}</select></label><label className="f">{afL('Due in','الاستحقاق خلال')}<select value={String(c.due)} onChange={e=>setC(k,'due',+e.target.value)}>{[3,7,14,28].map(d=><option key={d} value={String(d)}>{d} {afL('days','أيام')}</option>)}</select></label></div>
   <div className="f">{afL('Create in Snag List as','الإنشاء في قائمة الملاحظات كـ')}<span className="segv">{[['task',afL('Task','مهمة')],['snag',afL('Snag','ملاحظة')],['comment',afL('Comment','تعليق')]].map(o=><button key={o[0]} className={c.kind===o[0]?'on':''} onClick={()=>setC(k,'kind',o[0])} style={{padding:'0 10px',fontSize:12}}>{o[1]}</button>)}</span></div>
   <div className="chk3" onClick={()=>setC(k,'gate',c.gate?0:1)}><span className={'swc'+(c.gate?' on':'')}></span>{afL('Next submission waits until all tasks are closed','التقديم التالي ينتظر إغلاق جميع المهام')}</div>
   <div className="live"><i className="ti ti-clipboard-list"></i> {afL(`Tasks open in Snag List › ${c.kind==='snag'?'Snags':c.kind==='comment'?'Comments':'Tasks'}, linked to this submittal, assigned to ${coName(c.co)}.`,`تُفتح المهام في قائمة الملاحظات وترتبط بهذا التقديم وتُسند إلى ${coName(c.co)}.`)}</div></div>}
 </div>})}
 {!f.length&&<div className="live" style={{background:'var(--tone-gray-tint)',color:'var(--tone-gray-fg)'}}>{afL('No pop-up — the button acts immediately.','بدون نافذة — يُنفَّذ الزر مباشرة.')}</div>}</div>
 {missing.length?<div className="af-add">{missing.map(k=><button key={k} className="cb sm" onClick={()=>setF(x=>{x.form.push(k)})}><i className="ti ti-plus"></i>{afL(AF_B[k].en,AF_B[k].ar)}</button>)}</div>:null}
 {t.code==='B'&&!f.includes('tasks')&&<div className="live" style={{background:'var(--tone-amber-tint)',color:'var(--tone-amber-fg)'}}><i className="ti ti-alert-triangle"></i> {afL('Code B usually needs follow-up tasks so comments get closed out.','الرمز B يحتاج عادةً إلى مهام متابعة لإغلاق الملاحظات.')}</div>}
 <button className="cb sm" style={{alignSelf:'flex-start'}} onClick={onPreview}><i className="ti ti-external-link"></i>{afL('Preview pop-up','معاينة النافذة')}</button></>}
/* ---------- pop-up (preview + test run) ---------- */
function FormPopup({t,from,onCancel,onConfirm,mode}){const f=formOf(t);
 const [txt,setTxt]=afUseState('');const [rec,setRec]=afUseState(null);const [files,setFiles]=afUseState([]);
 const tc=cfgOf(t,'tasks');const [rows,setRows]=afUseState(()=>f.includes('tasks')?SAMPLE.map((s,i)=>({id:i,title:afL(s.title,s.ttl_ar),loc:s.loc,co:tc.co,due:tc.due})):[]);
 const miss=f.filter(k=>cfgOf(t,k).req&&(k==='comment'?!txt.trim():k==='rec'?!rec:k==='tasks'?!rows.filter(r=>r.title.trim()).length:!files.length));
 const setRow=(i,k,v)=>setRows(r=>r.map((x,j)=>j===i?Object.assign({},x,{[k]:v}):x));
 const req=k=>cfgOf(t,k).req?<span style={{color:'var(--tone-red-fg)'}}> *</span>:null;const lb=(k,txt)=><span className="af-lb">{txt}{req(k)}</span>;
 return <div className="scrim" onClick={onCancel}><div className="wmdl af-pop" onClick={e=>e.stopPropagation()}>
  <div className="mh">{t.code?<span className="cdb" style={{background:`var(--tone-${CODEH[t.code]}-solid)`,color:'#fff'}}>Code {t.code}</span>:<i className="ti ti-forms" style={{color:'var(--btn-pri)'}}></i>}<div style={{minWidth:0}}><b>{afL(t.en,t.ar)}</b><div style={{fontSize:12,color:'var(--ui-muted)'}}>{mode==='preview'?afL('Preview · what the holder sees','معاينة · ما يراه المتولي'):afL('Test run','تشغيل تجريبي')} · {from}</div></div><button className="cb ter sm ic x" onClick={onCancel}><i className="ti ti-x"></i></button></div>
  <div className="mb">{f.map(k=>{
   if(k==='comment')return <label key={k} className="af-f">{lb(k,afL('Comment','تعليق'))}<textarea rows="3" value={txt} onChange={e=>setTxt(e.target.value)} placeholder={t.code==='B'?afL('Approved subject to the comments below…','معتمد مع مراعاة الملاحظات التالية…'):afL('Add a note for the log…','أضف ملاحظة للسجل…')}></textarea></label>;
   if(k==='rec'){const c=cfgOf(t,k);return <div key={k} className="af-f">{lb(k,afL('Recommend a code to the manager','التوصية برمز للمدير'))}<div className="af-codes">{c.codes.map(cd=><button key={cd} className={rec===cd?'on':''} style={{'--h':`var(--tone-${CODEH[cd]}-solid)`,'--ht':`var(--tone-${CODEH[cd]}-tint)`}} onClick={()=>setRec(cd)}><b>Code {cd}</b><small>{{A:afL('Approved','معتمد'),B:afL('Approved with comments','معتمد مع ملاحظات'),C:afL('Revise & resubmit','مراجعة وإعادة تقديم'),D:afL('Rejected','مرفوض')}[cd]}</small></button>)}</div></div>}
   if(k==='tasks')return <div key={k} className="af-f">{lb(k,afL('Follow-up tasks','مهام المتابعة'))}<span className="af-sub">{afL(`Created in Snag List as ${tc.kind==='snag'?'snags':tc.kind==='comment'?'comments':'tasks'} · assigned to ${coName(tc.co)}`,`تُنشأ في قائمة الملاحظات · تُسند إلى ${coName(tc.co)}`)}</span>
    <div className="af-tasks">{rows.map((r,i)=><div key={r.id} className="af-tr"><span className="af-n">{i+1}</span><input value={r.title} onChange={e=>setRow(i,'title',e.target.value)} placeholder={afL('What needs to be done?','ما المطلوب؟')}/><input value={r.loc} onChange={e=>setRow(i,'loc',e.target.value)} placeholder={afL('Location','الموقع')}/><select value={r.co} onChange={e=>setRow(i,'co',e.target.value)}>{Object.keys(WF.CO).map(z=><option key={z} value={z}>{coName(z)}</option>)}</select><select value={String(r.due)} onChange={e=>setRow(i,'due',+e.target.value)}>{[3,7,14,28].map(d=><option key={d} value={String(d)}>{d}{afL('d','ي')}</option>)}</select><button className="cb ter sm ic" onClick={()=>setRows(x=>x.filter((_,j)=>j!==i))}><i className="ti ti-trash"></i></button></div>)}
    <button className="cb sm" style={{alignSelf:'flex-start'}} onClick={()=>setRows(x=>[...x,{id:Date.now(),title:'',loc:'',co:tc.co,due:tc.due}])}><i className="ti ti-plus"></i>{afL('Add task','إضافة مهمة')}</button></div>
    {tc.gate?<span className="af-sub"><i className="ti ti-info-circle"></i> {afL('The next submission waits until these are closed.','التقديم التالي ينتظر إغلاق هذه المهام.')}</span>:null}</div>;
   return <div key={k} className="af-f">{lb(k,afL('Attachments','مرفقات'))}<div className="af-files">{files.map((x,i)=><span key={i} className="af-file"><i className="ti ti-paperclip"></i>{x}</span>)}<button className="cb sm" onClick={()=>setFiles(x=>[...x,`markup-${x.length+1}.pdf`])}><i className="ti ti-plus"></i>{afL('Add file','إضافة ملف')}</button></div></div>})}
   {!f.length&&<p style={{margin:0,fontSize:13,color:'var(--ui-muted)'}}>{afL('This button has no form — it acts immediately.','هذا الزر بدون نموذج — يُنفَّذ مباشرة.')}</p>}
   {t.sign?<div className="okb" style={{background:'var(--tone-amber-tint)',color:'var(--tone-amber-fg)',fontWeight:500}}><i className="ti ti-signature"></i>{afL('Your signature will be applied on confirm','سيتم تطبيق توقيعك عند التأكيد')}</div>:null}</div>
  <div className="mf">{miss.length?<span style={{marginInlineEnd:'auto',fontSize:12.5,color:'var(--ui-muted)',alignSelf:'center'}}>{afL('Required: ','مطلوب: ')}{miss.map(k=>afL(AF_B[k].en,AF_B[k].ar)).join(', ')}</span>:null}<button className="cb" onClick={onCancel}>{afL('Cancel','إلغاء')}</button><button className="cb pri" disabled={!!miss.length} onClick={()=>onConfirm({tasks:rows.filter(r=>r.title.trim()),rec,kind:tc.kind})}>{afL('Confirm','تأكيد')}</button></div></div></div>}
window.AF={AF_B,formOf,cfgOf,FormEditor,FormPopup};
