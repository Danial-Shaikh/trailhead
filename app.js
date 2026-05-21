/* ============================================================
   Trailhead — Job Hunt Assistant
   Single-file, offline-first. All data lives in your browser.
   No accounts, no servers, no API keys.
   ============================================================ */

/* ---------- Tiny helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const el = (tag, attrs={}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k==='class') n.className=v;
    else if (k==='html') n.innerHTML=v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v!=null) n.setAttribute(k,v);
  }
  for (const kid of kids.flat()){ if(kid!=null) n.append(kid.nodeType?kid:document.createTextNode(kid)); }
  return n;
};
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-CA',{year:'numeric',month:'short',day:'numeric'}) : '—';
const daysSince = d => d ? Math.floor((Date.now()-new Date(d))/864e5) : null;
const todayISO = () => new Date().toISOString().slice(0,10);

/* ---------- Toast ---------- */
function toast(msg, type='ok'){
  const icon = type==='err'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
  const t = el('div',{class:`toast ${type}`,html:icon+`<span>${esc(msg)}</span>`});
  $('#toasts').append(t);
  setTimeout(()=>{t.style.animation='slideIn .25s reverse';setTimeout(()=>t.remove(),240)},3200);
}

/* ============================================================
   DATA LAYER — IndexedDB
   ============================================================ */
const DB = {
  name:'trailhead', ver:1, db:null,
  stores:['jobs','templates','docs','meta'],
  async open(){
    return new Promise((res,rej)=>{
      const r = indexedDB.open(this.name,this.ver);
      r.onupgradeneeded = e=>{
        const db=e.target.result;
        this.stores.forEach(s=>{ if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'}); });
      };
      r.onsuccess=e=>{this.db=e.target.result;res()};
      r.onerror=e=>rej(e);
    });
  },
  _tx(store,mode='readonly'){ return this.db.transaction(store,mode).objectStore(store); },
  all(store){ return new Promise((res,rej)=>{ const rq=this._tx(store).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=rej; }); },
  put(store,obj){ return new Promise((res,rej)=>{ const rq=this._tx(store,'readwrite').put(obj); rq.onsuccess=()=>res(obj); rq.onerror=rej; }); },
  del(store,id){ return new Promise((res,rej)=>{ const rq=this._tx(store,'readwrite').delete(id); rq.onsuccess=()=>res(); rq.onerror=rej; }); },
  get(store,id){ return new Promise((res,rej)=>{ const rq=this._tx(store).get(id); rq.onsuccess=()=>res(rq.result); rq.onerror=rej; }); },
  clear(store){ return new Promise((res,rej)=>{ const rq=this._tx(store,'readwrite').clear(); rq.onsuccess=()=>res(); rq.onerror=rej; }); }
};

/* App state */
const State = {
  jobs:[], templates:[], docs:[],
  settings:{ followDays:7, name:'', email:'', phone:'' },
  view:'dashboard', activeTemplate:null, lastLetter:'',
  filter:'all', search:'', sortKey:'dateApplied', sortDir:-1, preJob:null
};

const STATUSES = ['Wishlist','Applied','Interview','Offer','Rejected','Ghosted'];
const STATUS_CLASS = {Wishlist:'b-wishlist',Applied:'b-applied',Interview:'b-interview',Offer:'b-offer',Rejected:'b-rejected',Ghosted:'b-ghosted'};

async function loadAll(){
  await DB.open();
  State.jobs = await DB.all('jobs');
  State.templates = await DB.all('templates');
  State.docs = await DB.all('docs');
  const s = await DB.get('meta','settings');
  if (s) State.settings = {...State.settings, ...s.data};
  if (!State.templates.length){
    const seed = {
      id:uid(), name:'Standard Cover Letter',
      body:`Dear Hiring Manager at {{company}},\n\nI'm excited to apply for the {{role}} position. With my background in {{your field}}, I believe I can make a strong contribution to your team.\n\nIn my previous work I {{key achievement}}, and I'm particularly drawn to {{company}} because {{why this company}}.\n\nI'd welcome the chance to discuss how my experience aligns with what you're looking for. Thank you for your time and consideration.\n\nSincerely,\n{{your name}}`,
      created: Date.now()
    };
    await DB.put('templates',seed);
    State.templates=[seed];
  }
}

async function saveSettings(){ await DB.put('meta',{id:'settings',data:State.settings}); }

/* ============================================================
   ICONS
   ============================================================ */
const I = {
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  wand:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18 9l-1.5-1.5M18 3l-1.5 1.5M4 20l9-9M14 7l3 3"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  external:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5z"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>',
  data:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>'
};

/* ============================================================
   ROUTER
   ============================================================ */
const VIEWS = {
  dashboard:{title:'Dashboard', sub:'Your job search at a glance', render:renderDashboard},
  tracker:{title:'Applications', sub:'Every job, tracked in one place', render:renderTracker},
  followups:{title:'Follow-ups', sub:'Applications waiting on a reply', render:renderFollowups},
  letters:{title:'Cover Letters', sub:'Reusable templates that fill in for each job', render:renderLetters},
  docs:{title:'Documents', sub:'Your resumes and supporting files', render:renderDocs},
  settings:{title:'Settings', sub:'Your details and your data', render:renderSettings}
};

function go(view){
  State.view=view;
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===view));
  $('#pageTitle').textContent = VIEWS[view].title;
  $('#pageSub').textContent = VIEWS[view].sub;
  $('#topActions').innerHTML='';
  VIEWS[view].render();
}

function refreshBadges(){
  $('#navCount').textContent = State.jobs.length;
  const due = followupsDue();
  const nf = $('#navFollow');
  if (due.length){ nf.style.display=''; nf.textContent=due.length; }
  else nf.style.display='none';
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const c=$('#content'); c.innerHTML='';
  const jobs=State.jobs;
  const count = s => jobs.filter(j=>j.status===s).length;
  const active = jobs.filter(j=>!['Rejected','Ghosted'].includes(j.status)).length;
  const responded = jobs.filter(j=>['Interview','Offer','Rejected'].includes(j.status)).length;
  const appliedTotal = jobs.filter(j=>j.status!=='Wishlist').length;
  const rate = appliedTotal ? Math.round(responded/appliedTotal*100) : 0;

  const grid = el('div',{class:'stat-grid'});
  const stat=(cls,label,val,foot)=>el('div',{class:`stat ${cls}`},
    el('div',{class:'stat-label'},label),
    el('div',{class:'stat-value'},String(val)),
    el('div',{class:'stat-foot'},foot));
  grid.append(
    stat('','Total Logged',jobs.length, `${active} still active`),
    stat('s-blue','Applied',count('Applied'), 'awaiting response'),
    stat('s-amber','Interviewing',count('Interview'), count('Offer')?`+${count('Offer')} offer(s)`:'in the pipeline'),
    stat('s-green','Response Rate',rate+'%', `${responded} of ${appliedTotal}`)
  );
  c.append(grid);

  const cols=el('div',{class:'split',style:'grid-template-columns:1fr 1fr;gap:22px'});

  const funnel=el('div',{class:'panel'});
  funnel.append(el('div',{class:'panel-head'},el('div',{class:'panel-title'},'Pipeline')));
  const fbody=el('div',{style:'padding:18px 22px'});
  const max=Math.max(1,...STATUSES.map(count));
  STATUSES.forEach(s=>{
    const v=count(s); const pct=Math.round(v/max*100);
    const row=el('div',{style:'display:flex;align-items:center;gap:12px;margin-bottom:13px'});
    row.append(
      el('span',{class:`badge ${STATUS_CLASS[s]}`,style:'min-width:104px'},s),
      el('div',{style:'flex:1;height:9px;background:var(--paper-2);border-radius:5px;overflow:hidden'},
        el('div',{style:`height:100%;width:${pct}%;background:var(--accent-soft);border-radius:5px;transition:width .5s`})),
      el('span',{style:'font-family:IBM Plex Mono,monospace;font-size:14px;min-width:24px;text-align:right'},String(v))
    );
    fbody.append(row);
  });
  funnel.append(fbody);

  const due=followupsDue().slice(0,6);
  const fu=el('div',{class:'panel'});
  fu.append(el('div',{class:'panel-head'},
    el('div',{class:'panel-title'},'Needs a follow-up'),
    el('button',{class:'btn btn-ghost btn-sm',style:'margin-left:auto',onClick:()=>go('followups')},'View all')));
  if (!due.length){
    fu.append(el('div',{class:'empty',style:'padding:38px 20px'},
      el('div',{html:I.clock}),
      el('h3',{},'All caught up'),
      el('p',{},'No applications are overdue for a follow-up.')));
  } else {
    const list=el('div',{style:'padding:8px 0'});
    due.forEach(j=>{
      list.append(el('div',{style:'display:flex;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid #e6dcc9'},
        el('div',{style:'flex:1'},
          el('div',{style:'font-weight:500'},j.company),
          el('div',{style:'font-size:13px;color:var(--muted)'},j.role||'—')),
        el('span',{class:'follow-flag'},el('span',{html:I.clock}),`${daysSince(j.dateApplied)}d`)
      ));
    });
    fu.append(list);
  }
  cols.append(funnel,fu);
  c.append(cols);

  const top=$('#topActions');
  top.append(el('button',{class:'btn btn-primary',html:I.plus+'<span>Add application</span>',onClick:()=>openJobModal()}));
}

/* ============================================================
   TRACKER
   ============================================================ */
function filteredJobs(){
  let list=[...State.jobs];
  if (State.filter!=='all') list=list.filter(j=>j.status===State.filter);
  if (State.search){
    const q=State.search.toLowerCase();
    list=list.filter(j=>[j.company,j.role,j.location,j.notes].some(x=>(x||'').toLowerCase().includes(q)));
  }
  const k=State.sortKey, dir=State.sortDir;
  list.sort((a,b)=>{
    let av=a[k]??'', bv=b[k]??'';
    if (k.startsWith('date')){ av=av?new Date(av):0; bv=bv?new Date(bv):0; }
    else { av=String(av).toLowerCase(); bv=String(bv).toLowerCase(); }
    return av<bv?-1*dir:av>bv?1*dir:0;
  });
  return list;
}

function renderTracker(){
  const c=$('#content'); c.innerHTML='';
  const top=$('#topActions');
  top.append(
    el('button',{class:'btn btn-ghost',html:I.wand+'<span>Quick paste</span>',title:'Paste a job posting and auto-fill',onClick:openQuickPaste}),
    el('button',{class:'btn btn-ghost',html:I.download+'<span>Excel</span>',onClick:exportExcel}),
    el('button',{class:'btn btn-primary',html:I.plus+'<span>Add</span>',onClick:()=>openJobModal()})
  );

  const tb=el('div',{class:'toolbar'});
  const search=el('div',{class:'search',html:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.9"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>'});
  const sInput=el('input',{type:'text',placeholder:'Search company, role, notes…',value:State.search,
    oninput:e=>{State.search=e.target.value; renderTableBody();}});
  search.append(sInput);
  const pills=el('div',{class:'filter-pills'});
  ['all',...STATUSES].forEach(f=>{
    pills.append(el('button',{class:'pill'+(State.filter===f?' active':''),
      onClick:()=>{State.filter=f; renderTracker();}}, f==='all'?'All':f));
  });
  tb.append(search,pills);
  c.append(tb);

  const panel=el('div',{class:'panel'});
  const wrap=el('div',{class:'table-wrap'});
  const table=el('table');
  const cols=[['company','Company / Role'],['status','Status'],['location','Location'],
    ['salary','Salary'],['dateApplied','Applied'],['followup','Follow-up'],['link','Link'],['',''] ];
  const thead=el('thead'); const tr=el('tr');
  cols.forEach(([key,label])=>{
    const th=el('th',{},label);
    if (key){
      const arrow=el('span',{class:'arrow'}, State.sortKey===key?(State.sortDir===1?' ▲':' ▼'):' ⇅');
      th.append(arrow);
      th.onclick=()=>{ if(State.sortKey===key)State.sortDir*=-1; else{State.sortKey=key;State.sortDir=1;} renderTracker(); };
    }
    tr.append(th);
  });
  thead.append(tr); table.append(thead);
  const tbody=el('tbody',{id:'jobBody'}); table.append(tbody);
  wrap.append(table); panel.append(wrap); c.append(panel);
  renderTableBody();
}

function renderTableBody(){
  const tbody=$('#jobBody'); if(!tbody) return;
  tbody.innerHTML='';
  const list=filteredJobs();
  if (!list.length){
    tbody.append(el('tr',{},el('td',{colspan:8},
      el('div',{class:'empty'},
        el('div',{html:I.inbox}),
        el('h3',{},State.jobs.length?'No matches':'No applications yet'),
        el('p',{},State.jobs.length?'Try a different search or filter.':'Click “Add” or “Quick paste” to log your first job.')))));
    return;
  }
  list.forEach(j=>{
    const fdays=daysSince(j.dateApplied);
    const due = j.status==='Applied' && fdays!=null && fdays>=State.settings.followDays;
    const followCell = j.status==='Applied'
      ? (due ? el('span',{class:'follow-flag'},el('span',{html:I.clock}),`due (${fdays}d)`)
             : el('span',{class:'follow-ok'},fdays!=null?`in ${State.settings.followDays-fdays}d`:'—'))
      : el('span',{class:'follow-ok'},'—');

    const tr=el('tr');
    tr.append(
      el('td',{class:'co-cell'}, j.company, el('span',{class:'role'},j.role||'—')),
      el('td',{}, el('span',{class:`badge ${STATUS_CLASS[j.status]}`}, j.status)),
      el('td',{}, j.location||'—'),
      el('td',{}, j.salary||'—'),
      el('td',{}, fmtDate(j.dateApplied)),
      el('td',{}, followCell),
      el('td',{class:'link-cell'}, j.link?el('a',{href:j.link,target:'_blank',rel:'noopener',html:I.external}):'—'),
      el('td',{}, el('div',{class:'row-actions'},
        el('button',{class:'btn-icon btn-ghost',title:'Cover letter',html:I.wand,onClick:()=>{State.preJob=j; go('letters');}}),
        el('button',{class:'btn-icon btn-ghost',title:'Edit',html:I.edit,onClick:()=>openJobModal(j)}),
        el('button',{class:'btn-icon btn-ghost',title:'Delete',html:I.trash,onClick:()=>delJob(j)})
      ))
    );
    tbody.append(tr);
  });
}

async function delJob(j){
  if(!confirm(`Delete the ${j.role||'role'} at ${j.company}?`)) return;
  await DB.del('jobs',j.id);
  State.jobs=State.jobs.filter(x=>x.id!==j.id);
  refreshBadges(); renderTableBody(); toast('Application deleted');
}

/* ---------- Job modal ---------- */
function openJobModal(job){
  const isEdit=!!job;
  const j = job || {id:uid(),status:'Applied',dateApplied:todayISO()};
  const m=$('#modal');
  m.classList.remove('wide');
  m.innerHTML='';
  m.append(
    el('div',{class:'modal-head'},
      el('h2',{},isEdit?'Edit application':'New application'),
      el('button',{class:'close',html:closeIcon(),onClick:closeModal})),
  );
  const body=el('div',{class:'modal-body'});
  const f=(label,key,opts={})=>{
    const wrap=el('div',{class:'field'+(opts.full?' field-full':'')});
    wrap.append(el('label',{},label));
    let input;
    if(opts.type==='select'){ input=el('select',{id:'jf_'+key}); opts.options.forEach(o=>input.append(el('option',{value:o,...(j[key]===o?{selected:''}:{})},o))); }
    else if(opts.type==='textarea'){ input=el('textarea',{id:'jf_'+key,placeholder:opts.ph||''}, j[key]||''); }
    else { input=el('input',{id:'jf_'+key,type:opts.type||'text',placeholder:opts.ph||'',value:j[key]||''}); }
    wrap.append(input);
    if(opts.hint) wrap.append(el('div',{class:'hint'},opts.hint));
    return wrap;
  };
  const row1=el('div',{class:'field-row'}); row1.append(f('Company','company'),f('Role / Title','role'));
  const row2=el('div',{class:'field-row'}); row2.append(
    f('Status','status',{type:'select',options:STATUSES}),
    f('Date applied','dateApplied',{type:'date'}));
  const row3=el('div',{class:'field-row'}); row3.append(f('Location','location',{ph:'Remote / Toronto…'}),f('Salary','salary',{ph:'$90k–110k'}));
  body.append(row1,row2,row3,
    f('Job posting link','link',{full:true,type:'url',ph:'https://…'}),
    f('Job description','description',{full:true,type:'textarea',ph:'Paste the job description here',hint:'Handy to keep on file when you prep for interviews.'}),
    f('Notes','notes',{full:true,type:'textarea',ph:'Recruiter name, referral, interview prep, anything to remember…'})
  );
  m.append(body);
  m.append(el('div',{class:'modal-foot'},
    el('button',{class:'btn btn-ghost',onClick:closeModal},'Cancel'),
    el('button',{class:'btn btn-primary',html:(isEdit?'Save changes':'Add application'),onClick:async()=>{
      const get=k=>$('#jf_'+k).value.trim();
      if(!get('company')){ toast('Company is required','err'); return; }
      Object.assign(j,{
        company:get('company'),role:get('role'),status:get('status'),
        dateApplied:get('dateApplied'),location:get('location'),salary:get('salary'),
        link:get('link'),description:get('description'),notes:get('notes'),
        updated:Date.now()
      });
      if(!isEdit) j.created=Date.now();
      await DB.put('jobs',j);
      if(!isEdit) State.jobs.push(j);
      closeModal(); refreshBadges(); renderTracker(); toast(isEdit?'Saved':'Application added');
    }})
  ));
  openModal();
}

/* ---------- Quick paste: heuristic auto-fill ---------- */
function openQuickPaste(){
  const m=$('#modal'); m.classList.remove('wide'); m.innerHTML='';
  m.append(el('div',{class:'modal-head'},
    el('h2',{},'Quick paste a posting'),
    el('button',{class:'close',html:closeIcon(),onClick:closeModal})));
  const body=el('div',{class:'modal-body'});
  body.append(
    el('div',{class:'field'},
      el('label',{},'Job posting link (optional)'),
      el('input',{id:'qp_link',type:'url',placeholder:'https://…'})),
    el('div',{class:'field'},
      el('label',{},'Paste the whole job posting'),
      el('textarea',{id:'qp_text',style:'min-height:200px',placeholder:'Paste the job title, company, location and description here. The fields get auto-detected — you can fix anything before saving.'}),
      el('div',{class:'hint'},'Detection is best-effort. Always double-check before saving.'))
  );
  m.append(body);
  m.append(el('div',{class:'modal-foot'},
    el('button',{class:'btn btn-ghost',onClick:closeModal},'Cancel'),
    el('button',{class:'btn btn-primary',html:I.wand+'<span>Detect &amp; review</span>',onClick:()=>{
      const text=$('#qp_text').value; const link=$('#qp_link').value.trim();
      const guess=parsePosting(text);
      closeModal();
      openJobModal({id:uid(),status:'Applied',dateApplied:todayISO(),link,description:text.trim(),...guess});
    }})
  ));
  openModal();
}

function parsePosting(text){
  const out={};
  if(!text) return out;
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const titleRe=/\b(engineer|developer|designer|manager|analyst|scientist|lead|director|intern|specialist|coordinator|consultant|architect|administrator|associate|officer|representative|technician|writer|marketer|recruiter|accountant|nurse|teacher)\b/i;
  out.role = (lines.find(l=>titleRe.test(l)&&l.length<80)||lines[0]||'').replace(/\s*[-–|].*$/,'').trim();
  let m = text.match(/\bat\s+([A-Z][\w.&'’ -]{1,40})/);
  if(!m) m = text.match(/company[:\s]+([A-Z][\w.&'’ -]{1,40})/i);
  if(m) out.company = m[1].replace(/\s+(is|are|we|seeks|in|on|for)$/i,'').trim();
  const loc = text.match(/\b(remote|hybrid|on-?site)\b/i) || text.match(/\b([A-Z][a-z]+,\s?(?:[A-Z]{2}|[A-Z][a-z]+))\b/);
  if(loc) out.location = loc[0];
  const sal = text.match(/\$\s?\d{2,3}[\d,]*\s?(?:k|,000)?(?:\s?[-–to]+\s?\$?\s?\d{2,3}[\d,]*\s?(?:k|,000)?)?/i);
  if(sal) out.salary = sal[0].replace(/\s+/g,' ').trim();
  return out;
}

/* ============================================================
   FOLLOW-UPS
   ============================================================ */
function followupsDue(){
  const d=State.settings.followDays;
  return State.jobs.filter(j=>j.status==='Applied' && daysSince(j.dateApplied)>=d)
    .sort((a,b)=>new Date(a.dateApplied)-new Date(b.dateApplied));
}

function renderFollowups(){
  const c=$('#content'); c.innerHTML='';
  const due=followupsDue();
  const upcoming=State.jobs.filter(j=>j.status==='Applied'&&daysSince(j.dateApplied)<State.settings.followDays)
    .sort((a,b)=>new Date(a.dateApplied)-new Date(b.dateApplied));

  const intro=el('div',{style:'margin-bottom:22px;color:var(--ink-soft)'},
    `Showing applications still marked “Applied”. Anything past `,
    el('span',{class:'tag'},State.settings.followDays+' days'),
    ` without a status change is flagged. Change the window in Settings.`);
  c.append(intro);

  const section=(title,items,due)=>{
    const panel=el('div',{class:'panel',style:'margin-bottom:22px'});
    panel.append(el('div',{class:'panel-head'},
      el('div',{class:'panel-title'},title),
      el('span',{class:'tag',style:'margin-left:auto'},items.length+'')));
    if(!items.length){
      panel.append(el('div',{class:'empty',style:'padding:34px'},el('h3',{},'Nothing here'),el('p',{},'')));
      return panel;
    }
    items.forEach(j=>{
      const dd=daysSince(j.dateApplied);
      const row=el('div',{style:'display:flex;align-items:center;gap:14px;padding:15px 22px;border-bottom:1px solid #e6dcc9'});
      row.append(
        el('div',{style:'flex:1;min-width:0'},
          el('div',{style:'font-weight:500'},j.company,'  ',el('span',{style:'color:var(--muted);font-weight:400;font-size:14px'},'· '+(j.role||'—'))),
          el('div',{style:'font-size:13px;color:var(--muted);margin-top:2px'},`Applied ${fmtDate(j.dateApplied)} · ${dd} days ago`)),
        due?el('span',{class:'follow-flag'},el('span',{html:I.clock}),'follow up'):el('span',{class:'follow-ok'},`in ${State.settings.followDays-dd}d`),
        el('button',{class:'btn btn-ghost btn-sm',onClick:()=>{ j.status='Interview'; markStatus(j); }},'Mark replied'),
        el('button',{class:'btn-icon btn-ghost',title:'Edit',html:I.edit,onClick:()=>openJobModal(j)})
      );
      panel.append(row);
    });
    return panel;
  };
  c.append(section('Due now',due,true));
  c.append(section('Coming up',upcoming,false));
}

async function markStatus(j){ await DB.put('jobs',j); refreshBadges(); renderFollowups(); toast(`Moved ${j.company} to ${j.status}`); }

/* ============================================================
   COVER LETTERS  (template fill — no AI, fully offline)
   ============================================================ */
function placeholdersIn(body){
  const set=new Set();
  (body.match(/\{\{(.*?)\}\}/g)||[]).forEach(p=>set.add(p.slice(2,-2).trim()));
  return [...set];
}
// Values we can fill automatically from the job + your profile
function autoValues(ctx){
  return {
    company:ctx.company, role:ctx.role,
    'your name':State.settings.name||'',
    'your email':State.settings.email||'',
    'your phone':State.settings.phone||'',
    date:fmtDate(todayISO())
  };
}

function renderLetters(){
  const c=$('#content'); c.innerHTML='';
  const top=$('#topActions');
  top.append(el('button',{class:'btn btn-ghost',html:I.upload+'<span>Upload template</span>',onClick:uploadTemplate}),
             el('button',{class:'btn btn-primary',html:I.plus+'<span>New template</span>',onClick:()=>openTemplateModal()}));

  if(!State.activeTemplate && State.templates.length) State.activeTemplate=State.templates[0].id;

  const split=el('div',{class:'split'});

  // Left: template list
  const left=el('div',{});
  left.append(el('div',{style:'font-family:IBM Plex Mono,monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:12px'},'Your templates'));
  const list=el('div',{class:'tpl-list'});
  if(!State.templates.length){
    list.append(el('div',{class:'empty',style:'padding:30px 14px'},el('h3',{},'No templates'),el('p',{},'Upload or create one to get started.')));
  }
  State.templates.forEach(t=>{
    const card=el('div',{class:'tpl-card'+(State.activeTemplate===t.id?' active':''),onClick:()=>{State.activeTemplate=t.id; State.lastLetter=''; renderLetters();}});
    card.append(el('h4',{},t.name),el('p',{},t.body.replace(/\{\{.*?\}\}/g,'…').slice(0,120)));
    card.append(el('div',{style:'display:flex;align-items:center;gap:8px;margin-top:10px'},
      el('span',{class:'tpl-meta'},`${placeholdersIn(t.body).length} fields`),
      el('button',{class:'btn-icon btn-ghost',style:'margin-left:auto;padding:5px',html:I.edit,onClick:e=>{e.stopPropagation();openTemplateModal(t);}}),
      el('button',{class:'btn-icon btn-ghost',style:'padding:5px',html:I.trash,onClick:async e=>{e.stopPropagation(); if(confirm('Delete this template?')){await DB.del('templates',t.id);State.templates=State.templates.filter(x=>x.id!==t.id);if(State.activeTemplate===t.id)State.activeTemplate=null;renderLetters();}}})
    ));
    list.append(card);
  });
  left.append(list);

  // Right: fill-in form + output
  const right=el('div',{});
  const tpl=State.templates.find(t=>t.id===State.activeTemplate);

  const genPanel=el('div',{class:'panel',style:'margin-bottom:18px'});
  genPanel.append(el('div',{class:'panel-head'},el('div',{class:'panel-title'},'Fill in for a job')));
  const gp=el('div',{style:'padding:18px 20px'});

  // resolve which job is selected BEFORE building the dropdown
  if(State.preJob){ State._clJob=State.preJob.id; State.preJob=null; }
  if(State._clJob===undefined) State._clJob='';

  const jobSel=el('select',{id:'cl_job',style:'width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--card);margin-bottom:14px',
    onchange:e=>{ State._clJob=e.target.value; renderLetters(); }});
  jobSel.append(el('option',{value:''},'— Pick a saved application —'));
  State.jobs.forEach(j=>jobSel.append(el('option',{value:j.id,...(State._clJob===j.id?{selected:''}:{})},`${j.company} — ${j.role||'role'}`)));
  jobSel.append(el('option',{value:'__manual',...(State._clJob==='__manual'?{selected:''}:{})},'✎ Enter company & role manually'));
  gp.append(el('label',{style:'font-family:IBM Plex Mono,monospace;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px'},'Target job'),jobSel);
  jobSel.value = State._clJob || '';

  let ctx={company:'',role:''};
  if(State._clJob==='__manual'){
    const mr=el('div',{class:'field-row'});
    mr.append(
      el('div',{class:'field'},el('label',{},'Company'),el('input',{id:'cl_company',value:State._clCompany||'',oninput:e=>{State._clCompany=e.target.value;}})),
      el('div',{class:'field'},el('label',{},'Role'),el('input',{id:'cl_role',value:State._clRole||'',oninput:e=>{State._clRole=e.target.value;}})));
    gp.append(mr);
    ctx={company:State._clCompany||'the company',role:State._clRole||'the role'};
  } else if(State._clJob){
    const j=State.jobs.find(x=>x.id===State._clJob);
    if(j) ctx={company:j.company,role:j.role||'the role'};
  }

  // Dynamic fill-in fields for placeholders not auto-filled
  if(tpl){
    const auto=autoValues(ctx);
    const extra=placeholdersIn(tpl.body).filter(p=>!(p.toLowerCase() in auto) && !['company','role'].includes(p.toLowerCase()));
    if(extra.length){
      gp.append(el('div',{style:'font-family:IBM Plex Mono,monospace;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin:6px 0 10px'},'Fill in the blanks'));
      State._clFields=State._clFields||{};
      extra.forEach(p=>{
        const id='clf_'+p.replace(/\W/g,'_');
        gp.append(el('div',{class:'field'},
          el('label',{},p),
          el('input',{id,value:State._clFields[p]||'',placeholder:`Your ${p}…`,oninput:e=>{State._clFields[p]=e.target.value;}})));
      });
    }
    gp.append(el('button',{class:'btn btn-primary',html:I.wand+'<span>Fill letter</span>',onClick:()=>fillLetter(tpl)}));
  } else {
    gp.append(el('div',{style:'color:var(--muted)'},'Create or pick a template on the left to begin.'));
  }
  genPanel.append(gp);
  right.append(genPanel);

  const out=el('div',{class:'gen-out'+(State.lastLetter?'':' placeholder'),id:'cl_out'});
  if(State.lastLetter){ out.textContent=State.lastLetter; }
  else out.append(el('div',{html:I.wand}),el('div',{},'Your finished letter will appear here.'),el('div',{style:'font-size:13px'},'Pick a template, choose a job, fill any blanks, then hit “Fill letter”.'));
  right.append(out);
  const outActions=el('div',{style:'display:flex;gap:10px;margin-top:14px'});
  outActions.append(
    el('button',{class:'btn btn-ghost',html:I.copy+'<span>Copy</span>',onClick:()=>{ if(State.lastLetter){navigator.clipboard.writeText(State.lastLetter);toast('Copied to clipboard');} }}),
    el('button',{class:'btn btn-ghost',html:I.download+'<span>Download .txt</span>',onClick:()=>{ if(State.lastLetter) downloadFile('cover-letter.txt',State.lastLetter); }})
  );
  right.append(outActions);

  split.append(left,right);
  c.append(split);
}

function currentCtx(){
  if(State._clJob==='__manual') return {company:State._clCompany||'the company',role:State._clRole||'the role'};
  if(State._clJob){ const j=State.jobs.find(x=>x.id===State._clJob); if(j) return {company:j.company,role:j.role||'the role'}; }
  return {company:'the company',role:'the role'};
}

function fillLetter(tpl){
  const ctx=currentCtx();
  const auto=autoValues(ctx);
  const fields=State._clFields||{};
  let missing=[];
  const text=tpl.body.replace(/\{\{(.*?)\}\}/g,(_,raw)=>{
    const k=raw.trim(); const low=k.toLowerCase();
    if(low in auto && auto[low]) return auto[low];
    if(fields[k]) return fields[k];
    missing.push(k);
    return `[${k}]`;
  });
  State.lastLetter=text;
  const out=$('#cl_out'); out.classList.remove('placeholder'); out.textContent=text;
  if(missing.length) toast(`Filled — ${missing.length} blank(s) left as [brackets]`);
  else toast('Letter ready');
}

function openTemplateModal(t){
  const isEdit=!!t; const tpl=t||{id:uid(),name:'',body:''};
  const m=$('#modal'); m.classList.add('wide'); m.innerHTML='';
  m.append(el('div',{class:'modal-head'},el('h2',{},isEdit?'Edit template':'New template'),
    el('button',{class:'close',html:closeIcon(),onClick:closeModal})));
  const body=el('div',{class:'modal-body'});
  body.append(
    el('div',{class:'field'},el('label',{},'Template name'),el('input',{id:'tp_name',value:tpl.name,placeholder:'e.g. Software Engineer — warm tone'})),
    el('div',{class:'field'},el('label',{},'Template body'),
      el('textarea',{id:'tp_body',style:'min-height:300px',placeholder:'Write your cover letter. Use {{double braces}} for anything that changes per job.'},tpl.body),
      el('div',{class:'hint'},'Auto-filled fields: ',
        el('span',{class:'placeholder-tag'},'{{company}}'),' ',
        el('span',{class:'placeholder-tag'},'{{role}}'),' ',
        el('span',{class:'placeholder-tag'},'{{your name}}'),' ',
        el('span',{class:'placeholder-tag'},'{{your email}}'),'. ',
        'Any other {{thing}} you add becomes a quick fill-in box.'))
  );
  m.append(body);
  m.append(el('div',{class:'modal-foot'},
    el('button',{class:'btn btn-ghost',onClick:closeModal},'Cancel'),
    el('button',{class:'btn btn-primary',html:isEdit?'Save':'Create',onClick:async()=>{
      tpl.name=$('#tp_name').value.trim()||'Untitled template';
      tpl.body=$('#tp_body').value;
      if(!isEdit) tpl.created=Date.now();
      await DB.put('templates',tpl);
      if(!isEdit) State.templates.push(tpl);
      State.activeTemplate=tpl.id; State._clFields={};
      closeModal(); renderLetters(); toast(isEdit?'Template saved':'Template created');
    }})));
  openModal();
}

function uploadTemplate(){
  const inp=el('input',{type:'file',accept:'.txt,.md,.text',style:'display:none'});
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    const text=await file.text();
    const t={id:uid(),name:file.name.replace(/\.[^.]+$/,''),body:text,created:Date.now()};
    await DB.put('templates',t); State.templates.push(t); State.activeTemplate=t.id;
    renderLetters(); toast('Template uploaded');
  };
  inp.click();
}

/* ============================================================
   DOCUMENTS
   ============================================================ */
function renderDocs(){
  const c=$('#content'); c.innerHTML='';
  const top=$('#topActions');
  top.append(el('button',{class:'btn btn-primary',html:I.upload+'<span>Upload document</span>',onClick:uploadDoc}));
  c.append(el('div',{style:'margin-bottom:20px;color:var(--ink-soft)'},
    'Store resumes, portfolios, and reference letters here. Files are saved ',
    el('span',{class:'tag'},'in your browser'),' — they never upload anywhere.'));
  if(!State.docs.length){
    c.append(el('div',{class:'panel'},el('div',{class:'empty'},
      el('div',{html:I.doc}),el('h3',{},'No documents yet'),
      el('p',{},'Upload your resume or portfolio to keep everything in one place.'))));
    return;
  }
  const grid=el('div',{class:'doc-grid'});
  State.docs.forEach(d=>{
    const card=el('div',{class:'doc-card'});
    card.append(
      el('div',{class:'doc-icon',html:I.doc}),
      el('h4',{},d.name),
      el('div',{class:'doc-type'},`${d.ext||'file'} · ${fmtBytes(d.size)}`),
      el('div',{class:'doc-actions'},
        el('button',{class:'btn btn-ghost btn-sm',html:I.download+'<span>Download</span>',onClick:()=>downloadDoc(d)}),
        el('button',{class:'btn-icon btn-ghost',html:I.trash,title:'Delete',onClick:async()=>{ if(confirm('Delete '+d.name+'?')){await DB.del('docs',d.id);State.docs=State.docs.filter(x=>x.id!==d.id);renderDocs();toast('Deleted');} }}))
    );
    grid.append(card);
  });
  c.append(grid);
}

function uploadDoc(){
  const inp=el('input',{type:'file',accept:'.pdf,.doc,.docx,.txt,.md,.rtf,.png,.jpg,.jpeg',style:'display:none'});
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    if(file.size>8*1024*1024){ toast('File too large (max 8 MB for browser storage)','err'); return; }
    const data=await fileToBase64(file);
    const d={id:uid(),name:file.name,ext:(file.name.split('.').pop()||'').toUpperCase(),size:file.size,type:file.type,data,created:Date.now()};
    await DB.put('docs',d); State.docs.push(d); renderDocs(); toast('Document saved');
  };
  inp.click();
}
function downloadDoc(d){ const a=el('a',{href:d.data,download:d.name}); a.click(); }
function fmtBytes(b){ if(b<1024)return b+' B'; if(b<1048576)return (b/1024).toFixed(0)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function fileToBase64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings(){
  const c=$('#content'); c.innerHTML='';
  const wrap=el('div',{class:'set-section'});

  const me=el('div',{class:'set-block'});
  me.append(el('h3',{html:I.user+'<span>Your details</span>'}),
    el('div',{class:'desc'},'Used to auto-fill cover letters — the {{your name}}, {{your email}}, and {{your phone}} fields.'));
  me.append(
    el('div',{class:'field-row'},
      el('div',{class:'field'},el('label',{},'Full name'),el('input',{id:'set_name',value:State.settings.name})),
      el('div',{class:'field'},el('label',{},'Email'),el('input',{id:'set_email',value:State.settings.email}))),
    el('div',{class:'field'},el('label',{},'Phone (optional)'),el('input',{id:'set_phone',value:State.settings.phone})),
    el('div',{class:'field'},el('label',{},'Follow-up reminder window (days)'),
      el('input',{id:'set_days',type:'number',min:1,max:60,value:State.settings.followDays,style:'max-width:120px'}),
      el('div',{class:'hint'},'Applications still marked “Applied” after this many days get flagged.')),
    el('button',{class:'btn btn-primary',onClick:async()=>{
      State.settings.name=$('#set_name').value.trim();
      State.settings.email=$('#set_email').value.trim();
      State.settings.phone=$('#set_phone').value.trim();
      State.settings.followDays=Math.max(1,parseInt($('#set_days').value)||7);
      await saveSettings(); refreshBadges(); toast('Details saved');
    }},'Save details'));
  wrap.append(me);

  const data=el('div',{class:'set-block'});
  data.append(el('h3',{html:I.data+'<span>Your data</span>'}),
    el('div',{class:'desc'},'Everything lives in this browser. Back it up or move it to another device with export / import.'));
  data.append(el('div',{style:'display:flex;gap:10px;flex-wrap:wrap'},
    el('button',{class:'btn btn-ghost',html:I.download+'<span>Export Excel (.xlsx)</span>',onClick:exportExcel}),
    el('button',{class:'btn btn-ghost',html:I.download+'<span>Backup (.json)</span>',onClick:exportJSON}),
    el('button',{class:'btn btn-ghost',html:I.upload+'<span>Import backup</span>',onClick:importJSON}),
    el('button',{class:'btn btn-ghost',style:'color:var(--rose)',html:I.trash+'<span>Erase everything</span>',onClick:wipeAll})
  ));
  wrap.append(data);

  c.append(wrap);
}

/* ============================================================
   EXPORTS / IMPORT
   ============================================================ */
function exportExcel(){
  if(!State.jobs.length){ toast('No applications to export','err'); return; }
  const rows=State.jobs.map(j=>({
    Company:j.company,Role:j.role||'',Status:j.status,
    'Date Applied':j.dateApplied||'',Location:j.location||'',Salary:j.salary||'',
    'Follow-up due (days)':j.status==='Applied'&&daysSince(j.dateApplied)!=null?Math.max(0,State.settings.followDays-daysSince(j.dateApplied)):'',
    Link:j.link||'',Notes:(j.notes||'').replace(/\n/g,' '),
    'Job Description':(j.description||'').replace(/\n/g,' ').slice(0,500)
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:22},{wch:26},{wch:12},{wch:13},{wch:16},{wch:14},{wch:16},{wch:34},{wch:40},{wch:50}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Applications');
  XLSX.writeFile(wb,`job-applications-${todayISO()}.xlsx`);
  toast('Excel file downloaded');
}
function exportJSON(){
  const dump={version:1,exported:new Date().toISOString(),jobs:State.jobs,templates:State.templates,docs:State.docs,settings:State.settings};
  downloadFile(`trailhead-backup-${todayISO()}.json`,JSON.stringify(dump,null,2));
  toast('Backup downloaded');
}
function importJSON(){
  const inp=el('input',{type:'file',accept:'.json',style:'display:none'});
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    try{
      const data=JSON.parse(await file.text());
      if(!confirm('Import will merge this backup into your current data. Continue?')) return;
      for(const j of (data.jobs||[])){ await DB.put('jobs',j); }
      for(const t of (data.templates||[])){ await DB.put('templates',t); }
      for(const d of (data.docs||[])){ await DB.put('docs',d); }
      if(data.settings){ State.settings={...State.settings,...data.settings}; await saveSettings(); }
      await loadAll(); refreshBadges(); go('tracker'); toast('Backup imported');
    }catch(e){ toast('Invalid backup file','err'); }
  };
  inp.click();
}
async function wipeAll(){
  if(!confirm('This permanently erases ALL applications, templates, and documents from this browser. This cannot be undone. Continue?')) return;
  if(!confirm('Are you absolutely sure?')) return;
  await Promise.all(['jobs','templates','docs'].map(s=>DB.clear(s)));
  State.jobs=[];State.templates=[];State.docs=[];State.activeTemplate=null;State.lastLetter='';
  await loadAll(); refreshBadges(); go('dashboard'); toast('Everything erased');
}
function downloadFile(name,text){ const blob=new Blob([text],{type:'text/plain'}); const a=el('a',{href:URL.createObjectURL(blob),download:name}); a.click(); URL.revokeObjectURL(a.href); }

/* ============================================================
   MODAL utils
   ============================================================ */
function closeIcon(){ return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'; }
function openModal(){ $('#overlay').classList.add('show'); }
function closeModal(){ $('#overlay').classList.remove('show'); }

/* ============================================================
   INIT
   ============================================================ */
$('#overlay').addEventListener('click',e=>{ if(e.target===$('#overlay')) closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
$$('.nav-item').forEach(n=>n.addEventListener('click',()=>go(n.dataset.view)));

(async()=>{
  try{ await loadAll(); }
  catch(e){ toast('Storage init failed — data may not persist','err'); }
  refreshBadges();
  if(navigator.storage?.estimate){
    const {usage}=await navigator.storage.estimate();
    $('#footStorage').textContent=usage?`${fmtBytes(usage)} stored`:'';
  }
  go('dashboard');
})();
