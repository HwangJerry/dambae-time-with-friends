"""Bounded HTTP calls; secrets and upstream response bodies never enter errors."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

TIMEOUT_SECONDS = 20
MAX_BYTES = 4 * 1024 * 1024


class RemoteError(RuntimeError):
    def __init__(self, status=None):
        self.status = status
        super().__init__(f'원격 요청을 확인하지 못했어요 (HTTP {status or "연결 오류"}).')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Http:
    def __init__(self, opener=None):
        self.opener = opener or build_opener(NoRedirect())

    def json(self, url, *, token='', method='GET', body=None):
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Malfunction-Harness'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = Request(url, method=method, headers=headers,
                          data=None if body is None else json.dumps(body).encode())
        try:
            with self.opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise RemoteError()
                if not raw:
                    return {}
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise RemoteError()
                return result
        except HTTPError as error:
            raise RemoteError(error.code) from None
        except (URLError, OSError, ValueError):
            raise RemoteError() from None

    def healthy(self, url):
        try:
            with self.opener.open(Request(url, headers={'User-Agent': 'Malfunction-Harness'}), timeout=TIMEOUT_SECONDS) as response:
                return response.status == 200
        except (HTTPError, URLError, OSError):
            return False
