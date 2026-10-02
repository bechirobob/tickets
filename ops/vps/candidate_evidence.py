#!/usr/bin/env python3
r"""Bounded, lossless transport of isolated Candidate fixture evidence in job logs.

This is reviewable evidence storage only, never a build cache or release package.
It does not alter test results or make a failed/skipped browser gate successful.
Only the named synthetic fixture PNGs and Room geometry JSON are eligible. No
screenshots, traces, fixture credentials, or logs are collected indiscriminately.

Encode immediately after the focused suite, before Playwright clears outputs::

    python3 ops/vps/candidate_evidence.py encode --root test-results/operations \
      --stage operations --source-sha FULL_SHA --browser desktop-chromium

Decode a downloaded, plain-text GitHub job log (timestamp prefixes are allowed)::

    python3 ops/vps/candidate_evidence.py decode --log verify.log --out review \
      --stage operations --source-sha FULL_SHA --browser desktop-chromium

Run decode separately for each browser/stage; use a new output directory each
time. The decoder validates the COMPLETE selected stream before writing files,
retains the original bytes, and writes evidence-manifest.json alongside them.
A source SHA supplied by a trusted caller plus the job's exact-source/tree/build
checks provides attribution; a digest alone is not proof of source authenticity.
"""

import argparse
import base64
import binascii
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import zlib

PREFIX = "BECORE_CANDIDATE_EVIDENCE_V1 "
BROWSERS = ("desktop-chromium", "mobile-chromium", "mobile-webkit")
STAGES = ("operations", "room-entry")
MAX_STAGE_BYTES = 2 * 1024 * 1024
MAX_JSON_BYTES = 256 * 1024
MAX_LOG_BYTES = 64 * 1024 * 1024
MAX_LINE_BYTES = 32 * 1024
MAX_PNG_PIXELS = 16_000_000
MAX_FILES = 7
CHUNK_BYTES = 3072  # 4096 base64 characters, safely below a GitHub log line limit.
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
OPERATIONS_NAMES = ("fee-effective-time.png", "provider-record-action.png", "dispute-provider-handoff.png")
ROOM_NAMES = ("room-natural-entry.png", "room-natural-complete.png", "room-natural-entry.json", "room-reduced-motion.png")


class EvidenceError(ValueError):
    """Missing, malformed, mixed, or unbounded fixture evidence."""


def require(value, message):
    if not value:
        raise EvidenceError(message)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, "duplicate JSON key")
            result[key] = item
        return result
    def bad_constant(_):
        raise EvidenceError("non-finite JSON number")
    try:
        return json.loads(value, object_pairs_hook=unique, parse_constant=bad_constant)
    except (ValueError, UnicodeError) as error:
        raise EvidenceError(f"malformed JSON: {error}") from error


def identity(source_sha, browser, stage):
    require(isinstance(source_sha, str) and re.fullmatch(r"[a-f0-9]{40}", source_sha), "invalid source SHA")
    require(browser in BROWSERS and stage in STAGES, "invalid browser or stage")
    return {"source_sha": source_sha, "browser": browser, "stage": stage}


def required_names(browser, stage):
    if stage == "operations":
        return Counter({name: 1 for name in OPERATIONS_NAMES})
    if browser == "desktop-chromium":
        # Natural-entry tests explicitly skip desktop; reduced-motion does not.
        return Counter({"room-reduced-motion.png": 1})
    return Counter({"room-natural-entry.png": 2, "room-natural-complete.png": 2,
                    "room-natural-entry.json": 2, "room-reduced-motion.png": 1})


def safe_path(value, browser, stage):
    require(isinstance(value, str) and len(value) <= 260, "invalid evidence path")
    require(re.fullmatch(r"[A-Za-z0-9_.\-/]+", value), "unsafe evidence path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and len(path.parts) == 2 and path.as_posix() == value,
            "evidence needs a canonical relative fixture path")
    require(all(part not in (".", "..") for part in path.parts), "unsafe path traversal")
    require(path.parent.name.endswith("-" + browser), "path belongs to a different browser")
    allowed = OPERATIONS_NAMES if stage == "operations" else ROOM_NAMES
    require(path.name in allowed, "file is not allowlisted fixture evidence")
    return path


def validate_png(data):
    require(data.startswith(PNG_SIGNATURE), "invalid PNG signature")
    offset, count, ended = len(PNG_SIGNATURE), 0, False
    dimensions = None
    compressed = bytearray()
    seen_idat, idat_closed = False, False
    while offset < len(data):
        require(offset + 12 <= len(data), "truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        require(re.fullmatch(b"[A-Za-z]{4}", kind), "invalid PNG chunk type")
        end = offset + 12 + length
        require(end <= len(data), "truncated PNG payload")
        payload = data[offset + 8:offset + 8 + length]
        checksum = struct.unpack_from(">I", data, offset + 8 + length)[0]
        require(zlib.crc32(kind + payload) & 0xFFFFFFFF == checksum, "PNG CRC mismatch")
        require(not ended, "trailing PNG data")
        if count == 0:
            require(kind == b"IHDR" and length == 13, "missing PNG header")
        if kind == b"IHDR":
            require(count == 0 and length == 13, "duplicate PNG header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            require(0 < width <= 20000 and 0 < height <= 20000 and width * height <= MAX_PNG_PIXELS,
                    "PNG dimensions exceed limits")
            # Playwright's Chromium and WebKit screenshots use this exact subset.
            require(depth == 8 and color in (2, 6) and compression == filtering == interlace == 0,
                    "unsupported screenshot PNG encoding")
            dimensions = (width, height, 3 if color == 2 else 4)
        elif kind == b"IDAT":
            require(not idat_closed, "non-contiguous PNG image chunks")
            seen_idat = True
            compressed.extend(payload)
        elif kind == b"IEND":
            require(length == 0 and seen_idat, "invalid PNG end")
            ended = True
        else:
            require(kind[0] & 32 or kind == b"PLTE", "unknown critical PNG chunk")
            if seen_idat:
                idat_closed = True
        count += 1
        offset = end
    require(ended and dimensions is not None, "missing PNG end")
    width, height, channels = dimensions
    expected = (width * channels + 1) * height
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(compressed, expected + 1)
    except zlib.error as error:
        raise EvidenceError("malformed PNG compressed pixels") from error
    require(len(pixels) == expected and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
            "PNG pixel length or compression mismatch")
    require(all(pixels[row * (width * channels + 1)] <= 4 for row in range(height)), "invalid PNG row filter")


def validate_files(files, browser, stage):
    require(0 < len(files) <= MAX_FILES, "invalid evidence file count")
    require(sum(len(data) for data in files.values()) <= MAX_STAGE_BYTES, "stage exceeds 2 MiB raw limit")
    names, room_states = Counter(), []
    for relative, data in files.items():
        path = safe_path(relative, browser, stage)
        names[path.name] += 1
        require(0 < len(data) <= MAX_STAGE_BYTES, "empty or oversized evidence")
        if path.suffix == ".png":
            validate_png(data)
        else:
            require(len(data) <= MAX_JSON_BYTES, "Room JSON exceeds limit")
            value = strict_json(data)
            require(isinstance(value, dict) and set(value) == {"project", "input", "shortViewport", "samples", "insertions"},
                    "unexpected Room JSON schema")
            require(value["project"] == browser and type(value["shortViewport"]) is bool,
                    "Room JSON belongs to another browser or viewport")
            expected_input = ("Chromium touch input in an emulated mobile viewport" if browser == "mobile-chromium"
                              else "WebKit mobile viewport with incremental programmatic scrolling")
            require(value["input"] == expected_input, "unexpected Room input evidence")
            require(isinstance(value["samples"], list) and 0 < len(value["samples"]) <= 100 and
                    isinstance(value["insertions"], list) and len(value["insertions"]) <= 1000,
                    "invalid Room geometry evidence")
            room_states.append(value["shortViewport"])
            for sibling in ("room-natural-entry.png", "room-natural-complete.png"):
                require(str(path.with_name(sibling)) in files, "Room screenshot/geometry pair is incomplete")
    require(names == required_names(browser, stage), "missing, duplicate, or unexpected required screenshots")
    if room_states:
        require(sorted(room_states) == [False, True], "Room evidence must include both viewport sizes")


def no_symlinks(path):
    for part in (path.absolute(), *path.absolute().parents):
        require(not part.is_symlink(), "symlinks are not allowed in evidence paths")


def collect(root, browser, stage):
    root = Path(root)
    no_symlinks(root)
    require(root.is_dir(), "fixture output directory is missing")
    allowed = OPERATIONS_NAMES if stage == "operations" else ROOM_NAMES
    files = {}
    total = 0
    for path in sorted(root.rglob("*")):
        if path.name not in allowed:
            continue
        no_symlinks(path)
        require(path.is_file(), "evidence is not a regular file")
        relative = path.relative_to(root).as_posix()
        safe_path(relative, browser, stage)
        size = path.stat().st_size
        require(0 < size <= MAX_STAGE_BYTES and total + size <= MAX_STAGE_BYTES, "stage exceeds 2 MiB raw limit")
        with path.open("rb") as handle:
            data = handle.read(MAX_STAGE_BYTES + 1)
        require(len(data) == size, "evidence changed during collection")
        files[relative] = data
        total += size
        require(len(files) <= MAX_FILES, "too many evidence files")
    validate_files(files, browser, stage)
    return files


def encode(root, source_sha, browser, stage):
    origin = identity(source_sha, browser, stage)
    files = collect(root, browser, stage)  # Validate everything before printing anything.
    manifest = [{"path": path, "bytes": len(data), "sha256": digest(data),
                 "chunks": (len(data) + CHUNK_BYTES - 1) // CHUNK_BYTES} for path, data in files.items()]
    manifest_sha256 = digest(canonical(manifest).encode())
    records = [{**origin, "type": "begin", "files": manifest, "total_bytes": sum(map(len, files.values())),
                "manifest_sha256": manifest_sha256}]
    for index, (path, data) in enumerate(files.items(), 1):
        total = manifest[index - 1]["chunks"]
        for number, start in enumerate(range(0, len(data), CHUNK_BYTES), 1):
            records.append({**origin, "type": "chunk", "file": index, "number": number, "total": total,
                            "data": base64.b64encode(data[start:start + CHUNK_BYTES]).decode("ascii")})
    records.append({**origin, "type": "end", "manifest_sha256": manifest_sha256,
                    "file_count": len(files), "total_bytes": sum(map(len, files.values()))})
    return "".join(PREFIX + canonical(record) + "\n" for record in records)


def validate_manifest(record, browser, stage):
    entries = record.get("files")
    require(isinstance(entries, list) and 0 < len(entries) <= MAX_FILES, "invalid manifest file count")
    paths = []
    for entry in entries:
        require(isinstance(entry, dict) and set(entry) == {"path", "bytes", "sha256", "chunks"}, "invalid manifest entry")
        safe_path(entry["path"], browser, stage)
        require(integer(entry["bytes"], 1, MAX_STAGE_BYTES), "invalid declared byte count")
        require(isinstance(entry["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]), "invalid declared digest")
        require(integer(entry["chunks"], 1, (MAX_STAGE_BYTES + CHUNK_BYTES - 1) // CHUNK_BYTES) and
                entry["chunks"] == (entry["bytes"] + CHUNK_BYTES - 1) // CHUNK_BYTES, "invalid declared chunk count")
        paths.append(entry["path"])
    require(len(set(paths)) == len(paths) and paths == sorted(paths), "duplicate or unordered manifest paths")
    total = sum(entry["bytes"] for entry in entries)
    require(integer(record.get("total_bytes"), 1, MAX_STAGE_BYTES) and total == record["total_bytes"], "invalid manifest total")
    require(record.get("manifest_sha256") == digest(canonical(entries).encode()), "manifest digest mismatch")
    require(Counter(PurePosixPath(path).name for path in paths) == required_names(browser, stage), "incomplete screenshot manifest")
    return entries


def decode(log, source_sha, browser, stage):
    """Return validated (manifest, byte mapping), without any filesystem writes."""
    origin = identity(source_sha, browser, stage)
    require(isinstance(log, str) and len(log.encode("utf-8")) <= MAX_LOG_BYTES, "job log exceeds 64 MiB limit")
    active, complete, header = False, False, None
    entries, buffers = [], []
    expected_file, expected_number = 1, 1
    for line in log.splitlines():
        position = line.find(PREFIX)
        if position < 0:
            continue
        payload = line[position + len(PREFIX):]
        require(len(payload.encode()) <= MAX_LINE_BYTES, "evidence line exceeds limit")
        record = strict_json(payload)
        require(isinstance(record, dict), "invalid evidence record")
        selected = record.get("browser") == browser and record.get("stage") == stage
        if not active and not selected:
            continue  # Other browser/stage evidence in the same job is independent.
        require(all(record.get(key) == value for key, value in origin.items()), "mixed source/browser/stage evidence")
        kind = record.get("type")
        if kind == "begin":
            require(not active and not complete, "duplicate evidence stream")
            require(set(record) == set(origin) | {"type", "files", "total_bytes", "manifest_sha256"}, "invalid begin record")
            entries = validate_manifest(record, browser, stage)
            buffers = [bytearray() for _ in entries]
            active, header = True, record
        elif kind == "chunk":
            require(active and set(record) == set(origin) | {"type", "file", "number", "total", "data"}, "chunk without valid header")
            require(integer(record.get("file"), 1, len(entries)) and record["file"] == expected_file and
                    integer(record.get("number"), 1, 1000) and record["number"] == expected_number,
                    "missing, duplicate, or reordered evidence chunk")
            entry = entries[expected_file - 1]
            require(type(record.get("total")) is int and record["total"] == entry["chunks"], "chunk total mismatch")
            encoded = record.get("data")
            require(isinstance(encoded, str) and len(encoded) <= 4 * ((CHUNK_BYTES + 2) // 3), "invalid encoded chunk size")
            try:
                data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error) as error:
                raise EvidenceError("malformed base64 chunk") from error
            require(base64.b64encode(data).decode("ascii") == encoded, "non-canonical base64 chunk")
            expected_size = min(CHUNK_BYTES, entry["bytes"] - (expected_number - 1) * CHUNK_BYTES)
            require(len(data) == expected_size, "truncated or oversized evidence chunk")
            buffers[expected_file - 1].extend(data)
            expected_number += 1
            if expected_number > entry["chunks"]:
                expected_file, expected_number = expected_file + 1, 1
        elif kind == "end":
            require(active and set(record) == set(origin) | {"type", "manifest_sha256", "file_count", "total_bytes"}, "end without valid header")
            require(expected_file == len(entries) + 1 and expected_number == 1, "truncated evidence stream")
            require(record.get("manifest_sha256") == header["manifest_sha256"] and
                    type(record.get("file_count")) is int and record["file_count"] == len(entries) and
                    type(record.get("total_bytes")) is int and record["total_bytes"] == header["total_bytes"], "evidence end mismatch")
            active, complete = False, True
        else:
            raise EvidenceError("unknown evidence record")
    require(complete and not active and header is not None, "missing or truncated evidence stream")
    files = {entry["path"]: bytes(data) for entry, data in zip(entries, buffers)}
    for entry in entries:
        require(digest(files[entry["path"]]) == entry["sha256"], "evidence SHA256 mismatch")
    validate_files(files, browser, stage)
    return header, files


def write_decoded(out, manifest, files):
    out = Path(out)
    no_symlinks(out)
    require(not out.exists(), "output destination already exists; use a new directory")
    out.mkdir(parents=True)
    for relative, data in files.items():
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(data)
    with (out / "evidence-manifest.json").open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, indent=2) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("encode", "decode"):
        sub = commands.add_parser(command)
        sub.add_argument("--source-sha", required=True)
        sub.add_argument("--browser", choices=BROWSERS, required=True)
        sub.add_argument("--stage", choices=STAGES, required=True)
        if command == "encode":
            sub.add_argument("--root", type=Path, required=True)
        else:
            sub.add_argument("--log", type=Path, required=True)
            sub.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "encode":
            sys.stdout.write(encode(args.root, args.source_sha, args.browser, args.stage))
        else:
            require(args.log.stat().st_size <= MAX_LOG_BYTES, "job log exceeds 64 MiB limit")
            with args.log.open("rb") as handle:
                raw = handle.read(MAX_LOG_BYTES + 1)
            require(len(raw) <= MAX_LOG_BYTES, "job log exceeds 64 MiB limit")
            manifest, files = decode(raw.decode("utf-8"), args.source_sha, args.browser, args.stage)
            write_decoded(args.out, manifest, files)
            print(f"Verified {len(files)} files ({manifest['total_bytes']} bytes) for {args.browser}/{args.stage} at {args.source_sha}")
    except (EvidenceError, OSError, UnicodeError) as error:
        print(f"Candidate evidence failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
