"""帳號管理指令（在伺服器上執行）：

    python manage_users.py list
    python manage_users.py add <帳號>
    python manage_users.py reset-password <帳號>
"""
import getpass
import sys

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
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
