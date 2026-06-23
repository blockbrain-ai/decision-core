"""pytest configuration — ensures the hermes package is importable."""

import sys
from pathlib import Path

# Add the integrations directory to sys.path so 'hermes' is importable as a package
integrations_dir = str(Path(__file__).resolve().parent.parent)
if integrations_dir not in sys.path:
    sys.path.insert(0, integrations_dir)
