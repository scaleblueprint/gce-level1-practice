'use strict';

var BOOT = null;
var ACTIVE = null;
var QUESTIONS = [];
var LABS = [];
var qIndex = 0;
var labIndex = 0;
var timerHandle = null;

function byId(id) {
  return document.getElementById(id);
}

function showView(id) {
  var target = byId(id);
  if (!target) return;
  document.querySelectorAll('.page').forEach(function (el) {
    el.classList.remove('active');
  });
  target.classList.add('active');
  if (id === 'exam') renderExam();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.view = showView;

function ApiError(message, status, data) {
  this.name = 'ApiError';
  this.message = message;
  this.status = status;
  this.data = data;
}
ApiError.prototype = Object.create(Error.prototype);

async function api(url, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  var requestOptions = Object.assign({}, opts, { headers: headers });
  var response = await fetch(url, requestOptions);
  var data = null;
  var type = response.headers.get('content-type') || '';
  try {
    data = type.indexOf('application/json') >= 0 ? await response.json() : await response.text();
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    var message = 'Something went wrong. Please try again.';
    if (data && typeof data === 'object' && (data.error || data.detail)) message = data.error || data.detail;
    else if (typeof data === 'string' && data) message = data;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

function notify(title, message, kind) {
  kind = kind || 'info';
  var box = byId('appnotice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'appnotice';
    var main = document.querySelector('main');
    if (main) main.prepend(box);
  }
  box.className = 'appnotice ' + kind;
  box.innerHTML = '<div><b>' + title + '</b><div>' + message + '</div></div>' +
    '<button type="button" aria-label="Dismiss" onclick="this.parentElement.remove()">×</button>';
}

function safeWelcomeSeen(email) {
  try {
    var key = 'gce_welcome_seen:' + String(email || 'learner').toLowerCase();
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, '1');
    return false;
  } catch (_) {
    return false;
  }
}

function showWelcomeForNewLearner() {
  if (!BOOT || ACTIVE || (BOOT.history || []).length > 0) return;
  if (safeWelcomeSeen(BOOT.user && BOOT.user.email)) return;
  notify(
    'Welcome to Educator Level 1 Practice!',
    'Your account is ready. Start with the Exam Guide, revise in Study, then try a Mock Exam.' +
      '<div class="row" style="margin-top:10px">' +
      '<button type="button" onclick="view(\'guide\')">Read Exam Guide</button>' +
      '<button type="button" onclick="view(\'study\')">Open Study</button>' +
      '<button type="button" class="primary" onclick="view(\'dashboard\')">Dashboard</button>' +
      '</div>',
    'success'
  );
}

function fmt(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  var h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  var m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  var s = String(seconds % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

async function load() {
  try {
    BOOT = await api('/api/bootstrap');
    QUESTIONS = BOOT.questions || [];
    LABS = BOOT.labs || [];
    ACTIVE = BOOT.active || null;
    renderDashboard();
    renderHistory();
    renderExam();
    if (ACTIVE && !ACTIVE.is_paused) startTimer();
    else clearInterval(timerHandle);
    showWelcomeForNewLearner();
  } catch (e) {
    notify('Could not load your account', e.message || 'Please refresh and try again.', 'error');
    renderExam();
  }
}

function renderDashboard() {
  var host = byId('dashcards');
  if (!host || !BOOT) return;
  var history = BOOT.history || [];
  var a = ACTIVE;
  var activeActions = '';
  if (a) {
    if (a.is_paused) {
      activeActions = '<button type="button" class="primary" onclick="resumeExam()">Resume exam</button>';
    } else {
      activeActions = '<button type="button" class="primary" onclick="view(\'exam\')">Continue exam</button>' +
        '<button type="button" onclick="pauseExam()">Pause</button>';
    }
    activeActions += '<button type="button" class="danger" onclick="resetActiveAttempt()">Reset attempt</button>';
  }
  var activeText = 'No active exam.';
  if (a) activeText = a.is_paused ? 'Paused with ' + fmt(a.remaining_seconds) + ' remaining.' : 'You have ' + fmt(a.remaining_seconds) + ' remaining.';
  var latest = history.length && history[0].composite_pct != null ? history[0].composite_pct + '%' : '—';
  host.innerHTML =
    '<div class="card"><div class="muted">Active attempt</div><div class="big">' + (a ? a.mock_label : 'None') + '</div>' +
      '<p>' + activeText + '</p>' + (a ? '<div class="row">' + activeActions + '</div>' : '') + '</div>' +
    '<div class="card"><div class="muted">Completed attempts</div><div class="big">' + history.length + '</div></div>' +
    '<div class="card"><div class="muted">Latest score</div><div class="big">' + latest + '</div></div>';
}

function noActiveExamHtml() {
  return '<div class="card" style="max-width:760px;margin:0 auto">' +
    '<h2>Start a mock exam</h2>' +
    '<p class="muted">Choose a mock set. Each attempt contains 37 questions and 3 practice lab scenarios with a 3-hour timer.</p>' +
    '<div class="row">' +
      '<button type="button" class="primary" onclick="startAttempt(\'A\')">Start Mock A</button>' +
      '<button type="button" onclick="startAttempt(\'B\')">Start Mock B</button>' +
      '<button type="button" onclick="startAttempt(\'C\')">Start Mock C</button>' +
    '</div>' +
    '<p class="muted" style="margin-top:14px">Your answers save automatically. You can pause and resume a practice attempt.</p>' +
  '</div>';
}

async function startAttempt(labelOverride) {
  if (!BOOT) {
    notify('Please wait', 'Your account is still loading. Refresh the page if this message remains.', 'warning');
    return;
  }
  var selector = byId('mockLabel');
  var raw = labelOverride || (selector ? selector.value : 'A');
  var label = String(raw).replace('Mock ', '').toUpperCase();

  if (ACTIVE) {
    notify('Attempt already in progress', 'You already have ' + ACTIVE.mock_label + (ACTIVE.is_paused ? ' paused.' : ' in progress.') + ' Resume or reset it before starting another mock.', 'warning');
    renderDashboard();
    showView('dashboard');
    return;
  }

  try {
    ACTIVE = await api('/api/attempts', { method: 'POST', body: JSON.stringify({ label: label }) });
    BOOT.active = ACTIVE;
    qIndex = 0;
    labIndex = 0;
    renderDashboard();
    renderExam();
    startTimer();
    showView('exam');
    notify('Mock started', ACTIVE.mock_label + ' has started. Your answers are saved automatically.', 'success');
  } catch (e) {
    if (e.status === 409 && e.data && e.data.attempt) {
      ACTIVE = e.data.attempt;
      BOOT.active = ACTIVE;
      renderDashboard();
      renderExam();
      if (!ACTIVE.is_paused) startTimer();
      showView('exam');
      notify('Attempt already exists', 'Your existing ' + ACTIVE.mock_label + ' has been opened.', 'warning');
      return;
    }
    notify('Could not start the mock', e.message || 'Please try again.', 'error');
  }
}

async function pauseExam() {
  if (!ACTIVE || ACTIVE.is_paused) return;
  try {
    await saveOpenState();
    ACTIVE = await api('/api/attempts/' + ACTIVE.id + '/pause', { method: 'POST' });
    BOOT.active = ACTIVE;
    clearInterval(timerHandle);
    renderDashboard();
    renderExam();
    showView('exam');
    notify('Exam paused', ACTIVE.mock_label + ' is paused at ' + fmt(ACTIVE.remaining_seconds) + '.', 'success');
  } catch (e) {
    notify('Could not pause the exam', e.message || 'Please try again.', 'error');
  }
}

async function resumeExam() {
  if (!ACTIVE) return;
  if (!ACTIVE.is_paused) {
    showView('exam');
    return;
  }
  try {
    ACTIVE = await api('/api/attempts/' + ACTIVE.id + '/resume', { method: 'POST' });
    BOOT.active = ACTIVE;
    renderDashboard();
    renderExam();
    startTimer();
    showView('exam');
    notify('Exam resumed', 'The timer is running again. ' + fmt(ACTIVE.remaining_seconds) + ' remains.', 'success');
  } catch (e) {
    notify('Could not resume the exam', e.message || 'Please try again.', 'error');
  }
}

async function resetActiveAttempt() {
  if (!ACTIVE) return;
  if (!confirm('Reset ' + ACTIVE.mock_label + '? This clears all saved answers and lab work for this active attempt and restarts the 3-hour timer.')) return;
  try {
    ACTIVE = await api('/api/attempts/' + ACTIVE.id + '/reset', { method: 'POST' });
    BOOT.active = ACTIVE;
    qIndex = 0;
    labIndex = 0;
    renderDashboard();
    renderExam();
    startTimer();
    showView('exam');
    notify('Attempt reset', ACTIVE.mock_label + ' has been reset and the timer is back to 3 hours.', 'success');
  } catch (e) {
    notify('Could not reset the attempt', e.message || 'Please try again.', 'error');
  }
}

async function retake(label) {
  if (ACTIVE) {
    notify('Active attempt first', 'Finish or reset the current attempt before starting a retake.', 'warning');
    showView('dashboard');
    return;
  }
  await startAttempt(label);
}

function startTimer() {
  clearInterval(timerHandle);
  if (!ACTIVE || ACTIVE.is_paused) return;
  timerHandle = setInterval(function () {
    if (!ACTIVE || ACTIVE.is_paused) return;
    ACTIVE.remaining_seconds = Math.max(0, Number(ACTIVE.remaining_seconds || 0) - 1);
    var timer = byId('timer');
    if (timer) timer.textContent = fmt(ACTIVE.remaining_seconds);
    if (ACTIVE.remaining_seconds === 0) {
      clearInterval(timerHandle);
      finish(true);
    }
  }, 1000);
}

function renderPaused() {
  var box = byId('exambox');
  if (!box || !ACTIVE) return;
  box.innerHTML = '<div class="card" style="max-width:700px;margin:20px auto;text-align:center">' +
    '<div class="muted">' + ACTIVE.mock_label + '</div>' +
    '<h1 style="margin-bottom:8px">Exam paused</h1>' +
    '<div class="timer" style="font-size:34px;margin:16px 0">' + fmt(ACTIVE.remaining_seconds) + '</div>' +
    '<p class="muted">Your work is saved and the timer is frozen until you resume.</p>' +
    '<div class="row" style="justify-content:center;margin-top:18px">' +
      '<button type="button" class="primary" onclick="resumeExam()">Resume exam</button>' +
      '<button type="button" class="danger" onclick="resetActiveAttempt()">Reset attempt</button>' +
    '</div></div>';
}

function renderExam() {
  var box = byId('exambox');
  if (!box) return;
  if (!ACTIVE) {
    box.innerHTML = noActiveExamHtml();
    return;
  }
  if (ACTIVE.is_paused) {
    renderPaused();
    return;
  }
  if (qIndex >= 37) {
    renderLabs();
    return;
  }
  var qid = ACTIVE.question_ids[qIndex];
  var q = QUESTIONS[qid];
  if (!q) {
    box.innerHTML = '<div class="card"><h2>Could not load this question.</h2><p>Please refresh the page.</p></div>';
    return;
  }
  var ans = ACTIVE.answers[String(qIndex)] || [];
  var nav = '';
  for (var i = 0; i < 37; i++) {
    var done = (ACTIVE.answers[String(i)] || []).length ? 'done' : '';
    nav += '<button type="button" class="' + done + '" onclick="goQuestion(' + i + ')">' + (i + 1) + '</button>';
  }
  var choices = '';
  for (var c = 0; c < q.choices.length; c++) {
    var inputType = q.multi ? 'checkbox' : 'radio';
    var checked = ans.indexOf(c) >= 0 ? ' checked' : '';
    choices += '<label class="choice"><input type="' + inputType + '" name="ans" value="' + c + '"' + checked + ' onchange="answerChanged()">' + String.fromCharCode(65 + c) + '. ' + q.choices[c] + '</label>';
  }
  var flagged = ACTIVE.flags[String(qIndex)] ? ' checked' : '';
  box.innerHTML = '<div class="examgrid">' +
    '<aside class="card side">' +
      '<div class="timer" id="timer">' + fmt(ACTIVE.remaining_seconds) + '</div><div class="muted">Time remaining</div><hr>' +
      '<div class="qnav">' + nav + '</div><hr>' +
      '<button type="button" onclick="openLabs()">Go to labs</button>' +
      '<button type="button" style="margin-top:8px;width:100%" onclick="pauseExam()">Pause exam</button>' +
      '<button type="button" class="danger" style="margin-top:8px;width:100%" onclick="resetActiveAttempt()">Reset attempt</button>' +
    '</aside>' +
    '<div class="card">' +
      '<div class="muted">' + q.domain + ' • Question ' + (qIndex + 1) + '/37</div>' +
      '<h2>' + q.q + '</h2>' + choices +
      '<label><input id="flag" type="checkbox"' + flagged + ' onchange="saveAnswer()"> Flag for review</label>' +
      '<div class="row" style="margin-top:15px">' +
        '<button type="button" onclick="previousQuestion()">Previous</button>' +
        '<button type="button" class="primary" onclick="saveAndNext()">Save & Next</button>' +
      '</div>' +
    '</div></div>';
}

function goQuestion(index) {
  qIndex = index;
  renderExam();
}
function previousQuestion() {
  if (qIndex > 0) qIndex -= 1;
  renderExam();
}
function openLabs() {
  qIndex = 37;
  renderExam();
}
function answerChanged() {
  saveAnswer().catch(function (e) {
    notify('Could not save your answer', e.message || 'Please try again.', 'error');
  });
}
async function saveAndNext() {
  try {
    await saveAnswer();
    if (qIndex < 36) qIndex += 1;
    else qIndex = 37;
    renderExam();
  } catch (e) {
    notify('Could not save your answer', e.message || 'Please try again.', 'error');
  }
}
async function saveAnswer() {
  if (!ACTIVE || ACTIVE.is_paused || qIndex >= 37) return;
  var answer = Array.prototype.slice.call(document.querySelectorAll('input[name=ans]:checked')).map(function (el) {
    return Number(el.value);
  });
  var flag = !!(byId('flag') && byId('flag').checked);
  ACTIVE.answers[String(qIndex)] = answer;
  ACTIVE.flags[String(qIndex)] = flag;
  await api('/api/attempts/' + ACTIVE.id + '/answer', {
    method: 'PATCH',
    body: JSON.stringify({ index: qIndex, answer: answer, flag: flag })
  });
}

function labById(id) {
  for (var i = 0; i < LABS.length; i++) if (LABS[i].id === id) return LABS[i];
  return null;
}

function renderLabs() {
  if (!ACTIVE) return renderExam();
  if (ACTIVE.is_paused) return renderPaused();
  var id = ACTIVE.lab_ids[labIndex];
  var lab = labById(id);
  var box = byId('exambox');
  if (!lab || !box) return;
  var state = ACTIVE.lab_states[id] || {};
  var tabs = '';
  for (var i = 0; i < ACTIVE.lab_ids.length; i++) {
    var labItem = labById(ACTIVE.lab_ids[i]);
    tabs += '<button type="button" class="' + (i === labIndex ? 'primary' : '') + '" onclick="openLab(' + i + ')">' + (i + 1) + '. ' + (labItem ? labItem.name : 'Lab') + '</button>';
  }
  var tasks = '';
  for (var t = 0; t < lab.tasks.length; t++) tasks += '<div class="task">' + (t + 1) + '. ' + lab.tasks[t] + '</div>';
  box.innerHTML = '<div class="labgrid">' +
    '<aside class="card side"><div class="timer" id="timer">' + fmt(ACTIVE.remaining_seconds) + '</div>' +
      '<div class="row">' + tabs + '</div><hr>' + tasks +
      '<button type="button" class="primary" onclick="saveLab()">Save lab</button>' +
      '<button type="button" style="margin-top:8px" onclick="pauseExam()">Pause exam</button>' +
      '<button type="button" style="margin-top:8px" class="green" onclick="finish(false)">Finish exam</button>' +
      '<button type="button" style="margin-top:8px" class="danger" onclick="resetActiveAttempt()">Reset attempt</button>' +
      '<hr><button type="button" onclick="backToQuestions()">Back to questions</button>' +
    '</aside><div class="card"><h2>' + lab.title + '</h2>' + labForm(id, state) + '</div></div>';
}

function openLab(index) {
  labIndex = index;
  renderLabs();
}
function backToQuestions() {
  qIndex = 36;
  renderExam();
}

function fieldInput(key, label, value, type) {
  return '<div class="field"><label>' + label + '</label><input id="lab_' + key + '" type="' + (type || 'text') + '" value="' + (value == null ? '' : value) + '"></div>';
}
function fieldSelect(key, label, options, current) {
  var out = '<div class="field"><label>' + label + '</label><select id="lab_' + key + '"><option></option>';
  options.forEach(function (opt) {
    out += '<option' + (current === opt ? ' selected' : '') + '>' + opt + '</option>';
  });
  return out + '</select></div>';
}
function labForm(id, s) {
  if (id === 'drive') return fieldInput('folder', 'Folder name', s.folder) + fieldInput('doc', 'Document name', s.doc) + fieldInput('studentEmail', 'Student/group email', s.studentEmail) + fieldSelect('studentRole', 'Student role', ['Viewer', 'Commenter', 'Editor'], s.studentRole) + fieldInput('teacherEmail', 'Co-teacher email', s.teacherEmail) + fieldSelect('teacherRole', 'Co-teacher role', ['Viewer', 'Commenter', 'Editor'], s.teacherRole);
  if (id === 'classroom') return fieldInput('title', 'Assignment title', s.title) + fieldInput('due', 'Due date', s.due, 'date') + fieldSelect('attachment', 'Attachment', ['Reflection Template', 'Reading Notes', 'Project Rubric'], s.attachment) + fieldSelect('attachmentMode', 'Attachment setting', ['Students can view file', 'Students can edit file', 'Make a copy for each student'], s.attachmentMode);
  if (id === 'calendar') return fieldInput('title', 'Event title', s.title) + fieldSelect('repeat', 'Repeats', ['Does not repeat', 'Daily', 'Weekly', 'Monthly'], s.repeat) + '<label><input id="lab_meet" type="checkbox"' + (s.meet ? ' checked' : '') + '> Add Google Meet</label>' + fieldInput('guest', 'Guest email', s.guest);
  if (id === 'gmail') return fieldInput('search', 'Gmail search', s.search) + fieldInput('label', 'Label name', s.label) + fieldInput('filterFrom', 'Filter from', s.filterFrom) + fieldInput('filterLabel', 'Apply label', s.filterLabel);
  if (id === 'forms') return fieldInput('title', 'Form title', s.title) + '<label><input id="lab_quiz" type="checkbox"' + (s.quiz ? ' checked' : '') + '> Quiz mode</label>' + fieldInput('question', 'Question', s.question) + '<label><input id="lab_required" type="checkbox"' + (s.required ? ' checked' : '') + '> Required</label>' + fieldInput('choices', 'Choices, comma-separated', s.choices);
  if (id === 'sheets') return fieldSelect('sort', 'Sort', ['Student A→Z', 'Student Z→A', 'Rating high→low'], s.sort) + fieldSelect('filter', 'Filter class', ['5A', '5B', 'All'], s.filter) + fieldInput('average', 'Average rating', s.average) + fieldSelect('chart', 'Chart type', ['Column chart', 'Pie chart', 'Scatter chart'], s.chart);
  return '';
}

async function saveLab() {
  if (!ACTIVE || ACTIVE.is_paused) return;
  try {
    var id = ACTIVE.lab_ids[labIndex];
    var els = Array.prototype.slice.call(document.querySelectorAll('[id^=lab_]'));
    var state = {};
    els.forEach(function (el) {
      state[el.id.replace('lab_', '')] = el.type === 'checkbox' ? el.checked : el.value;
    });
    ACTIVE.lab_states[id] = state;
    await api('/api/attempts/' + ACTIVE.id + '/lab/' + id, { method: 'PATCH', body: JSON.stringify(state) });
    notify('Lab saved', 'Your lab work has been saved.', 'success');
  } catch (e) {
    notify('Could not save the lab', e.message || 'Please try again.', 'error');
  }
}

async function finish(auto) {
  auto = !!auto;
  if (!ACTIVE) return;
  if (!auto && !confirm('Finish and score this attempt?')) return;
  try {
    if (!auto && !ACTIVE.is_paused) await saveOpenState();
    var finished = await api('/api/attempts/' + ACTIVE.id + '/finish', { method: 'POST' });
    clearInterval(timerHandle);
    notify('Mock completed', 'Questions: ' + finished.question_pct + '% • Labs: ' + finished.lab_pct + '%', 'success');
    ACTIVE = null;
    await load();
    showView('history');
  } catch (e) {
    notify('Could not finish the mock', e.message || 'Please try again.', 'error');
  }
}

async function saveOpenState() {
  if (!ACTIVE || ACTIVE.is_paused) return;
  if (qIndex < 37) await saveAnswer();
  else await saveLab();
}

function renderHistory() {
  var host = byId('historybox');
  if (!host || !BOOT) return;
  var history = BOOT.history || [];
  if (!history.length) {
    host.innerHTML = '<p class="muted">No completed attempts yet.</p>';
    return;
  }
  var html = '';
  history.forEach(function (x) {
    var label = String(x.mock_label || 'Mock A').replace('Mock ', '');
    html += '<div class="card"><b>' + x.mock_label + '</b> • ' + new Date(x.started_at).toLocaleString() +
      '<div class="row"><span>Questions ' + x.question_pct + '%</span><span>Labs ' + x.lab_pct + '%</span>' +
      '<span><b>Practice composite ' + x.composite_pct + '%</b></span>' +
      '<button type="button" onclick="review(' + x.id + ')">Review</button>' +
      '<button type="button" class="primary" onclick="retake(\'' + label + '\')">Retake ' + x.mock_label + '</button></div></div>';
  });
  host.innerHTML = html;
}

async function review(id) {
  try {
    var r = await api('/api/attempts/' + id + '/review');
    var domains = '';
    Object.keys(r.domains || {}).forEach(function (d) {
      var v = r.domains[d];
      domains += '<div class="card"><b>' + d + '</b><div class="big">' + v.correct + '/' + v.total + '</div></div>';
    });
    var missed = '';
    if (r.missed && r.missed.length) {
      r.missed.forEach(function (m) {
        var correct = (m.answer || []).map(function (a) { return String.fromCharCode(65 + a) + '. ' + m.choices[a]; }).join(' | ');
        missed += '<div class="bad"><b>Q' + m.number + '. ' + m.question + '</b><br><span class="muted">Correct: ' + correct + '</span><br>' + m.explanation + '</div>';
      });
    } else {
      missed = '<div class="good">No missed questions.</div>';
    }
    byId('historybox').innerHTML += '<div class="card"><h2>Review</h2><div class="grid3">' + domains + '</div><h3>Missed questions</h3>' + missed + '</div>';
  } catch (e) {
    notify('Could not open review', e.message || 'Please try again.', 'error');
  }
}

window.startAttempt = startAttempt;
window.pauseExam = pauseExam;
window.resumeExam = resumeExam;
window.resetActiveAttempt = resetActiveAttempt;
window.retake = retake;
window.goQuestion = goQuestion;
window.previousQuestion = previousQuestion;
window.openLabs = openLabs;
window.answerChanged = answerChanged;
window.saveAndNext = saveAndNext;
window.saveAnswer = saveAnswer;
window.openLab = openLab;
window.backToQuestions = backToQuestions;
window.saveLab = saveLab;
window.finish = finish;
window.review = review;

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      showView(btn.getAttribute('data-view'));
    });
  });
  load();
});
