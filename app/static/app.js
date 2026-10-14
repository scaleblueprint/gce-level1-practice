let BOOT=null, ACTIVE=null, QUESTIONS=[], LABS=[], qIndex=0, labIndex=0, timerHandle=null;
const byId=id=>document.getElementById(id);

function view(id){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));byId(id).classList.add('active')}

class ApiError extends Error{constructor(message,status,data){super(message);this.status=status;this.data=data}}
async function api(url,opts={}){
  const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
  let data=null;
  const type=r.headers.get('content-type')||'';
  try{data=type.includes('application/json')?await r.json():await r.text()}catch(_){data=null}
  if(!r.ok){
    const message=(data&&typeof data==='object'&&(data.error||data.detail))||(typeof data==='string'&&data)||'Something went wrong. Please try again.';
    throw new ApiError(message,r.status,data);
  }
  return data;
}

function notify(title,message,kind='info'){
  let box=byId('appnotice');
  if(!box){box=document.createElement('div');box.id='appnotice';document.querySelector('main').prepend(box)}
  box.className='appnotice '+kind;
  box.innerHTML=`<div><b>${title}</b><div>${message}</div></div><button aria-label="Dismiss" onclick="this.parentElement.remove()">×</button>`;
  box.scrollIntoView({behavior:'smooth',block:'start'});
}

async function load(){
  BOOT=await api('/api/bootstrap');QUESTIONS=BOOT.questions;LABS=BOOT.labs;ACTIVE=BOOT.active;
  renderDashboard();renderHistory();
  if(ACTIVE){renderExam();startTimer()}else{clearInterval(timerHandle)}
}

function renderDashboard(){
  let h=BOOT.history||[],a=ACTIVE;
  byId('dashcards').innerHTML=`
    <div class="card"><div class="muted">Active attempt</div><div class="big">${a?a.mock_label:'None'}</div>
      <p>${a?`You have ${fmt(a.remaining_seconds)} remaining. Resume it or reset it to start again.`:'No active exam.'}</p>
      ${a?`<div class="row"><button class="primary" onclick="view('exam')">Resume</button><button class="danger" onclick="resetActiveAttempt()">Reset attempt</button></div>`:''}
    </div>
    <div class="card"><div class="muted">Completed attempts</div><div class="big">${h.length}</div></div>
    <div class="card"><div class="muted">Latest score</div><div class="big">${h[0]?.composite_pct!=null?h[0].composite_pct+'%':'—'}</div></div>`;
}

async function startAttempt(labelOverride=null){
  const label=(labelOverride||byId('mockLabel').value).replace('Mock ','');
  if(ACTIVE){
    notify('Attempt already in progress',`You already have ${ACTIVE.mock_label} in progress. Resume it, or use “Reset attempt” if you want to start over. Your saved answers will not be lost unless you reset.`,'warning');
    renderDashboard();view('dashboard');return;
  }
  try{
    ACTIVE=await api('/api/attempts',{method:'POST',body:JSON.stringify({label})});
    BOOT.active=ACTIVE;qIndex=0;labIndex=0;renderDashboard();renderExam();startTimer();view('exam');
    notify('Mock started',`${ACTIVE.mock_label} has started. Your answers are saved automatically.`,'success');
  }catch(e){
    if(e.status===409&&e.data?.attempt){
      ACTIVE=e.data.attempt;BOOT.active=ACTIVE;renderDashboard();renderExam();startTimer();view('dashboard');
      notify('Attempt already in progress',`You already have ${ACTIVE.mock_label} in progress. Resume it or reset it before starting another mock.`,'warning');
      return;
    }
    notify('Could not start the mock',e.message,'error');
  }
}

async function resetActiveAttempt(){
  if(!ACTIVE)return;
  if(!confirm(`Reset ${ACTIVE.mock_label}? This will clear all saved answers and lab work for this active attempt and restart the 3-hour timer.`))return;
  try{
    ACTIVE=await api(`/api/attempts/${ACTIVE.id}/reset`,{method:'POST'});
    BOOT.active=ACTIVE;qIndex=0;labIndex=0;renderDashboard();renderExam();startTimer();view('exam');
    notify('Attempt reset',`${ACTIVE.mock_label} has been reset. The timer is back to 3 hours and all previous answers for this active attempt were cleared.`,'success');
  }catch(e){notify('Could not reset the attempt',e.message,'error')}
}

async function retake(label){
  if(ACTIVE){
    notify('Finish or reset the active attempt first',`You currently have ${ACTIVE.mock_label} in progress. Resume it, or reset it before starting a retake.`,'warning');
    renderDashboard();view('dashboard');return;
  }
  await startAttempt(label);
}

function startTimer(){
  clearInterval(timerHandle);
  timerHandle=setInterval(()=>{
    if(!ACTIVE)return;
    ACTIVE.remaining_seconds=Math.max(0,ACTIVE.remaining_seconds-1);
    let e=byId('timer');if(e)e.textContent=fmt(ACTIVE.remaining_seconds);
    if(ACTIVE.remaining_seconds===0){clearInterval(timerHandle);finish(true)}
  },1000)
}
function fmt(s){let h=String(Math.floor(s/3600)).padStart(2,'0'),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),ss=String(s%60).padStart(2,'0');return `${h}:${m}:${ss}`}

function renderExam(){
  if(!ACTIVE){byId('exambox').innerHTML='<div class="card">No active attempt. Start a mock from the dashboard.</div>';return}
  let onLabs=qIndex>=37;if(onLabs){renderLabs();return}
  let q=QUESTIONS[ACTIVE.question_ids[qIndex]],ans=ACTIVE.answers[String(qIndex)]||[];let nav='';
  for(let i=0;i<37;i++)nav+=`<button class="${(ACTIVE.answers[String(i)]||[]).length?'done':''}" onclick="qIndex=${i};renderExam()">${i+1}</button>`;
  byId('exambox').innerHTML=`<div class="examgrid"><aside class="card side"><div class="timer" id="timer">${fmt(ACTIVE.remaining_seconds)}</div><div class="muted">Time remaining</div><hr><div class="qnav">${nav}</div><hr><button onclick="qIndex=37;renderExam()">Go to labs</button><button class="danger" style="margin-top:8px;width:100%" onclick="resetActiveAttempt()">Reset attempt</button></aside><div class="card"><div class="muted">${q.domain} • Question ${qIndex+1}/37</div><h2>${q.q}</h2><div>${q.choices.map((c,i)=>`<label class="choice"><input type="${q.multi?'checkbox':'radio'}" name="ans" value="${i}" ${ans.includes(i)?'checked':''} onchange="answerChanged(${q.multi})">${String.fromCharCode(65+i)}. ${c}</label>`).join('')}</div><label><input id="flag" type="checkbox" ${ACTIVE.flags[String(qIndex)]?'checked':''} onchange="saveAnswer()"> Flag for review</label><div class="row" style="margin-top:15px"><button onclick="if(qIndex>0){qIndex--;renderExam()}">Previous</button><button class="primary" onclick="saveAnswer().then(()=>{if(qIndex<36){qIndex++;renderExam()}else{qIndex=37;renderExam()}}).catch(handleSaveError)">Save & Next</button></div></div></div>`
}
function answerChanged(multi){if(!multi){document.querySelectorAll('input[name=ans]').forEach(x=>{if(!x.checked)x.checked=false})}saveAnswer().catch(handleSaveError)}
function handleSaveError(e){notify('Could not save your answer',e.message,'error')}
async function saveAnswer(){if(qIndex>=37)return;let answer=[...document.querySelectorAll('input[name=ans]:checked')].map(x=>Number(x.value)),flag=!!byId('flag')?.checked;ACTIVE.answers[String(qIndex)]=answer;ACTIVE.flags[String(qIndex)]=flag;await api(`/api/attempts/${ACTIVE.id}/answer`,{method:'PATCH',body:JSON.stringify({index:qIndex,answer,flag})})}

function labById(id){return LABS.find(x=>x.id===id)}
function renderLabs(){let id=ACTIVE.lab_ids[labIndex],lab=labById(id),s=ACTIVE.lab_states[id]||{};let tabs=ACTIVE.lab_ids.map((x,i)=>`<button class="${i===labIndex?'primary':''}" onclick="labIndex=${i};renderLabs()">${i+1}. ${labById(x).name}</button>`).join('');byId('exambox').innerHTML=`<div class="labgrid"><aside class="card side"><div class="timer" id="timer">${fmt(ACTIVE.remaining_seconds)}</div><div class="row">${tabs}</div><hr>${lab.tasks.map((t,i)=>`<div class="task">${i+1}. ${t}</div>`).join('')}<button class="primary" onclick="saveLab()">Save lab</button><button style="margin-top:8px" class="green" onclick="finish()">Finish exam</button><button style="margin-top:8px" class="danger" onclick="resetActiveAttempt()">Reset attempt</button><hr><button onclick="qIndex=36;renderExam()">Back to questions</button></aside><div class="card"><h2>${lab.title}</h2>${labForm(id,s)}</div></div>`}
function labForm(id,s){let f=(k,l,v='')=>`<div class="field"><label>${l}</label><input id="lab_${k}" value="${s[k]??v}"></div>`,sel=(k,l,opts)=>`<div class="field"><label>${l}</label><select id="lab_${k}"><option></option>${opts.map(x=>`<option ${s[k]===x?'selected':''}>${x}</option>`).join('')}</select></div>`;
if(id==='drive')return f('folder','Folder name')+f('doc','Document name')+f('studentEmail','Student/group email')+sel('studentRole','Student role',['Viewer','Commenter','Editor'])+f('teacherEmail','Co-teacher email')+sel('teacherRole','Co-teacher role',['Viewer','Commenter','Editor']);
if(id==='classroom')return f('title','Assignment title')+`<div class="field"><label>Due date</label><input id="lab_due" type="date" value="${s.due??''}"></div>`+sel('attachment','Attachment',['Reflection Template','Reading Notes','Project Rubric'])+sel('attachmentMode','Attachment setting',['Students can view file','Students can edit file','Make a copy for each student']);
if(id==='calendar')return f('title','Event title')+sel('repeat','Repeats',['Does not repeat','Daily','Weekly','Monthly'])+`<label><input id="lab_meet" type="checkbox" ${s.meet?'checked':''}> Add Google Meet</label>`+f('guest','Guest email');
if(id==='gmail')return f('search','Gmail search')+f('label','Label name')+f('filterFrom','Filter from')+f('filterLabel','Apply label');
if(id==='forms')return f('title','Form title')+`<label><input id="lab_quiz" type="checkbox" ${s.quiz?'checked':''}> Quiz mode</label>`+f('question','Question')+`<label><input id="lab_required" type="checkbox" ${s.required?'checked':''}> Required</label>`+f('choices','Choices, comma-separated');
if(id==='sheets')return sel('sort','Sort',['Student A→Z','Student Z→A','Rating high→low'])+sel('filter','Filter class',['5A','5B','All'])+f('average','Average rating')+sel('chart','Chart type',['Column chart','Pie chart','Scatter chart']);
return ''}
async function saveLab(){try{let id=ACTIVE.lab_ids[labIndex],els=[...document.querySelectorAll('[id^=lab_]')],state={};els.forEach(el=>state[el.id.replace('lab_','')]=el.type==='checkbox'?el.checked:el.value);ACTIVE.lab_states[id]=state;let r=await api(`/api/attempts/${ACTIVE.id}/lab/${id}`,{method:'PATCH',body:JSON.stringify(state)});notify('Lab saved',`${r.score.passed}/4 tasks are currently correct in this practice simulation.`,'success')}catch(e){notify('Could not save the lab',e.message,'error')}}
async function finish(auto=false){if(!ACTIVE)return;if(!auto&&!confirm('Finish and score this attempt?'))return;try{if(!auto)await saveOpenState();ACTIVE=await api(`/api/attempts/${ACTIVE.id}/finish`,{method:'POST'});clearInterval(timerHandle);notify('Mock completed',`Questions: ${ACTIVE.question_pct}% • Labs: ${ACTIVE.lab_pct}%`,'success');ACTIVE=null;await load();view('history')}catch(e){notify('Could not finish the mock',e.message,'error')}}
async function saveOpenState(){if(qIndex<37)await saveAnswer();else await saveLab()}

function renderHistory(){
  let h=BOOT.history||[];
  byId('historybox').innerHTML=h.length?h.map(x=>{
    const label=(x.mock_label||'Mock A').replace('Mock ','');
    return `<div class="card"><b>${x.mock_label}</b> • ${new Date(x.started_at).toLocaleString()}<div class="row"><span>Questions ${x.question_pct}%</span><span>Labs ${x.lab_pct}%</span><span><b>Practice composite ${x.composite_pct}%</b></span><button onclick="review(${x.id})">Review</button><button class="primary" onclick="retake('${label}')">Retake ${x.mock_label}</button></div></div>`
  }).join(''):'<p class="muted">No completed attempts yet.</p>'
}
async function review(id){try{let r=await api(`/api/attempts/${id}/review`);byId('historybox').innerHTML+=`<div class="card"><h2>Review</h2><div class="grid3">${Object.entries(r.domains).map(([d,v])=>`<div class="card"><b>${d}</b><div class="big">${v.correct}/${v.total}</div></div>`).join('')}</div><h3>Missed questions</h3>${r.missed.length?r.missed.map(m=>`<div class="bad"><b>Q${m.number}. ${m.question}</b><br><span class="muted">Correct: ${m.answer.map(a=>String.fromCharCode(65+a)+'. '+m.choices[a]).join(' | ')}</span><br>${m.explanation}</div>`).join(''):'<div class="good">No missed questions.</div>'}</div>`}catch(e){notify('Could not open review',e.message,'error')}}

load().catch(e=>notify('Could not load your account',e.message,'error'));
