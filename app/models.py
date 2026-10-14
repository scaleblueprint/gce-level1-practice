from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from .db import Base

def utcnow():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    attempts = relationship("Attempt", back_populates="user", cascade="all, delete-orphan")

class Attempt(Base):
    __tablename__ = "attempts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    mock_label = Column(String(20), nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, default=10800, nullable=False)
    question_ids = Column(JSON, nullable=False)
    answers = Column(JSON, nullable=False, default=dict)
    flags = Column(JSON, nullable=False, default=dict)
    lab_ids = Column(JSON, nullable=False)
    lab_states = Column(JSON, nullable=False, default=dict)
    lab_scores = Column(JSON, nullable=False, default=dict)
    question_score = Column(Integer, nullable=True)
    question_pct = Column(Integer, nullable=True)
    lab_points = Column(Integer, nullable=True)
    lab_pct = Column(Integer, nullable=True)
    composite_pct = Column(Integer, nullable=True)
    is_finished = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="attempts")
