#!/usr/bin/env python3
"""Replace reduced arena exports with the desktop project's original PNGs."""

import argparse
import json
import shutil
import struct
import subprocess
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
MANIFEST = PROJECT / "web/public/assets/manifest.json"
ASSETS = PROJECT / "web/public"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_info(path: Path) -> tuple[int, int, int]:
    with path.open("rb") as source:
        header = source.read(29)
    if len(header) < 29 or not header.startswith(PNG_SIGNATURE) or header[12:16] != b"IHDR":
        raise ValueError(f"Not a valid PNG: {path}")
    width, height = struct.unpack(">II", header[16:24])
    return width, height, header[24]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Desktop Art/Textures/Arena directory")
    args = parser.parse_args()
    source_dir = args.source_dir.resolve(strict=True)
    manifest = json.loads(MANIFEST.read_text())
    replacements = []

    # Validate the complete set before changing the bundle.
    for name, entry in manifest["textures"].items():
        if not entry.get("source", "").startswith("Art/Textures/Arena/"):
            continue
        source = source_dir / Path(entry["source"]).name
        width, height, depth = png_info(source)
        if [width, height] != entry["sourceSize"]:
            raise ValueError(f"{name}: PNG dimensions do not match the source manifest")
        destination = ASSETS / f"assets/textures/arena/{name}.png"
        old = ASSETS / entry["path"]
        replacements.append((entry, source, destination, old, width, height, depth))

    if len(replacements) != 35:
        raise ValueError(f"Expected 35 authored arena textures, found {len(replacements)}")

    new_bytes = 0
    for entry, source, destination, _old, width, height, depth in replacements:
        if source.stem.endswith("_N"):
            # The authored normal maps use DirectX Y. The desktop web exporter
            # flipped green for glTF/OpenGL; keep that conversion without
            # reducing the image to 1024 px or quantizing it to WebP.
            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source), "-vf", "lutrgb=g=negval",
                "-frames:v", "1", "-pix_fmt", "rgb24", str(destination),
            ], check=True)
            encoding = "full-resolution lossless PNG; green flipped from DirectX source"
        else:
            shutil.copyfile(source, destination)
            encoding = f"original {depth}-bit PNG"
        size = destination.stat().st_size
        new_bytes += size
        entry.update({
            "path": destination.relative_to(ASSETS).as_posix(),
            "bytes": size,
            "width": width,
            "height": height,
            "encoding": encoding,
        })

    for _entry, _source, _destination, old, *_ in replacements:
        if old.suffix.lower() == ".webp":
            old.unlink()
    asset_root = ASSETS / "assets"
    manifest["bytesByCategory"] = {
        category: sum(path.stat().st_size for path in (asset_root / category).rglob("*") if path.is_file())
        for category in ("models", "textures", "audio", "fonts")
    }
    manifest["totalBytes"] = sum(manifest["bytesByCategory"].values())
    manifest["budget"]["withinBudget"] = manifest["totalBytes"] <= manifest["budget"]["targetBytes"]
    manifest["budget"]["note"] = (
        "Standalone iOS bundle uses original desktop arena PNGs; the website's 40 MB target does not apply. "
        "Counts include model LOD files and the LOD index."
    )
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"Imported {len(replacements)} original arena PNGs; arena textures: {new_bytes:,} bytes")


if __name__ == "__main__":
    main()
