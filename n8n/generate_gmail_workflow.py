from generate_workflows import node, code, gate, rpc, e, save, GMAIL, SUPA

MAILBOX = 'rheinwerk.industrieservice@gmail.com'

def gmail_http(key, name, method, url, body=None, query=None, soft=False, output=None):
    p = {'method': method, 'url': url, 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'gmailOAuth2', 'options': {'timeout': 30000, 'response': {'response': {'responseFormat': 'json', 'fullResponse': True, 'neverError': soft}}}}
    if body:
        p.update(sendBody=True, specifyBody='json', jsonBody=e(body))
    if query:
        p.update(sendQuery=True, queryParameters={'parameters': query})
    return node(key, name, 'n8n-nodes-base.httpRequest', 4.5, p, GMAIL, output=output, settings={'onError':'continueRegularOutput'} if soft else None)

verify = """const r=$input.first().json;const mailbox=String(r.body?.emailAddress??r.emailAddress??'').toLowerCase();if(mailbox!=='rheinwerk.industrieservice@gmail.com')throw new Error('RheinWerk Gmail-Konto nicht bestätigt');return [{json:{mailbox_verified:true}}];"""
mime = r"""const m=$input.first().json;const mailbox='rheinwerk.industrieservice@gmail.com';
if(m.direction!=='outgoing'||m.status!=='queued'||!m.approved_by||!m.approved_at)throw new Error('Freigegebene Nachricht erforderlich');
if(!/^[0-9a-f-]{36}$/i.test(m.id)||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(m.to_address??''))throw new Error('Ungültige Nachrichtenidentität oder Empfängeradresse');
const clean=s=>String(s??'').replace(/[\r\n]/g,' ').trim();const messageId='<'+m.id+'@rheinwerk-service.online>';
const subj=clean(m.subject);const chunks=Array.from(subj.matchAll(/.{1,30}/gu),x=>'=?UTF-8?B?'+Buffer.from(x[0]).toString('base64')+'?=');
const headers=['From: RheinWerk Industrieservice <'+mailbox+'>','To: '+m.to_address,'Subject: '+chunks.join('\r\n '),'Message-ID: '+messageId,'X-RheinWerk-Message-Id: '+m.id,'Date: '+new Date().toUTCString(),'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64'];
const refs=[...(Array.isArray(m.references_header)?m.references_header:[]),m.in_reply_to].filter(x=>typeof x==='string'&&/^<[^<>\s]+>$/.test(x));
if(m.in_reply_to&&/^<[^<>\s]+>$/.test(m.in_reply_to))headers.push('In-Reply-To: '+m.in_reply_to);
if(refs.length)headers.push('References: '+[...new Set(refs)].slice(-20).join(' '));
const body=Buffer.from(String(m.body_text??''),'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
const raw=Buffer.from(headers.join('\r\n')+'\r\n\r\n'+body).toString('base64url');
return [{json:{message_id:m.id,mime_message_id:messageId,recipient:m.to_address,search_query:'in:sent to:'+m.to_address,send_body:{raw,...(m.gmail_thread_id?{threadId:m.gmail_thread_id}:{})}}}];"""
sent_candidates = r"""const b=$input.first().json.body??{};
if(b.nextPageToken)throw new Error('Mehr als 100 gesendete Kandidaten: manuelle Versandprüfung erforderlich, kein erneuter Versand');
const messages=b.messages??[];return messages.length?messages.map(m=>({json:{candidate_id:m.id},pairedItem:{item:0}})):[{json:{skip_candidate:true},pairedItem:{item:0}}];"""
sent_match = r"""const meta=$('MIME mit stabiler Nachrichten-ID').item.json;const matches=[];
for(const item of $input.all()){if(item.json.skip_candidate)continue;const b=item.json.body;
if(item.json.statusCode!==200||!b?.id||!Array.isArray(b.payload?.headers))throw new Error('Gmail-Versandprüfung unvollständig: kein erneuter Versand');
const header=name=>b.payload.headers.find(h=>String(h.name).toLowerCase()===name)?.value??'';
const recipient=header('to').toLowerCase().includes(meta.recipient.toLowerCase());
const identity=header('x-rheinwerk-message-id')===meta.message_id||[meta.mime_message_id,'<'+meta.message_id+'@rheinwerk-dashboard>'].includes(header('message-id'));
if(recipient&&identity)matches.push({id:b.id,threadId:b.threadId});}
if(matches.length>1)throw new Error('Mehrere Gmail-Versände mit derselben internen ID: manuelle Prüfung erforderlich');
return [{json:{body:{messages:matches}},pairedItem:{item:0}}];"""
delivery = r"""const r=$input.first().json;const meta=$('MIME mit stabiler Nachrichten-ID').item.json;const b=r.body??r;
const ok=r.statusCode>=200&&r.statusCode<300&&typeof b.id==='string'&&typeof b.threadId==='string';
const actualMime=b.payload?.headers?.find(h=>String(h.name).toLowerCase()==='message-id')?.value;
return [{json:{...meta,ok,confirmation:{message_id:meta.message_id,mailbox_key:'rheinwerk.industrieservice@gmail.com',gmail_message_id:b.id??null,gmail_thread_id:b.threadId??null,mime_message_id:actualMime??meta.mime_message_id,sent_at:new Date().toISOString()},failure:{message_id:meta.message_id,permanent:r.statusCode===400,error_text:String(b.error?.message??r.error?.message??'Gmail delivery outcome unknown').slice(0,1000)}}}];"""
out = [
 node('schedule','Freigegebene E-Mails jede Minute','n8n-nodes-base.scheduleTrigger',1.4,{'rule':{'interval':[{'field':'minutes','minutesInterval':1}]}},kind='trigger'),
 gmail_http('profile','Versandpostfach prüfen','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile',output={'body':{'emailAddress':MAILBOX}}),
 code('mailbox','Versandpostfach bestätigen',verify,{'mailbox_verified':True}),
 rpc('claim','Freigegebene Nachrichten reservieren','claim_queued_messages','{{ {batch_limit:5,lease_seconds:600} }}',{'id':'00000000-0000-4000-8000-000000000001','direction':'outgoing','status':'queued','approved_by':'dispatcher','approved_at':'2026-10-08T12:00:00Z'}),
 node('loop','Nachrichten einzeln versenden','n8n-nodes-base.splitInBatches',3,{'batchSize':1},kind='splitInBatches'),
 code('mime','MIME mit stabiler Nachrichten-ID',mime,{'message_id':'example','mime_message_id':'<example@rheinwerk-service.online>','recipient':'customer@example.com','search_query':'in:sent to:customer@example.com','send_body':{'raw':'example'}}),
 gmail_http('search','Bereits gesendete Nachricht suchen','GET','https://gmail.googleapis.com/gmail/v1/users/me/messages',query=[{'name':'q','value':e('{{ $json.search_query }}')},{'name':'maxResults','value':'100'}],output={'body':{'messages':[]}}),
 code('candidates','Versandkandidaten vorbereiten',sent_candidates,{'candidate_id':'gmail-example','skip_candidate':False}),
 gate('hascandidate','Versandkandidat vorhanden?','{{ $json.skip_candidate !== true }}'),
 gmail_http('candidate','Versandkandidat laden','GET',e("{{ 'https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent($json.candidate_id) }}"),query=[{'name':'format','value':'metadata'}],output={'statusCode':200,'body':{'id':'gmail-example','payload':{'headers':[]}}}),
 code('matchsent','Interne Versand-ID abgleichen',sent_match,{'body':{'messages':[]}}),
 gate('exists','Versand bereits nachgewiesen?','{{ ($json.body.messages ?? []).length > 0 }}'),
 gmail_http('found','Bestehenden Versand nachlesen','GET',e("{{ 'https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent($json.body.messages?.[0]?.id ?? $json.body.id) }}"),query=[{'name':'format','value':'metadata'}],soft=True,output={'statusCode':200,'body':{'id':'gmail-example','threadId':'thread-example'}}),
 gmail_http('send','Freigegebene E-Mail senden','POST','https://gmail.googleapis.com/gmail/v1/users/me/messages/send',body="{{ $('MIME mit stabiler Nachrichten-ID').item.json.send_body }}",soft=True,output={'statusCode':200,'body':{'id':'gmail-example','threadId':'thread-example'}}),
 gate('accepted','Gmail-Versand angenommen?','{{ $json.statusCode >= 200 && $json.statusCode < 300 && typeof $json.body?.id === "string" }}'),
 code('delivery','Gmail-Ergebnis auswerten',delivery,{'ok':True,'confirmation':{'message_id':'example'},'failure':{'message_id':'example'}}),
 gate('ok','Versand bestätigt?','{{ $json.ok === true }}'),
 rpc('confirm','Bestätigten Versand speichern','confirm_message_sent','{{ $json.confirmation }}'),
 rpc('failure','Versandfehler für Wiederholung speichern','mark_message_failed','{{ $json.failure }}'),
]
save('rheinwerk-gmail-send','RheinWerk · Gmail Versand',out,'.add(schedule).to(profile).to(mailbox).to(claim).to(loop.onEachBatch(mime.to(search).to(candidates).to(hascandidate.onTrue(candidate.to(matchsent)).onFalse(matchsent)).to(exists.onTrue(found.to(delivery)).onFalse(send.to(accepted.onTrue(found).onFalse(delivery)))))).add(delivery).to(ok.onTrue(confirm.to(nextBatch(loop))).onFalse(failure.to(nextBatch(loop))))')

incoming = r"""const item=$('Eingehende E-Mails einzeln').item;const m=item.json;const h=m.headers??{};
const header=n=>{let v=Array.isArray(h)?h.find(x=>String(x.name).toLowerCase()===n)?.value:h[n]??h[n.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];return typeof v==='string'?v:v?.text??'';};
const from=m.from?.value?.[0]?.address??m.from?.address??header('from')??'';const address=String(from).match(/<([^<>]+)>/)?.[1]??String(from).trim();
const references=m.references??header('references');const refs=Array.isArray(references)?references:String(references??'').match(/<[^<>\s]+>/g)??[];
if(!m.id||!address)throw new Error('Gmail-Nachrichtenidentität fehlt');
let text=m.text??m.bodyText??'';if(!text&&m.html)text=String(m.html).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const p={contract_version:'1.0',mailbox_key:'rheinwerk.industrieservice@gmail.com',gmail_message_id:m.id,gmail_thread_id:m.threadId,mime_message_id:m.messageId??header('message-id')??null,in_reply_to:m.inReplyTo??header('in-reply-to')??null,references_header:refs,from_address:address,subject:m.subject??header('subject')??'',body_text:String(text),received_at:m.date?new Date(m.date).toISOString():new Date().toISOString()};
return [{json:{payload:p},binary:item.binary}];"""
prepare = r"""const message=$input.first().json;const original=$('Gmail-Antwort normalisieren').item;const all=Object.entries(original.binary??{});const warnings=[];const files=[];
for(const [i,[key,b]] of all.entries()){if(i>=3){warnings.push('Mehr als drei E-Mail-Anhänge');continue;}if(!['application/pdf','image/jpeg','image/png'].includes(b.mimeType)){warnings.push('Nicht unterstützter Anhang: '+(b.fileName??key));continue;}
const name=String(b.fileName??key).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,140);files.push({json:{message_id:message.id,request_id:message.request_id,mime_type:b.mimeType,file_name:b.fileName??key,storage_path:'messages/'+message.id+'/'+i+'_'+name,skip_file:false,warnings},binary:{data:b}});}
if(!files.length)return [{json:{message_id:message.id,request_id:message.request_id,skip_file:true,warnings}}];return files;"""
verify_incoming = r"""const item=$input.first();const b=await this.helpers.getBinaryDataBuffer(0,'data');const m=item.json;const t=m.mime_type;
const magic=t==='application/pdf'?b.subarray(0,5).toString()==='%PDF-':t==='image/png'?b.subarray(0,8).toString('hex')==='89504e470d0a1a0a':t==='image/jpeg'?b[0]===255&&b[1]===216:false;
if(b.length<1||b.length>5242880||!magic)return [{json:{...m,skip_file:true,warnings:[...m.warnings,'Dateityp oder Größe ungültig: '+m.file_name]}}];
return [{json:{...m,size_bytes:b.length},binary:item.binary}];"""
uploadcheck = r"""const r=$input.first().json;const m=$('Gmail-Dateiinhalt prüfen').item.json;const ok=(r.statusCode>=200&&r.statusCode<300)||r.statusCode===409||String(r.body?.statusCode)==='409';if(!ok)throw new Error('Gmail-Anhang konnte nicht gespeichert werden');return [{json:m}];"""
finish = r"""const m=$('Gmail-Nachricht speichern und zuordnen').item.json;const warnings=[...new Set($input.all().flatMap(x=>x.json.warnings??[]))];return [{json:{message_id:m.id,warnings}}];"""
inc = [
 node('start','Neue Gmail-Antwort','n8n-nodes-base.gmailTrigger',1.4,{'authentication':'oAuth2','pollTimes':{'item':[{'mode':'everyMinute'}]},'event':'messageReceived','simple':False,'maxResults':5,'filters':{'q':'in:inbox -from:'+MAILBOX,'readStatus':'both','includeSpamTrash':False,'includeDrafts':False},'options':{'downloadAttachments':True,'dataPropertyAttachmentsPrefixName':'attachment_'}},GMAIL,kind='trigger',output={'id':'gmail-example','threadId':'thread-example','text':'Antwort','from':{'value':[{'address':'customer@example.com'}]}}),
 node('mailloop','Eingehende E-Mails einzeln','n8n-nodes-base.splitInBatches',3,{'batchSize':1},kind='splitInBatches'),
 gmail_http('profile','Empfangspostfach prüfen','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile',output={'body':{'emailAddress':MAILBOX}}),
 code('mailbox','Empfangspostfach bestätigen',verify,{'mailbox_verified':True}),
 code('normalize','Gmail-Antwort normalisieren',incoming,{'payload':{'contract_version':'1.0'}}),
 rpc('record','Gmail-Nachricht speichern und zuordnen','record_incoming_message','{{ {payload:$json.payload} }}',{'id':'message-example','request_id':'request-example','ignored':False}),
 gate('valid','Verarbeitbare Nachricht?','{{ $json.ignored !== true && !!$json.id }}'),
 code('files','Gmail-Anhänge vorbereiten',prepare,{'message_id':'message-example','storage_path':'messages/example/photo.png','mime_type':'image/png','skip_file':False,'warnings':[]}),
 node('fileloop','Gmail-Anhänge einzeln','n8n-nodes-base.splitInBatches',3,{'batchSize':1},kind='splitInBatches'),
 gate('hasfile','Gmail-Anhang vorhanden?','{{ $json.skip_file !== true }}'),
 code('verify','Gmail-Dateiinhalt prüfen',verify_incoming,{'skip_file':False,'storage_path':'messages/example/photo.png','mime_type':'image/png','file_name':'photo.png','size_bytes':100}),
 gate('fileok','Gmail-Anhang gültig?','{{ $json.skip_file !== true }}'),
 node('upload','Gmail-Anhang privat speichern','n8n-nodes-base.httpRequest',4.5,{'method':'POST','url':e("{{ 'http://host.docker.internal:54321/storage/v1/object/dashboard/'+$json.storage_path.split('/').map(encodeURIComponent).join('/') }}"),'authentication':'predefinedCredentialType','nodeCredentialType':'supabaseApi','sendHeaders':True,'headerParameters':{'parameters':[{'name':'Content-Type','value':e('{{ $json.mime_type }}')}]},'sendBody':True,'contentType':'binaryData','inputDataFieldName':'data','options':{'timeout':30000,'response':{'response':{'responseFormat':'json','fullResponse':True,'neverError':True}}}},SUPA),
 code('uploadcheck','Gmail-Dateiübertragung bestätigen',uploadcheck,{'message_id':'example','file_name':'photo.png','mime_type':'image/png','size_bytes':100,'storage_path':'messages/example/photo.png'}),
 rpc('register','Gmail-Anhang registrieren','register_incoming_attachment','{{ {message_id:$json.message_id,file_name:$json.file_name,mime_type:$json.mime_type,size_bytes:$json.size_bytes,storage_path:$json.storage_path} }}'),
 code('registered','Gmail-Anhang abgeschlossen',"return [{json:$('Gmail-Dateiinhalt prüfen').item.json}];",{'warnings':[]}),
 code('finish','Eingang vollständig vorbereiten',finish,{'message_id':'message-example','warnings':[]}),
 rpc('complete','Antwort für Analyse freigeben','complete_incoming_message','{{ $json }}'),
]
inc += [
 node('sweep','Verpasste Antworten alle 15 Minuten','n8n-nodes-base.scheduleTrigger',1.4,{'rule':{'interval':[{'field':'minutes','minutesInterval':15}]}},kind='trigger'),
 gmail_http('sweepprofile','Postfach für verpasste Antworten prüfen','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile',output={'body':{'emailAddress':MAILBOX}}),
 code('sweepguard','Postfach für verpasste Antworten bestätigen',verify,{'mailbox_verified':True}),
 node('sweepmail','RIS-Antworten der letzten 7 Tage laden','n8n-nodes-base.gmail',2.2,{'resource':'message','operation':'getAll','authentication':'oAuth2','returnAll':False,'limit':100,'simple':False,'filters':{'q':'in:inbox -from:'+MAILBOX+' newer_than:7d subject:RIS','readStatus':'both','includeSpamTrash':False},'options':{'downloadAttachments':True,'dataPropertyAttachmentsPrefixName':'attachment_'}},GMAIL,output={'id':'gmail-example','from':{'value':[{'address':'customer@example.com'}]},'text':'Antwort'}),
 node('recovery','Unvollständige Antworten alle 5 Minuten','n8n-nodes-base.scheduleTrigger',1.4,{'rule':{'interval':[{'field':'minutes','minutesInterval':5}]}},kind='trigger'),
 gmail_http('recoveryprofile','Wiederherstellungspostfach prüfen','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile',output={'body':{'emailAddress':MAILBOX}}),
 code('recoveryguard','Wiederherstellungspostfach bestätigen',verify,{'mailbox_verified':True}),
 rpc('pending','Unvollständige Antworten laden','list_incomplete_incoming','{{ {batch_limit:5} }}',{'gmail_message_id':'gmail-example'}),
 node('reload','Gmail-Antwort erneut laden','n8n-nodes-base.gmail',2.2,{'resource':'message','operation':'get','authentication':'oAuth2','messageId':e('{{ $json.gmail_message_id }}'),'simple':False,'options':{'downloadAttachments':True,'dataPropertyAttachmentsPrefixName':'attachment_'}},GMAIL,output={'id':'gmail-example','from':{'value':[{'address':'customer@example.com'}]},'text':'Antwort'})
]
save('rheinwerk-gmail-receive','RheinWerk · Gmail Eingang',inc,'.add(start).to(mailloop.onEachBatch(profile.to(mailbox).to(normalize).to(record).to(valid.onTrue(files).onFalse(nextBatch(mailloop))))).add(files).to(fileloop.onEachBatch(hasfile.onTrue(verify).onFalse(nextBatch(fileloop))).onDone(finish)).add(verify).to(fileok.onTrue(upload.to(uploadcheck).to(register).to(registered).to(nextBatch(fileloop))).onFalse(nextBatch(fileloop))).add(finish).to(complete).to(nextBatch(mailloop)).add(recovery).to(recoveryprofile).to(recoveryguard).to(pending).to(reload).to(mailloop).add(sweep).to(sweepprofile).to(sweepguard).to(sweepmail).to(mailloop)')
