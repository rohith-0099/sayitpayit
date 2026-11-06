import os

os.environ["GUARDIAN_SKIP_MODEL_LOAD"] = "1"  # validation paths don't need the models

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_health_reports_models():
    with TestClient(app) as c:
        r = c.get("/health")
    assert r.status_code == 200 and "models" in r.json()


def test_enroll_needs_three_samples():
    with TestClient(app) as c:
        r = c.post("/voice/enroll", files=[("samples", ("a.wav", b"x", "audio/wav"))])
    assert r.status_code == 400


def test_verify_rejects_bad_embedding_and_bad_audio():
    with TestClient(app) as c:
        r = c.post("/voice/verify", files={"audio": ("a.webm", b"not audio", "audio/webm")}, data={"embedding": "nope"})
        assert r.status_code == 400
        r = c.post("/voice/verify", files={"audio": ("a.webm", b"not audio", "audio/webm")}, data={"embedding": "[" + ",".join(["0.1"] * 192) + "]"})
        assert r.status_code == 400 and "decode" in r.json()["detail"]


def test_shared_key_enforced_when_set(monkeypatch):
    monkeypatch.setenv("GUARDIAN_API_KEY", "s3cret")
    with TestClient(app) as c:
        assert c.post("/voice/verify").status_code == 401
