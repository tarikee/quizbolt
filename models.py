from datetime import datetime
from uuid import uuid4
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base

class Quiz(Base):
    __tablename__ = "quizzes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    questions: Mapped[list["Question"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan", order_by="Question.sort_order"
    )

class Question(Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    quiz_id: Mapped[str] = mapped_column(ForeignKey("quizzes.id"))
    question_text: Mapped[str] = mapped_column(String, nullable=False)
    time_limit: Mapped[int] = mapped_column(Integer, default=20)
    sort_order: Mapped[int] = mapped_column(Integer)
    quiz: Mapped["Quiz"] = relationship(back_populates="questions")
    choices: Mapped[list["Choice"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="Choice.sort_order"
    )

class Choice(Base):
    __tablename__ = "choices"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id"))
    choice_text: Mapped[str] = mapped_column(String, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer)
    question: Mapped["Question"] = relationship(back_populates="choices")
