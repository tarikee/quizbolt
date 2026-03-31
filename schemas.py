from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ChoiceCreate(BaseModel):
    choice_text: str
    is_correct: bool
    sort_order: int

class QuestionCreate(BaseModel):
    question_text: str
    time_limit: int = 20
    sort_order: int
    choices: list[ChoiceCreate]

class QuizCreate(BaseModel):
    title: str
    questions: list[QuestionCreate]

class ChoiceResponse(BaseModel):
    id: str
    choice_text: str
    is_correct: bool
    sort_order: int
    model_config = {"from_attributes": True}

class QuestionResponse(BaseModel):
    id: str
    question_text: str
    time_limit: int
    sort_order: int
    choices: list[ChoiceResponse]
    model_config = {"from_attributes": True}

class QuizResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    questions: list[QuestionResponse]
    model_config = {"from_attributes": True}

class QuizListItem(BaseModel):
    id: str
    title: str
    created_at: datetime
    question_count: int
    model_config = {"from_attributes": True}

class GameCreateRequest(BaseModel):
    quiz_id: str
