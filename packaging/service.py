"""Entry point for the bundled service. stdout is a private readiness pipe."""
import argparse
import json
import os
import secrets
import socket
import sys
import threading
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--version", action="version", version="0.4.0")
    args = parser.parse_args()
    root = Path(args.state_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["CONNECTION_SETTINGS_PATH"] = str(root / "connection.json")
    os.environ["DYNAMODB_MODE"] = "aws"
    os.environ["READ_ONLY"] = "true"
    os.environ["DATA_PATH"] = str(root / "imports")
    os.environ["LOG_LEVEL"] = "WARNING"
    for action in ("DELETE", "PURGE", "CREATE", "UPDATE", "SEED"):
        os.environ[action + "_TABLES_ON_STARTUP"] = "false"

    if not getattr(sys, "frozen", False):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import uvicorn

    from app import host_runtime
    from app.user_state import StateStore

    StateStore(root)  # Fail visibly before claiming readiness; never reset corruption.
    from app.main import app

    host_runtime.state_directory = root
    host_runtime.session_token = secrets.token_urlsafe(32)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        host_runtime.host = f"127.0.0.1:{port}"
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                log_level="warning",
                access_log=False,
                lifespan="on",
                timeout_graceful_shutdown=8,
                loop="asyncio",
                http="h11",
            )
        )
        thread = threading.Thread(
            target=server.run, kwargs={"sockets": [sock]}, daemon=True
        )
        thread.start()

        def watch_parent():
            # A pipe EOF works across Windows and POSIX, including parent crashes.
            try:
                while sys.stdin.buffer.read(1):
                    pass
            finally:
                server.should_exit = True

        threading.Thread(target=watch_parent, daemon=True).start()
        deadline = time.monotonic() + 30
        while not server.started:
            if (
                not thread.is_alive()
                or time.monotonic() > deadline
                or server.should_exit
            ):
                server.should_exit = True
                raise RuntimeError(
                    "Local service did not start. Check the saved settings and data folder permissions."
                )
            time.sleep(0.025)
        print(
            json.dumps(
                {
                    "protocol": 1,
                    "url": f"http://127.0.0.1:{port}",
                    "token": host_runtime.session_token,
                    "version": "0.4.0",
                }
            ),
            flush=True,
        )
        thread.join()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No environment dump, credential values or session token in error output.
        print(
            f"DynamoDB Tools could not start: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        sys.exit(1)
