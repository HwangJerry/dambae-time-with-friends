"""Serialize signing/store operations across repository-scoped Mac runners."""
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def signing_lock():
    import fcntl
    root = Path.home() / '.local/share/malfunction-deploy'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'signing.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
