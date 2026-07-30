import pytest
from _pytest.monkeypatch import MonkeyPatch


@pytest.fixture(scope="module", autouse=True)
def _patch_minio_container():
    mp = MonkeyPatch()
    mp.setattr(
        "elyra.tests.kfp.test_bootstrapper.start_minio_container",
        lambda raise_on_failure=False: None,
    )
    mp.setattr(
        "elyra.tests.kfp.test_bootstrapper.stop_minio_container",
        lambda: None,
    )
    yield
    mp.undo()
