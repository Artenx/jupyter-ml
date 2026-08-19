#
# Copyright 2018-2026 Elyra Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Advisory file locking for small JSON-backed stores."""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import threading
from typing import Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - exercised on Windows only
    fcntl = None
    import msvcrt


class JsonStoreLock:
    """Serialize read-modify-write operations across threads and processes."""

    def __init__(self, path: Path):
        self.path = path
        self._thread_lock = threading.RLock()

    @contextmanager
    def acquire(self) -> Iterator[None]:
        """Acquire the lock represented by a sibling lock file."""
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self._thread_lock:
            descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            try:
                if fcntl:
                    fcntl.flock(descriptor, fcntl.LOCK_EX)
                else:  # pragma: no cover - exercised on Windows only
                    os.write(descriptor, b"\0")
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    msvcrt.locking(descriptor, msvcrt.LK_LOCK, 1)
                yield
            finally:
                if fcntl:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                else:  # pragma: no cover - exercised on Windows only
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
                os.close(descriptor)
