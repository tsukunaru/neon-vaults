"""Capture clean English Neon Vaults store media from the production build.

Chrome must already expose the local page through the DevTools protocol. The
tool uses only Python's standard library so it adds no project dependency.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "store-assets" / "en-release"
FRAMES = OUTPUT / "capture-frames"
DEBUG_ENDPOINT = "http://127.0.0.1:9224/json/list"
FPS = 10


class DevToolsSocket:
    def __init__(self, url: str) -> None:
        parsed = urlparse(url)
        self.socket = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=15)
        self.socket.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port or 80}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = self._read_http_headers()
        if not response.startswith(b"HTTP/1.1 101"):
            raise RuntimeError(response.decode("latin1", errors="replace"))
        expected = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        if f"sec-websocket-accept: {expected}".lower() not in response.decode("latin1").lower():
            raise RuntimeError("Invalid WebSocket handshake")
        self.next_id = 1

    def _read_http_headers(self) -> bytes:
        data = bytearray()
        while b"\r\n\r\n" not in data:
            data.extend(self.socket.recv(4096))
        return bytes(data)

    def _read_exact(self, count: int) -> bytes:
        data = bytearray()
        while len(data) < count:
            chunk = self.socket.recv(count - len(data))
            if not chunk:
                raise ConnectionError("DevTools socket closed")
            data.extend(chunk)
        return bytes(data)

    def _send_frame(self, payload: bytes, opcode: int = 1) -> None:
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        header.extend(mask)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.socket.sendall(header + masked)

    def _read_message(self) -> str:
        chunks: list[bytes] = []
        while True:
            first, second = self._read_exact(2)
            final = bool(first & 0x80)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(8))[0]
            masked = bool(second & 0x80)
            mask = self._read_exact(4) if masked else b""
            payload = self._read_exact(length)
            if masked:
                payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
            if opcode == 0x9:
                self._send_frame(payload, opcode=0xA)
                continue
            if opcode == 0x8:
                raise ConnectionError("DevTools closed the WebSocket")
            if opcode in (0x0, 0x1):
                chunks.append(payload)
                if final:
                    return b"".join(chunks).decode("utf-8")

    def command(self, method: str, params: dict[str, object] | None = None) -> dict[str, object]:
        command_id = self.next_id
        self.next_id += 1
        self._send_frame(json.dumps({"id": command_id, "method": method, "params": params or {}}).encode())
        while True:
            message = json.loads(self._read_message())
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise RuntimeError(f"{method}: {message['error']}")
            return message.get("result", {})

    def close(self) -> None:
        try:
            self._send_frame(b"", opcode=0x8)
        finally:
            self.socket.close()


def local_target() -> dict[str, object]:
    with urllib.request.urlopen(DEBUG_ENDPOINT, timeout=5) as response:
        targets = json.load(response)
    return next(target for target in targets if target.get("type") == "page" and "127.0.0.1:8765" in target.get("url", ""))


def evaluate(cdp: DevToolsSocket, expression: str, *, await_promise: bool = False) -> object:
    result = cdp.command(
        "Runtime.evaluate",
        {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
    )
    value = result.get("result", {})
    if value.get("subtype") == "error":
        raise RuntimeError(value.get("description", "Runtime.evaluate failed"))
    return value.get("value")


def wait_for(cdp: DevToolsSocket, condition: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if evaluate(cdp, f"Boolean({condition})"):
            return
        time.sleep(0.1)
    raise TimeoutError(condition)


def set_viewport(cdp: DevToolsSocket, width: int, height: int, *, mobile: bool) -> None:
    cdp.command(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": mobile,
            "screenWidth": width,
            "screenHeight": height,
        },
    )
    time.sleep(0.25)


def screenshot(cdp: DevToolsSocket, path: Path) -> None:
    result = cdp.command(
        "Page.captureScreenshot",
        {"format": "png", "fromSurface": True, "captureBeyondViewport": False},
    )
    path.write_bytes(base64.b64decode(result["data"]))


def click(cdp: DevToolsSocket, selector: str) -> None:
    found = evaluate(
        cdp,
        f"(()=>{{const element=document.querySelector({json.dumps(selector)});"
        "if(!element)return false;element.click();return true})()",
    )
    if not found:
        raise RuntimeError(f"Missing element: {selector}")


def key(cdp: DevToolsSocket, code: str) -> None:
    key_value = {"KeyW": "w", "KeyA": "a", "KeyS": "s", "KeyD": "d"}[code]
    for event_type in ("keyDown", "keyUp"):
        cdp.command(
            "Input.dispatchKeyEvent",
            {"type": event_type, "code": code, "key": key_value, "windowsVirtualKeyCode": ord(key_value.upper())},
        )


def reload_english(cdp: DevToolsSocket) -> None:
    cdp.command("Page.reload", {"ignoreCache": False})
    wait_for(cdp, "document.querySelector('#app') && !document.querySelector('#app').classList.contains('is-loading')")
    click(cdp, '[data-language="en"]')
    wait_for(cdp, "document.documentElement.lang === 'en'")


def start_campaign(cdp: DevToolsSocket) -> None:
    click(cdp, "#home-continue")
    time.sleep(0.35)
    if evaluate(cdp, "!document.querySelector('#sector-intro').classList.contains('hidden')"):
        click(cdp, "#sector-enter")
    wait_for(cdp, "document.querySelector('#game-canvas') && !document.querySelector('#home-screen').classList.contains('active')")
    time.sleep(0.35)


def start_rush(cdp: DevToolsSocket) -> None:
    click(cdp, "#nav-modes")
    click(cdp, "#open-rush")
    click(cdp, "#rush-start")
    wait_for(cdp, "document.querySelector('#rush-hud') && !document.querySelector('#rush-hud').classList.contains('hidden')")
    time.sleep(0.35)


def capture_frames(cdp: DevToolsSocket, prefix: str, count: int, actions: dict[int, str]) -> None:
    started = time.monotonic()
    for index in range(count):
        action = actions.get(index)
        if action:
            if action.startswith("#"):
                click(cdp, action)
            else:
                key(cdp, action)
        screenshot(cdp, FRAMES / f"{prefix}-{index:04d}.png")
        target = started + (index + 1) / FPS
        time.sleep(max(0, target - time.monotonic()))


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    FRAMES.mkdir(parents=True, exist_ok=True)
    cdp = DevToolsSocket(str(local_target()["webSocketDebuggerUrl"]))
    try:
        cdp.command("Page.enable")
        cdp.command("Runtime.enable")

        set_viewport(cdp, 1280, 720, mobile=False)
        reload_english(cdp)
        start_campaign(cdp)
        key(cdp, "KeyW")
        time.sleep(0.4)
        screenshot(cdp, OUTPUT / "desktop-gameplay-01-campaign.png")

        key(cdp, "KeyD")
        time.sleep(0.8)
        click(cdp, "#replay-button")
        time.sleep(0.45)
        capture_frames(cdp, "desktop", 80, {8: "KeyW", 30: "KeyD", 55: "#replay-button", 64: "KeyW"})

        reload_english(cdp)
        start_rush(cdp)
        key(cdp, "KeyD")
        time.sleep(0.35)
        screenshot(cdp, OUTPUT / "desktop-gameplay-02-vault-rush.png")
        capture_frames(cdp, "desktop-rush", 60, {10: "KeyW", 25: "KeyA", 40: "KeyS", 50: "KeyD"})

        set_viewport(cdp, 360, 640, mobile=True)
        reload_english(cdp)
        start_campaign(cdp)
        key(cdp, "KeyW")
        time.sleep(0.4)
        screenshot(cdp, OUTPUT / "mobile-gameplay-01-campaign.png")
        capture_frames(cdp, "mobile", 80, {20: "KeyD", 48: "#replay-button", 58: "KeyW"})

        reload_english(cdp)
        start_rush(cdp)
        key(cdp, "KeyD")
        time.sleep(0.35)
        screenshot(cdp, OUTPUT / "mobile-gameplay-02-vault-rush.png")
        capture_frames(cdp, "mobile-rush", 60, {10: "KeyW", 25: "KeyA", 40: "KeyS", 50: "KeyD"})

        language = evaluate(cdp, "document.documentElement.lang")
        report = {
            "language": language,
            "desktop": [1280, 720],
            "mobile": [360, 640],
            "fps": FPS,
            "campaignFramesPerOrientation": 80,
            "rushFramesPerOrientation": 60,
        }
        (OUTPUT / "capture-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        cdp.close()


if __name__ == "__main__":
    main()
