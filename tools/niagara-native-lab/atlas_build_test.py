#!/usr/bin/env python3
"""Focused tests for the ST01c atlas derivative recipe."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

TOOL_PATH = Path(__file__).with_name("atlas-build.py")
spec = importlib.util.spec_from_file_location("atlas_build", TOOL_PATH)
atlas_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(atlas_build)


class AtlasBuildTests(unittest.TestCase):
    def test_cellwise_resize_has_no_neighbor_bleed(self):
        source = Image.new("RGBA", (16, 8))
        for y in range(8):
            for x in range(16):
                source.putpixel((x, y), (255, 0, 0, 255) if x < 8 else (0, 0, 255, 255))
        result = atlas_build.build_atlas(source, (2, 1), 4)
        self.assertEqual(result.size, (8, 4))
        self.assertTrue(all(result.getpixel((x, y)) == (255, 0, 0, 255)
                            for x in range(4) for y in range(4)))
        self.assertTrue(all(result.getpixel((x, y)) == (0, 0, 255, 255)
                            for x in range(4, 8) for y in range(4)))

    def test_resize_uses_linear_light_rgb_and_separate_alpha(self):
        source = Image.new("RGBA", (2, 1))
        source.putpixel((0, 0), (0, 0, 0, 0))
        source.putpixel((1, 0), (255, 255, 255, 255))
        result = atlas_build.resize_frame_linear(source, 1)
        self.assertEqual(result.getpixel((0, 0)), (188, 188, 188, 128))

    def test_full_variant_preserves_rgba_including_transparent_rgb(self):
        source = Image.new("RGBA", (2, 2))
        source.putdata([(19, 43, 67, 0), (1, 2, 3, 255), (255, 0, 127, 4), (0, 0, 0, 0)])
        result = atlas_build.build_atlas(source, (1, 1), 2)
        self.assertEqual(result.tobytes(), source.tobytes())
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "exact.webp"
            result.save(target, format="WEBP", lossless=True, method=6, exact=True)
            with Image.open(target) as decoded:
                self.assertEqual(decoded.convert("RGBA").tobytes(), source.tobytes())

    def test_validation_rejects_hash_mismatch_and_bad_shape(self):
        source_spec = {"schema": atlas_build.SCHEMA, "sourceSystemSha256": "a" * 64,
                       "inputs": [{"id": "flame", "file": ".scratch/unreal/reference11/textures/T_FlameUV_2.png",
                        "sha256": "0" * 64, "dimensions": [2048, 1024], "grid": [8, 4], "srgb": True},
                        {"id": "smoke", "file": ".scratch/unreal/reference11/textures/T_Smoke_1.png",
                         "sha256": "b" * 64, "dimensions": [2560, 1536], "grid": [10, 6], "srgb": True}],
                       "variants": [{"id": key, "cellSize": value} for key, value in atlas_build.EXPECTED_VARIANTS.items()]}
        with tempfile.TemporaryDirectory() as temp:
            spec_path = Path(temp) / "spec.json"
            spec_path.write_text(json.dumps(source_spec), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source hash mismatch: flame"):
                atlas_build.load_spec(spec_path)
        source_spec["inputs"][0]["sha256"] = "a" * 64
        source_spec["inputs"][0]["dimensions"] = [2048, 1023]
        with tempfile.TemporaryDirectory() as temp:
            spec_path = Path(temp) / "spec.json"
            spec_path.write_text(json.dumps(source_spec), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "dimensions, grid, or sRGB"):
                atlas_build.load_spec(spec_path)

    def test_mip_storage_sums_integer_rgba8_levels(self):
        self.assertEqual(atlas_build.mip_rgba8_bytes(4, 2), (4 * 2 + 2 * 1 + 1) * 4)
        self.assertEqual(atlas_build.mip_rgba8_bytes(1, 1), 4)
        with self.assertRaises(ValueError):
            atlas_build.mip_rgba8_bytes(0, 1)


if __name__ == "__main__":
    unittest.main()
