"""Run integration checks against temporary local services and always clean up."""
from contextlib import contextmanager
import os
import signal
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlparse

from .contract import local_path
from .http import Http

SERVICE_READY_TIMEOUT_SECONDS = 60
SERVICE_POLL_SECONDS = 0.25
SERVICE_STOP_TIMEOUT_SECONDS = 5
TEST_DIRECTORY_TOKEN = '${MALFUNCTION_TEST_DIR}'


def environment(extra, directory):
    result = dict(os.environ, MALFUNCTION_TEST_DIR=directory)
    result.update({key: value.replace(TEST_DIRECTORY_TOKEN, directory) for key, value in extra.items()})
    return result


@contextmanager
def test_services(root, component, directory):
    processes = []
    http = Http()
    try:
        for service in component['build'].get('test_services', []):
            url = urlparse(service['health_url'])
            host = '127.0.0.1' if url.hostname == 'localhost' else url.hostname
            family = socket.AF_INET6 if ':' in host else socket.AF_INET
            try:
                with socket.socket(family, socket.SOCK_STREAM) as reservation:
                    reservation.bind((host, url.port))
            except OSError:
                raise RuntimeError('검증용 서비스 포트가 이미 사용 중이에요: ' + service['id']) from None
            process = subprocess.Popen(service['command'], cwd=local_path(root, service.get('root', component['root'])),
                                       env=environment(service.get('env', {}), directory), start_new_session=True)
            processes.append(process)
            deadline = time.monotonic() + service.get('ready_timeout_seconds', SERVICE_READY_TIMEOUT_SECONDS)
            while True:
                if process.poll() is not None:
                    raise RuntimeError('검증용 서비스가 준비 전에 종료됐어요: ' + service['id'])
                if http.healthy(service['health_url'], timeout=1):
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('검증용 서비스 준비 시간이 지났어요: ' + service['id'])
                time.sleep(SERVICE_POLL_SECONDS)
        yield
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('검증 중 필요한 서비스가 종료됐어요.')
    finally:
        for process in reversed(processes):
            try:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=SERVICE_STOP_TIMEOUT_SECONDS)
                except subprocess.TimeoutExpired:
                    pass
            except ProcessLookupError:
                pass
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()


def run_checks(root, component, run):
    with tempfile.TemporaryDirectory(prefix='malfunction-checks-') as directory:
        env = environment(component['build'].get('test_env', {}), directory)
        cwd = local_path(root, component['root'])
        for argv in component['build'].get('prepare', []):
            run(argv, cwd=cwd, env=env)
        with test_services(root, component, directory):
            for argv in component['build']['checks']:
                run(argv, cwd=cwd, env=env)
