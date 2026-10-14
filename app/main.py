import json, os, random
from datetime import datetime, timezone
from pathlib import Path
import bcrypt
from fastapi import FastAPI, Request, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, func, text

from .db import Base, engine, get_db
from .models import User, Attempt

BASE = Path(__file__).resolve().parent
QUESTIONS = []
for question_file in sorted((BASE / "data").glob("questions_*.json")):
    QUESTIONS.extend(json.loads(question_file.read_text(encoding="utf-8")))
LABS = json.loads((BASE / "data" / "labs.json").read_text(encoding="utf-8"))
LAB_BY_ID = {x["id"]: x for x in LABS}

app = FastAPI(title="GCE Level 1 Practice App")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "change-this-in-production"),
    same_site="lax",
    https_only=os.getenv("HTTPS_ONLY", "false").lower() == "true",
    max_age=60 * 60 * 24 * 30,
)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")
Base.metadata.create_all(bind=engine)

def now():
    return datetime.now(timezone.utc)

def aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def current_user(request: Request, db: Session):
    uid = request.session.get("user_id")
    return db.get(User, uid) if uid else None

def require_user(request: Request, db: Session = Depends(get_db)):
    user = current_user(request, db)
    if not user:
        raise HTTPException(401, "Not signed in")
    return user

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def serialize_attempt(a: Attempt):
    started = aware(a.started_at)
    finished = aware(a.finished_at)
    elapsed = int((now() - started).total_seconds()) if not a.is_finished else int((finished - started).total_seconds())
    remaining = max(0, a.duration_seconds - elapsed)
    return {
        "id": a.id,
        "mock_label": a.mock_label,
        "started_at": a.started_at.isoformat(),
        "finished_at": a.finished_at.isoformat() if a.finished_at else None,
        "remaining_seconds": remaining,
        "question_ids": a.question_ids,
        "answers": a.answers or {},
        "flags": a.flags or {},
        "lab_ids": a.lab_ids,
        "lab_states": a.lab_states or {},
        "lab_scores": a.lab_scores or {},
        "question_score": a.question_score,
        "question_pct": a.question_pct,
        "lab_points": a.lab_points,
        "lab_pct": a.lab_pct,
        "composite_pct": a.composite_pct,
        "is_finished": a.is_finished,
    }

def pick_questions(seed: int):
    rng = random.Random(seed)
    by_domain = {}
    for i, q in enumerate(QUESTIONS):
        by_domain.setdefault(q["domain"], []).append(i)
    chosen = []
    for ids in by_domain.values():
        ids = ids[:]
        rng.shuffle(ids)
        chosen.extend(ids[:7])
    rest = [i for i in range(len(QUESTIONS)) if i not in chosen]
    rng.shuffle(rest)
    chosen.extend(rest[:2])
    rng.shuffle(chosen)
    return chosen[:37]

def pick_labs(seed: int):
    rng = random.Random(seed + 900)
    ids = [x["id"] for x in LABS]
    rng.shuffle(ids)
    return ids[:3]

def same_set(a, b):
    return sorted(a or []) == sorted(b or [])

def grade_lab(lab_id: str, state: dict):
    e = LAB_BY_ID[lab_id]["expected"]
    norm = lambda x: str(x or "").strip().lower()
    if lab_id == "drive":
        checks = [
            norm(state.get("folder")) == norm(e["folder"]),
            norm(state.get("doc")) == norm(e["doc"]),
            norm(state.get("studentEmail")) == norm(e["studentEmail"]) and state.get("studentRole") == e["studentRole"],
            norm(state.get("teacherEmail")) == norm(e["teacherEmail"]) and state.get("teacherRole") == e["teacherRole"],
        ]
    elif lab_id == "classroom":
        checks = [
            norm(state.get("title")) == norm(e["title"]),
            state.get("due") == e["due"],
            state.get("attachment") == e["attachment"],
            state.get("attachmentMode") == e["attachmentMode"],
        ]
    elif lab_id == "calendar":
        checks = [
            norm(state.get("title")) == norm(e["title"]),
            state.get("repeat") == e["repeat"],
            state.get("meet") is True,
            norm(state.get("guest")) == norm(e["guest"]),
        ]
    elif lab_id == "gmail":
        s = norm(state.get("search"))
        checks = [
            all(x.lower() in s for x in e["search_contains"]),
            norm(state.get("label")) == norm(e["label"]),
            norm(state.get("filterFrom")) == norm(e["filterFrom"]),
            norm(state.get("filterLabel")) == norm(e["filterLabel"]),
        ]
    elif lab_id == "forms":
        choices = {norm(x) for x in str(state.get("choices") or "").split(",") if x.strip()}
        checks = [
            norm(state.get("title")) == norm(e["title"]),
            state.get("quiz") is True,
            norm(state.get("question")) == norm(e["question"]) and state.get("required") is True,
            {x.lower() for x in e["choices"]}.issubset(choices),
        ]
    elif lab_id == "sheets":
        try:
            avg_ok = abs(float(state.get("average", -99)) - float(e["average"])) < 0.001
        except Exception:
            avg_ok = False
        checks = [
            state.get("sort") == e["sort"],
            state.get("filter") == e["filter"],
            avg_ok,
            state.get("chart") == e["chart"],
        ]
    else:
        checks = [False] * 4
    return {"passed": sum(checks), "total": len(checks), "details": checks}

def maybe_auto_finish(a: Attempt, db: Session):
    if not a.is_finished and (now() - aware(a.started_at)).total_seconds() >= a.duration_seconds:
        finish_attempt(a, db)

def finish_attempt(a: Attempt, db: Session):
    if a.is_finished:
        return
    score = 0
    for pos, qid in enumerate(a.question_ids):
        q = QUESTIONS[qid]
        answer = (a.answers or {}).get(str(pos))
        if same_set(answer, q["answer"]):
            score += 1
    lab_scores = {}
    lab_points = 0
    states = a.lab_states or {}
    for lab_id in a.lab_ids:
        result = grade_lab(lab_id, states.get(lab_id, {}))
        lab_scores[lab_id] = result
        lab_points += result["passed"]

    q_pct = round(score / 37 * 100)
    lab_pct = round(lab_points / 12 * 100)
    composite = round(q_pct * 0.7 + lab_pct * 0.3)

    a.question_score = score
    a.question_pct = q_pct
    a.lab_points = lab_points
    a.lab_pct = lab_pct
    a.composite_pct = composite
    a.lab_scores = lab_scores
    a.is_finished = True
    a.finished_at = now()
    db.add(a)
    db.commit()

@app.get("/healthz")
def healthz(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True, "questions": len(QUESTIONS), "labs": len(LABS)}

@app.get("/", response_class=HTMLResponse)
def home(request: Request, db: Session = Depends(get_db)):
    user = current_user(request, db)
    if not user:
        return templates.TemplateResponse("login.html", {"request": request})
    return templates.TemplateResponse("app.html", {"request": request, "email": user.email})

@app.post("/register")
def register(request: Request, email: str = Form(...), password: str = Form(...), registration_code: str = Form(""), db: Session = Depends(get_db)):
    email = email.strip().lower()
    if len(password) < 8:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Password must be at least 8 characters."}, status_code=400)
    expected_code = os.getenv("REGISTRATION_CODE", "").strip()
    if expected_code and registration_code.strip() != expected_code:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid registration code."}, status_code=403)
    single_user = os.getenv("SINGLE_USER", "true").lower() == "true"
    count = db.scalar(select(func.count(User.id))) or 0
    if single_user and count >= 1:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Registration is closed. Use the existing account."}, status_code=403)
    if db.scalar(select(User).where(User.email == email)):
        return templates.TemplateResponse("login.html", {"request": request, "error": "Account already exists."}, status_code=400)
    u = User(email=email, password_hash=hash_password(password))
    db.add(u); db.commit(); db.refresh(u)
    request.session["user_id"] = u.id
    return RedirectResponse("/", status_code=303)

@app.post("/login")
def login(request: Request, email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == email.strip().lower()))
    if not u or not check_password(password, u.password_hash):
        return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid email or password."}, status_code=401)
    request.session["user_id"] = u.id
    return RedirectResponse("/", status_code=303)

@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/", status_code=303)

@app.get("/api/bootstrap")
def bootstrap(user: User = Depends(require_user), db: Session = Depends(get_db)):
    active = db.scalar(select(Attempt).where(Attempt.user_id == user.id, Attempt.is_finished == False).order_by(Attempt.id.desc()))
    if active:
        maybe_auto_finish(active, db)
        if active.is_finished:
            active = None
    history = db.scalars(select(Attempt).where(Attempt.user_id == user.id, Attempt.is_finished == True).order_by(Attempt.id.desc()).limit(12)).all()
    return {
        "user": {"email": user.email},
        "active": serialize_attempt(active) if active else None,
        "history": [serialize_attempt(x) for x in history],
        "questions": [{k: v for k, v in q.items() if k not in ("answer", "exp")} for q in QUESTIONS],
        "labs": [{k:v for k,v in x.items() if k != "expected"} for x in LABS],
    }

@app.post("/api/attempts")
async def start_attempt(request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    payload = await request.json()
    label = str(payload.get("label", "A")).upper()
    seed_map = {"A": 11, "B": 29, "C": 47}
    seed = seed_map.get(label, 11)
    old = db.scalar(select(Attempt).where(Attempt.user_id == user.id, Attempt.is_finished == False).order_by(Attempt.id.desc()))
    if old:
        maybe_auto_finish(old, db)
        if not old.is_finished:
            return JSONResponse({"error": "An active attempt already exists.", "attempt": serialize_attempt(old)}, status_code=409)
    a = Attempt(
        user_id=user.id,
        mock_label=f"Mock {label}",
        question_ids=pick_questions(seed),
        answers={},
        flags={},
        lab_ids=pick_labs(seed),
        lab_states={},
        lab_scores={},
    )
    db.add(a); db.commit(); db.refresh(a)
    return serialize_attempt(a)

@app.get("/api/attempts/{attempt_id}")
def get_attempt(attempt_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    a = db.get(Attempt, attempt_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404)
    maybe_auto_finish(a, db)
    return serialize_attempt(a)

@app.patch("/api/attempts/{attempt_id}/answer")
async def save_answer(attempt_id: int, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    a = db.get(Attempt, attempt_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404)
    maybe_auto_finish(a, db)
    if a.is_finished:
        raise HTTPException(409, "Attempt is finished")
    payload = await request.json()
    idx = str(int(payload["index"]))
    answers = dict(a.answers or {})
    answers[idx] = payload.get("answer") or []
    flags = dict(a.flags or {})
    flags[idx] = bool(payload.get("flag", False))
    a.answers = answers
    a.flags = flags
    db.add(a); db.commit()
    return {"ok": True}

@app.patch("/api/attempts/{attempt_id}/lab/{lab_id}")
async def save_lab(attempt_id: int, lab_id: str, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    a = db.get(Attempt, attempt_id)
    if not a or a.user_id != user.id or lab_id not in a.lab_ids:
        raise HTTPException(404)
    maybe_auto_finish(a, db)
    if a.is_finished:
        raise HTTPException(409, "Attempt is finished")
    state = await request.json()
    states = dict(a.lab_states or {})
    states[lab_id] = state
    a.lab_states = states
    db.add(a); db.commit()
    return {"ok": True, "score": grade_lab(lab_id, state)}

@app.post("/api/attempts/{attempt_id}/finish")
def finish(attempt_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    a = db.get(Attempt, attempt_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404)
    finish_attempt(a, db)
    return serialize_attempt(a)

@app.get("/api/attempts/{attempt_id}/review")
def review(attempt_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    a = db.get(Attempt, attempt_id)
    if not a or a.user_id != user.id or not a.is_finished:
        raise HTTPException(404)
    rows = []
    domains = {}
    for pos, qid in enumerate(a.question_ids):
        q = QUESTIONS[qid]
        chosen = (a.answers or {}).get(str(pos)) or []
        correct = same_set(chosen, q["answer"])
        d = domains.setdefault(q["domain"], {"correct": 0, "total": 0})
        d["total"] += 1
        d["correct"] += int(correct)
        if not correct:
            rows.append({
                "number": pos + 1,
                "question": q["q"],
                "choices": q["choices"],
                "chosen": chosen,
                "answer": q["answer"],
                "explanation": q["exp"],
            })
    return {"attempt": serialize_attempt(a), "domains": domains, "missed": rows}
