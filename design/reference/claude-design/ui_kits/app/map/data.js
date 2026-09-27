// Map View — sample data for Al Nakheel Villas Compound. Exposes window.MD.
(function(){
const ST={
 ok:{en:'On Track',ar:'ضمن المسار',ic:'ti-trending-up',c:'var(--tone-blue-solid)',t:'var(--tone-blue-tint)',f:'var(--tone-blue-fg)',den:'No open snags or failed inspections, and fewer than 3 submittals pending approval.',dar:'لا توجد ملاحظات مفتوحة أو فحوصات راسبة، وأقل من 3 تقديمات بانتظار الاعتماد.'},
 att:{en:'Needs Attention',ar:'بحاجة لمتابعة',ic:'ti-alert-circle',c:'var(--tone-orange-solid)',t:'var(--tone-orange-tint)',f:'var(--tone-orange-fg)',den:'1–3 open snags, 1 failed inspection, or 3+ submittals pending approval.',dar:'من 1 إلى 3 ملاحظات مفتوحة، أو فحص راسب واحد، أو 3 تقديمات أو أكثر بانتظار الاعتماد.'},
 iss:{en:'Issues',ar:'مشكلات',ic:'ti-alert-triangle',c:'var(--tone-red-solid)',t:'var(--tone-red-tint)',f:'var(--tone-red-fg)',den:'4+ open snags or 2+ failed inspections.',dar:'4 ملاحظات مفتوحة أو أكثر، أو فحصان راسبان أو أكثر.'},
 done:{en:'Complete',ar:'مكتمل',ic:'ti-check',c:'var(--tone-green-solid)',t:'var(--tone-green-tint)',f:'var(--tone-green-fg)',den:'All inspections passed and nothing open. Zone handed over.',dar:'اجتازت جميع الفحوصات ولا يوجد شيء مفتوح. تم تسليم المنطقة.'},
 ns:{en:'Not Started',ar:'لم يبدأ',ic:'ti-hourglass-high',c:'var(--tone-gray-solid)',t:'var(--tone-gray-tint)',f:'var(--tone-gray-fg)',den:'No Work Items recorded in this zone yet.',dar:'لا توجد عناصر عمل مسجلة في هذه المنطقة بعد.'}
};
const ORDER=['iss','att','ok','done','ns'];
const TRADES={AR:['Architecture','معماري','violet'],CV:['Civil','مدني','amber'],EL:['Electrical','كهربائي','cyan'],ME:['Mechanical','ميكانيكي','green'],LS:['Landscaping','تنسيق الحدائق','orange']};
const COS={afc:['Al Futtaim Construction Co.','شركة الفطيم للمقاولات','#f8552f'],arb:['Arabtec','أرابتك','#3d6db5'],alec:['ALEC Engineering','ألك للهندسة','#1fae66']};
const TYPES={snag:['Snag','ملاحظة'],insp:['Inspection','فحص'],sub:['Submittal','تقديم']};
const PHASES={p1:['Phase 01','المرحلة ٠١'],p2:['Phase 02','المرحلة ٠٢'],p3:['Phase 03','المرحلة ٠٣'],p4:['Phase 04','المرحلة ٠٤'],am:['Amenities','المرافق'],inf:['Infrastructure','البنية التحتية']};
// ROLES: what each viewer is allowed to see
const ROLES={admin:{en:'Project Admin',ar:'مسؤول المشروع',sub:['Whole site · all trades','الموقع بالكامل · جميع التخصصات'],edit:1},
 contractor:{en:'Contractor · Al Futtaim',ar:'المقاول · الفطيم',sub:['Your company’s work only','أعمال شركتك فقط'],co:['afc']},
 owner:{en:'Owner Representative',ar:'ممثل المالك',sub:['Whole site · Civil, Architecture, Landscaping','الموقع بالكامل · مدني، معماري، تنسيق الحدائق'],tr:['CV','AR','LS']}};
const Z=[
 {id:'p1',en:'Phase 01 – North Villas',ar:'المرحلة ٠١ – فلل الشمال',ph:'p1',units:[28,'villas','فيلا'],tr:['AR','CV','EL','ME'],n:[0,0,0,60],loc:'l-p1',pts:[[70,62],[300,48],[468,60],[468,288],[84,288]],m:[270,172]},
 {id:'mosque',en:'Mosque',ar:'المسجد',ph:'am',units:[1,'building','مبنى'],tr:['AR','CV'],n:[1,0,1,12],loc:'l-mos',pts:[[532,60],[628,60],[628,168],[532,168]],m:[580,114]},
 {id:'land',en:'Landscaping',ar:'تنسيق الحدائق',ph:'am',units:[3,'parks','حدائق'],tr:['LS','CV'],n:[5,1,0,6],loc:'l-land',pts:[[532,180],[628,180],[628,288],[532,288]],m:[580,234]},
 {id:'p3',en:'Phase 03 – East Villas',ar:'المرحلة ٠٣ – فلل الشرق',ph:'p3',units:[30,'villas','فيلا'],tr:['AR','CV','EL','ME'],n:[0,0,2,38],loc:'l-p3',pts:[[640,62],[935,82],[942,288],[640,288]],m:[790,178]},
 {id:'road',en:'Main Gate & Roads',ar:'البوابة الرئيسية والطرق',ph:'inf',units:[4.2,'km of roads','كم من الطرق'],tr:['CV','EL'],n:[4,2,1,18],loc:'l-road',pts:[[480,50],[520,50],[520,300],[945,300],[945,338],[520,338],[520,610],[538,610],[538,632],[462,632],[462,610],[480,610],[480,338],[60,338],[60,300],[480,300]],m:[500,620]},
 {id:'p4',en:'Phase 04 – South Villas',ar:'المرحلة ٠٤ – فلل الجنوب',ph:'p4',units:[31,'villas','فيلا'],tr:['AR','CV','EL','ME'],n:[0,0,0,0],loc:'l-p4',pts:[[70,350],[318,350],[318,598],[88,604],[70,580]],m:[194,474]},
 {id:'club',en:'Clubhouse',ar:'النادي',ph:'am',units:[1,'building','مبنى'],tr:['AR','ME','EL'],n:[0,0,0,24],done:1,loc:'l-club',pts:[[330,350],[468,350],[468,598],[330,598]],m:[399,474]},
 {id:'p2',en:'Phase 02 – Central Blocks',ar:'المرحلة ٠٢ – البلوكات الوسطى',ph:'p2',units:[24,'villas · 6 blocks','فيلا · ٦ بلوكات'],tr:['AR','CV','EL','ME'],n:[3,1,5,42],loc:'l-p2',pts:[[532,350],[942,350],[930,592],[532,600]],m:[734,474]}
];
const ISSUE={
 AR:[['Cracked plaster — Villa {v}','تشقق في اللياسة — فيلا {v}'],['Misaligned door frame — Villa {v}','إطار باب غير مستقيم — فيلا {v}'],['Paint defects on façade — Villa {v}','عيوب دهان في الواجهة — فيلا {v}']],
 CV:[['Honeycombing in slab — Block {b}','تعشيش في البلاطة — بلوك {b}'],['Kerb level out of tolerance — Road R{r}','منسوب الرصيف خارج الحد — طريق R{r}'],['Waterproofing lap failed — Villa {v}','فشل تراكب العزل — فيلا {v}']],
 EL:[['Earthing test failed — Block {b}','فشل اختبار التأريض — بلوك {b}'],['Streetlight cable exposed — Road R{r}','كابل إنارة مكشوف — طريق R{r}'],['DB labelling missing — Villa {v}','ملصقات لوحة التوزيع مفقودة — فيلا {v}']],
 ME:[['Chilled water pipe leak — Villa {v}','تسرب في أنبوب المياه المبردة — فيلا {v}'],['Duct insulation damaged — Block {b}','تلف عزل مجرى الهواء — بلوك {b}']],
 LS:[['Irrigation line leak — Park {r}','تسرب خط الري — حديقة {r}'],['Dead palms to replace — Boulevard {r}','نخيل تالف يلزم استبداله — الممشى {r}'],['Paving settlement — Walkway {r}','هبوط في الرصف — الممر {r}']]
};
const COK=['afc','arb','alec'];
// expand counts → work items
Z.forEach((z,zi)=>{z.items=[];const kinds=['snag','failed','pending','passed'];let k=0;
 z.n.forEach((cnt,ki)=>{for(let i=0;i<cnt;i++,k++){const tr=z.tr[(i+ki)%z.tr.length];const co=COK[(i+zi+ki)%3];const it={kind:kinds[ki],tr,co,type:ki===0?'snag':ki===2?'sub':'insp'};
  if(ki<2){const pool=ISSUE[tr];const tpl=pool[(i+zi)%pool.length];const v=100+zi*28+((i*7+3)%28),b='ABCDEF'[(i+zi)%6],r=(i%4)+1;
   it.t=tpl.map(s=>s.replace('{v}',v).replace('{b}',b).replace('{r}',r));it.age=2+((i*5+zi*3)%14)}
  z.items.push(it)}})});
const LOCS=[
 {id:'root',en:'Al Nakheel Villas Compound',ar:'مجمع فلل النخيل',d:0},
 {id:'l-p1',en:'Phase 01 — North Villas',ar:'المرحلة ٠١ — فلل الشمال',d:1,s:['Villas 101–128','فلل 101–128']},
 {id:'l-p2',en:'Phase 02 — Central Blocks',ar:'المرحلة ٠٢ — البلوكات الوسطى',d:1,s:['Blocks A–F','بلوكات A–F']},
 {id:'l-p3',en:'Phase 03 — East Villas',ar:'المرحلة ٠٣ — فلل الشرق',d:1,s:['Villas 201–230','فلل 201–230']},
 {id:'l-p4',en:'Phase 04 — South Villas',ar:'المرحلة ٠٤ — فلل الجنوب',d:1,s:['Villas 301–331','فلل 301–331']},
 {id:'l-am',en:'Amenities',ar:'المرافق',d:1,group:1},
 {id:'l-club',en:'Clubhouse',ar:'النادي',d:2},
 {id:'l-mos',en:'Mosque',ar:'المسجد',d:2},
 {id:'l-land',en:'Landscaping & Parks',ar:'تنسيق الحدائق والمتنزهات',d:2},
 {id:'l-inf',en:'Infrastructure',ar:'البنية التحتية',d:1,group:1},
 {id:'l-road',en:'Main Gate & Internal Roads',ar:'البوابة الرئيسية والطرق الداخلية',d:2},
 {id:'l-util',en:'Utilities Corridor',ar:'ممر المرافق',d:2},
 {id:'l-p5',en:'Phase 05 — Future Expansion',ar:'المرحلة ٠٥ — توسعة مستقبلية',d:1,s:['Not yet mapped','غير مرسومة بعد']}
];
window.MD={ST,ORDER,TRADES,COS,TYPES,PHASES,ROLES,Z,LOCS};
})();
