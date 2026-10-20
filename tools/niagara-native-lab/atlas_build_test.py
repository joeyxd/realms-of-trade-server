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

    def test_ktx2_parser_rejects_foreign_or_truncated_files(self):
        with self.assertRaises(ValueError):
            atlas_build.parse_ktx2(b"RIFF" * 40)
        with self.assertRaises(ValueError):
            atlas_build.parse_ktx2(atlas_build.KTX2_MAGIC + b"\x00" * 20)

    def test_toktx_recipe_declares_srgb_uastc_zstd_with_mipmaps_and_gl_origin(self):
        if not atlas_build.DEFAULT_TOKTX.is_file():
            self.skipTest("portable toktx is not installed")
        self.assertIn("--genmipmap", atlas_build.KTX2_RECIPES["ktx2-uastc"])
        self.assertFalse([a for a in atlas_build.KTX2_RECIPES["ktx2-uastc"] if a.startswith("--uastc_rdo")])
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "tiny.png"
            image = Image.new("RGBA", (16, 8), (200, 40, 10, 255))
            image.putpixel((0, 0), (0, 0, 255, 255))
            image.save(source)
            row = {"id": "flame", "dimensions": [16, 8], "file": "tiny.png"}
            name, data, info, command = atlas_build.encode_ktx2(atlas_build.DEFAULT_TOKTX, "ktx2-uastc", row, source, Path(temp))
            self.assertEqual(name, "ktx2-uastc-flame.ktx2")
            self.assertEqual((info["width"], info["height"], len(info["levels"])), (16, 8, 5))
            self.assertEqual((info["transfer"], info["primaries"], info["supercompression"]), (2, 1, 2))
            self.assertIn(b"KTXorientation\x00ru", data)
            self.assertEqual(command[0], "toktx")
            self.assertIn("--encode uastc", " ".join(command))

    def test_diagnostic_recipes_are_a_2x2_over_the_uastc_line(self):
        recipes = atlas_build.KTX2_RECIPES
        self.assertEqual(recipes["ktx2-uastc"], ("--t2", "--encode", "uastc", "--uastc_quality", "4", "--zcmp", "3", "--genmipmap",
                                                 "--lower_left_maps_to_s0t0", "--assign_oetf", "srgb", "--assign_primaries", "srgb"))
        self.assertEqual(recipes["ktx2-uastc-box"], recipes["ktx2-uastc"] + ("--filter", "box"))
        self.assertEqual(recipes["ktx2-rgba8"], ("--t2", "--zcmp", "3", "--genmipmap", "--lower_left_maps_to_s0t0",
                                                 "--assign_oetf", "srgb", "--assign_primaries", "srgb"))
        self.assertEqual(recipes["ktx2-rgba8-box"], recipes["ktx2-rgba8"] + ("--filter", "box"))
        self.assertNotIn("--filter", recipes["ktx2-uastc"] + recipes["ktx2-rgba8"])
        self.assertEqual(set(atlas_build.EXPECTED_VARIANTS) | set(atlas_build.DIAGNOSTIC_VARIANTS), {*atlas_build.WEBP_VARIANTS, *recipes})
        self.assertFalse(set(atlas_build.EXPECTED_VARIANTS) & set(atlas_build.DIAGNOSTIC_VARIANTS))

    def test_rgba8_variants_write_raw_srgb_levels_and_box_changes_only_the_mips(self):
        if not atlas_build.DEFAULT_TOKTX.is_file():
            self.skipTest("portable toktx is not installed")
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "noise.png"
            image = Image.new("RGBA", (16, 8))
            image.putdata([((x * 37 + y * 11) % 256, (x * x * 5 + y * 3) % 256, (x * y * 7) % 256, 255 - (x + y) % 3 * 60)
                           for y in range(8) for x in range(16)])
            image.save(source)
            row = {"id": "flame", "dimensions": [16, 8], "file": "noise.png"}
            built = {}
            for ident in ("ktx2-rgba8", "ktx2-rgba8-box"):
                name, data, info, command = atlas_build.encode_ktx2(atlas_build.DEFAULT_TOKTX, ident, row, source, Path(temp))
                self.assertEqual(name, f"{ident}-flame.ktx2")
                self.assertEqual((info["vkFormat"], info["colorModel"], info["primaries"], info["transfer"]), (43, 1, 1, 2))
                self.assertEqual([level["uncompressedByteLength"] for level in info["levels"]], [512, 128, 32, 8, 4])
                self.assertNotIn("--encode", command)
                self.assertEqual("--filter box" in " ".join(command), ident.endswith("-box"))
                built[ident] = data
            self.assertNotEqual(built["ktx2-rgba8"], built["ktx2-rgba8-box"])
            again = atlas_build.encode_ktx2(atlas_build.DEFAULT_TOKTX, "ktx2-rgba8-box", row, source, Path(temp))[1]
            self.assertEqual(again, built["ktx2-rgba8-box"])
            box = atlas_build.encode_ktx2(atlas_build.DEFAULT_TOKTX, "ktx2-uastc-box", row, source, Path(temp))
            self.assertEqual((box[2]["vkFormat"], box[2]["colorModel"], len(box[2]["levels"])), (0, 166, 5))
            self.assertIn("--filter box", " ".join(box[3]))


if __name__ == "__main__":
    unittest.main()
