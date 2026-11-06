"""Guardian: voice security, fraud risk and scam-language service for SayItPayIt."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

VERSION = "0.1.0"

app = FastAPI(
    title="SayItPayIt Guardian",
    version=VERSION,
    description="Voice gate, risk model and scam classifier. CPU only.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "guardian", "version": VERSION}
