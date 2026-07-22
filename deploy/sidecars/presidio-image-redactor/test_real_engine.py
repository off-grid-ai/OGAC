import io
import os
import unittest

from PIL import Image, ImageChops, ImageDraw, ImageFont

os.environ["PRESIDIO_IMAGE_REDACTOR_TOKEN"] = "build-verification-token-32-characters"

from app import _redact_sync  # noqa: E402


class RealPresidioImageRedactorTest(unittest.TestCase):
    def test_actual_library_redacts_an_email_from_pixels(self) -> None:
        source = Image.new("RGB", (1200, 220), "white")
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 54)
        ImageDraw.Draw(source).text((30, 70), "Email alice@example.com", font=font, fill="black")
        raw = io.BytesIO()
        source.save(raw, format="PNG")

        output, width, height, detections = _redact_sync(
            raw.getvalue(), "image/png", ["EMAIL_ADDRESS"], 0.5
        )
        redacted = Image.open(io.BytesIO(output)).convert("RGB")

        self.assertEqual((width, height), source.size)
        self.assertTrue(any(item["entity_type"] == "EMAIL_ADDRESS" for item in detections))
        self.assertIsNotNone(ImageChops.difference(source, redacted).getbbox())


if __name__ == "__main__":
    unittest.main()
