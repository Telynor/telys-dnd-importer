import importlib.util
import json
import socket
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("tely_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ExtractionTests(unittest.TestCase):
    def test_block_boundaries_and_script_removal(self):
        parser = bridge.ReadableHTML()
        parser.feed('<header>Navigation</header><main><h1>Watcher</h1><p>Armor Class 15<br>Hit Points 20</p><script>evil()</script><p>Speed 30 ft.</p></main>')
        text = parser.text()
        self.assertIn("Armor Class 15\nHit Points 20", text)
        self.assertIn("Speed 30 ft.", text)
        self.assertNotIn("Navigation", text)
        self.assertNotIn("evil", text)

    def test_hidden_and_nested_skipped_elements(self):
        parser = bridge.ReadableHTML()
        parser.feed('<p hidden><span>hidden</span><br>more hidden</p><p>Visible</p><svg><g>omit</g></svg><p>End</p>')
        self.assertEqual(parser.text(), "Visible\n\nEnd")

    def test_article_header_preserves_content_title(self):
        parser = bridge.ReadableHTML()
        parser.feed('<header>Site navigation</header><main><article><header><h1>Copperwork Watcher</h1></header><p>Armor Class 16</p></article></main><div>Unrelated footer</div>')
        text = parser.text()
        self.assertTrue(text.startswith("Copperwork Watcher"))
        self.assertNotIn("Site navigation", text)
        self.assertNotIn("Unrelated footer", text)

    def test_private_and_loopback_sources_are_rejected(self):
        for address in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "0.0.0.0"]:
            with self.subTest(address=address):
                def resolver(*args, **kwargs):
                    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80))]
                with self.assertRaises(ValueError):
                    bridge.public_target("http://example.com/source", resolver=resolver)

    def test_mixed_dns_and_nonstandard_ports_are_rejected(self):
        def resolver(*args, **kwargs):
            return [(2, 1, 6, "", ("1.1.1.1", 80)), (2, 1, 6, "", ("127.0.0.1", 80))]
        with self.assertRaises(ValueError):
            bridge.public_target("http://example.com/", resolver=resolver)
        with self.assertRaises(ValueError):
            bridge.public_target("http://example.com:8765/", resolver=resolver)

    def test_public_target_is_pinned_and_credentials_are_rejected(self):
        def resolver(*args, **kwargs):
            return [(2, 1, 6, "", ("1.1.1.1", 443))]
        parsed, hostname, port, address = bridge.public_target("https://example.com/data", resolver=resolver)
        self.assertEqual((hostname, port, address), ("example.com", 443, "1.1.1.1"))
        for url in ["file:///etc/passwd", "http://u:p@example.com/", "javascript:alert(1)"]:
            with self.assertRaises(ValueError):
                bridge.public_target(url, resolver=resolver)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
        cls.server.daemon_threads = True
        cls.server.token = "test-private-token"
        cls.server.allowed_origins = {"http://localhost:30000"}
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def post(self, path, body, token="test-private-token", origin="http://localhost:30000"):
        request = Request(self.url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "X-Tely-Token": token, "Origin": origin})
        return urlopen(request, timeout=3)

    def test_health_returns_no_secrets(self):
        with urlopen(self.url + "/health", timeout=3) as response:
            value = response.read().decode()
            self.assertNotIn(self.server.token, value)
            self.assertTrue(json.loads(value)["ok"])

    def test_missing_token_and_wrong_origin_are_rejected(self):
        with self.assertRaises(HTTPError) as caught:
            self.post("/fetch", {"url": "https://example.com"}, token="")
        self.assertEqual(caught.exception.code, 401)
        with self.assertRaises(HTTPError) as caught:
            self.post("/fetch", {"url": "https://example.com"}, origin="https://untrusted.example")
        self.assertEqual(caught.exception.code, 403)

    def test_fetch_route_and_cors_headers(self):
        with patch.object(bridge, "fetch_public_page", return_value={"text": "Source text", "url": "https://example.com"}) as mock:
            with self.post("/fetch", {"url": "https://example.com"}) as response:
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:30000")
                self.assertEqual(json.load(response)["text"], "Source text")
            mock.assert_called_once_with("https://example.com")

    def test_model_route_does_not_echo_keys(self):
        result = {"choices": [{"message": {"content": '{"entries":[]}'}}]}
        with patch.object(bridge, "proxy_model", return_value=result) as mock:
            with self.post("/extract", {"endpoint": "http://localhost:11434/v1/chat/completions", "apiKey": "secret", "request": {"messages": []}}) as response:
                body = response.read().decode()
                self.assertNotIn("secret", body)
                self.assertEqual(json.loads(body), result)
            self.assertEqual(mock.call_args.args[1], "secret")

    def test_network_errors_do_not_disclose_source_or_keys(self):
        with patch.object(bridge, "proxy_model", side_effect=OSError("secret credential details")):
            with self.assertRaises(HTTPError) as caught:
                self.post("/extract", {"endpoint": "https://example.com/v1/chat/completions", "apiKey": "secret", "request": {"messages": []}})
            self.assertNotIn("secret credential", caught.exception.read().decode())


if __name__ == "__main__":
    unittest.main()
