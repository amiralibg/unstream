"""Entrypoint for the frozen Unstream backend binary.

Spawns the FastAPI application over loopback via uvicorn.
Configurable via command line arguments or environment variables.
"""

import argparse
import multiprocessing
import os
import sys

# PyInstaller freeze support for multiprocessing
multiprocessing.freeze_support()


def main():
    parser = argparse.ArgumentParser(description="Unstream Desktop Backend")
    parser.add_argument(
        "--host",
        default=os.getenv("UNSTREAM_HOST", "127.0.0.1"),
        help="Bind host (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("UNSTREAM_PORT", "8000")),
        help="Bind port (default: 8000)",
    )
    parser.add_argument(
        "--static-dir",
        default=os.getenv("UNSTREAM_STATIC_DIR", ""),
        help="Directory containing built frontend SPA",
    )
    parser.add_argument(
        "--downloads-dir",
        default=os.getenv("UNSTREAM_DOWNLOADS_DIR", ""),
        help="Directory for music downloads",
    )
    args = parser.parse_args()

    if args.static_dir:
        os.environ["UNSTREAM_STATIC_DIR"] = args.static_dir
    if args.downloads_dir:
        os.environ["UNSTREAM_DOWNLOADS_DIR"] = args.downloads_dir

    import uvicorn
    from app.main import app

    print(f"Starting Unstream API on http://{args.host}:{args.port}")
    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
        loop="asyncio",
        http="auto",
        ws="none",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    server.run()


if __name__ == "__main__":
    main()
