"""帳號管理指令（在伺服器上執行）：

    python manage_users.py list
    python manage_users.py add <帳號>
    python manage_users.py reset-password <帳號>
    python manage_users.py usage [--days 30]            各使用者的 LLM 用量（依 token 由多到少）
    python manage_users.py usage <帳號> [--days 30]     單一使用者按日、模型的用量明細
    python manage_users.py feedback [帳號] [--days 30]  使用者送出的意見回饋與使用體驗評分（新的在前）
"""
import getpass
import sys
import time
import unicodedata

from dotenv import load_dotenv

load_dotenv()

import store  # noqa: E402  （需在 load_dotenv 之後，才會讀到 .env 的 RSLIDE_DB_PATH）
from accounts import MAX_PASSWORD, MIN_PASSWORD, USERNAME_RE  # noqa: E402


def ask_password() -> str:
    pw = getpass.getpass("密碼：")
    if not MIN_PASSWORD <= len(pw) <= MAX_PASSWORD:
        sys.exit(f"密碼長度需為 {MIN_PASSWORD}~{MAX_PASSWORD} 個字元")
    if getpass.getpass("再輸入一次：") != pw:
        sys.exit("兩次輸入的密碼不一致")
    return pw


def parse_days(args: list[str]) -> tuple[list[str], int]:
    """取出 --days N（預設 30），回傳其餘參數與天數。"""
    if "--days" not in args:
        return args, 30
    i = args.index("--days")
    try:
        days = int(args[i + 1])
    except (IndexError, ValueError):
        sys.exit("--days 需為正整數")
    if days <= 0:
        sys.exit("--days 需為正整數")
    return args[:i] + args[i + 2:], days


def fmt_time(ms: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))


def print_table(headers: list[str], rows: list[list]):
    # 中文字在終端機佔兩格，以 East Asian Width 計算欄寬才能對齊
    width = lambda v: sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in str(v))
    widths = [max(width(v) for v in col) for col in zip(headers, *rows)]
    for row in [headers, *rows]:
        print("  ".join(str(v) + " " * (w - width(v)) for v, w in zip(row, widths)).rstrip())


def show_usage(args: list[str]):
    args, days = parse_days(args)
    since = store.now_ms() - days * store.DAY_MS
    if not args:
        rows = store.usage_by_user(since)
        if not rows:
            print(f"最近 {days} 天沒有 LLM 使用紀錄")
            return
        print(f"最近 {days} 天各使用者的 LLM 用量（同素材生成 = 同一份素材被送去生成的最多次數）")
        print_table(["帳號", "呼叫", "失敗", "生成", "重產", "輸入 tokens", "輸出 tokens", "合計 tokens", "同素材生成", "最後使用"],
                    [[r["username"], r["calls"], r["errors"], r["generates"], r["regenerates"], f"{r['input_tokens']:,}",
                      f"{r['output_tokens']:,}", f"{r['total_tokens']:,}", r["max_same_content"] or 0,
                      fmt_time(r["last_used"])] for r in rows])
    elif len(args) == 1:
        rows = store.usage_by_day(args[0], since)
        if not rows:
            print(f"{args[0]} 最近 {days} 天沒有 LLM 使用紀錄")
            return
        print(f"{args[0]} 最近 {days} 天的 LLM 用量")
        print_table(["日期", "平台", "模型", "呼叫", "失敗", "輸入 tokens", "輸出 tokens", "合計 tokens"],
                    [[r["day"], r["provider"], r["model"], r["calls"], r["errors"], f"{r['input_tokens']:,}",
                      f"{r['output_tokens']:,}", f"{r['total_tokens']:,}"] for r in rows])
    else:
        sys.exit(__doc__)


def show_feedback(args: list[str]):
    args, days = parse_days(args)
    if len(args) > 1:
        sys.exit(__doc__)
    rows = store.list_feedback(store.now_ms() - days * store.DAY_MS, args[0] if args else None)
    who = f"{args[0]} " if args else ""
    if not rows:
        print(f"{who}最近 {days} 天沒有意見回饋")
        return
    ratings = [r["rating"] for r in rows if r["rating"]]
    avg = f"，平均使用體驗 {sum(ratings) / len(ratings):.1f} 星（{len(ratings)} 則評分）" if ratings else ""
    print(f"{who}最近 {days} 天的意見回饋，共 {len(rows)} 則{avg}")
    for r in rows:
        stars = f"  {'★' * r['rating']}{'☆' * (5 - r['rating'])}" if r["rating"] else ""
        print(f"\n[{fmt_time(r['created_at'])}] {r['username']}{stars}")
        if r["content"]:
            print("  " + r["content"].replace("\n", "\n  "))


def main(argv: list[str]):
    cmd, args = (argv[0] if argv else ""), argv[1:]
    if cmd == "list":
        with store.connect() as conn:
            rows = conn.execute("SELECT u.username, COUNT(h.id) AS n FROM users u "
                                "LEFT JOIN history h ON h.user_id = u.id GROUP BY u.id ORDER BY u.username").fetchall()
        for r in rows:
            print(f"{r['username']}\t{r['n']} 筆紀錄")
    elif cmd == "add" and len(args) == 1:
        if not USERNAME_RE.match(args[0]):
            sys.exit("帳號需為 2~32 個字，只能包含文字、數字與 . _ - @")
        try:
            store.create_user(args[0], ask_password())
        except store.UsernameTaken:
            sys.exit("此帳號已存在")
        print("已建立帳號", args[0])
    elif cmd == "reset-password" and len(args) == 1:
        if not store.set_password(args[0], ask_password()):
            sys.exit("找不到此帳號")
        print("已重設密碼，該帳號在所有裝置上都需重新登入")
    elif cmd == "usage":
        show_usage(args)
    elif cmd == "feedback":
        show_feedback(args)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
