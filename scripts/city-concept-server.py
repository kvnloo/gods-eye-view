"""Single-request local image bridge. JSON in and JSON out; no credential output."""
import base64
import contextlib
import importlib.util
import io
import json
import os
import sys
import warnings

from PIL import Image

GENERATOR = "/mnt/zer0models/comfyui/custom_nodes/comfyui-codex-image/__init__.py"
REQUEST_LIMIT = 1024 * 1024
IMAGE_LIMIT = 600000
Image.MAX_IMAGE_PIXELS = 16_000_000


def reference_png(value):
    if not isinstance(value, str) or len(value) > REQUEST_LIMIT:
        raise ValueError("Invalid image")
    header, encoded = value.split(",", 1)
    formats = {"data:image/png;base64": "PNG", "data:image/jpeg;base64": "JPEG"}
    if header not in formats:
        raise ValueError("Invalid image")
    data = base64.b64decode(encoded, validate=True)
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            if image.format != formats[header]:
                raise ValueError("Invalid image")
            image.load()
            output = io.BytesIO()
            image.convert("RGB").save(output, "PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def load_generator():
    spec = importlib.util.spec_from_file_location("city_concept_codex_image", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def jpeg_data_url(image):
    image = image.convert("RGB")
    image.thumbnail((1536, 1024), Image.Resampling.LANCZOS)
    while True:
        for quality in (85, 70, 55, 40):
            output = io.BytesIO()
            image.save(output, "JPEG", quality=quality, optimize=True)
            value = "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
            if len(value) <= IMAGE_LIMIT:
                return value
        image.thumbnail((max(1, image.width * 3 // 4), max(1, image.height * 3 // 4)), Image.Resampling.LANCZOS)


def main():
    if len(sys.argv) != 1:
        raise ValueError("No process arguments accepted")
    raw = sys.stdin.read(REQUEST_LIMIT + 1)
    if len(raw.encode("utf-8")) > REQUEST_LIMIT:
        raise ValueError("Request too large")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or set(payload) != {"prompt", "image"}:
        raise ValueError("Invalid request")
    prompt = payload["prompt"]
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode("utf-8")) > 32768:
        raise ValueError("Invalid prompt")
    reference = reference_png(payload["image"])
    # Keep dependency diagnostics and upstream errors off both protocol streams.
    with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        generator = load_generator()
        image = generator.generate(prompt, [reference], size="1536x1024")
        result = jpeg_data_url(image)
    sys.stdout.write(json.dumps({"provider": "local", "image": result}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("Local concept generation failed\n")
        sys.exit(1)
