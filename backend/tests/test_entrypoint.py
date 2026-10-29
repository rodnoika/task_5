from pathlib import Path
import runpy

import pytest
import uvicorn

MAIN = Path(__file__).resolve().parents[1] / "app" / "main.py"


@pytest.mark.parametrize("run_name", ["__main__", "__mp_main__"])
def test_file_entrypoint_resolves_package_from_any_working_directory(
    monkeypatch, tmp_path, run_name
):
    calls = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs))
    )
    namespace = runpy.run_path(str(MAIN), run_name=run_name)
    assert namespace["health"]()["backend"] == "FastAPI"
    if run_name == "__main__":
        assert calls[0][0] == ("app.main:app",)
        assert calls[0][1]["host"] == "127.0.0.1"
        assert calls[0][1]["port"] == 8000
    else:
        assert not calls
