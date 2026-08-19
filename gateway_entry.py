"""PyInstaller entry point for the bundled local translation gateway."""

from local_translator.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
