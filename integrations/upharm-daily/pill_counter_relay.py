"""UPharmDaily adapter for Pill Counter's authenticated label queue (stdlib only).

The host application owns the printer driver and silent printing function.
Never report physical printing as complete merely because Windows accepted a job.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from uuid import UUID, uuid4


class RelayError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class PrintRejected(Exception):
    """Only use printer/layout when the adapter knows it did not submit a job."""
    def __init__(self, reason: str = "uncertain"):
        self.reason = reason if reason in ("printer", "layout") else "uncertain"
        super().__init__(self.reason)


SPOOLED = "spooled"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RelayError(code, "Relay redirects are not permitted")


def _uuid(value):
    try:
        return str(UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


class PillCounterReceiver:
    """Run one instance in the app. print_label(label) must return SPOOLED.

    The callback runs on this receiver's worker thread. Marshal into the GUI
    thread if required by the existing printer implementation. Wait for the
    actual spool result; do not acknowledge just scheduling a GUI callback.
    on_event receives a dict without medication data or authentication tokens.
    """

    def __init__(self, config: dict, print_label: Callable, *, printer_name: str,
                 journal_dir, on_event: Callable | None = None,
                 allow_local_http: bool = False):
        url = urlsplit(config.get("apiUrl", ""))
        production = (url.scheme == "https" and
                      url.netloc == "pharmacy-pill-counter-mvp.vercel.app")
        local_test = (allow_local_http and url.scheme == "http" and
                      url.hostname in ("127.0.0.1", "localhost"))
        if not (production or local_test) or url.path != "/api/print-relay" or url.query or url.fragment or url.username:
            raise ValueError("Unexpected relay endpoint")
        import re
        if (config.get("schemaVersion") != 1 or
                not re.fullmatch(r"\d{13}-[a-f0-9]{32}", config.get("stationId", "")) or
                not re.fullmatch(r"[a-f0-9]{64}", config.get("ownerToken", ""))):
            raise ValueError("Invalid UPharmDaily connection file")
        if not printer_name.strip() or len(printer_name) > 120:
            raise ValueError("Select an installed printer")
        self._config = dict(config)
        self._print_label = print_label
        self._printer_name = printer_name
        self._on_event = on_event or (lambda event: None)
        self._opener = build_opener(_NoRedirect())
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread = None
        self._heartbeat_at = 0.0
        self._paused = False
        directory = Path(journal_dir)
        directory.mkdir(parents=True, exist_ok=True)
        self._journal_path = directory / ("pill-relay-" + config["stationId"] + ".json")
        if self._journal_path.exists():
            self._journal = json.loads(self._journal_path.read_text(encoding="utf-8"))
            if not _uuid(self._journal.get("receiverId")) or not isinstance(self._journal.get("pending"), dict):
                raise ValueError("Invalid receiver journal; check physical prints before resetting")
            self._paused = bool(self._journal.get("paused", False))
            # A crash between claim and durable spool acknowledgement is uncertain.
            for entry in self._journal["pending"].values():
                if entry["state"] == "claimed":
                    entry.update(state="failed", reason="uncertain")
                    self._paused = True
        else:
            self._journal = {"receiverId": str(uuid4()), "pending": {}}
        self._save()

    def _emit(self, state, **data):
        try:
            self._on_event({"state": state, **data})
        except Exception:
            pass  # Host notifications cannot invalidate a durable print result.

    def _save(self):
        self._journal["paused"] = self._paused
        temporary = self._journal_path.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(self._journal, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self._journal_path)

    def _request(self, action, data=None, *, get=False):
        body = {"action": action, "station": self._config["stationId"], **(data or {})}
        url = self._config["apiUrl"]
        raw = None
        if get:
            url += "?" + urlencode(body)
        else:
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = Request(url, data=raw, method="GET" if get else "POST", headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + self._config["ownerToken"]})
        try:
            with self._opener.open(request, timeout=15) as response:
                return json.load(response)
        except HTTPError as error:
            # Do not expose credentials, request bodies or label details in errors.
            raise RelayError(error.code, "Relay request failed") from None

    def _heartbeat(self, state):
        self._request("receiver-heartbeat", {"receiverId": self._journal["receiverId"],
            "printerName": self._printer_name, "state": state})
        self._heartbeat_at = time.monotonic()

    def _flush_results(self):
        for job_id, entry in list(self._journal["pending"].items()):
            if entry["state"] == "claimed":
                # Never call the printer twice after an interrupted local write.
                entry.update(state="failed", reason="uncertain")
                self._paused = True
                self._save()
            self._request(entry["state"], {"jobId": job_id,
                "receiverId": self._journal["receiverId"], "claimId": entry["claimId"],
                **({"reason": entry["reason"]} if entry["state"] == "failed" else {})})
            self._emit(entry["state"], jobId=job_id, reason=entry.get("reason"))
            del self._journal["pending"][job_id]
            self._save()

    def poll_once(self):
        """One bounded receive cycle; also useful with an application's scheduler."""
        if not self._lock.acquire(blocking=False):
            return
        try:
            self._flush_results()
            if time.monotonic() - self._heartbeat_at >= 15:
                self._heartbeat("error" if self._paused else "ready")
            if self._paused or self._stop.is_set():
                return
            response = self._request("jobs", get=True)
            for job in response["jobs"]:
                if self._stop.is_set():
                    break
                if job.get("status", "waiting") != "waiting":
                    continue
                job_id = job["id"]
                if not _uuid(job_id):
                    raise ValueError("Invalid job ID")
                claim_id = str(uuid4())
                # An ambiguous/lost claim response is never retried for printing.
                claimed = self._request("claim", {"jobId": job_id,
                    "receiverId": self._journal["receiverId"], "claimId": claim_id})
                if not claimed.get("claimed"):
                    continue
                entry = {"claimId": claim_id, "state": "claimed"}
                self._journal["pending"][job_id] = entry
                self._save()  # Must succeed before invoking the existing printer.
                self._emit("processing", jobId=job_id)
                try:
                    result = self._print_label(dict(job["label"]))
                    if result != SPOOLED:
                        raise PrintRejected("uncertain")
                    entry["state"] = "spooled"
                except Exception as error:
                    entry.update(state="failed", reason=error.reason if isinstance(error, PrintRejected) else "uncertain")
                    self._paused = True
                self._save()
                self._flush_results()
                if self._paused:
                    self._heartbeat("error")
                    break
        finally:
            self._lock.release()

    def resume(self):
        """Call after the operator checks the printer/physical output; no reprint."""
        with self._lock:
            self._paused = False
            self._save()
            self._heartbeat_at = 0

    def run(self):
        try:
            while not self._stop.is_set():
                try:
                    self.poll_once()
                except RelayError as error:
                    if error.status in (403, 410):
                        self._emit("expired")
                        break
                    self._emit("connection_error")
                except Exception:
                    self._emit("connection_error")
                self._stop.wait(3)
        finally:
            try:
                self._heartbeat("stopped")
            except Exception:
                pass

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, name="UPharmDaily-label-relay", daemon=True)
        self._thread.start()

    def stop(self):
        """Stops accepting new labels; a spool call already in progress may finish."""
        self._stop.set()
