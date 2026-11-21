import os
import sys
import warnings
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

warnings.filterwarnings("ignore", category=RuntimeWarning)

# The NOWA core raises if anything writes stable memory while awake (host-contract violation).
os.environ.setdefault("NOWA_STRICT_LEARNING", "1")


def nowa_available() -> bool:
    from nowasea.brains import nowa_adapter as na

    return (na.nowa_root() / "src" / "agent.py").is_file()


requires_nowa = pytest.mark.skipif(not nowa_available(), reason="NOWA not fetched (run scripts/setup)")


@pytest.fixture(scope="session")
def tank():
    from nowasea.world.tank import build_tank

    t = build_tank(7)
    t.build_grid()
    return t
