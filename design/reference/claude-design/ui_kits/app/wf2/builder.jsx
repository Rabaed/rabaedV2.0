// Workflow builder V2 — built on React Flow (reactflow@11 UMD). Data model shared with v1 (WF from wf/data.js).
const {useState,useMemo,useCallback,useEffect,useRef}=React;
const RFX=window.ReactFlow;const Flow=RFX.ReactFlow||RFX.default;
const {useStoreApi,ReactFlowProvider,Background,MiniMap,Handle,Position,EdgeLabelRenderer,BaseEdge,getBezierPath,getSmoothStepPath,useStore,useReactFlow}=RFX;
const {STG,END,CO,FIELDS,VERS,BANDS,W,clone}=WF;
const RS2=RS.S;const L=(e,a)=>RS2.lang==='ar'?a:e;
const tone=k=>{const el=document.querySelector('.rs')||document.documentElement;return getComputedStyle(el).getPropertyValue(k).trim()||'#8a8f9c'};
const edgeColor=t=>t.type==='return'?tone('--tone-orange-solid'):t.type==='submit'?tone('--btn-pri'):t.code?tone(`--tone-${t.code==='C'?'orange':t.code==='D'?'red':'green'}-solid`):t.type==='cancel'?tone('--tone-gray-solid'):tone('--ui-text-2');
const box=s=>s.end?{w:170,h:46}:{w:200,h:78};
const TT={send:['Send','إرسال'],submit:['Submit','تقديم'],return:['Return','إرجاع'],close:['Close','إغلاق'],cancel:['Cancel','إلغاء']};
function validate(d){const out=[];const {S:St,T}=d;
 Object.entries(St).forEach(([id,s])=>{if(s.end)return;if(!Object.values(T).some(t=>t.f===id))out.push({lv:'err',id,msg:[`Step “${s.en}” has no way forward`,`الخطوة «${s.ar}» ليس لها مسار للأمام`]})});
 Object.entries(T).forEach(([id,t])=>{const a=St[t.f],b=St[t.to];if(!a||!b)return;
  if((t.type==='submit'||t.code)&&!t.sign)out.push({lv:'err',id,msg:[`“${t.en}” sets a hand-over or final code and must require signature`,`«${t.ar}» يجب أن يتطلب توقيعًا`]});
  if(t.type==='return'&&!b.end&&a.co!==b.co)out.push({lv:'err',id,msg:[`Return “${t.en}” crosses companies — Return can only go back within the same company`,`الإرجاع «${t.ar}» يعبر بين الشركات — مسموح داخل نفس الشركة فقط`]});
  if(t.type==='send'&&!b.end&&a.co!==b.co)out.push({lv:'err',id,msg:[`“${t.en}” is a Send but goes to another company — use Submit`,`«${t.ar}» إرسال إلى شركة أخرى — استخدم تقديم`]});
  (t.cond||[]).forEach(c=>{if(!FIELDS.includes(c.f))out.push({lv:'err',id,msg:[`Condition uses field “${c.f}” that doesn’t exist in the form`,`الشرط يستخدم الحقل «${c.f}» غير الموجود في النموذج`]})})});
 Object.entries(T).forEach(([id,t])=>{if(t.code==='B'&&!AF.formOf(t).includes('tasks'))out.push({lv:'warn',id,msg:[`“${t.en}” is Code B but has no follow-up tasks block`,`«${t.ar}» رمز B بدون مهام متابعة`]})});
 const byF={};Object.entries(T).forEach(([id,t])=>{if(t.cond&&t.cond.length)(byF[t.f]=byF[t.f]||[]).push(id)});Object.values(byF).forEach(ids=>{if(ids.length>1)out.push({lv:'warn',id:ids[1],msg:['Two conditions from the same step can both match','شرطان من نفس الخطوة قد يتحققان معًا']})});
 return out}
function autoLayout(n){const ids=Object.keys(n.S);const start=ids.find(i=>n.S[i].stage==='drafts'&&!n.S[i].end)||ids[0];const depth={[start]:0};const q=[start];
 while(q.length){const a=q.shift();Object.values(n.T).forEach(t=>{if(t.f!==a||t.type==='return'||t.type==='cancel'||!n.S[t.to]||n.S[t.to].end)return;if(depth[t.to]==null){depth[t.to]=depth[a]+1;q.push(t.to)}})}
 const band=Object.fromEntries(BANDS.map(b=>[b[0],b]));const cols={},byCol={};
 ids.forEach(i=>{const s=n.S[i];if(s.end)return;(cols[s.stage]=cols[s.stage]||new Set()).add(depth[i]??99)});
 ids.forEach(i=>{const s=n.S[i];if(s.end)return;const ds=[...cols[s.stage]].sort((a,b)=>a-b);const x=band[s.stage][1]+30+ds.indexOf(depth[i]??99)*280;(byCol[x]=byCol[x]||[]).push(i)});
 Object.entries(byCol).forEach(([x,arr])=>arr.forEach((i,j)=>{n.S[i].x=+x;n.S[i].y=Math.round((330-(arr.length-1)*145+j*290-39)/10)*10}));
 ids.filter(i=>n.S[i].end).sort((a,b)=>'ACDX'.indexOf(n.S[a].end)-'ACDX'.indexOf(n.S[b].end)).forEach((i,j)=>{n.S[i].x=1110;n.S[i].y=70+j*160})}
/* ---------- canvas pieces ---------- */
const Hs=({rtl,end})=><>
 <Handle id="l" type="target" position={rtl?Position.Right:Position.Left}/>
 {!end&&<Handle id="r" type="source" position={rtl?Position.Left:Position.Right}/>}
 <Handle id="tt" type="target" position={Position.Top}/>
 {!end&&<Handle id="ts" type="source" position={Position.Top} style={{left:'72%'}}/>}
 {!end&&<Handle id="bs" type="source" position={Position.Bottom} style={{left:'32%'}}/>}
 <Handle id="bt" type="target" position={Position.Bottom} style={{left:'68%'}}/>
</>;
function StepNode({data}){const s=data.s;const outL={recommend:['Recommends code','يوصي بالرمز'],final:['Issues final code','يصدر الرمز النهائي'],insp:['Inspection result','نتيجة الفحص']}[s.out];
 return <div className={'rf2-step '+(data.cls||'')} style={{'--nc':`var(--tone-${STG[s.stage][2]}-solid)`}} dir={data.rtl?'rtl':'ltr'}><Hs rtl={data.rtl}/>
  <span className="ic"><i className={'ti '+(s.ic||'ti-user')}></i></span>
  <div className="tx"><b>{L(s.en,s.ar)}</b><small>{L(CO[s.co][2],CO[s.co][3])} · {s.perm}</small>{outL&&<span className="om">{L(outL[0],outL[1])}</span>}</div>
  {s.cond?<span className="cd"><i className="ti ti-filter"></i></span>:null}{data.err?<span className="rf2-er"><i className="ti ti-alert-triangle"></i></span>:null}</div>}
function EndNode({data}){const e=END[data.s.end];return <div className={'rf2-end '+(data.cls||'')} style={{'--nc':`var(--tone-${e[2]}-solid)`,'--nt':`var(--tone-${e[2]}-tint)`}} dir={data.rtl?'rtl':'ltr'}><Hs rtl={data.rtl} end/><i className={'ti '+e[3]}></i>{L(e[0],e[1])}</div>}
function WfEdge(p){const {data}=p;const t=data.t;let path,lx,ly,anc='-50%';
 if(data.route==='loop'){const off=40+data.n*24;[path,lx,ly]=getSmoothStepPath({...p,sourcePosition:Position.Bottom,targetPosition:Position.Bottom,borderRadius:16,offset:off});ly=Math.max(p.sourceY,p.targetY)+off}
 else if(data.ortho||data.route==='v')[path,lx,ly]=getSmoothStepPath({...p,borderRadius:14});
 else [path,lx,ly]=getBezierPath(p);
 if(data.route==='v'){lx=p.sourceX+(data.n?14:-14)*(p.sourceX>p.targetX?1:-1);lx+=(p.targetY>p.sourceY?-1:1)*0;lx=(p.sourceX+p.targetX)/2+(p.targetY>p.sourceY?-58:58)}
 if(data.route==='fwd'){if(data.toEnd){const ltr=p.targetX>p.sourceX;lx=p.targetX+(ltr?-12:12);ly=p.targetY+(data.fi-(data.fc-1)/2)*25;anc=ltr?'-100%':'0%'}else{ly+=data.n*26;lx+=data.n*40}}
 const sel=p.selected;
 return <><BaseEdge path={path} markerEnd={p.markerEnd} interactionWidth={18} style={{stroke:data.col,strokeWidth:sel?3.5:data.cls==='done'?3:2,strokeDasharray:t.type==='return'?'6 4':undefined,opacity:data.cls==='fade'?.3:1}}/>
 <EdgeLabelRenderer><button className={'rf2-lbl nodrag nopan '+(data.cls||'')+(sel?' sel':'')} style={{transform:`translate(${lx}px,${ly}px) translate(${anc},-50%)`,'--ec':data.col}} onClick={e=>{e.stopPropagation();data.onPick(p.id)}}>{t.sign?<i className="ti ti-signature"></i>:null}{t.cond?<i className="ti ti-filter"></i>:null}{AF.formOf(t).includes('tasks')?<i className="ti ti-list-check"></i>:null}{AF.formOf(t).includes('rec')?<i className="ti ti-star"></i>:null}{L(t.en,t.ar)}{data.err?<i className="ti ti-alert-triangle er"></i>:null}</button></EdgeLabelRenderer></>}
const nodeTypes={step:StepNode,end:EndNode},edgeTypes={wf:WfEdge};
function Bands({rtl}){const tr=useStore(s=>s.transform);return <div className="rf2-bands" style={{transform:`translate(${tr[0]}px,${tr[1]}px) scale(${tr[2]})`}}>{BANDS.map(([k,a,b])=>{const c=STG[k][2];return <div key={k} className="rf2-band" style={{left:rtl?W-b:a,width:b-a,background:`var(--tone-${c}-tint)`}}><span style={{color:`var(--tone-${c}-fg)`,...(rtl?{left:'auto',right:14}:{})}}>{L(STG[k][0],STG[k][1])}</span></div>})}</div>}
/* ---------- inspector ---------- */
function Side({m,sel,setSel,upd,snapH,del,makeT,onPreview}){const s=m.S[sel],t=m.T[sel];
 const obj=n=>n.S[sel]||n.T[sel];
 const inp=(o,k,x={})=><input value={o[k]||''} onFocus={snapH} onChange={e=>{const v=e.target.value;upd(n=>{obj(n)[k]=v})}} {...x}/>;
 const setK=(k,v)=>{snapH();upd(n=>{const o=obj(n);if(v===''||v==null)delete o[k];else o[k]=v})};
 const nm=x=>x.end?L(END[x.end][0],END[x.end][1]):L(x.en,x.ar);
 const delBtn=lbl=><button className="cb sm" onClick={del} style={{color:'var(--tone-red-fg)',alignSelf:'flex-start'}}><i className="ti ti-trash"></i>{lbl}</button>;
 if(!s&&!t)return <><h6>{L('Nothing selected','لا يوجد تحديد')}</h6><p style={{fontSize:13,color:'var(--ui-muted)',margin:0,lineHeight:1.5}}>{L('Click a step or an arrow label to edit it.','انقر على خطوة أو على تسمية سهم لتعديلها.')}</p>
  <h6>{L('On the canvas','على اللوحة')}</h6><ul className="rf2-tips">
   <li><i className="ti ti-git-branch"></i><span>{L('Drag from any dot on a step and drop on another step — that creates a new button. Drop on empty canvas to create a new step already connected.','اسحب من أي نقطة على خطوة وأفلتها على خطوة أخرى لإنشاء زر جديد. أفلتها على مساحة فارغة لإنشاء خطوة جديدة متصلة.')}</span></li>
   <li><i className="ti ti-hand-move"></i><span>{L('Drag steps and ends from the palette onto the canvas.','اسحب الخطوات والنهايات من اللوحة الجانبية إلى المخطط.')}</span></li>
   <li><i className="ti ti-pointer"></i><span>{L('Shift-drag to box-select; drag the group to move it.','اضغط Shift واسحب لتحديد عدة عناصر ونقلها معًا.')}</span></li>
   <li><i className="ti ti-trash"></i><span><kbd>Delete</kbd> {L('removes the selection','يحذف المحدد')} · <kbd>⌘Z</kbd> {L('undo','تراجع')} · <kbd>⇧⌘Z</kbd> {L('redo','إعادة')}</span></li>
  </ul><h6>{L('This draft','هذه المسودة')}</h6><div style={{fontSize:13}}>{Object.values(m.S).filter(x=>!x.end).length} {L('steps','خطوات')} · {Object.keys(m.T).length} {L('transitions','انتقالات')}</div></>;
 if(s&&s.end){const ins=Object.entries(m.T).filter(([,x])=>x.to===sel);return <><h6>{L('End','نهاية')}</h6><b>{nm(s)}</b><p style={{fontSize:12.5,color:'var(--ui-muted)',margin:0}}>{L('Ends only receive actions. Final codes are set on the incoming button.','النهايات تستقبل الإجراءات فقط. الرمز النهائي يُحدَّد على الزر الوارد.')}</p><h6>{L('Incoming','الواردة')} · {ins.length}</h6><div className="rf2-outs">{ins.map(([k,x])=><button key={k} onClick={()=>setSel(k)}><i className="d" style={{background:edgeColor(x)}}></i>{L(x.en,x.ar)}</button>)}</div>{delBtn(L('Delete end','حذف النهاية'))}</>}
 if(s){const pool=s.co==='ctr'?'TMC Constructions → Nasser, Ahmed':s.co==='cns'?'Design Consultants LLC → pool: Ahmed, Sara':'Al Futtaim PMC → Hassan';const outs=Object.entries(m.T).filter(([,x])=>x.f===sel);
  return <><h6>{L('Step','خطوة')}</h6>
  <label className="f">{L('Name (EN)','الاسم (EN)')}{inp(s,'en')}</label>
  <label className="f">{L('Name (AR)','الاسم (AR)')}{inp(s,'ar',{dir:'rtl'})}</label>
  <label className="f">{L('Stage','المرحلة')}<select value={s.stage} onChange={e=>setK('stage',e.target.value)}>{['drafts','internal','pending'].map(k=><option key={k} value={k}>{L(STG[k][0],STG[k][1])}</option>)}</select></label>
  <h6>{L('Who holds it','من يتولاها')}</h6><div className="g2"><select value={s.co} onChange={e=>setK('co',e.target.value)}>{Object.keys(CO).map(k=><option key={k} value={k}>{L(CO[k][2],CO[k][3])}</option>)}</select><select value={s.perm} onChange={e=>setK('perm',e.target.value)}>{['Create','Review','Approve','Verify','Fix'].map(x=><option key={x}>{x}</option>)}</select></div>
  <div className="live"><i className="ti ti-users"></i> {L('In this project:','في هذا المشروع:')} {pool}</div>
  <h6>{L('Outcome','النتيجة')}</h6><select value={s.out} onChange={e=>setK('out',e.target.value)}>{[['none',L('None','بدون')],['recommend',L('Recommend a code (for the manager)','يوصي برمز')],['final',L('Issue the final code','يصدر الرمز النهائي')],['insp',L('Inspection result','نتيجة الفحص')]].map(o=><option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
  <h6>{L('Buttons from this step','الأزرار من هذه الخطوة')} · {outs.length}</h6>{outs.length?<div className="rf2-outs">{outs.map(([k,x])=><button key={k} onClick={()=>setSel(k)}><i className="d" style={{background:edgeColor(x)}}></i><span style={{flex:1}}>{L(x.en,x.ar)}</span><i className="ti ti-arrow-right" style={{color:'var(--ui-faint)'}}></i><span style={{color:'var(--ui-muted)'}}>{nm(m.S[x.to])}</span></button>)}</div>:<div className="live" style={{background:'var(--tone-amber-tint)',color:'var(--tone-amber-fg)'}}>{L('Drag from this step’s dot to add a button.','اسحب من نقطة هذه الخطوة لإضافة زر.')}</div>}
  <label className="f">{L('Add a button to…','إضافة زر إلى…')}<select value="" onChange={e=>{if(e.target.value)makeT(sel,e.target.value)}}><option value="">{L('Choose target step or end','اختر الخطوة أو النهاية')}</option>{Object.entries(m.S).filter(([k])=>k!==sel).map(([k,x])=><option key={k} value={k}>{nm(x)}</option>)}</select></label>
  {delBtn(L('Delete step','حذف الخطوة'))}</>}
 return <><h6>{L('Transition (button)','انتقال (زر)')}</h6><div className="rf2-route"><span>{nm(m.S[t.f])}</span><i className="ti ti-arrow-right"></i><span>{nm(m.S[t.to])}</span></div>
 <label className="f">{L('Button label (EN)','نص الزر (EN)')}{inp(t,'en')}</label>
 <label className="f">{L('Button label (AR)','نص الزر (AR)')}{inp(t,'ar',{dir:'rtl'})}</label>
 <div className="f">{L('Type','النوع')}<span className="segv">{Object.keys(TT).map(k=><button key={k} className={t.type===k?'on':''} onClick={()=>setK('type',k)} style={{padding:'0 8px',fontSize:12}}>{L(TT[k][0],TT[k][1])}</button>)}</span></div>
 <label className="f">{L('Outcome · Review Code','النتيجة · رمز المراجعة')}<select value={t.code||''} onChange={e=>setK('code',e.target.value)}><option value="">—</option>{['A','B','C','D'].map(c=><option key={c}>{c}</option>)}</select></label>
 <div className="chk3" onClick={()=>setK('sign',t.sign?0:1)}><span className={'swc'+(t.sign?' on':'')}></span>{L('Requires signature + confirmation','يتطلب توقيعًا وتأكيدًا')}</div>
 <h6>{L('Condition','الشرط')}</h6>{(t.cond||[]).map((c,i)=><React.Fragment key={i}><div className="crow"><select value={c.f} onChange={e=>{snapH();const v=e.target.value;upd(n=>{n.T[sel].cond[i].f=v})}}>{[...FIELDS,...(FIELDS.includes(c.f)?[]:[c.f])].map(f=><option key={f}>{f}</option>)}</select><select value={c.op} onChange={e=>{snapH();const v=e.target.value;upd(n=>{n.T[sel].cond[i].op=v})}}>{['>','<','=','≠'].map(o=><option key={o}>{o}</option>)}</select><input value={c.v} onFocus={snapH} onChange={e=>{const v=e.target.value;upd(n=>{n.T[sel].cond[i].v=v})}}/><button className="cb ter sm ic" onClick={()=>{snapH();upd(n=>{n.T[sel].cond.splice(i,1);if(!n.T[sel].cond.length)delete n.T[sel].cond})}}><i className="ti ti-x"></i></button></div>{i<t.cond.length-1?<small style={{fontWeight:700,color:'var(--ui-muted)'}}>AND</small>:null}</React.Fragment>)}
 <button className="cb sm" style={{alignSelf:'flex-start'}} onClick={()=>{snapH();upd(n=>{const x=n.T[sel];x.cond=x.cond||[];x.cond.push({f:'cost_impact',op:'>',v:'0'})})}}><i className="ti ti-plus"></i>{L('Add rule','إضافة قاعدة')}</button>
 <AF.FormEditor t={t} sel={sel} upd={upd} snapH={snapH} onPreview={()=>onPreview(sel)}/>
 {delBtn(L('Delete transition','حذف الانتقال'))}</>}
/* ---------- builder ---------- */
function Builder(){
 const [,force]=useState(0);useEffect(()=>{const f=()=>force(x=>x+1);addEventListener('rs-render',f);return()=>removeEventListener('rs-render',f)},[]);
 const rtl=RS2.lang==='ar';const rf=useReactFlow();const store=useStoreApi();const wrap=useRef(null);
 const [m,setM]=useState(()=>{const d=VERS.find(v=>v.st==='draft');const T=clone(d.T);if(T.t4)T.t4.form=['comment','rec'];if(T.t7){T.t7.form=['comment','tasks','files'];T.t7.formCfg={tasks:{req:1,co:'ctr',due:7,kind:'task',gate:1}}}return {S:clone(d.S),T}});
 const [sel,setSel]=useState(null);const [selN,setSelN]=useState(()=>new Set());const [selE,setSelE]=useState(()=>new Set());
 const [hist,setHist]=useState({u:[],r:[]});const [dirty,setDirty]=useState(false);const [pub,setPub]=useState(false);
 const [sim,setSim]=useState(null);const [cost,setCost]=useState(620000);
 const [ortho,setOrtho]=useState(false);const [snapOn,setSnapOn]=useState(true);const [mini,setMini]=useState(true);
 const [modal,setModal]=useState(false);const [note,setNote]=useState('');const [noteErr,setNoteErr]=useState(false);
 const [toast,setToast]=useState(null);const [act,setAct]=useState(null);const [conn,setConn]=useState(false);const [over,setOver]=useState(false);
 const mref=useRef(m);mref.current=m;const tt=useRef();const dims=useRef({});const [,bump]=useState(0);
 useEffect(()=>{if(!wrap.current||!window.ResizeObserver)return;let w0=0,tm;const ro=new ResizeObserver(([e])=>{const w=Math.round(e.contentRect.width);if(Math.abs(w-w0)>40){w0=w;clearTimeout(tm);tm=setTimeout(()=>rf.fitView({padding:.08}),60)}});ro.observe(wrap.current);return()=>ro.disconnect()},[]);
 const flash=x=>{setToast(x);clearTimeout(tt.current);tt.current=setTimeout(()=>setToast(null),2400)};
 const snapH=useCallback(()=>{const cur=JSON.stringify(mref.current);setHist(h=>({u:[...h.u,cur].slice(-80),r:[]}));setDirty(true)},[]);
 const upd=useCallback(fn=>setM(prev=>{const n=clone(prev);fn(n);return n}),[]);
 const pick=id=>{setSel(id);if(id&&mref.current.S[id]){setSelN(new Set([id]));setSelE(new Set())}else if(id){setSelE(new Set([id]));setSelN(new Set())}else{setSelN(new Set());setSelE(new Set())}};
 const undo=()=>{if(!hist.u.length)return;setM(JSON.parse(hist.u[hist.u.length-1]));setHist({u:hist.u.slice(0,-1),r:[...hist.r,JSON.stringify(m)]})};
 const redo=()=>{if(!hist.r.length)return;setM(JSON.parse(hist.r[hist.r.length-1]));setHist({r:hist.r.slice(0,-1),u:[...hist.u,JSON.stringify(m)]})};
 useEffect(()=>{const k=e=>{if(e.target.closest&&e.target.closest('input,textarea,select'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}if(e.key==='Escape'){setModal(false);pick(null)}};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k)});
 const idKey=Object.keys(m.S).join(',')+'|'+rtl+'|'+RS2.lang;
 useEffect(()=>{const t1=setTimeout(()=>{const els=[...(wrap.current?wrap.current.querySelectorAll('.react-flow__node'):[])];if(els.length)store.getState().updateNodeDimensions(els.map(el=>({id:el.dataset.id,nodeElement:el,forceUpdate:true})))},60);return()=>clearTimeout(t1)},[idKey]);
 useEffect(()=>{const t=setTimeout(()=>rf.fitView({padding:.08}),140);return()=>clearTimeout(t)},[]);
 const errs=useMemo(()=>validate(m),[m]);const ne=errs.filter(e=>e.lv==='err').length;const errIds=new Set(errs.filter(e=>e.lv==='err').map(e=>e.id));
 const ok=t=>!t.cond||t.cond.every(c=>!/^cost_impact/.test(c.f)||(c.op==='>'?cost>+c.v:c.op==='<'?cost<+c.v:true));
 const advance=id=>{const t=m.T[id];setSim(s=>({at:t.to,path:[...s.path,t.to],edges:[...s.edges,id]}))};
 const go=id=>{const t=m.T[id];if(AF.formOf(t).length||t.sign)return setAct({id,mode:'sim'});advance(id)};
 const onPick=id=>{if(sim){const t=m.T[id];if(t&&t.f===sim.at&&ok(t))go(id);return}pick(id)};
 const mx=(s,x)=>rtl?W-x-box(s).w:x;
 const nodes=Object.entries(m.S).map(([id,s])=>{let cls='';if(sim){cls=sim.path.includes(id)?'done':'fade';if(sim.at===id)cls='cur'}const dm=dims.current[id]||{width:box(s).w,height:box(s).h};return {id,type:s.end?'end':'step',position:{x:mx(s,s.x),y:s.y},width:dm.width,height:dm.height,selected:selN.has(id),data:{s,rtl,cls,err:errIds.has(id)}}});
 const pairN={};const fan={},fanI={};Object.entries(m.T).forEach(([id,t])=>{const a=m.S[t.f],b=m.S[t.to];if(a&&b&&b.end&&Math.abs(b.x-a.x)>60)(fan[t.to]=fan[t.to]||[]).push(id)});Object.values(fan).forEach(ids=>{ids.sort((x,y)=>m.S[m.T[x].f].y-m.S[m.T[y].f].y||(m.T[x].code||'').localeCompare(m.T[y].code||''));ids.forEach((id,i)=>fanI[id]=[i,ids.length])});
 const edges=Object.entries(m.T).filter(([,t])=>m.S[t.f]&&m.S[t.to]).map(([id,t])=>{const a=m.S[t.f],b=m.S[t.to];const dx=(b.x+box(b).w/2)-(a.x+box(a).w/2);let route,sh,th;
  if(Math.abs(dx)<60){route='v';[sh,th]=b.y>a.y?['bs','tt']:['ts','bt']}else if(dx>0){route='fwd';sh='r';th='l'}else{route='loop';sh='bs';th='bt'}
  const k=route+'|'+[t.f,t.to].sort().join('|');const n=pairN[k]=(pairN[k]??-1)+1;
  let cls='';if(sim)cls=sim.edges.includes(id)?'done':(t.f===sim.at&&ok(t)?'next':'fade');
  const col=edgeColor(t);
  return {id,source:t.f,target:t.to,sourceHandle:sh,targetHandle:th,type:'wf',selected:selE.has(id),zIndex:selE.has(id)?2:0,markerEnd:{type:'arrowclosed',color:col,width:16,height:16},data:{t,route,n,col,cls,err:errIds.has(id),ortho,onPick,toEnd:!!fanI[id],fi:fanI[id]?fanI[id][0]:0,fc:fanI[id]?fanI[id][1]:1}}});
 const onNodesChange=useCallback(ch=>{const dc=ch.filter(c=>c.type==='dimensions'&&c.dimensions);if(dc.length){dc.forEach(c=>{dims.current[c.id]=c.dimensions});bump(x=>x+1)}const pos=ch.filter(c=>c.type==='position'&&c.position),rem=ch.filter(c=>c.type==='remove'),sl=ch.filter(c=>c.type==='select');
  if(sl.length)setSelN(p=>{const n=new Set(p);sl.forEach(c=>c.selected?n.add(c.id):n.delete(c.id));return n});
  if(rem.length){snapH();upd(n=>rem.forEach(r=>{delete n.S[r.id];Object.keys(n.T).forEach(k=>{if(n.T[k].f===r.id||n.T[k].to===r.id)delete n.T[k]})}));setSel(null)}
  if(pos.length)upd(n=>pos.forEach(p=>{const s=n.S[p.id];if(!s)return;s.x=rtl?W-p.position.x-box(s).w:p.position.x;s.y=p.position.y}));
 },[rtl]);
 const onEdgesChange=useCallback(ch=>{const rem=ch.filter(c=>c.type==='remove'),sl=ch.filter(c=>c.type==='select');
  if(sl.length)setSelE(p=>{const n=new Set(p);sl.forEach(c=>c.selected?n.add(c.id):n.delete(c.id));return n});
  if(rem.length){snapH();upd(n=>rem.forEach(r=>{delete n.T[r.id]}));setSel(null)}},[]);
 const cs=useRef(null);
 const lastT=useRef({k:'',t:0});
 const makeT=(src,tgt)=>{const M=mref.current;const a=M.S[src],b=M.S[tgt];if(!a||!b||src===tgt)return;const kk=src+'>'+tgt,now=Date.now();if(lastT.current.k===kk&&now-lastT.current.t<400)return;lastT.current={k:kk,t:now};
  if(a.end)return flash(L('Ends can’t have outgoing buttons','لا يمكن أن تكون للنهايات أزرار صادرة'));
  snapH();const id='t'+Date.now().toString(36);let t;
  if(b.end){t=b.end==='X'?{type:'cancel',en:'Cancel',ar:'إلغاء'}:{type:'close',code:b.end==='A'?'A':b.end,sign:1,en:L(END[b.end][0],END[b.end][0]),ar:END[b.end][1]}}
  else if(a.co!==b.co)t={type:'submit',sign:1,en:'Submit',ar:'تقديم'};
  else{const back=b.x<a.x;t=back?{type:'return',en:'Return',ar:'إرجاع'}:{type:'send',en:'Send',ar:'إرسال'}}
  upd(n=>{n.T[id]={f:src,to:tgt,...t}});pick(id);flash(L(`Added “${t.en}” — rename it in the panel`,`أُضيف «${t.ar}» — غيّر اسمه من اللوحة`))};
 const onConnect=p=>{if(cs.current)cs.current.done=true;makeT(p.source,p.target)};
 const onConnectStart=(e,{nodeId})=>{cs.current={nodeId,done:false};setConn(true)};
 const onConnectEnd=e=>{setConn(false);const c=cs.current;cs.current=null;if(!c||c.done||!c.nodeId)return;const pt=e.changedTouches?e.changedTouches[0]:e;const el=document.elementFromPoint(pt.clientX,pt.clientY);const nd=el&&el.closest('.react-flow__node');
  if(nd&&nd.dataset.id&&nd.dataset.id!==c.nodeId){const tg=nd.dataset.id;return setTimeout(()=>makeT(c.nodeId,tg),0)}
  if(el&&el.closest('.react-flow__pane')){const M=mref.current;if(M.S[c.nodeId]&&M.S[c.nodeId].end)return;snapH();const id='n'+Date.now().toString(36);const {x,y}=toModel('step',s2f({x:pt.clientX,y:pt.clientY}));const src=M.S[c.nodeId];upd(n=>{n.S[id]={en:'New step',ar:'خطوة جديدة',stage:x<250?'drafts':x<500?'internal':'pending',co:src.co,perm:'Review',out:'none',x,y,ic:'ti-user'}});setTimeout(()=>makeT(c.nodeId,id),0)}};
 const isValid=c=>{const a=mref.current.S[c.source];return a&&!a.end&&c.source!==c.target};
 const toModel=(kind,fp)=>{const s=kind==='step'?{w:200,h:78}:{w:170,h:46};const x=Math.round(((rtl?W-fp.x-s.w/2:fp.x-s.w/2))/20)*20,y=Math.round((fp.y-s.h/2)/20)*20;return {x,y}};
 const add=(kind,fp)=>{snapH();const id='n'+Date.now().toString(36);const {x,y}=toModel(kind.startsWith('tpl')?'step':kind,fp);
  upd(n=>{if(kind==='step')n.S[id]={en:'New step',ar:'خطوة جديدة',stage:x<250?'drafts':x<500?'internal':'pending',co:'ctr',perm:'Review',out:'none',x,y,ic:'ti-user'};
   else if(kind.startsWith('end:'))n.S[id]={end:kind.slice(4),x,y};
   else{const t1=kind==='tpl1';const a=id+'a',c=id+'c';n.S[a]={en:t1?'Engineer review':'Consultant engineer',ar:t1?'مراجعة المهندس':'مهندس الاستشاري',stage:t1?'internal':'pending',co:t1?'ctr':'cns',perm:'Review',out:t1?'none':'recommend',x,y,ic:'ti-user'};n.S[c]={en:t1?'PM review':'Consultant manager',ar:t1?'مراجعة المدير':'مدير الاستشاري',stage:t1?'internal':'pending',co:t1?'ctr':'cns',perm:'Approve',out:t1?'none':'final',x:x+280,y,ic:'ti-user-check'};n.T[id+'t']={f:a,to:c,en:t1?'Send for review':'Send to Manager',ar:t1?'إرسال للمراجعة':'إرسال للمدير',type:'send'};n.T[id+'r']={f:c,to:a,en:'Return',ar:'إرجاع',type:'return'}}});
  if(!kind.startsWith('tpl'))pick(id);else pick(null)};
 const s2f=pt=>rf.screenToFlowPosition?rf.screenToFlowPosition(pt):(()=>{const r=wrap.current.getBoundingClientRect();return rf.project({x:pt.x-r.left,y:pt.y-r.top})})();
 const addCenter=kind=>{const r=wrap.current.getBoundingClientRect();add(kind,s2f({x:r.left+r.width/2+(Math.random()*60-30),y:r.top+r.height/2+(Math.random()*60-30)}))};
 const onDrop=e=>{e.preventDefault();setOver(false);const k=e.dataTransfer.getData('application/x-wf');if(k)add(k,s2f({x:e.clientX,y:e.clientY}))};
 const focus=id=>{const s=m.S[id]||m.S[m.T[id]&&m.T[id].f];if(!s)return;pick(id);const b=box(s);rf.setCenter(mx(s,s.x)+b.w/2,s.y+b.h/2,{zoom:Math.max(rf.getZoom(),1),duration:450})};
 const del=()=>{if(!sel)return;snapH();upd(n=>{if(n.S[sel]){delete n.S[sel];Object.keys(n.T).forEach(k=>{if(n.T[k].f===sel||n.T[k].to===sel)delete n.T[k]})}else delete n.T[sel]});pick(null)};
 const layout=()=>{snapH();upd(autoLayout);setTimeout(()=>rf.fitView({padding:.08,duration:450}),40)};
 const startSim=()=>{if(sim)return setSim(null);pick(null);const st=Object.keys(m.S).find(i=>m.S[i].stage==='drafts'&&!m.S[i].end)||Object.keys(m.S)[0];setSim({at:st,path:[st],edges:[]})};
 const doPub=()=>{if(!note.trim())return setNoteErr(true);setModal(false);setPub(true);setDirty(false);setHist({u:[],r:[]});flash(L('v4 published — new items will use it','تم نشر v4 — العناصر الجديدة ستستخدمه'))};
 const pal=(kind,icon,label)=><button className="pal" draggable onDragStart={e=>{e.dataTransfer.setData('application/x-wf',kind);e.dataTransfer.effectAllowed='move'}} onClick={()=>addCenter(kind)} title={L('Drag onto the canvas, or click to add','اسحب إلى المخطط أو انقر للإضافة')}>{icon}<span className="lb">{label}</span><i className="ti ti-grip-vertical gr"></i></button>;
 const nameOf=id=>{const s=m.S[id];return s.end?L(END[s.end][0],END[s.end][1]):L(s.en,s.ar)};
 return <div className="bld">
  <div className="btop"><a className="cb ter sm" href="settings-workflows.html" title={L('Back to workflows','العودة إلى سير العمل')}><i className="ti ti-arrow-left"></i></a><h2>{L('Material Submittal – 2-tier review','اعتماد المواد – مراجعة على مستويين')}</h2>
   {pub?<span className="vs pub"><i className="ti ti-check"></i>{L('Published','منشور')} v4</span>:<span className="vs draft">{L('Draft','مسودة')} v4{dirty?' · '+L('unsaved changes','تغييرات غير محفوظة'):''}</span>}<span className="rf2-tag"><i className="ti ti-vector"></i>V2 · React Flow</span>
   <span className="sp"></span>
   <span className="segv" title={L('Arrow style','شكل الأسهم')}><button className={!ortho?'on':''} onClick={()=>setOrtho(false)}><i className="ti ti-route"></i>{L('Curved','منحنية')}</button><button className={ortho?'on':''} onClick={()=>setOrtho(true)}><i className="ti ti-link"></i>{L('Orthogonal','متعامدة')}</button></span>
   <button className="cb ic" onClick={undo} disabled={!hist.u.length} title="⌘Z"><i className="ti ti-arrow-back-up"></i></button><button className="cb ic" onClick={redo} disabled={!hist.r.length} title="⇧⌘Z"><i className="ti ti-arrow-forward-up"></i></button>
   <button className="cb" onClick={layout}><i className="ti ti-layout-grid"></i>{L('Auto-layout','ترتيب تلقائي')}</button>
   <button className={'cb'+(sim?' on':'')} onClick={startSim}><i className="ti ti-player-play"></i>{L('Test run','تشغيل تجريبي')}</button>
   <button className="cb" onClick={()=>{if(ne){flash(L(`${ne} errors to fix`,`${ne} أخطاء للإصلاح`));focus(errs.find(e=>e.lv==='err').id)}else flash(L('Validation passed','اجتاز التحقق'))}}><i className={'ti ti-'+(ne?'alert-triangle':'circle-check')}></i>{L('Validate','تحقق')}</button>
   <button className="cb pri" onClick={()=>{setNote('');setNoteErr(false);setModal(true)}} disabled={pub}><i className="ti ti-upload"></i>{L('Publish','نشر')}</button></div>
  <div className="bgrid">
   <aside className="card bpal"><h6>{L('Drag to add','اسحب للإضافة')}</h6>{pal('step',<i className="ti ti-square-plus"></i>,L('Step','خطوة'))}{Object.entries(END).map(([k,e])=><React.Fragment key={k}>{pal('end:'+k,<i className="e" style={{background:`var(--tone-${e[2]}-tint)`,boxShadow:`inset 0 0 0 2px var(--tone-${e[2]}-solid)`}}></i>,L('End · ','نهاية · ')+L(e[0],e[1]))}</React.Fragment>)}
    <h6>{L('Templates','قوالب')}</h6>{pal('tpl1',<i className="ti ti-template"></i>,L('2-tier internal review','مراجعة داخلية على مستويين'))}{pal('tpl2',<i className="ti ti-template"></i>,L('Consultant engineer → manager','مهندس الاستشاري ← المدير'))}
    <h6>{L('Canvas','اللوحة')}</h6><div className="chk3" onClick={()=>setSnapOn(!snapOn)}><span className={'swc'+(snapOn?' on':'')}></span>{L('Snap to grid','محاذاة للشبكة')}</div><div className="chk3" onClick={()=>setMini(!mini)}><span className={'swc'+(mini?' on':'')}></span>{L('Mini-map','الخريطة المصغّرة')}</div></aside>
   <section className="wcv"><div ref={wrap} className={'rf2-wrap'+(conn?' connecting':'')} dir="ltr" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(!over)setOver(true)}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOver(false)}} onDrop={onDrop}>
    <Bands rtl={rtl}/>
    <Flow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValid} connectionMode="loose"
     onNodeDragStart={()=>snapH()} onNodeClick={(e,n)=>{if(!sim)setSel(n.id)}} onEdgeClick={(e,ed)=>onPick(ed.id)} onPaneClick={()=>{if(!sim)pick(null)}} onConnectStart={onConnectStart} onConnectEnd={onConnectEnd} connectionRadius={36}
     nodesDraggable={!sim} nodesConnectable={!sim} elementsSelectable={!sim} snapToGrid={snapOn} snapGrid={[20,20]} deleteKeyCode={sim?null:['Backspace','Delete']} selectionKeyCode="Shift" multiSelectionKeyCode={['Meta','Control']}
     fitView fitViewOptions={{padding:.08}} minZoom={.25} maxZoom={2} defaultEdgeOptions={{type:'wf'}} attributionPosition="top-right" connectionLineStyle={{stroke:tone('--btn-pri'),strokeWidth:2.5,strokeDasharray:'6 4'}}>
     <Background gap={20} size={1.2} color={tone('--ui-border')}/>
     {mini&&<MiniMap position="bottom-left" pannable zoomable nodeBorderRadius={6} nodeColor={n=>{const s=m.S[n.id];if(!s)return '#ccc';return s.end?tone(`--tone-${END[s.end][2]}-solid`):tone(`--tone-${STG[s.stage][2]}-solid`)}} style={{width:170,height:96}}/>}
    </Flow>
    <div className="wctl"><button onClick={()=>rf.zoomOut({duration:200})} title={L('Zoom out','تصغير')}><i className="ti ti-zoom-out"></i></button><button onClick={()=>rf.zoomIn({duration:200})} title={L('Zoom in','تكبير')}><i className="ti ti-zoom-in"></i></button><button onClick={()=>rf.fitView({padding:.08,duration:400})} title={L('Fit','ملاءمة')}><i className="ti ti-maximize"></i></button></div>
    {over&&<div className="rf2-drop"></div>}
    {sim&&<div className="simbar"><i className="ti ti-player-play"></i><b>{L('Test run','تشغيل تجريبي')}</b><span>{L('Sample: MAR · cost impact','عينة: MAR · أثر التكلفة')} <select value={cost>500000?'620000':'120000'} onChange={e=>setCost(+e.target.value)} style={{height:26,borderRadius:5,border:0,font:'inherit',fontSize:12}}><option value="620000">620,000 SAR</option><option value="120000">120,000 SAR</option></select></span><span style={{opacity:.7}}>·</span>
     {m.S[sim.at].end?<b>{L('Finished: ','انتهى: ')}{nameOf(sim.at)}</b>:<>{L('At','عند')} <b>{nameOf(sim.at)}</b> — {Object.entries(m.T).filter(([,t])=>t.f===sim.at&&ok(t)).map(([k,t])=><button key={k} className="cb sm pri" onClick={()=>go(k)}>{L(t.en,t.ar)}</button>)}</>}
     <span style={{flex:1}}></span><button className="cb sm ter" onClick={()=>{setSim(null);setTimeout(startSim,0)}}><i className="ti ti-refresh"></i>{L('Restart','إعادة')}</button><button className="cb sm ter" onClick={()=>setSim(null)}><i className="ti ti-x"></i></button></div>}
   </div></section>
   <aside className="card bside"><Side onPreview={id=>setAct({id,mode:'preview'})} makeT={makeT} m={m} sel={sel&&(m.S[sel]||m.T[sel])?sel:null} setSel={id=>{pick(id);focus(id)}} upd={upd} snapH={snapH} del={del}/></aside>
   <section className="card bval"><div className="h"><i className={'ti ti-'+(ne?'alert-triangle':'circle-check')} style={{color:`var(--tone-${ne?'red':'green'}-solid)`}}></i>{ne?L(`${ne} errors`,`${ne} أخطاء`):L('No errors','لا أخطاء')}{errs.length-ne?` · ${errs.length-ne} ${L('warning','تحذير')}`:''}</div>
    {errs.map((e,i)=><button key={i} className="vi" onClick={()=>focus(e.id)}><i className={'ti ti-'+(e.lv==='err'?'circle-x':'alert-triangle')} style={{color:`var(--tone-${e.lv==='err'?'red':'amber'}-solid)`}}></i>{L(e.msg[0],e.msg[1])}<i className="ti ti-focus-2" style={{marginInlineStart:'auto',color:'var(--ui-faint)'}}></i></button>)}</section>
  </div>
  {modal&&<div className="scrim" onClick={()=>setModal(false)}><div className="wmdl" onClick={e=>e.stopPropagation()}><div className="mh"><i className="ti ti-upload" style={{color:'var(--btn-pri)'}}></i><b>{L('Publish v4','نشر v4')}</b><button className="cb ter sm ic x" onClick={()=>setModal(false)}><i className="ti ti-x"></i></button></div>
   <div className="mb">{ne?<div className="okb" style={{background:'var(--tone-red-tint)',color:'var(--tone-red-fg)'}}><i className="ti ti-circle-x"></i>{L(`${ne} validation errors — fix them before publishing.`,`${ne} أخطاء تحقق — أصلحها قبل النشر.`)}<button className="cb sm" style={{marginInlineStart:'auto'}} onClick={()=>{setModal(false);focus(errs.find(e=>e.lv==='err').id)}}>{L('Show first error','عرض أول خطأ')}</button></div>:<div className="okb" style={{background:'var(--tone-green-tint)',color:'var(--tone-green-fg)'}}><i className="ti ti-circle-check"></i>{L('Validation passed','اجتاز التحقق')}</div>}
    <label style={{display:'flex',flexDirection:'column',gap:6,fontSize:12.5,fontWeight:600}}>{L('Change note','ملاحظة التغيير')} *<textarea rows="3" value={note} onChange={e=>{setNote(e.target.value);setNoteErr(false)}} placeholder={L('What changed and why?','ما الذي تغيّر ولماذا؟')} style={{border:0,borderRadius:6,padding:'8px 10px',background:'var(--fld-bg)',boxShadow:`inset 0 0 0 1px ${noteErr?'var(--tone-red-solid)':'var(--fld-bd)'}`,font:'inherit',fontSize:13.5,color:'var(--fld-txt)'}}></textarea></label>
    <div className="okb" style={{background:'var(--tone-blue-tint)',color:'var(--tone-blue-fg)',fontWeight:500}}><i className="ti ti-info-circle"></i>{L('31 items on v3 and 16 on older versions keep their version. New items will use v4.','31 عنصرًا على v3 و16 على إصدارات أقدم تحتفظ بإصداراتها. العناصر الجديدة ستستخدم v4.')}</div></div>
   <div className="mf"><button className="cb" onClick={()=>setModal(false)}>{L('Cancel','إلغاء')}</button><button className="cb pri" disabled={!!ne} onClick={doPub}><i className="ti ti-upload"></i>{L('Publish v4','نشر v4')}</button></div></div></div>}
  {act&&m.T[act.id]&&<AF.FormPopup key={act.id+act.mode} t={m.T[act.id]} mode={act.mode} from={nameOf(m.T[act.id].f)+' → '+nameOf(m.T[act.id].to)} onCancel={()=>setAct(null)} onConfirm={r=>{const a=act;setAct(null);if(a.mode==='sim'){advance(a.id);const n=r.tasks.length;flash(n?L(`${n} ${r.kind==='snag'?'snags':r.kind==='comment'?'comments':'tasks'} created in Snag List`,`تم إنشاء ${n} في قائمة الملاحظات`):L('Action recorded','تم تسجيل الإجراء'))}else flash(L('Preview only — nothing was saved','معاينة فقط — لم يُحفظ شيء'))}}/>}
  {toast&&<div className="toast"><i className="ti ti-circle-check"></i>{toast}</div>}
 </div>}
ReactDOM.createRoot(document.getElementById('rf2host')).render(<ReactFlowProvider><Builder/></ReactFlowProvider>);
