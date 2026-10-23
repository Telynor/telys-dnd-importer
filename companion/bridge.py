#!/usr/bin/env python3
"""Local, token-protected CORS bridge. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import hmac
import http.client
import ipaddress
import json
import os
import secrets
import socket
import ssl
import sys
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

VERSION = "0.1.0-alpha.1"
MAX_PAGE = 5_000_000
MAX_REQUEST = 30_000_000
MAX_RESPONSE = 4_000_000


class ReadableHTML(HTMLParser):
    SKIP = {"script", "style", "noscript", "iframe", "svg", "nav", "footer", "aside", "form", "button"}
    BLOCK = {"p", "div", "section", "article", "main", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skipping = []
        self.content_depth = 0
        self.primary_found = False

    def handle_starttag(self, tag, attrs):
        if self.skipping:
            if tag not in {"br", "hr", "img", "input", "meta", "link", "source", "wbr"}:
                self.skipping.append(tag)
            return
        values = dict(attrs)
        if tag in self.SKIP or (tag == "header" and not self.content_depth) or "hidden" in values or values.get("aria-hidden") == "true":
            self.skipping.append(tag)
            return
        if tag in {"main", "article"}:
            if not self.primary_found:
                self.parts = []
                self.primary_found = True
            self.content_depth += 1
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if not self.skipping and tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.skipping:
            if tag in self.skipping:
                index = len(self.skipping) - 1 - self.skipping[::-1].index(tag)
                del self.skipping[index:]
            return
        if tag in self.BLOCK:
            self.parts.append("\n")
        elif tag in {"th", "td"}:
            self.parts.append(" | ")
        if tag in {"main", "article"}:
            self.content_depth = max(0, self.content_depth - 1)

    def handle_data(self, data):
        if not self.skipping and (not self.primary_found or self.content_depth):
            self.parts.append(data)

    def text(self):
        import re
        text = "".join(self.parts).replace("\xa0", " ")
        text = re.sub(r"[ \t]+", " ", text)
        return re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()


def public_target(url, resolver=socket.getaddrinfo):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Web sources must use HTTP(S) without credentials.")
    if any(c in url for c in "\r\n\x00"):
        raise ValueError("Invalid URL.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in {80, 443}:
        raise ValueError("Web source ports must be 80 or 443.")
    hostname = parsed.hostname.encode("idna").decode("ascii")
    addresses = sorted({r[4][0] for r in resolver(hostname, port, type=socket.SOCK_STREAM)})
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("Web source links must resolve only to public IP addresses.")
    return parsed, hostname, port, addresses[0]


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, address, port):
        super().__init__(hostname, port, timeout=25, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def fetch_public_page(url):
    # Resolve and pin each hop: a redirect or DNS change cannot reach local services.
    current = str(url)
    for _ in range(6):
        parsed, hostname, port, address = public_target(current)
        if parsed.scheme == "https":
            connection = PinnedHTTPSConnection(hostname, address, port)
        else:
            connection = http.client.HTTPConnection(address, port, timeout=25)
        path = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
        if parsed.query:
            path += "?" + quote(parsed.query, safe="=&%/:?@!$'()*+,;~-._")
        host_header = hostname if port in {80, 443} else f"{hostname}:{port}"
        try:
            connection.request("GET", path, headers={"Host": host_header, "User-Agent": "TelysDNDImporter/" + VERSION, "Accept": "text/html,text/plain,application/xhtml+xml", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ValueError("Website redirect had no destination.")
                current = urljoin(current, location)
                continue
            if response.status != 200:
                raise ValueError(f"Website returned HTTP {response.status}. Paste the visible page content instead.")
            content_type = response.getheader("Content-Type", "")
            if not any(t in content_type.lower() for t in ["text/html", "text/plain", "application/xhtml+xml"]):
                raise ValueError("Link must point to HTML or plain text.")
            if int(response.getheader("Content-Length", "0")) > MAX_PAGE:
                raise ValueError("Page is too large. Paste the relevant content.")
            body = response.read(MAX_PAGE + 1)
            if len(body) > MAX_PAGE:
                raise ValueError("Page is too large. Paste the relevant content.")
            encoding = "utf-8"
            if "charset=" in content_type.lower():
                encoding = content_type.lower().split("charset=", 1)[1].split(";", 1)[0].strip(' "')
            try:
                text = body.decode(encoding, errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")
            if "html" in content_type.lower():
                parser = ReadableHTML()
                parser.feed(text)
                text = parser.text()
            if len(text) > 120_000:
                raise ValueError("Page has too much text. Paste only the relevant section.")
            return {"url": current, "text": text}
        finally:
            connection.close()
    raise ValueError("Website redirected too many times.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Model endpoint redirected; configure its final URL directly.")


def proxy_model(endpoint, api_key, request):
    parsed = urlsplit(str(endpoint))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid model endpoint URL.")
    if not parsed.path.endswith("/chat/completions"):
        raise ValueError("Use a chat-completions endpoint ending in /chat/completions.")
    if not isinstance(request, dict) or not isinstance(request.get("messages"), list) or request.get("stream"):
        raise ValueError("Expected a non-streaming chat-completions request.")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        if "\r" in api_key or "\n" in api_key:
            raise ValueError("Invalid API key.")
        headers["Authorization"] = "Bearer " + api_key
    req = Request(endpoint, data=json.dumps(request).encode("utf-8"), headers=headers, method="POST")
    try:
        with build_opener(NoRedirect()).open(req, timeout=170) as response:
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ValueError("Model response is too large.")
            return json.loads(data)
    except HTTPError as error:
        raise ValueError(f"Model endpoint returned HTTP {error.code}; check model and credentials.") from None


class Handler(BaseHTTPRequestHandler):
    server_version = "TelyDNDCompanion/" + VERSION

    def log_message(self, fmt, *args):
        # Do not log source URLs, request bodies, API keys, or tokens.
        return

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in self.server.allowed_origins

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Tely-Token")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204 if self.origin_allowed() else 403, {})

    def do_GET(self):
        if not self.origin_allowed():
            return self.reply(403, {"error": "Origin not allowed."})
        if self.path == "/health":
            return self.reply(200, {"ok": True, "version": VERSION})
        self.reply(404, {"error": "Not found."})

    def do_POST(self):
        if not self.origin_allowed():
            return self.reply(403, {"error": "Origin not allowed. Restart with --allow-origin and your exact Foundry origin."})
        token = self.headers.get("X-Tely-Token", "")
        if not hmac.compare_digest(token, self.server.token):
            return self.reply(401, {"error": "Bridge token is missing or incorrect."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_REQUEST:
                return self.reply(413, {"error": "Request is empty or exceeds 30 MB."})
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("Request body must be an object.")
            if self.path == "/fetch":
                result = fetch_public_page(body.get("url", ""))
            elif self.path == "/extract":
                result = proxy_model(body.get("endpoint", ""), body.get("apiKey") or os.environ.get("TELY_IMPORTER_API_KEY", ""), body.get("request"))
            else:
                return self.reply(404, {"error": "Not found."})
            self.reply(200, result)
        except (ValueError, TypeError, KeyError, OSError, http.client.HTTPException):
            # Keep details generic: URLs and tokens can occur in network exceptions.
            self.reply(400, {"error": "Source/model request failed. Check the URL, public page access, model endpoint, and model capabilities. Nothing was imported."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", default=[], help="Exact Foundry origin, e.g. http://localhost:30000 (repeatable)")
    args = parser.parse_args()
    origins = args.allow_origin or ["http://localhost:30000", "http://127.0.0.1:30000"]
    for origin in origins:
        value = urlsplit(origin)
        if value.scheme not in {"http", "https"} or not value.netloc or value.path or value.query or value.fragment or value.username:
            parser.error("Origins must be exact HTTP(S) origins without a path or credentials.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.allowed_origins = set(origins)
    server.token = os.environ.get("TELY_IMPORTER_BRIDGE_TOKEN") or secrets.token_urlsafe(32)
    print(f"Tely's DND Importer companion {VERSION}", flush=True)
    print(f"Bridge URL: http://127.0.0.1:{args.port}", flush=True)
    print(f"Bridge token: {server.token}", flush=True)
    print("Allowed Foundry origins: " + ", ".join(origins), flush=True)
    print("Paste the token into Model & connection. Keep this window open. Ctrl+C stops the companion.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
