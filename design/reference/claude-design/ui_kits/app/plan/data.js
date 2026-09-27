// Plan View — sample data + drawing. Exposes window.PD.
(function(){
const W=1200,H=800;
const TYPE={snag:{en:'Snag',ar:'ملاحظة',code:'SNG',shape:'circle'},insp:{en:'Inspection Request',ar:'طلب فحص',code:'IR',shape:'diamond'},com:{en:'Comment',ar:'تعليق',code:'COM',shape:'square'}};
const STAT={open:{en:'Open',ar:'مفتوح',c:'var(--tone-orange-solid)',t:'var(--tone-orange-tint)',f:'var(--tone-orange-fg)'},review:{en:'In review',ar:'قيد المراجعة',c:'var(--tone-blue-solid)',t:'var(--tone-blue-tint)',f:'var(--tone-blue-fg)'},failed:{en:'Failed',ar:'راسب',c:'var(--tone-red-solid)',t:'var(--tone-red-tint)',f:'var(--tone-red-fg)'},closed:{en:'Closed',ar:'مغلق',c:'var(--tone-green-solid)',t:'var(--tone-green-tint)',f:'var(--tone-green-fg)'},draft:{en:'Draft',ar:'مسودة',c:'var(--tone-gray-solid)',t:'var(--tone-gray-tint)',f:'var(--tone-gray-fg)'}};
const STAGE={open:['Raised · with contractor','مُسجّلة · لدى المقاول'],review:['Fixed · awaiting consultant','مُصلحة · بانتظار الاستشاري'],failed:['Inspection failed · re-work','رسب الفحص · إعادة عمل'],closed:['Closed out','مغلقة'],draft:['Draft','مسودة']};
const TR={EL:['Electrical','كهرباء','cyan'],PL:['Plumbing','سباكة','blue'],AR:['Finishes','تشطيبات','violet'],FS:['Firestopping','عزل الحريق','orange'],ME:['Mechanical','ميكانيكا','green'],CV:['Civil','مدني','amber']};
const CO={tmc:['TMC Constructions','تي إم سي للمقاولات','#f8552f','TMC'],dry:['Gulf Dryliners','الخليج للألواح الجافة','#7a5af0','GDL'],fire:['FireSafe Systems','فاير سيف للأنظمة','#e98b45','FSS'],mep:['ALEC MEP','ألك للأعمال الكهروميكانيكية','#1fae66','ALC']};
const TRCO={EL:'tmc',PL:'mep',ME:'mep',AR:'dry',FS:'fire',CV:'tmc'};
const ROLES={admin:{en:'Project Admin',ar:'مسؤول المشروع',sub:['All companies','جميع الشركات']},tmc:{en:'TMC Constructions',ar:'تي إم سي للمقاولات',sub:['Contractor · own work only','مقاول · أعمال الشركة فقط'],co:'tmc'},dry:{en:'Gulf Dryliners',ar:'الخليج للألواح الجافة',sub:['Contractor · own work only','مقاول · أعمال الشركة فقط'],co:'dry'}};
const ROOMS=[{id:'a1',en:'Apt 201',ar:'شقة 201',r:[70,70,330,250]},{id:'a2',en:'Apt 202',ar:'شقة 202',r:[420,70,330,250]},{id:'a3',en:'Apt 203',ar:'شقة 203',r:[800,70,330,250]},{id:'a4',en:'Apt 204',ar:'شقة 204',r:[70,480,330,250]},{id:'a5',en:'Apt 205',ar:'شقة 205',r:[800,480,330,250]},{id:'cor',en:'Corridor',ar:'الممر',r:[70,340,1060,120]},{id:'core',en:'Lift & stair core',ar:'نواة المصاعد والدرج',r:[440,480,230,250]},{id:'r1',en:'Riser 01',ar:'الرايزر ٠١',r:[680,480,100,120]},{id:'r2',en:'Riser 02',ar:'الرايزر ٠٢',r:[680,610,100,120]}];
const TITLES={EL:[['Cable tray not bonded','حامل الكابلات غير موصول بالتأريض'],['Socket outlet loose','مقبس كهربائي غير مثبت'],['Missing cable labels','ملصقات الكابلات مفقودة'],['Light fitting misaligned','وحدة إنارة غير مستقيمة'],['Conduit not capped','أنبوب التمديد غير مغلق']],PL:[['Leak at WC connector','تسرب عند وصلة المرحاض'],['Pipe insulation torn','عزل الأنبوب ممزق'],['Floor drain level wrong','منسوب مصرف الأرضية خاطئ']],AR:[['Plasterboard joint cracked','تشقق في وصلة الجبس'],['Paint drips on skirting','قطرات دهان على النعلة'],['Door frame out of plumb','إطار الباب غير رأسي'],['Tile lippage over 2 mm','بروز البلاط أكثر من 2 مم'],['Ceiling access panel missing','لوحة وصول السقف مفقودة']],FS:[['Firestopping incomplete at riser','عزل الحريق غير مكتمل عند الرايزر'],['Collar undersized on SVP','طوق أنبوب الصرف أصغر من المطلوب']],ME:[['Duct flexible too long','المجرى المرن أطول من اللازم'],['FCU drain pan dirty','حوض تصريف وحدة التكييف متسخ']],CV:[['Honeycomb at column base','تعشيش عند قاعدة العمود']]};
let seed=7;const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280};
const FLOORS=[{id:'rf',en:'Roof',ar:'السطح',lv:'RF',n:[6,5,0,1,0]},{id:'03',en:'Floor 03',ar:'الطابق ٠٣',lv:'L03',n:[12,10,1,2,0]},{id:'02',en:'Floor 02',ar:'الطابق ٠٢',lv:'L02',n:[27,24,1,3,1]},{id:'01',en:'Floor 01',ar:'الطابق ٠١',lv:'L01',n:[9,6,2,1,0]},{id:'gf',en:'Ground Floor',ar:'الطابق الأرضي',lv:'GF',n:[4,4,0,0,0]}];
// n = [snags, openSnags, inspections, comments, failedInspections]
const PINS={};const seq={};
FLOORS.forEach(f=>{seed=f.id.charCodeAt(0)*31+f.id.charCodeAt(1);const L=[];const [sn,op,ins,com,fl]=f.n;const trs=['EL','EL','AR','AR','PL','FS','ME','EL','AR','PL','CV'];
 const mk=(type,st,i)=>{const tr=type==='insp'?'EL':type==='com'?['AR','PL','EL'][i%3]:trs[Math.floor(rnd()*trs.length)];const co=TRCO[tr];const room=ROOMS[Math.floor(rnd()*ROOMS.length)];const [x,y,w,h]=room.r;
  const key=CO[co][3]+'-'+tr+'-'+TYPE[type].code;seq[key]=(seq[key]||0)+1;const pool=TITLES[tr];const t=type==='com'?[['Clarify ceiling height at bulkhead','توضيح ارتفاع السقف عند الحاجز'],['Confirm socket heights with ID','تأكيد ارتفاع المقابس مع التصميم الداخلي'],['Riser door swing clashes with duct','فتحة باب الرايزر تتعارض مع المجرى']][i%3]:type==='insp'?[['First-fix electrical — Apt 201–205','التمديدات الكهربائية الأولى — الشقق 201–205']][0]:pool[Math.floor(rnd()*pool.length)];
  return {id:f.id+'-'+L.length,fl:f.id,no:'TWR-'+key+'-'+String(seq[key]+(tr==='EL'&&type==='snag'?10:0)).padStart(3,'0'),type,st,tr,co,room:room.id,x:Math.round(x+18+rnd()*(w-36)),y:Math.round(y+18+rnd()*(h-36)),t,age:Math.floor(rnd()*14)+1,photos:rnd()>.35?1+Math.floor(rnd()*3):0,mine:rnd()>.72,rev:rnd()>.25?'C':'B',d:Math.floor(rnd()*40)}};
 for(let i=0;i<sn;i++)L.push(mk('snag',i<op?'open':(i%2?'closed':'review'),i));
 for(let i=0;i<ins;i++)L.push(mk('insp',i<fl?'failed':'review',i));
 for(let i=0;i<com;i++)L.push(mk('com',i===2?'closed':'open',i));
 PINS[f.id]=L});
// hero pin + two items 3+ weeks old on Floor 02
const P2=PINS['02'];Object.assign(P2[0],{no:'TWR-TMC-EL-SNG-014',t:['Cable tray not bonded','حامل الكابلات غير موصول بالتأريض'],tr:'EL',co:'tmc',st:'open',age:14,photos:1,x:712,y:520,room:'r1',rev:'C',mine:true});
P2[5].age=24;P2[11].age=23;
// cluster-friendly: stack a few pins close together in Riser 01 / corridor
[3,7,9].forEach((k,i)=>{P2[k].x=700+i*14;P2[k].y=545+i*10;P2[k].room='r1'});
const SHEETS={'02':[{id:'C',no:'A-102',en:'Floor 02 Plan',ar:'مخطط الطابق ٠٢',rev:'C',cur:1,date:'14 Sep 2026'},{id:'B',no:'A-102',en:'Floor 02 Plan',ar:'مخطط الطابق ٠٢',rev:'B',date:'02 Jul 2026'},{id:'A',no:'A-102',en:'Floor 02 Plan',ar:'مخطط الطابق ٠٢',rev:'A',date:'11 Mar 2026'}]};
// schematic drawing (sample sheet)
function drawing(sheet){const g=[];const rect=(x,y,w,h,cls)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls||'wl'}"></rect>`;
 for(let i=0;i<7;i++){const x=70+i*(1060/6);g.push(`<line x1="${x}" y1="22" x2="${x}" y2="${H-22}" class="gd"></line><circle cx="${x}" cy="22" r="13" class="gb"></circle><text x="${x}" y="26.5" class="gt">${'ABCDEFG'[i]}</text>`)}
 for(let j=0;j<5;j++){const y=70+j*165;g.push(`<line x1="22" y1="${y}" x2="${W-22}" y2="${y}" class="gd"></line><circle cx="22" cy="${y}" r="13" class="gb"></circle><text x="22" y="${y+4.5}" class="gt">${j+1}</text>`)}
 g.push(rect(60,60,1080,680,'ow'));
 ROOMS.forEach(r=>{const [x,y,w,h]=r.r;g.push(rect(x,y,w,h));g.push(`<text x="${x+w/2}" y="${y+h/2}" class="rl">${r.en.toUpperCase()}</text><text x="${x+w/2}" y="${y+h/2+16}" class="ra">${r.id==='cor'?'1060 × 120':w*10+' × '+h*10}</text>`)});
 // doors, fixtures, core details
 [[240,320],[590,320],[965,320],[240,480],[965,480]].forEach(([x,y])=>g.push(`<path d="M${x-22} ${y} a44 44 0 0 1 44 0" class="dr"></path>`));
 [[90,90],[440,90],[820,90],[90,500],[820,500]].forEach(([x,y])=>g.push(rect(x,y,70,50,'fx'),rect(x+80,y,40,50,'fx')));
 g.push(rect(450,490,100,110,'fx'),rect(560,490,100,110,'fx'),`<line x1="450" y1="490" x2="550" y2="600" class="fx"></line><line x1="550" y1="490" x2="450" y2="600" class="fx"></line><line x1="560" y1="490" x2="660" y2="600" class="fx"></line><line x1="660" y1="490" x2="560" y2="600" class="fx"></line>`);
 for(let i=0;i<9;i++)g.push(`<line x1="${450+i*23}" y1="615" x2="${450+i*23}" y2="720" class="fx"></line>`);
 [[70,70],[400,70],[750,70],[1130,70],[70,730],[400,730],[800,730],[1130,730]].forEach(([x,y])=>g.push(rect(x-9,y-9,18,18,'col')));
 g.push(`<g class="tb"><rect x="${W-300}" y="${H-58}" width="280" height="44"></rect><text x="${W-290}" y="${H-41}">${sheet.no} · ${sheet.en.toUpperCase()}</text><text x="${W-290}" y="${H-24}">REV ${sheet.rev} · ${sheet.date.toUpperCase()} · 1:100</text></g>`);
 if(sheet.rev!=='C')g.push(`<rect x="800" y="480" width="330" height="250" class="cloud"></rect>`);
 return `<svg class="dwg" viewBox="0 0 ${W} ${H}">${g.join('')}</svg>`}
window.PD={W,H,TYPE,STAT,STAGE,TR,CO,ROLES,ROOMS,FLOORS,PINS,SHEETS,drawing};
})();
