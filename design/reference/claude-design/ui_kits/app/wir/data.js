// Inspections (WIR) — sample data. Exposes window.WD.
(function(){
const P={
 sami:{n:['Sami Haddad','سامي حداد'],c:'#e9a23b',co:'tmc',r:['Contractor Engineer','مهندس المقاول']},
 nasser:{n:['Nasser Al Kaabi','ناصر الكعبي'],c:'#e98b45',co:'tmc',r:['Contractor PM','مدير مشروع المقاول']},
 layla:{n:['Layla Mansour','ليلى منصور'],c:'#1aa3b8',co:'dcl',r:['Consultant Engineer','مهندسة الاستشاري']},
 karim:{n:['Karim Aziz','كريم عزيز'],c:'#3d6db5',co:'dcl',r:['Consultant Manager','مدير الاستشاري']}};
const CO={tmc:['TMC Constructions','تي إم سي للمقاولات','#f8552f'],dcl:['Design Consultants LLC','ديزاين للاستشارات','#3d6db5'],own:['Al Waha Development','الواحة للتطوير','#1fae66'],gdl:['Gulf Dryliners','الخليج للألواح الجافة','#7a5af0']};
const TRADES={CV:['Civil','مدني'],EL:['Electrical','كهرباء'],ME:['Mechanical','ميكانيك'],PL:['Plumbing','سباكة'],AR:['Architectural','معماري']};
const ZONES={A:{n:['Zone A','المنطقة A'],b:{T1:{n:['Tower 1','البرج 1'],f:['B1','GF','01','02','03','04','05']},T2:{n:['Tower 2','البرج 2'],f:['GF','01','02']}}},B:{n:['Zone B','المنطقة B'],b:{POD:{n:['Podium','المنصة'],f:['GF','01']}}}};
// checklist templates (filtered by trade)
const TPL={
 'CV-CL-04':{tr:'CV',n:['Blockwork before plastering','أعمال البلوك قبل اللياسة'],ver:'v3',
  secs:[[['Setting out','التخطيط'],[
   ['Wall positions match the approved setting-out drawing','مواقع الجدران مطابقة لمخطط التخطيط المعتمد'],
   ['Openings sized and placed per the door / window schedule','الفتحات بمقاساتها ومواقعها حسب جدول الأبواب والنوافذ'],
   ['Walls plumb within 5 mm over 3 m','الجدران رأسية بانحراف لا يتجاوز 5 مم لكل 3 م'],
   ['Wall faces flat within 5 mm under a 3 m straightedge','أسطح الجدران مستوية ضمن 5 مم تحت قدة 3 م']]],
  [['Blockwork','البلوك'],[
   ['Blocks are the approved type and size (200 mm hollow)','البلوك من النوع والمقاس المعتمد (200 مم مفرغ)'],
   ['Mortar joints 10 mm, fully filled, raked for plaster','فواصل المونة 10 مم ممتلئة ومخدوشة للياسة'],
   ['Bond pattern half-block, no straight joints','نمط الربط نصف بلوكة بدون فواصل مستقيمة'],
   ['Wall ties to columns every 3rd course','روابط الجدران مع الأعمدة كل 3 مداميك'],
   ['Lintels over openings wider than 1.0 m, 150 mm bearing each side','أعتاب فوق الفتحات الأعرض من 1.0 م بارتكاز 150 مم من كل جانب'],
   ['Top joint to slab packed and sealed with approved filler','الفاصل العلوي مع السقف محشو ومغلق بمادة معتمدة'],
   ['Movement joints at the positions on the drawing','فواصل الحركة في المواقع المبيّنة على المخطط'],
   ['No cracked or broken blocks in the wall','لا يوجد بلوك متشقق أو مكسور في الجدار']]],
  [['Embedded services','التمديدات المدفونة'],[
   ['Conduit routes chased, not cut across block webs','مسارات المواسير محفورة دون قطع أضلاع البلوك'],
   ['Conduit boxes fixed flush, at the heights on the approved drawing','علب المواسير مثبتة بمستوى السطح وعلى الارتفاعات المعتمدة'],
   ['Conduits fixed every 600 mm and capped','المواسير مثبتة كل 600 مم ومغطاة الأطراف'],
   ['Plumbing sleeves in place and sized to the drawing','جلب السباكة في مكانها وبالمقاسات المبيّنة'],
   ['Chases filled with mortar flush to block face','الحفر مملوءة بالمونة بمستوى سطح البلوك'],
   ['Fire-rated walls: penetrations marked for firestopping','الجدران المقاومة للحريق: الاختراقات مُعلّمة لعزل الحريق'],
   ['Services tested (pressure / continuity) before cover-up','التمديدات مختبرة (ضغط / استمرارية) قبل التغطية']]],
  [['Readiness for plaster','الجاهزية للياسة'],[
   ['Mesh fixed at block-to-concrete junctions','شبك مثبت عند التقاء البلوك بالخرسانة'],
   ['Corner beads and stop beads fixed straight','زوايا الحماية والحواف مثبتة بشكل مستقيم'],
   ['Surfaces free of dust, oil and loose mortar','الأسطح خالية من الغبار والزيوت والمونة السائبة'],
   ['Slab edge protection and access in place','حماية حواف السقف والوصول الآمن متوفرة'],
   ['Area cleared of debris and waste blocks','المنطقة خالية من المخلفات وبقايا البلوك']]]],
  req:{c:1,p:1}},
 'CV-CL-02':{tr:'CV',n:['Concrete pour — slabs and beams','صب الخرسانة — البلاطات والكمرات'],ver:'v5',secs:[[['Formwork','الشدات'],[['Formwork level and propped','الشدات مستوية ومدعّمة'],['Release agent applied','تم دهان مادة الفصل']]],[['Reinforcement','التسليح'],[['Bar sizes and spacing per drawing','أقطار ومسافات الحديد حسب المخطط'],['Cover blocks in place','بسكوت الغطاء في مكانه']]]],n2:18,req:{c:1,p:1}},
 'CV-CL-05':{tr:'CV',n:['Internal plaster finish','اللياسة الداخلية'],ver:'v2',secs:[[['Finish','التشطيب'],[['Thickness 15 mm average','السماكة 15 مم في المتوسط'],['No cracks or hollow spots','لا تشققات أو مناطق جوفاء']]]],n2:12,req:{c:1,p:0}},
 'EL-CL-01':{tr:'EL',n:['Containment & conduits before cover-up','الحوامل والمواسير قبل التغطية'],ver:'v4',secs:[[['Conduits','المواسير'],[['Routes per drawing','المسارات حسب المخطط']]]],n2:16,req:{c:1,p:1}}};
const items=[];TPL['CV-CL-04'].secs.forEach((s,si)=>s[1].forEach(t=>items.push({id:'i'+(items.length+1),s:si,t})));
// final answers when sent (24): 18 pass · 5 fail · 1 N/A — 4 ticked "Raise a Snag"
const FIN={};items.forEach(i=>FIN[i.id]={a:'p'});
Object.assign(FIN,{
 i6:{a:'f',c:['Joints on the stair-core side not raked — plaster won’t key.','الفواصل بجهة بيت الدرج غير مخدوشة — لن تتماسك اللياسة.'],snag:1,ph:[{k:'joint',ann:[{t:'ell',x:.5,y:.52,rx:.2,ry:.13,c:'#ef3b2d'}]}]},
 i9:{a:'f',c:['Lintel over D-03 bears 100 mm on the left side, needs 150 mm.','العتب فوق الباب D-03 يرتكز 100 مم من اليسار، والمطلوب 150 مم.'],snag:1,ph:[{k:'lintel',ann:null}]},
 i8:{a:'f',c:['Two ties missing at C/3 — fixed while I was on site.','رابطان ناقصان عند C/3 — تم تركيبهما أثناء وجودي في الموقع.'],snag:0,ph:[{k:'tie',ann:null}]},
 i14:{a:'f',c:['Two boxes at grid C/4 set 40 mm proud of the block face.','علبتان عند المحور C/4 بارزتان 40 مم عن سطح البلوك.'],snag:1,ph:[{k:'box',ann:[{t:'arr',x1:.2,y1:.24,x2:.47,y2:.47,c:'#ef3b2d'},{t:'txt',x:.06,y:.16,s:['40 mm proud','بارزة 40 مم'],c:'#ef3b2d'}]},{k:'box2',ann:null}]},
 i18:{a:'f',c:['Penetrations on the fire-rated wall at the riser not marked.','الاختراقات في الجدار المقاوم للحريق عند الرايزر غير مُعلّمة.'],snag:1,ph:[{k:'fire',ann:[{t:'rect',x:.3,y:.3,w:.4,h:.36,c:'#ffd23f'}]}]},
 i23:{a:'n',c:['No slab edge on this floor — internal walls only.','لا توجد حافة سقف في هذا الطابق — جدران داخلية فقط.']},
 i1:{a:'p',ph:[{k:'wall',ann:null}]}});
// mid-walk state (Engineer on site): 21 of 24 answered — 18 pass · 2 fail · 1 N/A
// i6, i9, i18 not answered yet (the Engineer walks to them next)
const MID={};items.forEach(i=>{if(!['i6','i9','i18'].includes(i.id))MID[i.id]=JSON.parse(JSON.stringify(FIN[i.id]))});
const SUBS=[
 {no:'TWR-TMC-CV-MAR-012',s:['Concrete blocks — 200 mm hollow, Class B','بلوك خرساني — 200 مم مفرغ، فئة B'],code:'A',can:1},
 {no:'TWR-TMC-CV-MAR-015',s:['Ready-mix mortar M5','مونة جاهزة M5'],code:'B',can:1},
 {no:'TWR-TMC-EL-MAR-021',s:['PVC conduits and back boxes','مواسير PVC والعلب الخلفية'],code:'B',can:0},
 {no:'TWR-TMC-CV-DAR-004',s:['Blockwork setting-out drawings, Floors 1–5','مخططات تخطيط البلوك، الطوابق 1–5'],code:'A',can:1},
 {no:'TWR-TMC-CV-MAR-019',s:['Galvanised wall ties','روابط جدران مجلفنة'],code:'A',can:1}];
const PICKED=['TWR-TMC-CV-MAR-012','TWR-TMC-CV-MAR-015','TWR-TMC-EL-MAR-021'];
const WIR={no:'TWR-DCL-CV-WIR-007',rev:0,desc:['Inspect blockwork and embedded conduits before plastering','فحص أعمال البلوك والمواسير المدفونة قبل اللياسة'],tr:'CV',loc:['A','T1','03'],req:['21 Oct 2026','09:00'],reqAr:['21 أكتوبر 2026','09:00'],tpl:'CV-CL-04',by:'sami',pm:'nasser',eng:'layla',mgr:'karim',
 cover:['Floor 3 blockwork complete on grids A–F. Electrical first-fix done. Ready for your inspection.','أعمال بلوك الطابق 3 مكتملة على المحاور A–F. التمديدات الكهربائية الأولى منتهية. جاهزة للفحص.'],
 rec:'f',note:['Contractor pushing to plaster Monday — the lintel at D-03 needs fixing first. I’d hold.','المقاول يريد البدء باللياسة الإثنين — يجب إصلاح عتب D-03 أولاً. أنصح بالتريث.']};
window.WD={P,CO,TRADES,ZONES,TPL,items,FIN,MID,SUBS,PICKED,WIR};
})();
