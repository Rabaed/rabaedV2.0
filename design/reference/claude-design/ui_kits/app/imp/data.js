// Import register — data + rules. Exposes window.IMD.
(function(){
const TYPES={MAR:['Material Approval Request','طلب اعتماد مواد','ti-box','blue'],SAR:['Supplier Approval Request','طلب اعتماد مورّد','ti-truck','violet'],DAR:['Document Approval Request','طلب اعتماد مستند','ti-file-text','cyan']};
const TR={EL:['Electrical','كهرباء','cyan'],ME:['Mechanical','ميكانيك','green'],PL:['Plumbing','سباكة','blue'],CV:['Civil','مدني','amber'],AR:['Architectural','معماري','violet'],FP:['Fire protection','الحماية من الحريق','red']};
const LOCS={'T1-B1':['Tower 1 / B1','البرج ١ / B1'],'T1-F1':['Tower 1 / Floor 1','البرج ١ / الطابق 1'],'T1-F2':['Tower 1 / Floor 2','البرج ١ / الطابق 2'],'T1-F3':['Tower 1 / Floor 3','البرج ١ / الطابق 3'],'T1-F4':['Tower 1 / Floor 4','البرج ١ / الطابق 4'],'T1-F5':['Tower 1 / Floor 5','البرج ١ / الطابق 5'],'T1-RF':['Tower 1 / Roof','البرج ١ / السطح'],'POD':['Podium','المنصة'],'T2-F1':['Tower 2 / Floor 1','البرج ٢ / الطابق 1']};
// company members (who can raise which types / which trades)
const CO={tmc:['TMC Constructions','تي إم سي للمقاولات','#f8552f','Contractor','مقاول'],gdl:['Gulf Dryliners','الخليج للألواح الجافة','#7a5af0','Subcontractor','مقاول باطن'],fss:['FireSafe Systems','فاير سيف للأنظمة','#e98b45','Subcontractor','مقاول باطن'],dcl:['Design Consultants LLC','ديزاين للاستشارات','#3d6db5','Consultant','استشاري'],own:['Al Waha Development','الواحة للتطوير','#1fae66','Client','العميل']};
const M={
 hafiz:{n:['Hafiz Hamdan','حافظ حمدان'],co:'tmc',em:'hafiz@tmc.sa',c:'#3d6db5',role:['Contractor Engineer','مهندس المقاول'],ty:['MAR','SAR','DAR'],tr:['EL','ME','PL','CV','AR','FP']},
 faisal:{n:['Faisal Al Harbi','فيصل الحربي'],co:'tmc',em:'faisal@tmc.sa',c:'#1aa3b8',role:['Electrical Engineer','مهندس كهرباء'],ty:['MAR','SAR','DAR'],tr:['EL']},
 omar:{n:['Omar Al Blooshi','عمر البلوشي'],co:'tmc',em:'omar@tmc.sa',c:'#1fae66',role:['MEP Engineer','مهندس كهروميكانيك'],ty:['MAR','SAR','DAR'],tr:['ME','PL']},
 sami:{n:['Sami Haddad','سامي حداد'],co:'tmc',em:'sami@tmc.sa',c:'#e9a23b',role:['Site Engineer','مهندس موقع'],ty:['MAR','DAR'],tr:['CV','AR']},
 nasser:{n:['Nasser Al Kaabi','ناصر الكعبي'],co:'tmc',em:'nasser@tmc.sa',c:'#e98b45',role:['Contractor PM','مدير مشروع المقاول'],ty:['MAR','SAR','DAR'],tr:['EL','ME','PL','CV','AR','FP']},
 kali:{n:['Khalid Ali','خالد علي'],co:'gdl',em:'k.ali@gulfdry.ae',c:'#7a5af0',role:['Engineer','مهندس'],ty:['MAR','DAR'],tr:['AR']},
 rashed:{n:['Rashed Al Mazrouei','راشد المزروعي'],co:'gdl',em:'rashed@gulfdry.ae',c:'#b5455a',role:['Project Engineer','مهندس مشروع'],ty:['MAR','SAR','DAR'],tr:['AR','CV']}
};
const byEmail=e=>Object.keys(M).find(k=>M[k].em===String(e||'').trim().toLowerCase());
// spreadsheet columns
const COLS=[
 ['A','No.','no',null,0],['B','Description','subject','subject',92],['C','Sub. Type','type','type',88],['D','Discipline','trade','trade',95],['E','Scope','scope','scopes',90],['F','Location','loc','loc',97],['G','Package','pkg','pkg',99],['H','Responsible (email)','email','assign',81],['I','TMC Ref','ref','ref',74],['J','Spec Section','spec','f_spec',86],['K','Manufacturer','mfr','f_mfr',90],['L','Planned date','date','f_date',83],['M','Remarks','rem',null,0]];
const FIELDS=[['subject','Subject','الموضوع',1],['type','Type','النوع',1],['trade','Trade','التخصص',1],['scopes','Scopes','النطاقات'],['loc','Location','الموقع'],['pkg','Package','الحزمة'],['assign','Assign to','إسناد إلى'],['ref','Paper ref','المرجع الورقي'],['f_spec','Form · Spec section','النموذج · بند المواصفات',0,'MAR · SAR'],['f_mfr','Form · Manufacturer','النموذج · الشركة المصنعة',0,'MAR'],['f_date','Form · Planned submission','النموذج · موعد التقديم المخطط',0,'MAR · SAR · DAR']];
// distinct-value suggestions [target, confidence]; null target = no match
const SUG={
 type:{'MAR':['MAR',100],'SAR':['SAR',100],'DAR':['DAR',100],'Material':['MAR',96],'Supplier':['SAR',90],'Doc':['DAR',85]},
 trade:{'Electrical':['EL',100],'Elec.':['EL',94],'Mechanical':['ME',100],'Mech':['ME',91],'Plumbing':['PL',100],'Civil':['CV',100],'Arch':['AR',89],'HVAC-2':[null,0]},
 scopes:{'Lighting':['Lighting',100],'HVAC':['HVAC',100],'Drainage':['Drainage',100],'Concrete':['Concrete',100],'Finishes':['Interior finishes',84]},
 loc:{'Tower 1 / Floor 1':['T1-F1',100],'Tower 1 / Floor 2':['T1-F2',100],'Lvl 3':['T1-F3',87],'T1-L02':['T1-F2',82],'Tower 1 / Floor 4':['T1-F4',100],'Basement':['T1-B1',78],'Roof':['T1-RF',93],'Podium':['POD',100],'Tower 1 / Floor 5':['T1-F5',100],'Tower 3 / L5':[null,0]}};
// project packages (spec numbering PKG-001)
const SCOPES={'Lighting':['Lighting','الإنارة'],'Power':['Power','الطاقة'],'Containment':['Containment','الحوامل'],'HVAC':['HVAC','التكييف'],'Drainage':['Drainage','الصرف'],'Concrete':['Concrete','الخرسانة'],'Waterproofing':['Waterproofing','العزل المائي'],'Interior finishes':['Interior finishes','التشطيبات الداخلية'],'Façade':['Façade','الواجهة']};
const PKGS={'PKG-001':['Tower 1 — Electrical materials','البرج ١ — المواد الكهربائية','prog'],'PKG-002':['Façade & finishes – Tower 1','الواجهة والتشطيبات – البرج ١','done'],'PKG-003':['MEP coordination – Level 3','تنسيق الأعمال الكهروميكانيكية – الطابق ٣','open'],'PKG-004':['Façade – Tower 2','الواجهة – البرج ٢','prog'],'PKG-005':['Fire & life safety','الحريق وسلامة الأرواح','open'],'PKG-006':['Concrete mix designs','تصاميم الخلطات الخرسانية','done']};
const PST={open:['Open','مفتوحة','blue'],prog:['In Progress','قيد التنفيذ','amber'],done:['Done','منتهية','green']};
// rows
const ITEMS={Electrical:['Lighting fixtures','LV switchgear','Cable trays & supports','Distribution boards','Small power devices','Emergency lighting','Earthing system','Busbar trunking'],Mechanical:['Chilled water pipes','HVAC ducting','Fan coil units','Fire dampers','Pumps & valves','Insulation'],Plumbing:['Drainage pipes & fittings','Water heaters','Sanitary ware','Booster pumps'],Civil:['Concrete mix C40','Waterproofing membrane','Reinforcement steel','Precast planks'],Arch:['Ceramic floor tiles','Gypsum partitions','Doors & ironmongery','Suspended ceiling']};
const TRS=['Electrical','Elec.','Mechanical','Mech','Plumbing','Civil','Arch','Electrical','Mechanical','Electrical'];
const TYS=['MAR','Material','MAR','SAR','MAR','DAR','Supplier','MAR','Doc','MAR','MAR'];
const LRS=['Tower 1 / Floor 1','Tower 1 / Floor 2','Lvl 3','T1-L02','Tower 1 / Floor 4','Basement','Roof','Podium','Tower 1 / Floor 5'];
const SCP={Electrical:'Lighting',Mechanical:'HVAC',Plumbing:'Drainage',Civil:'Concrete',Arch:'Finishes'};
const MFR=['Philips','Schneider Electric','ABB','Daikin','Grundfos','RAK Ceramics','Knauf','Sika'];
const norm=t=>({'Elec.':'Electrical','Mech':'Mechanical','HVAC-2':'Mechanical'}[t]||t);
const ROWS=[];
for(let i=0;i<189;i++){const r=i+4;const tr=TRS[i%10],nt=norm(tr),it=ITEMS[nt]||ITEMS.Arch;const loc=LRS[i%9];
 const email=(nt==='Electrical'&&i%3===0)?'faisal@tmc.sa':((nt==='Mechanical'||nt==='Plumbing')&&i%4===0)?'omar@tmc.sa':'';
 const pkg=nt==='Electrical'?'Electrical L1–L5':(nt==='Mechanical'||nt==='Plumbing')?'MEP coordination':'';
 const lk=(SUG.loc[loc]||[])[0];ROWS.push({r,no:String(i+1),subject:it[i%it.length]+' – '+(lk?LOCS[lk][0].replace('Tower 1 / ',''):loc),type:TYS[i%11],trade:tr,scope:SCP[nt]||'',loc,pkg,email,ref:'TMC-'+(nt[0])+'-'+String(i+1).padStart(3,'0'),spec:['26 51 00','26 24 13','23 31 13','22 13 16','03 30 00','09 30 00'][i%6],mfr:MFR[i%8],date:String(5+(i%20)).padStart(2,'0')+'-Nov-26',rem:i%17===0?'Long lead':''})}
const ov=(r,o)=>Object.assign(ROWS.find(x=>x.r===r),o);
ov(14,{subject:'',trade:'HVAC-2',pkg:'MEP coordination',email:''});
ov(27,{loc:'Tower 3 / L5'});
ov(41,{type:''});
ov(58,{email:'k.ali@gulfdry.ae',trade:'Arch',pkg:'',subject:'Gypsum partitions – Floor 4'});
ov(102,{email:'sami@tmc.sa',type:'SAR',trade:'Civil',pkg:'',subject:'Waterproofing membrane – Basement'});
ov(133,{email:'faisal@tmc.sa',type:'MAR',trade:'Mechanical',pkg:'MEP coordination',subject:'Fan coil units – Floor 4'});
ov(171,{pkg:'Façade',trade:'Arch',email:'',subject:'Curtain wall brackets – Floor 5'});
// title rows above the header (row 3)
const TOP=[['TMC Constructions — Submittal Register','','','','',''],['Project: Dubai Marina Tower · Rev 4 · 30 Sep 2026','','','','','']];
const SHEETS=[['Register',192,13],['Instructions',24,2],['Lookups',40,6]];
window.IMD={SCOPES,TYPES,TR,LOCS,CO,M,byEmail,COLS,FIELDS,SUG,PKGS,PST,ROWS,TOP,SHEETS};
})();
