import json
from pathlib import Path

base = Path(__file__).resolve().parents[1] / "app" / "data"
qs = []
for question_file in sorted(base.glob("questions_*.json")):
    qs.extend(json.loads(question_file.read_text()))
labs = json.loads((base / "labs.json").read_text())

assert len(qs) == 80
assert len(labs) == 6
assert all("domain" in q and "answer" in q and "choices" in q for q in qs)
assert all(len(q["choices"]) >= 4 for q in qs)
assert all(all(0 <= a < len(q["choices"]) for a in q["answer"]) for q in qs)
print("Data smoke test passed: 80 questions, 6 labs.")
