import asyncio
import threading
import unittest
from unittest.mock import patch

from app import _bounded_redaction


class OcrSlotCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_request_holds_slot_until_worker_finishes(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        calls = 0
        result = (b"redacted", 1, 1, [])

        def controlled_worker(*_args: object) -> tuple[bytes, int, int, list[object]]:
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                release.wait(timeout=2)
            return result

        with patch("app._redact_sync", controlled_worker):
            first = asyncio.create_task(_bounded_redaction(b"one", "image/png", ["PERSON"], 0.5))
            self.assertTrue(await asyncio.to_thread(entered.wait, 1))
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first

            second = asyncio.create_task(_bounded_redaction(b"two", "image/png", ["PERSON"], 0.5))
            await asyncio.sleep(0.05)
            self.assertFalse(second.done(), "the still-running first OCR worker must retain the only slot")

            release.set()
            self.assertEqual(await asyncio.wait_for(second, timeout=1), result)
            self.assertEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
