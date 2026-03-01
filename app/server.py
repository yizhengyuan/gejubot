import json
import os
import subprocess
import threading
import time
from collections import OrderedDict
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def gtp_column(index: int) -> str:
    # GTP skips the letter I.
    if index < 8:
        return chr(ord("A") + index)
    return chr(ord("A") + index + 1)


def is_valid_gtp(move: str, board_size: int) -> bool:
    if move.lower() == "pass":
        return True
    if len(move) < 2:
        return False
    col = move[0].upper()
    if col == "I":
        return False
    row = move[1:]
    if not row.isdigit():
        return False
    if col < "A" or col > gtp_column(board_size - 1):
        return False
    row_num = int(row)
    return 1 <= row_num <= board_size


def infer_next_player(moves: list[list[str]]) -> str:
    if not moves:
        return "B"
    last = moves[-1][0]
    return "W" if last == "B" else "B"


def normalize_move_infos(move_infos: list, pv_length: int) -> list[dict]:
    normalized = []
    for info in move_infos:
        if not isinstance(info, dict):
            continue
        pv_raw = info.get("pv")
        pv = []
        if isinstance(pv_raw, list):
            pv = [m for m in pv_raw if isinstance(m, str)][:pv_length]
        normalized.append(
            {
                "move": info.get("move"),
                "visits": info.get("visits"),
                "winrate": info.get("winrate"),
                "scoreLead": info.get("scoreLead"),
                "policy": info.get("policy"),
                "pv": pv,
            }
        )
    return normalized


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


_CACHE_MAX_ENTRIES = 64
_analysis_cache: "OrderedDict[str, dict]" = OrderedDict()
_analysis_cache_lock = threading.Lock()


def _cache_get(key: str) -> Optional[dict]:
    with _analysis_cache_lock:
        value = _analysis_cache.get(key)
        if value is None:
            return None
        _analysis_cache.move_to_end(key)
        # Return a detached copy.
        return json.loads(json.dumps(value))


def _cache_set(key: str, value: dict) -> None:
    with _analysis_cache_lock:
        _analysis_cache[key] = json.loads(json.dumps(value))
        _analysis_cache.move_to_end(key)
        while len(_analysis_cache) > _CACHE_MAX_ENTRIES:
            _analysis_cache.popitem(last=False)


def _build_cache_key(
    *,
    moves: list[list[str]],
    max_visits: Optional[int],
    top_n: int,
    pv_length: int,
    candidate_moves: list[str],
    next_player: str,
    return_all_candidates: bool,
    expand_candidates: bool,
) -> str:
    key_obj = {
        "moves": moves,
        "maxVisits": max_visits,
        "topN": top_n,
        "pvLength": pv_length,
        "candidateMoves": candidate_moves,
        "nextPlayer": next_player,
        "returnAllCandidates": return_all_candidates,
        "expandCandidates": expand_candidates,
    }
    return json.dumps(key_obj, sort_keys=True, separators=(",", ":"))


class KataGoEngine:
    def __init__(
        self,
        binary_path: str,
        model_path: str,
        config_path: str,
        board_size: int = 19,
        rules: str = "chinese",
        komi: float = 7.5,
        default_visits: int = 120,
    ) -> None:
        self.binary_path = binary_path
        self.model_path = model_path
        self.config_path = config_path
        self.board_size = board_size
        self.rules = rules
        self.komi = komi
        self.default_visits = default_visits
        self._lock = threading.Lock()
        self._query_id = 0
        self._start_process()

    def _start_process(self) -> None:
        cmd = [
            self.binary_path,
            "analysis",
            "-model",
            self.model_path,
            "-config",
            self.config_path,
        ]
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stderr(self) -> None:
        if not self.proc.stderr:
            return
        for line in self.proc.stderr:
            print(f"[katago] {line.rstrip()}")

    def _next_id(self) -> str:
        self._query_id += 1
        return f"q{self._query_id}-{int(time.time() * 1000)}"

    def analyze(
        self,
        moves: list[list[str]],
        max_visits: Optional[int] = None,
        max_moves_to_analyze: Optional[int] = None,
        analysis_pv_len: Optional[int] = None,
        allow_moves: Optional[dict] = None,
    ) -> dict:
        if self.proc.poll() is not None:
            raise RuntimeError("KataGo process is not running")
        if self.proc.stdin is None or self.proc.stdout is None:
            raise RuntimeError("KataGo pipes are not available")

        request_id = self._next_id()
        payload = {
            "id": request_id,
            "rules": self.rules,
            "komi": self.komi,
            "boardXSize": self.board_size,
            "boardYSize": self.board_size,
            "moves": moves,
            "maxVisits": max_visits or self.default_visits,
            "includePolicy": True,
        }
        if isinstance(max_moves_to_analyze, int) and max_moves_to_analyze > 0:
            payload["maxMovesToAnalyze"] = max_moves_to_analyze
        if isinstance(analysis_pv_len, int) and analysis_pv_len > 0:
            payload["analysisPVLen"] = analysis_pv_len
        if isinstance(allow_moves, dict):
            payload["allowMoves"] = [allow_moves]

        with self._lock:
            self.proc.stdin.write(json.dumps(payload, ensure_ascii=True) + "\n")
            self.proc.stdin.flush()

            while True:
                line = self.proc.stdout.readline()
                if line == "":
                    raise RuntimeError("KataGo output stream closed")
                line = line.strip()
                if not line:
                    continue
                try:
                    response = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if response.get("id") != request_id:
                    continue
                if response.get("isDuringSearch"):
                    continue
                return response

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class AppHandler(SimpleHTTPRequestHandler):
    engine: Optional[KataGoEngine] = None

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._write_json({"ok": True})
            return
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/analyze":
            self._write_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._write_json({"error": "invalid json"}, status=HTTPStatus.BAD_REQUEST)
            return

        moves = data.get("moves", [])
        max_visits_raw = data.get("maxVisits")
        top_n_raw = data.get("topN")
        pv_len_raw = data.get("pvLength")
        candidate_moves_raw = data.get("candidateMoves")
        next_player_raw = data.get("nextPlayer")
        return_all_candidates_raw = data.get("returnAllCandidates")
        expand_candidates_raw = data.get("expandCandidates")
        max_visits = None
        top_n = 10
        pv_length = 10
        return_all_candidates = False
        expand_candidates = False
        if max_visits_raw is not None:
            if not isinstance(max_visits_raw, int) or max_visits_raw <= 0:
                self._write_json({"error": "maxVisits must be a positive integer"}, status=HTTPStatus.BAD_REQUEST)
                return
            max_visits = max_visits_raw
        if top_n_raw is not None:
            if not isinstance(top_n_raw, int) or top_n_raw <= 0 or top_n_raw > 400:
                self._write_json({"error": "topN must be an integer in [1,400]"}, status=HTTPStatus.BAD_REQUEST)
                return
            top_n = top_n_raw
        if pv_len_raw is not None:
            if not isinstance(pv_len_raw, int) or pv_len_raw <= 0 or pv_len_raw > 30:
                self._write_json({"error": "pvLength must be an integer in [1,30]"}, status=HTTPStatus.BAD_REQUEST)
                return
            pv_length = pv_len_raw
        if return_all_candidates_raw is not None:
            if not isinstance(return_all_candidates_raw, bool):
                self._write_json({"error": "returnAllCandidates must be a boolean"}, status=HTTPStatus.BAD_REQUEST)
                return
            return_all_candidates = return_all_candidates_raw
        if expand_candidates_raw is not None:
            if not isinstance(expand_candidates_raw, bool):
                self._write_json({"error": "expandCandidates must be a boolean"}, status=HTTPStatus.BAD_REQUEST)
                return
            expand_candidates = expand_candidates_raw
        if not isinstance(moves, list):
            self._write_json({"error": "moves must be a list"}, status=HTTPStatus.BAD_REQUEST)
            return

        board_size = self.engine.board_size if self.engine else 19
        sanitized_moves: list[list[str]] = []
        for item in moves:
            if not isinstance(item, list) or len(item) != 2:
                self._write_json({"error": "each move must be [player, move]"}, status=HTTPStatus.BAD_REQUEST)
                return
            player, move = item
            if player not in ("B", "W"):
                self._write_json({"error": "player must be B or W"}, status=HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(move, str) or not is_valid_gtp(move, board_size):
                self._write_json({"error": f"invalid move: {move}"}, status=HTTPStatus.BAD_REQUEST)
                return
            normalized = "pass" if move.lower() == "pass" else move.upper()
            sanitized_moves.append([player, normalized])

        candidate_moves: list[str] = []
        if candidate_moves_raw is not None:
            if not isinstance(candidate_moves_raw, list):
                self._write_json({"error": "candidateMoves must be a list"}, status=HTTPStatus.BAD_REQUEST)
                return
            for m in candidate_moves_raw:
                if not isinstance(m, str) or not is_valid_gtp(m, board_size):
                    self._write_json({"error": f"invalid candidate move: {m}"}, status=HTTPStatus.BAD_REQUEST)
                    return
                if m.lower() == "pass":
                    continue
                candidate_moves.append(m.upper())
            # Preserve order while dropping duplicates.
            candidate_moves = list(dict.fromkeys(candidate_moves))

        next_player = infer_next_player(sanitized_moves)
        if next_player_raw is not None:
            if next_player_raw not in ("B", "W"):
                self._write_json({"error": "nextPlayer must be B or W"}, status=HTTPStatus.BAD_REQUEST)
                return
            next_player = next_player_raw

        cache_key = _build_cache_key(
            moves=sanitized_moves,
            max_visits=max_visits,
            top_n=top_n,
            pv_length=pv_length,
            candidate_moves=candidate_moves,
            next_player=next_player,
            return_all_candidates=return_all_candidates,
            expand_candidates=expand_candidates,
        )
        cached = _cache_get(cache_key)
        if cached is not None:
            self._write_json(cached)
            return

        try:
            if self.engine is None:
                raise RuntimeError("engine is not initialized")
            result = self.engine.analyze(
                sanitized_moves,
                max_visits=max_visits,
                max_moves_to_analyze=top_n,
                analysis_pv_len=pv_length,
            )
        except Exception as exc:
            self._write_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        move_infos = result.get("moveInfos", [])
        normalized_infos = normalize_move_infos(move_infos, pv_length)

        # KataGo analysis often reports only a small top subset in one query.
        # If user requests more or asks for full candidates, scan in chunks.
        should_expand = expand_candidates or return_all_candidates
        if should_expand and (top_n > len(normalized_infos) or return_all_candidates) and candidate_moves:
            merged = {}
            for item in normalized_infos:
                move = item.get("move")
                if isinstance(move, str):
                    merged[move.upper()] = item

            for chunk in chunked(candidate_moves, 5):
                try:
                    chunk_result = self.engine.analyze(
                        sanitized_moves,
                        max_visits=max_visits,
                        analysis_pv_len=pv_length,
                        allow_moves={
                            "player": next_player.lower(),
                            "moves": chunk,
                            "untilDepth": 1,
                        },
                    )
                except Exception:
                    continue
                chunk_infos = normalize_move_infos(chunk_result.get("moveInfos", []), pv_length)
                for item in chunk_infos:
                    move = item.get("move")
                    if isinstance(move, str):
                        merged[move.upper()] = item

            if merged:
                normalized_infos = list(merged.values())

        def winrate_key(item: dict) -> float:
            value = item.get("winrate")
            return float(value) if isinstance(value, (int, float)) else -1.0

        def visits_key(item: dict) -> int:
            value = item.get("visits")
            return int(value) if isinstance(value, int) else -1

        normalized_infos.sort(key=lambda item: (winrate_key(item), visits_key(item)), reverse=True)

        top_moves = []
        for idx, info in enumerate(normalized_infos[:top_n], start=1):
            item = dict(info)
            item["rank"] = idx
            top_moves.append(item)

        all_candidates = []
        if return_all_candidates:
            for idx, info in enumerate(normalized_infos, start=1):
                item = dict(info)
                item["rank"] = idx
                all_candidates.append(item)

        payload = {
            "topMoves": top_moves,
            "candidateCount": len(normalized_infos),
            "rootInfo": result.get("rootInfo", {}),
        }
        if return_all_candidates:
            payload["allCandidates"] = all_candidates
        _cache_set(cache_key, payload)
        self._write_json(payload)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[http] {self.address_string()} - {fmt % args}")

    def _write_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    root = Path(__file__).resolve().parent
    static_dir = root / "static"

    binary_path = require_env("KATAGO_BINARY")
    model_path = require_env("KATAGO_MODEL")
    config_path = require_env("KATAGO_CONFIG")
    for p in (binary_path, model_path, config_path):
        if not Path(p).exists():
            raise RuntimeError(f"Path does not exist: {p}")

    board_size = int(os.getenv("BOARD_SIZE", "19"))
    rules = os.getenv("RULES", "chinese")
    komi = float(os.getenv("KOMI", "7.5"))
    default_visits = int(os.getenv("DEFAULT_VISITS", "120"))
    port = int(os.getenv("PORT", "8080"))

    engine = KataGoEngine(
        binary_path=binary_path,
        model_path=model_path,
        config_path=config_path,
        board_size=board_size,
        rules=rules,
        komi=komi,
        default_visits=default_visits,
    )
    AppHandler.engine = engine

    handler = lambda *args, **kwargs: AppHandler(*args, directory=str(static_dir), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Serving at http://127.0.0.1:{port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        engine.close()


if __name__ == "__main__":
    main()
