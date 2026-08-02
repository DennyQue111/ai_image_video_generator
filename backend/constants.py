from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
PROJECT_FILE_PATH = str(BASE_DIR / "outputs")
OUTPUT_FILE_PATH = str(Path(PROJECT_FILE_PATH) / "_temp" / "generator_outputs")
