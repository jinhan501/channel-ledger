/* Channel ledger domain validation. This file has no Google or browser dependencies. */
(function (root) {
  'use strict';
  const LISTS=['units','products','prices','shipments','payments','settlements','archivedUnits','archivedProducts'];
  const TABLES=['prices','shipments','payments','settlements'];
  const MAX_NAME=160, MAX_NOTE=1000;
  function fail(message){throw new Error(message)}
  function obj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)}
  function str(v,max=MAX_NAME){return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)}
  function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;let d=new Date(v+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===v}
  function amount(v,zero=false){return Number.isSafeInteger(v)&&(zero?v>=0:v>0)&&v<=1000000000}
  function unique(list,key,label){const s=new Set();for(const x of list){const k=key(x);if(s.has(k))fail(label+'重複');s.add(k)}}
  function plainRecord(x,keys,label){if(!obj(x)||Object.keys(x).some(k=>!keys.includes(k)))fail(label+'欄位不正確')}
  function empty(){return {units:[],products:[],prices:[],shipments:[],payments:[],settlements:[],archivedUnits:[],archivedProducts:[]}}
  function validate(s){
    if(!obj(s)||Object.keys(s).some(k=>!LISTS.includes(k))||LISTS.some(k=>!Array.isArray(s[k])))fail('資料結構不正確');
    if(LISTS.some(k=>s[k].length>10000))fail('資料筆數已達限制');
    for(const x of [...s.units,...s.archivedUnits])if(!str(x))fail('單位名稱不正確');
    unique([...s.units,...s.archivedUnits],x=>x,'單位');
    for(const x of [...s.products,...s.archivedProducts]){plainRecord(x,['name','unit'],'商品');if(!str(x.name)||!str(x.unit,30))fail('商品名稱或單位不正確')}
    unique([...s.products,...s.archivedProducts],x=>x.name,'商品');
    let units=new Set([...s.units,...s.archivedUnits]),products=new Map([...s.products,...s.archivedProducts].map(x=>[x.name,x]));
    for(const t of TABLES)unique(s[t],x=>x&&x.id,t+'編號');
    for(const p of s.prices){plainRecord(p,['id','supplier','buyer','product','price'],'通路價格');if(!str(p.id)||!units.has(p.supplier)||!units.has(p.buyer)||p.supplier===p.buyer||!products.has(p.product)||!amount(p.price))fail('通路價格不正確')}
    unique(s.prices,x=>JSON.stringify([x.supplier,x.buyer,x.product]),'通路價格');
    let shipments=new Map();
    for(const a of s.shipments){
      plainRecord(a,['id','date','delivery','supplier','buyer','kind','note','items','createdBy','voided'],'出貨');
      if(!str(a.id)||!date(a.date)||!str(a.delivery,50)||!units.has(a.supplier)||!units.has(a.buyer)||a.supplier===a.buyer||!['買斷','寄售'].includes(a.kind)||typeof a.note!=='string'||a.note.length>MAX_NOTE||!Array.isArray(a.items)||!a.items.length||a.items.length>100||(a.voided!==undefined&&typeof a.voided!=='boolean')||(a.createdBy!==undefined&&!str(a.createdBy)))fail('出貨資料不正確');
      for(const i of a.items){plainRecord(i,['name','unit','qty','price'],'出貨明細');if(!products.has(i.name)||products.get(i.name).unit!==i.unit||!amount(i.qty)||!amount(i.price)||!Number.isSafeInteger(i.qty*i.price))fail('出貨商品、數量或價格不正確')}
      shipments.set(a.id,a);
    }
    let sold=new Map(),returned=new Map(),due=new Map();
    for(const a of s.shipments){let total=a.kind==='買斷'?a.items.reduce((v,i)=>v+i.qty*i.price,0):0;if(!Number.isSafeInteger(total))fail('出貨金額超過限制');due.set(a.id,total)}
    for(const c of s.settlements){
      plainRecord(c,['id','date','type','shipment','item','qty','price','createdBy','voided'],'寄售紀錄');let a=shipments.get(c.shipment);
      if(!str(c.id)||!date(c.date)||!['售出','退回'].includes(c.type)||!a||a.kind!=='寄售'||!Number.isSafeInteger(c.item)||c.item<0||c.item>=a.items.length||!amount(c.qty)||c.price!==a.items[c.item].price||(c.voided!==undefined&&typeof c.voided!=='boolean')||(c.createdBy!==undefined&&!str(c.createdBy)))fail('寄售紀錄不正確');
      if(c.voided)continue;if(a.voided)fail('已作廢出貨單仍有关聯寄售紀錄');let key=JSON.stringify([c.shipment,c.item]),m=c.type==='售出'?sold:returned;m.set(key,(m.get(key)||0)+c.qty);if(c.type==='售出'){let total=due.get(a.id)+c.qty*c.price;if(!Number.isSafeInteger(total))fail('寄售金額超過限制');due.set(a.id,total)}
    }
    for(const a of s.shipments)for(let i=0;i<a.items.length;i++){let k=JSON.stringify([a.id,i]);if((sold.get(k)||0)+(returned.get(k)||0)>a.items[i].qty)fail('售出及退回數量超過寄售出貨數量')}
    let allocations=new Map();
    for(const p of s.payments){
      plainRecord(p,['id','date','amount','supplier','buyer','method','payer','allocations','createdBy','voided'],'收款');
      if(!str(p.id)||!date(p.date)||!amount(p.amount)||!units.has(p.supplier)||!units.has(p.buyer)||p.supplier===p.buyer||!str(p.method,50)||typeof p.payer!=='string'||p.payer.length>MAX_NOTE||!Array.isArray(p.allocations)||!p.allocations.length||p.allocations.length>100||(p.voided!==undefined&&typeof p.voided!=='boolean')||(p.createdBy!==undefined&&!str(p.createdBy)))fail('收款資料不正確');
      unique(p.allocations,x=>x.shipment,'收款分配');let total=0;
      for(const x of p.allocations){plainRecord(x,['shipment','amount'],'收款分配');let a=shipments.get(x.shipment);if(!a||!amount(x.amount)||a.supplier!==p.supplier||a.buyer!==p.buyer)fail('收款分配對象不正確');total+=x.amount;if(!p.voided){if(a.voided)fail('已作廢出貨單仍有收款');allocations.set(a.id,(allocations.get(a.id)||0)+x.amount)}}
      if(total!==p.amount)fail('收款分配合計不符');
    }
    for(const [sid,total] of allocations)if(total>due.get(sid))fail('已收金額超過應收金額');
    return true;
  }
  function normalizeActor(before,next,actor){
    for(const t of ['shipments','payments','settlements']){let old=new Map(before[t].map(x=>[x.id,x]));for(const x of next[t]){let prior=old.get(x.id);if(prior){if(prior.createdBy!==undefined)x.createdBy=prior.createdBy;else delete x.createdBy}else x.createdBy=actor}}
  }
  function diff(before,next){
    const changes=[];for(const [active,archive,key] of [['units','archivedUnits',x=>x],['products','archivedProducts',x=>x.name]]){let oldA=new Set(before[active].map(key)),oldAll=new Set([...before[active],...before[archive]].map(key)),newA=new Set(next[active].map(key)),newAll=new Set([...next[active],...next[archive]].map(key));for(const v of oldAll)if(!newAll.has(v))fail('不可永久移除既有基本資料');let perms=[];if([...newA].some(v=>!oldAll.has(v)))perms.push('add');if([...newA].some(v=>oldAll.has(v)&&!oldA.has(v)))perms.push('edit');if([...oldA].some(v=>!newA.has(v)))perms.push('void');if(!perms.length)perms.push('edit');for(const t of [active,archive])if(JSON.stringify(before[t])!==JSON.stringify(next[t]))changes.push({table:t,before:before[t],after:next[t],permissions:perms})}
    for(const table of TABLES){let old=new Map(before[table].map(x=>[x.id,x])),now=new Map(next[table].map(x=>[x.id,x]));for(const [id,a] of old){let b=now.get(id);if(!b){if(table!=='prices')fail('不可直接刪除交易紀錄');changes.push({table,id,before:a,after:null,permissions:['void']});continue}if(JSON.stringify(a)!==JSON.stringify(b)){if(a.voided)fail('已作廢紀錄不能修改或直接恢復');if(b.voided){let clean=Object.assign({},b);delete clean.voided;let original=Object.assign({},a);delete original.voided;if(JSON.stringify(clean)!==JSON.stringify(original))fail('作廢時不能同時更改紀錄內容')}changes.push({table,id,before:a,after:b,permissions:[b.voided?'void':'edit']})}}for(const [id,b] of now)if(!old.has(id)){if(b.voided)fail('不能新增已作廢紀錄');changes.push({table,id,before:null,after:b,permissions:['add']})}}
    return changes;
  }
  function prepare(before,proposed,actor,rights,reason){
    if(!str(actor,254))fail('登入身分不正確');if(!obj(rights))fail('權限不正確');
    let next=JSON.parse(JSON.stringify(proposed));validate(before);normalizeActor(before,next,actor);validate(next);let changes=diff(before,next);
    if(!changes.length)fail('沒有變更');for(const c of changes)for(const permission of c.permissions)if(!rights.admin&&!rights[permission])fail('沒有'+permission+'權限');
    if(changes.some(c=>c.table==='shipments'||c.table==='payments'||c.table==='settlements')){if(changes.some(c=>c.table==='units'||c.table==='products'||c.table==='archivedUnits'||c.table==='archivedProducts'||c.table==='prices'))fail('交易與基本資料須分開儲存')}
    if(changes.some(c=>c.permissions.some(p=>p!=='add'))&&(!str(reason,500)))fail('請填寫修改原因');
    for(const a of before.shipments){let b=next.shipments.find(x=>x.id===a.id);if(!b)continue;let linked=before.payments.some(p=>!p.voided&&p.allocations.some(x=>x.shipment===a.id))||before.settlements.some(c=>!c.voided&&c.shipment===a.id);if(linked&&(a.supplier!==b.supplier||a.buyer!==b.buyer||a.kind!==b.kind))fail('有關聯紀錄時不能更改交易單位或交易方式');if(before.settlements.some(c=>!c.voided&&c.shipment===a.id)&&JSON.stringify(a.items)!==JSON.stringify(b.items))fail('寄售已有紀錄，不能直接修改商品明細')}
    return {state:next,changes};
  }
  function apply(state,changes){let out=JSON.parse(JSON.stringify(state));for(const c of changes){if(!LISTS.includes(c.table))fail('事件資料錯誤');if(!c.id){out[c.table]=c.after;continue}let a=out[c.table],i=a.findIndex(x=>x.id===c.id);if(c.after===null){if(i<0)fail('事件參照錯誤');a.splice(i,1)}else if(i<0)a.push(c.after);else a[i]=c.after}validate(out);return out}
  const api={empty,validate,prepare,apply};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.LedgerCore=api;
})(typeof globalThis==='undefined'?this:globalThis);

/* Separate Apps Script project; configuration is deliberately not initialized. */
var LEDGER={events:'異動紀錄',schema:1,maxEventChars:40000,maxEvents:10000};
function lock_(fn){var lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw new Error('目前有人操作中，請稍後再試');try{return fn()}finally{try{SpreadsheetApp.flush()}finally{lock.releaseLock()}}}
function settings_(){var p=PropertiesService.getScriptProperties(),id=p.getProperty('LEDGER_SHEET_ID'),owner=(p.getProperty('LEDGER_OWNER_EMAIL')||'').toLowerCase();if(!id||!validEmail_(owner))throw new Error('系統尚未完成設定');return {id:id,owner:owner,properties:p}}
function spreadsheet_(){return SpreadsheetApp.openById(settings_().id)}
function table_(name){var sheet=spreadsheet_().getSheetByName(name);if(!sheet)throw new Error('系統資料表不完整，請聯絡管理員');return sheet}
function validEmail_(v){return typeof v==='string'&&v.length<=254&&/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)}
function normEmail_(v){return String(v||'').trim().toLowerCase()}
function hash_(v){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v),Utilities.Charset.UTF_8).map(function(x){return ('0'+(x&255).toString(16)).slice(-2)}).join('')}
function id_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'')}
function actorRows_(){var owner=settings_().owner,users={};users[owner]={email:owner,name:'管理員',active:true,add:true,edit:true,void:true};eventRows_().forEach(function(row){var change=JSON.parse(String(row[4]));if(change&&change.kind==='account'){var next=change.after;if(!next||!validEmail_(next.email))throw new Error('帳號紀錄損毀，請聯絡管理員');users[next.email]=next}});return Object.keys(users).map(function(k){return users[k]})}
function findUser_(email){return actorRows_().filter(function(x){return x.email===email})[0]||null}
function permissions_(u){return {admin:u.email===settings_().owner,add:u.add,edit:u.edit,void:u.void}}
function auth_(token){if(typeof token!=='string'||token.length<40||token.length>160)throw new Error('請先登入');var cache=CacheService.getScriptCache(),raw=cache.get('ledger:session:'+hash_(token));if(!raw)throw new Error('登入已失效，請重新登入');var record=JSON.parse(raw),user=findUser_(record.email);if(!user||!user.active||record.expires<=Date.now())throw new Error('登入已失效或沒有權限');return user}
function requestCode_(payload){var email=normEmail_(payload.email),generic={message:'若此信箱已獲授權，將收到登入驗證碼。'};if(!validEmail_(email))return generic;return lock_(function(){var u=findUser_(email);if(!u||!u.active)return generic;var p=settings_().properties,k='LEDGER_OTP_'+hash_(email),old=JSON.parse(p.getProperty(k)||'{}'),now=Date.now();if(old.lastSent&&now-old.lastSent<60000)throw new Error('請等候一分鐘後再寄送');var windowStart=old.windowStart||now,count=Number(old.count||0);if(now-windowStart>=86400000){windowStart=now;count=0}if(count>=12)throw new Error('此信箱驗證碼寄送次數已達上限，請稍後再試');var code=Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase(),salt=id_();var rec={hash:hash_(salt+':'+email+':'+code),salt:salt,expires:now+600000,attempts:0,lastSent:now,windowStart:windowStart,count:count+1};p.setProperty(k,JSON.stringify(rec));try{MailApp.sendEmail({to:email,subject:'【通路帳本】登入驗證碼',body:'您的登入驗證碼：'+code+'\n驗證碼 10 分鐘內有效，若非本人操作請忽略。',name:'通路帳本'})}catch(err){rec.hash='';rec.expires=0;p.setProperty(k,JSON.stringify(rec));throw new Error('驗證碼寄送失敗，請稍後再試')}return generic})}
function verifyCode_(payload){var email=normEmail_(payload.email),code=String(payload.code||'').trim().toUpperCase();return lock_(function(){var p=settings_().properties,k='LEDGER_OTP_'+hash_(email),raw=p.getProperty(k),u=validEmail_(email)?findUser_(email):null;if(!raw||!u||!u.active)throw new Error('驗證碼無效或已過期');var r=JSON.parse(raw),now=Date.now();if(!r.hash||r.expires<=now||r.attempts>=5)throw new Error('驗證碼無效或已過期');r.attempts++;p.setProperty(k,JSON.stringify(r));if(hash_(r.salt+':'+email+':'+code)!==r.hash)throw new Error('驗證碼不正確');r.hash='';r.expires=0;p.setProperty(k,JSON.stringify(r));var token=id_(),expires=now+21600000;CacheService.getScriptCache().put('ledger:session:'+hash_(token),JSON.stringify({email:email,expires:expires}),21600);return {token:token,email:email,name:u.name,permissions:permissions_(u),expires:expires}})}
function eventRows_(){var s=table_(LEDGER.events),n=s.getLastRow();if(n<=1)return [];if(n-1>LEDGER.maxEvents)throw new Error('資料筆數已達安全限制，請聯絡管理員');return s.getRange(2,1,n-1,7).getValues()}
function replay_(rows){var state=LedgerCore.empty(),version=0;rows.forEach(function(row){if(Number(row[0])!==version+1)throw new Error('資料版本不連續，請聯絡管理員');var changes=JSON.parse(String(row[4]));if(Array.isArray(changes))state=LedgerCore.apply(state,changes);else if(!changes||['account','restore'].indexOf(changes.kind)<0)throw new Error('異動紀錄不正確');version++});return {state:state,version:version}}
function snapshot_(){return replay_(eventRows_())}
function backup_(user){if(!permissions_(user).admin)throw new Error('只有管理員可以備份');return lock_(function(){user=findUser_(user.email);if(!user||!user.active||!permissions_(user).admin)throw new Error('沒有管理帳號權限');var rows=eventRows_(),current=replay_(rows);return {format:'channel-ledger-backup',schema:1,createdAt:new Date().toISOString(),owner:settings_().owner,version:current.version,events:rows,checksum:hash_(JSON.stringify(rows))}})}
function validateBackup_(backup,owner){
 if(!backup||backup.format!=='channel-ledger-backup'||backup.schema!==1||backup.owner!==owner||!Array.isArray(backup.events)||backup.events.length>=LEDGER.maxEvents||backup.version!==backup.events.length||backup.checksum!==hash_(JSON.stringify(backup.events)))throw new Error('備份檔案錯誤或不屬於此帳本');
 backup.events.forEach(function(row,index){
  if(!Array.isArray(row)||row.length!==7||Number(row[0])!==index+1||typeof row[1]!=='string'||!/^[0-9T:.Z-]+$/.test(row[1])||!validEmail_(row[2])||typeof row[3]!=='string'||row[3].length>501||typeof row[4]!=='string'||row[4].length>LEDGER.maxEventChars||typeof row[5]!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(row[5])||typeof row[6]!=='string'||!/^[a-f0-9]{64}$/.test(row[6]))throw new Error('備份紀錄格式錯誤');
  var change=JSON.parse(row[4]);if(!Array.isArray(change)){if(!change||['account','restore'].indexOf(change.kind)<0)throw new Error('備份紀錄格式錯誤');if(change.kind==='account'){var u=change.after;if(!u||!validEmail_(u.email)||u.email===owner||typeof u.name!=='string'||u.name.length>100||['active','add','edit','void'].some(function(k){return typeof u[k]!=='boolean'}))throw new Error('備份帳號格式錯誤')}}
 });
 return replay_(backup.events);
}
function restore_(user,p){if(!permissions_(user).admin)throw new Error('只有管理員可以還原');return lock_(function(){
 user=findUser_(user.email);if(!user||!user.active||!permissions_(user).admin)throw new Error('沒有管理帳號權限');var config=settings_(),current=replay_(eventRows_());
 if(p.generation!==config.id||p.version!==current.version)throw new Error('資料已變更，請重新載入後再操作');
 var snap=validateBackup_(p.backup,config.owner),rows=p.backup.events;
 var book=SpreadsheetApp.create('通路帳本｜還原 '+Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd-HHmmss'));
 var sheet=book.getSheets()[0];sheet.setName(LEDGER.events);var needed=rows.length+2;if(sheet.getMaxRows()<needed)sheet.insertRowsAfter(sheet.getMaxRows(),needed-sheet.getMaxRows());
 sheet.getRange(1,1,1,7).setValues([['版本','時間','操作帳號','原因','異動內容','請求編號','檢查碼']]);
 if(rows.length){var safeRows=rows.map(function(row){var copy=row.slice();copy[3]="'"+String(copy[3]).replace(/^'/,'');return copy});sheet.getRange(2,1,safeRows.length,7).setValues(safeRows)}
 var changes=JSON.stringify({kind:'restore',backupVersion:snap.version}),requestId='restore-'+id_();
 sheet.appendRow([snap.version+1,new Date().toISOString(),user.email,"'備份還原，原試算表保留",changes,requestId,hash_(changes)]);SpreadsheetApp.flush();
 var verifyRows=sheet.getRange(2,1,snap.version+1,7).getValues();var verify=replay_(verifyRows);if(JSON.stringify(verify.state)!==JSON.stringify(snap.state))throw new Error('還原驗證失敗，原資料未變更');
 config.properties.setProperty('LEDGER_SHEET_ID',book.getId());return {url:book.getUrl(),version:verify.version,generation:book.getId()};
 })}
function commit_(user,p){return lock_(function(){user=findUser_(user.email);if(!user||!user.active)throw new Error('登入已失效或沒有權限');var rows=eventRows_(),current=replay_(rows),requestId=String(p.requestId||'');if(p.generation!==settings_().id)throw new Error('帳本資料來源已更新，請重新載入');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw new Error('送出識別不正確');var fingerprint=hash_(JSON.stringify({actor:user.email,version:p.version,state:p.state,reason:p.reason}));var old=rows.filter(function(r){return String(r[5])===requestId})[0];if(old){if(String(old[2])!==user.email||String(old[6])!==fingerprint)throw new Error('送出識別重複，請重新載入');return {state:current.state,history:history_(rows,user),version:current.version,replayed:true}}if(!Number.isSafeInteger(p.version)||p.version!==current.version)throw new Error('其他人已更新資料，請重新載入後再確認');var out=LedgerCore.prepare(current.state,p.state,user.email,permissions_(user),String(p.reason||'')),changes=JSON.stringify(out.changes);if(changes.length>LEDGER.maxEventChars)throw new Error('此次變更資料過大，請分次操作');if(rows.length>=LEDGER.maxEvents)throw new Error('資料筆數已達安全限制，請聯絡管理員');var row=[current.version+1,new Date().toISOString(),user.email,"'"+String(p.reason||''),changes,requestId,fingerprint];table_(LEDGER.events).appendRow(row);return {state:out.state,history:history_(rows.concat([row]),user),version:current.version+1,replayed:false}})}
function userList_(user){if(!permissions_(user).admin)throw new Error('沒有管理帳號權限');return actorRows_().map(function(x){return {email:x.email,name:x.name,active:x.active,add:x.add,edit:x.edit,void:x.void,owner:x.email===settings_().owner}})}
function saveUser_(actor,p){if(!permissions_(actor).admin)throw new Error('沒有管理帳號權限');return lock_(function(){actor=findUser_(actor.email);if(!actor||!actor.active||!permissions_(actor).admin)throw new Error('沒有管理帳號權限');var email=normEmail_(p.email),name=String(p.name||'').trim(),owner=settings_().owner;if(!validEmail_(email)||!name||name.length>100||/[\u0000-\u001f]/.test(name)||typeof p.active!=='boolean'||typeof p.add!=='boolean'||typeof p.edit!=='boolean'||typeof p.void!=='boolean')throw new Error('帳號資料不正確');if(email===owner)throw new Error('不可修改擁有者帳號');var rows=eventRows_(),current=replay_(rows),before=findUser_(email),after={email:email,name:name,active:p.active,add:p.add,edit:p.edit,void:p.void};if(JSON.stringify(before)===JSON.stringify(after))return userList_(actor);if(rows.length>=LEDGER.maxEvents)throw new Error('資料筆數已達安全限制，請聯絡管理員');var changes=JSON.stringify({kind:'account',before:before,after:after});table_(LEDGER.events).appendRow([current.version+1,new Date().toISOString(),actor.email,"'帳號權限管理",changes,'account-'+id_(),hash_(changes)]);SpreadsheetApp.flush();return userList_(actor)})}
function history_(rows,user){var admin=permissions_(user).admin;return rows.slice().reverse().reduce(function(all,row){var changes=JSON.parse(String(row[4])),when=String(row[1]),actor=String(row[2]),reason=String(row[3]).replace(/^'/,'');if(Array.isArray(changes))changes.forEach(function(c){all.push({at:when,action:c.table+(c.id?' '+c.id:''),before:c.before,after:c.after,operator:actor,reason:reason})});else if(admin&&changes.kind==='account')all.push({at:when,action:'帳號權限',before:changes.before,after:changes.after,operator:actor,reason:reason});else if(admin&&changes.kind==='restore')all.push({at:when,action:'備份還原',before:null,after:changes,operator:actor,reason:reason});return all},[])}
function api(action,payload){try{var p=payload||{};if(action==='auth.request')return {ok:true,data:requestCode_(p)};if(action==='auth.verify')return {ok:true,data:verifyCode_(p)};var u=auth_(p.token);if(action==='auth.logout'){CacheService.getScriptCache().remove('ledger:session:'+hash_(p.token));return {ok:true,data:{}}}if(action==='data.get'){var result=lock_(function(){var active=findUser_(u.email);if(!active||!active.active)throw new Error('登入已失效或沒有權限');var rows=eventRows_();return {snap:replay_(rows),generation:settings_().id,history:history_(rows,active),user:active}});return {ok:true,data:{state:result.snap.state,version:result.snap.version,generation:result.generation,history:result.history,user:{email:result.user.email,name:result.user.name,permissions:permissions_(result.user)}}}}if(action==='data.backup')return {ok:true,data:backup_(u)};if(action==='data.restore')return {ok:true,data:restore_(u,p)};if(action==='data.commit')return {ok:true,data:commit_(u,p)};if(action==='accounts.list')return {ok:true,data:userList_(u)};if(action==='accounts.save')return {ok:true,data:saveUser_(u,p)};throw new Error('不支援的操作')}catch(err){return {ok:false,error:String(err.message||'系統暫時無法處理')}}}
/* API-only entry point for a separately hosted website. */
function doPost(e){
  try{
    var raw=e&&e.postData&&e.postData.contents;
    if(typeof raw!=='string'||raw.length>1900000)throw new Error('請求格式不正確');
    var req=JSON.parse(raw),allowed=['auth.request','auth.verify','auth.logout','data.get','data.backup','data.restore','data.commit','accounts.list','accounts.save'];
    if(!req||allowed.indexOf(req.action)<0||!req.payload||typeof req.payload!=='object'||Array.isArray(req.payload))throw new Error('請求格式不正確');
    return ContentService.createTextOutput(JSON.stringify(api(req.action,req.payload))).setMimeType(ContentService.MimeType.JSON);
  }catch(err){return ContentService.createTextOutput(JSON.stringify({ok:false,error:'請求格式不正確'})).setMimeType(ContentService.MimeType.JSON)}
}

