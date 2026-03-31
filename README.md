# QuizBolt

An open-source, Kahoot-style live quiz game platform built with FastAPI, SQLite, and vanilla JavaScript.

## Features

- Create multi-question quizzes with 4 answer choices and configurable time limits
- Host live game sessions with a shareable 6-digit room code
- Players join from any browser — no account needed
- Real-time gameplay via WebSockets
- Score based on correctness + speed (faster = more points, up to 1000 per question)
- Live leaderboard after each question and a podium at the end

## Tech Stack

| Layer      | Technology                         |
|------------|------------------------------------|
| Backend    | Python 3.10+, FastAPI              |
| Database   | SQLite via SQLAlchemy 2.0 (async)  |
| Frontend   | Vanilla JS + Jinja2 templates      |
| Real-time  | FastAPI WebSockets                 |
| Server     | Uvicorn                            |

## Quick Start

```bash
# 1. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the server
python main.py
# or: uvicorn main:app --reload

# 4. Open your browser
open http://localhost:8000
```

## How to Play

1. **Create a quiz** — go to `/create`, add questions and mark the correct answer for each.
2. **Host a game** — from the home page click "Host" next to any quiz. You'll get a 6-digit room code.
3. **Players join** — players go to `/join`, enter the room code and a nickname.
4. **Start** — the host clicks "Start Game". Questions are sent in real time.
5. **Answer** — players tap a coloured answer button. Faster correct answers earn more points.
6. **Results** — after each question the host sees the leaderboard. After all questions a podium is shown.

## Project Structure

```
kahoot/
├── main.py           # FastAPI app, routes, WebSocket endpoints
├── models.py         # SQLAlchemy ORM models
├── database.py       # Async engine & session setup
├── game_manager.py   # In-memory game session state machine
├── schemas.py        # Pydantic request/response schemas
├── requirements.txt
├── static/
│   ├── css/style.css
│   └── js/
│       ├── host.js     # Host WS client
│       ├── player.js   # Player WS client
│       └── create.js   # Quiz builder UI
└── templates/
    ├── base.html
    ├── index.html   # Landing + quiz library
    ├── create.html  # Quiz creation form
    ├── host.html    # Host game dashboard
    ├── join.html    # Player join page
    └── play.html    # Player game view
```

## Scoring

Each correct answer earns between 500 and 1000 points depending on how quickly you answered:

```
score = 500 + 500 * (1 - elapsed / time_limit)
```

Wrong answers or no answer score 0.
