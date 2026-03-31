from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import uvicorn

from database import get_db, init_db
from models import Quiz, Question, Choice
from schemas import QuizCreate, QuizResponse, QuizListItem, GameCreateRequest
from game_manager import game_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="QuizBolt", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- Pages ---

@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/create")
async def create_page(request: Request):
    return templates.TemplateResponse("create.html", {"request": request})

@app.get("/host/{room_code}")
async def host_page(request: Request, room_code: str):
    session = game_manager.get_session(room_code)
    if not session:
        raise HTTPException(status_code=404, detail="Room not found")
    return templates.TemplateResponse("host.html", {"request": request, "room_code": room_code})

@app.get("/join")
async def join_page(request: Request):
    return templates.TemplateResponse("join.html", {"request": request})

@app.get("/play/{room_code}")
async def play_page(request: Request, room_code: str, nickname: str):
    return templates.TemplateResponse("play.html", {"request": request, "room_code": room_code, "nickname": nickname})

# --- Quiz API ---

@app.post("/api/quizzes", response_model=QuizResponse)
async def create_quiz(data: QuizCreate, db: AsyncSession = Depends(get_db)):
    quiz = Quiz(title=data.title)
    db.add(quiz)
    await db.flush()
    for q_data in data.questions:
        question = Question(
            quiz_id=quiz.id,
            question_text=q_data.question_text,
            time_limit=q_data.time_limit,
            sort_order=q_data.sort_order,
        )
        db.add(question)
        await db.flush()
        for c_data in q_data.choices:
            choice = Choice(
                question_id=question.id,
                choice_text=c_data.choice_text,
                is_correct=c_data.is_correct,
                sort_order=c_data.sort_order,
            )
            db.add(choice)
    await db.commit()
    await db.refresh(quiz)
    # Eagerly load relationships
    result = await db.execute(
        select(Quiz).where(Quiz.id == quiz.id)
    )
    quiz = result.scalar_one()
    # Load questions and choices
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Quiz).options(
            selectinload(Quiz.questions).selectinload(Question.choices)
        ).where(Quiz.id == quiz.id)
    )
    quiz = result.scalar_one()
    return quiz

@app.get("/api/quizzes", response_model=list[QuizListItem])
async def list_quizzes(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Quiz).options(selectinload(Quiz.questions))
    )
    quizzes = result.scalars().all()
    return [
        QuizListItem(
            id=q.id,
            title=q.title,
            created_at=q.created_at,
            question_count=len(q.questions),
        )
        for q in quizzes
    ]

@app.get("/api/quizzes/{quiz_id}", response_model=QuizResponse)
async def get_quiz(quiz_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Quiz).options(
            selectinload(Quiz.questions).selectinload(Question.choices)
        ).where(Quiz.id == quiz_id)
    )
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return quiz

@app.delete("/api/quizzes/{quiz_id}")
async def delete_quiz(quiz_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Quiz).where(Quiz.id == quiz_id))
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    await db.delete(quiz)
    await db.commit()
    return {"ok": True}

# --- Game API ---

@app.post("/api/games")
async def create_game(data: GameCreateRequest, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Quiz).options(
            selectinload(Quiz.questions).selectinload(Question.choices)
        ).where(Quiz.id == data.quiz_id)
    )
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    questions = [
        {
            "id": q.id,
            "question_text": q.question_text,
            "time_limit": q.time_limit,
            "sort_order": q.sort_order,
            "choices": [
                {
                    "id": c.id,
                    "choice_text": c.choice_text,
                    "is_correct": c.is_correct,
                    "sort_order": c.sort_order,
                }
                for c in q.choices
            ],
        }
        for q in quiz.questions
    ]
    room_code = game_manager.create_session(quiz.id, quiz.title, questions)
    return {"room_code": room_code}

# --- WebSockets ---

@app.websocket("/ws/host/{room_code}")
async def host_ws(websocket: WebSocket, room_code: str):
    await websocket.accept()
    try:
        await game_manager.connect_host(room_code, websocket)
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "start_game":
                await game_manager.start_game(room_code)
            elif msg_type == "next_question":
                await game_manager.next_question(room_code)
            elif msg_type == "end_question":
                await game_manager.end_question(room_code)
    except WebSocketDisconnect:
        await game_manager.disconnect_host(room_code)
    except Exception:
        await game_manager.disconnect_host(room_code)

@app.websocket("/ws/play/{room_code}/{nickname}")
async def player_ws(websocket: WebSocket, room_code: str, nickname: str):
    await websocket.accept()
    joined = False
    try:
        joined = await game_manager.connect_player(room_code, nickname, websocket)
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "answer":
                await game_manager.submit_answer(room_code, nickname, data["choice_id"])
    except WebSocketDisconnect:
        if joined:
            await game_manager.disconnect_player(room_code, nickname)
    except Exception:
        if joined:
            await game_manager.disconnect_player(room_code, nickname)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
