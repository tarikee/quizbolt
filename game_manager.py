import time
import random
from dataclasses import dataclass, field
from typing import Optional
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

def calculate_score(elapsed_seconds: float, time_limit: int) -> int:
    time_fraction = max(0.0, 1.0 - (elapsed_seconds / time_limit))
    return int(500 + 500 * time_fraction)

@dataclass
class Player:
    nickname: str
    websocket: WebSocket
    score: int = 0
    current_answer: Optional[str] = None
    answer_time: Optional[float] = None
    answered: bool = False

@dataclass
class GameSession:
    room_code: str
    quiz_id: str
    quiz_title: str
    questions: list[dict]
    host_ws: Optional[WebSocket] = None
    players: dict = field(default_factory=dict)  # nickname -> Player
    current_question_index: int = -1
    question_start_time: Optional[float] = None
    state: str = "lobby"  # lobby | question | results | finished

class GameManager:
    def __init__(self):
        self.sessions: dict[str, GameSession] = {}

    def create_session(self, quiz_id: str, quiz_title: str, questions: list[dict]) -> str:
        for _ in range(100):
            code = str(random.randint(100000, 999999))
            if code not in self.sessions:
                self.sessions[code] = GameSession(
                    room_code=code,
                    quiz_id=quiz_id,
                    quiz_title=quiz_title,
                    questions=questions,
                )
                return code
        raise RuntimeError("Could not generate unique room code")

    def get_session(self, room_code: str) -> Optional[GameSession]:
        return self.sessions.get(room_code)

    async def connect_host(self, room_code: str, ws: WebSocket):
        session = self.sessions.get(room_code)
        if not session:
            await ws.close(code=4004)
            return
        session.host_ws = ws
        # Send current player list to host
        await ws.send_json({
            "type": "lobby_state",
            "players": list(session.players.keys()),
            "quiz_title": session.quiz_title,
            "question_count": len(session.questions),
        })

    async def connect_player(self, room_code: str, nickname: str, ws: WebSocket) -> bool:
        session = self.sessions.get(room_code)
        if not session:
            await ws.send_json({"type": "error", "message": "Room not found"})
            return False
        if session.state != "lobby":
            await ws.send_json({"type": "error", "message": "Game already started"})
            return False
        if nickname in session.players:
            await ws.send_json({"type": "error", "message": "Nickname already taken"})
            return False
        session.players[nickname] = Player(nickname=nickname, websocket=ws)
        await ws.send_json({"type": "joined", "message": "Waiting for host to start..."})
        # Notify host
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "player_joined",
                    "nickname": nickname,
                    "player_count": len(session.players),
                })
            except Exception:
                pass
        return True

    async def disconnect_player(self, room_code: str, nickname: str):
        session = self.sessions.get(room_code)
        if not session or nickname not in session.players:
            return
        del session.players[nickname]
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "player_left",
                    "nickname": nickname,
                    "player_count": len(session.players),
                })
            except Exception:
                pass

    async def disconnect_host(self, room_code: str):
        session = self.sessions.get(room_code)
        if not session:
            return
        session.host_ws = None
        # Notify all players
        await self._broadcast_to_players(session, {
            "type": "game_over",
            "message": "Host disconnected",
            "final_leaderboard": self._get_leaderboard(session),
        })
        del self.sessions[room_code]

    async def start_game(self, room_code: str):
        session = self.sessions.get(room_code)
        if not session or session.state != "lobby":
            return
        session.state = "question"
        session.current_question_index = 0
        await self._send_question(session)

    async def next_question(self, room_code: str):
        session = self.sessions.get(room_code)
        if not session or session.state not in ("question", "results"):
            return
        session.current_question_index += 1
        if session.current_question_index >= len(session.questions):
            await self._end_game(session)
        else:
            session.state = "question"
            await self._send_question(session)

    async def end_question(self, room_code: str):
        session = self.sessions.get(room_code)
        if not session or session.state != "question":
            return
        session.state = "results"
        q = session.questions[session.current_question_index]
        correct_id = next((c["id"] for c in q["choices"] if c["is_correct"]), None)

        # Score all players who haven't answered yet (they get 0)
        results = []
        for nickname, player in session.players.items():
            correct = player.current_answer == correct_id
            if correct and player.answer_time is not None:
                elapsed = player.answer_time - session.question_start_time
                earned = calculate_score(elapsed, q["time_limit"])
            else:
                earned = 0
            player.score += earned
            results.append({
                "nickname": nickname,
                "correct": correct,
                "points_earned": earned,
                "total_score": player.score,
            })
            # Notify player
            try:
                await player.websocket.send_json({
                    "type": "answer_result",
                    "correct": correct,
                    "points_earned": earned,
                    "total_score": player.score,
                    "correct_choice_id": correct_id,
                })
            except Exception:
                pass
            # Reset for next question
            player.current_answer = None
            player.answer_time = None
            player.answered = False

        leaderboard = self._get_leaderboard(session)
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "question_results",
                    "correct_choice_id": correct_id,
                    "results": results,
                    "leaderboard": leaderboard,
                })
            except Exception:
                pass

    async def submit_answer(self, room_code: str, nickname: str, choice_id: str):
        session = self.sessions.get(room_code)
        if not session or session.state != "question":
            return
        player = session.players.get(nickname)
        if not player or player.answered:
            return
        player.current_answer = choice_id
        player.answer_time = time.time()
        player.answered = True
        # Tell host how many have answered
        answered_count = sum(1 for p in session.players.values() if p.answered)
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "answer_received",
                    "nickname": nickname,
                    "answer_count": answered_count,
                    "player_count": len(session.players),
                })
            except Exception:
                pass
        # Auto-end if everyone answered
        if answered_count == len(session.players):
            await self.end_question(room_code)

    async def _send_question(self, session: GameSession):
        q = session.questions[session.current_question_index]
        session.question_start_time = time.time()
        # Send to players (no correct answer info)
        player_choices = [{"id": c["id"], "choice_text": c["choice_text"]} for c in q["choices"]]
        await self._broadcast_to_players(session, {
            "type": "question",
            "question_text": q["question_text"],
            "choices": player_choices,
            "time_limit": q["time_limit"],
            "question_number": session.current_question_index + 1,
            "total_questions": len(session.questions),
        })
        # Send to host (with full info)
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "question",
                    "question_text": q["question_text"],
                    "choices": q["choices"],
                    "time_limit": q["time_limit"],
                    "question_number": session.current_question_index + 1,
                    "total_questions": len(session.questions),
                })
            except Exception:
                pass

    async def _end_game(self, session: GameSession):
        session.state = "finished"
        leaderboard = self._get_leaderboard(session)
        await self._broadcast_to_players(session, {
            "type": "game_over",
            "final_leaderboard": leaderboard,
        })
        if session.host_ws:
            try:
                await session.host_ws.send_json({
                    "type": "game_over",
                    "final_leaderboard": leaderboard,
                })
            except Exception:
                pass

    def _get_leaderboard(self, session: GameSession) -> list[dict]:
        sorted_players = sorted(session.players.values(), key=lambda p: p.score, reverse=True)
        return [{"rank": i + 1, "nickname": p.nickname, "score": p.score} for i, p in enumerate(sorted_players)]

    async def _broadcast_to_players(self, session: GameSession, message: dict):
        disconnected = []
        for nickname, player in session.players.items():
            try:
                await player.websocket.send_json(message)
            except Exception:
                disconnected.append(nickname)
        for nickname in disconnected:
            del session.players[nickname]

game_manager = GameManager()
