#!/usr/bin/env python3
"""Private, attempt-pinned Tickets runtime transport using the existing GH_TOKEN.

No cleanup, deletion, overwrite, extraction, or deployment is performed here.
A failed upload leaves an unpublished draft for inspection. A later invocation
may finish publishing only a complete, byte-identical draft, never a partial one.
GitHub API provenance is checked online by download; its local receipt supplies
additional consistency checks to the release operator, not a digital signature.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import tempfile
import time

REPOSITORY = "bechirobob/tickets"
WORKFLOW = ".github/workflows/vps-runtime.yml"
AUTHOR = "github-actions[bot]"
ARCHIVE = "tickets-vps-runtime.tar.gz"
CHECKSUM = ARCHIVE + ".sha256"
MANIFEST = "tickets-vps-runtime.manifest.json"
RECEIPT = "release-transport.json"
SCHEMA = "tickets-vps-runtime-release/v1"
RECEIPT_SCHEMA = "tickets-vps-runtime-transport/v1"
PRODUCER_SCHEMA = "tickets-vps-runtime-producer/v1"
PRODUCER_MARKER = "TICKETS_RUNTIME_RELEASE_RECEIPT "
PUBLISH_STEP = "Publish verified private runtime release"
LOG_LIMIT = 32 * 1024 ** 2
SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
NUMBER = re.compile(r"[1-9][0-9]{0,19}\Z")
NAMES = (ARCHIVE, CHECKSUM, MANIFEST)
LIMITS = {ARCHIVE: 2 * 1024 ** 3 - 1, CHECKSUM: 1024, MANIFEST: 65536}
CONTENT_TYPES = {
    # gh release upload explicitly labels .tar.gz as application/x-gtar.
    ARCHIVE: {"application/gzip", "application/x-gzip", "application/x-gtar", "application/octet-stream"},
    CHECKSUM: {"text/plain", "application/octet-stream"},
    MANIFEST: {"application/json", "text/plain", "application/octet-stream"},
}


class TransportError(RuntimeError):
    pass


class ApiError(TransportError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def require(condition, message):
    if not condition:
        raise TransportError(message)


def number(value):
    require(type(value) in (str, int) and NUMBER.fullmatch(str(value)),
            "A positive, bounded integer is required.")
    return int(value)


def sha(value):
    require(isinstance(value, str) and SHA.fullmatch(value), "An exact Git SHA is required.")
    return value


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, "Duplicate JSON key.")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(TransportError("Invalid JSON constant.")))
    except (ValueError, UnicodeError, TypeError) as error:
        raise TransportError("Invalid JSON document.") from error


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path, limit):
    info = Path(path).lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= limit,
            "Expected a bounded, nonempty regular file: " + Path(path).name)
    return info.st_size


def file_record(path):
    return {"name": Path(path).name,
            "size": regular_file(path, LIMITS[Path(path).name]),
            "sha256": digest_file(path)}


def release_tag(source, run_id, attempt):
    return f"tickets-vps-{sha(source)}-{number(run_id)}-{number(attempt)}"


def release_body(manifest):
    return "Tickets VPS runtime transport v1\nManifest SHA-256: " + hashlib.sha256(canonical(manifest)).hexdigest() + "\n"


def identity(source, source_tree, run_id, attempt):
    return {"schema": SCHEMA, "repository": REPOSITORY, "source_sha": sha(source),
            "source_tree": sha(source_tree), "workflow": WORKFLOW,
            "event": "push", "ref": "refs/heads/main", "run_id": number(run_id),
            "run_attempt": number(attempt), "release_tag": release_tag(source, run_id, attempt)}


def write_once(path, data):
    path = Path(path)
    if path.exists() or path.is_symlink():
        regular_file(path, max(len(data), 1))
        require(path.read_bytes() == data, "Refusing to overwrite different local data: " + path.name)
    else:
        with path.open("xb") as handle:
            handle.write(data)
        path.chmod(0o600)


def generate_manifest(directory, *, source, source_tree, run_id, attempt):
    directory = Path(directory)
    result = identity(source, source_tree, run_id, attempt)
    archive = file_record(directory / ARCHIVE)
    expected = f"{archive['sha256']}  {ARCHIVE}\n".encode()
    # Accept an existing exact checksum, but never silently replace one.
    write_once(directory / CHECKSUM, expected)
    result["files"] = [archive, file_record(directory / CHECKSUM)]
    write_once(directory / MANIFEST, canonical(result))
    return result


def validate_local(directory, *, source, source_tree, run_id, attempt):
    directory = Path(directory)
    regular_file(directory / MANIFEST, LIMITS[MANIFEST])
    raw = (directory / MANIFEST).read_bytes()
    manifest = strict_json(raw)
    expected = identity(source, source_tree, run_id, attempt)
    expected["files"] = [file_record(directory / ARCHIVE), file_record(directory / CHECKSUM)]
    require(manifest == expected and raw == canonical(expected), "Runtime manifest identity or file digest mismatch.")
    checksum = f"{expected['files'][0]['sha256']}  {ARCHIVE}\n".encode()
    require((directory / CHECKSUM).read_bytes() == checksum, "Runtime checksum mismatch.")
    return manifest


class GitHub:
    """Only fixed GitHub hosts, validated repo-relative endpoints and existing auth."""
    def __init__(self):
        require(bool(os.environ.get("GH_TOKEN")), "GH_TOKEN is required; no credentials are created or requested.")
        self.env = dict(os.environ, GH_HOST="github.com", GH_REPO=REPOSITORY,
                        GH_PROMPT_DISABLED="1", GH_PAGER="cat", GH_DEBUG="")

    def command(self, args, *, timeout=120):
        try:
            result = subprocess.run(["gh", *args], capture_output=True, env=self.env,
                                    timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ApiError("GitHub command could not complete; no mutation will be retried automatically.") from error
        if result.returncode:
            # Never echo subprocess output: remote data, URLs and credentials may occur there.
            match = re.search(rb"\(HTTP ([0-9]{3})\)", result.stderr)
            raise ApiError("GitHub command failed; check token permissions and API availability.",
                           int(match[1]) if match else None)
        require(len(result.stdout) <= 8 * 1024 ** 2, "Unexpectedly large GitHub API response.")
        return result.stdout

    def api(self, suffix, *, method="GET", payload=None):
        require((suffix == "" or re.fullmatch(r"[A-Za-z0-9_./?=&-]+", suffix)) and ".." not in suffix,
                "Unsafe GitHub API endpoint.")
        require(method in ("GET", "POST", "PATCH"), "Unsupported GitHub operation.")
        args = ["api", "--hostname", "github.com", "--method", method,
                "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28",
                f"repos/{REPOSITORY}/{suffix}".rstrip("/")]
        if payload is not None:
            # Fields are controlled locally; no API-provided URL is followed by our commands.
            for key, value in payload.items():
                args.extend(["-F" if type(value) in (bool, int) else "-f",
                             f"{key}={str(value).lower() if type(value) is bool else value}"])
        return strict_json(self.command(args))

    def repository(self):
        return self.api("")

    def download_asset(self, asset_id, destination, expected_size):
        self.stream(f"releases/assets/{number(asset_id)}", destination,
                    max_size=expected_size, expected_size=expected_size, accept="application/octet-stream")

    def job_log(self, job_id):
        with tempfile.TemporaryDirectory(prefix="tickets-producer-log-") as directory:
            path = Path(directory) / "job.log"
            self.stream(f"actions/jobs/{number(job_id)}/logs", path, max_size=LOG_LIMIT)
            return path.read_bytes()

    def stream(self, suffix, destination, *, max_size, expected_size=None, accept="application/vnd.github+json"):
        """Stream with a hard byte limit and deadline; never pass API URLs to gh."""
        require(re.fullmatch(r"(?:releases/assets/[1-9][0-9]*|actions/jobs/[1-9][0-9]*/logs)", suffix),
                "Unsafe download endpoint.")
        args = ["gh", "api", "--hostname", "github.com", "--method", "GET",
                "-H", "Accept: " + accept, "-H", "X-GitHub-Api-Version: 2022-11-28",
                f"repos/{REPOSITORY}/{suffix}"]
        started = time.monotonic()
        with Path(destination).open("xb") as target, tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, env=self.env)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    count = 0
                    while True:
                        require(time.monotonic() - started < 600, "Runtime asset download timed out.")
                        if not selector.select(timeout=1):
                            continue
                        chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                        if not chunk:
                            break
                        count += len(chunk)
                        require(count <= max_size, "GitHub download exceeds its declared size limit.")
                        target.write(chunk)
                require(process.wait(timeout=max(1, 600 - (time.monotonic() - started))) == 0,
                        "Runtime asset download failed; check existing token access.")
                require(expected_size is None or count == expected_size, "Runtime asset size mismatch.")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
        Path(destination).chmod(0o600)


def verify_repository(client):
    repository = client.repository()
    require(isinstance(repository, dict) and repository.get("full_name") == REPOSITORY
            and repository.get("private") is True and repository.get("visibility") == "private"
            and repository.get("fork") is False,
            "Runtime transport requires the exact private, non-fork Tickets repository.")
    return repository


def verify_source(client, source):
    commit = client.api("git/commits/" + sha(source))
    require(isinstance(commit, dict) and commit.get("sha") == source, "Remote source commit mismatch.")
    return sha(commit.get("tree", {}).get("sha"))


def verify_run(client, *, source, run_id, attempt, completed):
    run_id, attempt = number(run_id), number(attempt)
    run = client.api(f"actions/runs/{run_id}/attempts/{attempt}")
    require(isinstance(run, dict) and type(run.get("id")) is int and run["id"] == run_id
            and type(run.get("run_attempt")) is int and run["run_attempt"] == attempt
            and run.get("head_sha") == source and run.get("path") == WORKFLOW
            and run.get("head_branch") == "main" and run.get("event") == "push"
            and run.get("repository", {}).get("full_name") == REPOSITORY
            and run.get("head_repository", {}).get("full_name") == REPOSITORY,
            "Runtime run source, repository, workflow or attempt mismatch.")
    if completed:
        require(run.get("status") == "completed" and run.get("conclusion") == "success",
                "The exact runtime run attempt has not succeeded.")
    else:
        require(run.get("status") == "in_progress" and run.get("conclusion") is None,
                "Publishing must occur inside the current in-progress runtime run.")
    return run


def find_release(client, tag):
    # Unlike the published-release-by-tag endpoint this also sees drafts.
    matching = []
    for page in range(1, 101):
        releases = client.api(f"releases?per_page=100&page={page}")
        require(isinstance(releases, list) and len(releases) <= 100, "Invalid release inventory.")
        require(all(isinstance(value, dict) for value in releases), "Malformed release inventory.")
        matching.extend(value for value in releases if value.get("tag_name") == tag)
        require(len(matching) <= 1, "Ambiguous release tag collision.")
        if len(releases) < 100:
            return client.api(f"releases/{number(matching[0].get('id'))}") if matching else None
    raise TransportError("Release inventory limit reached; absence could not be established safely.")


def verify_ref(client, tag, source, *, allow_missing=False):
    try:
        ref = client.api("git/ref/tags/" + tag)
    except ApiError as error:
        if allow_missing and error.status == 404:
            return False
        raise
    require(isinstance(ref, dict) and ref.get("ref") == "refs/tags/" + tag,
            "Unexpected release Git reference.")
    obj = ref.get("object", {})
    for _ in range(6):
        target = sha(obj.get("sha"))
        if obj.get("type") == "commit":
            require(target == source, "Release Git tag points to a different commit.")
            return True
        require(obj.get("type") == "tag", "Unexpected release Git object type.")
        annotation = client.api("git/tags/" + target)
        require(isinstance(annotation, dict) and annotation.get("sha") == target,
                "Annotated Git tag identity mismatch.")
        obj = annotation.get("object", {})
    raise TransportError("Release annotated tag chain exceeds the safe bound.")


def author_ok(author):
    return (isinstance(author, dict) and author.get("login") == AUTHOR and author.get("type") == "Bot"
            and type(author.get("id")) is int and author["id"] > 0)


def validate_release(release, manifest, *, allow_draft=False, allow_empty=False):
    require(isinstance(release, dict), "Missing release metadata.")
    number(release.get("id"))
    require(type(release.get("id")) is int and release.get("tag_name") == manifest["release_tag"]
            and release.get("name") == manifest["release_tag"]
            and release.get("target_commitish") == manifest["source_sha"]
            and release.get("body") == release_body(manifest) and author_ok(release.get("author"))
            and type(release.get("draft")) is bool and release.get("prerelease") is True,
            "Release identity, author or publication metadata mismatch.")
    require(allow_draft or release["draft"] is False, "Draft runtime release cannot be consumed.")
    if not release["draft"]:
        require(isinstance(release.get("published_at"), str) and bool(release["published_at"]),
                "Runtime release is not published.")
    assets = release.get("assets")
    require(isinstance(assets, list), "Missing runtime release assets.")
    if allow_empty and assets == []:
        return {}
    require(len(assets) == len(NAMES), "Runtime release is incomplete or has unexpected assets.")
    result, ids = {}, set()
    for asset in assets:
        require(isinstance(asset, dict) and asset.get("name") in NAMES
                and asset["name"] not in result, "Unexpected or duplicate runtime asset name.")
        name = asset["name"]
        identifier = number(asset.get("id"))
        require(type(asset.get("id")) is int and identifier not in ids, "Invalid or duplicate runtime asset ID.")
        size = asset.get("size")
        content_type = asset.get("content_type")
        require(type(size) is int and 0 < size <= LIMITS[name] and asset.get("state") == "uploaded"
                and isinstance(content_type, str) and content_type.split(";", 1)[0].strip().lower() in CONTENT_TYPES[name]
                and isinstance(asset.get("digest"), str) and re.fullmatch(r"sha256:[a-f0-9]{64}", asset["digest"])
                and author_ok(asset.get("uploader")), "Runtime asset type, state, size, digest or author mismatch.")
        result[name] = asset
        ids.add(identifier)
    return result


def check_asset_bytes(directory, assets):
    for name in NAMES:
        path = Path(directory) / name
        require(regular_file(path, LIMITS[name]) == assets[name]["size"]
                and "sha256:" + digest_file(path) == assets[name]["digest"],
                "Runtime asset bytes differ from GitHub metadata: " + name)


def release_snapshot(release):
    keys = ("id", "tag_name", "name", "target_commitish", "body", "draft", "prerelease", "published_at")
    value = {key: release.get(key) for key in keys}
    value["author"] = {key: release["author"].get(key) for key in ("id", "login", "type")}
    value["assets"] = []
    for asset in sorted(release["assets"], key=lambda item: item["name"]):
        item = {key: asset.get(key) for key in ("id", "name", "size", "state", "content_type", "digest")}
        item["uploader"] = {key: asset["uploader"].get(key) for key in ("id", "login", "type")}
        value["assets"].append(item)
    return value



def producer_receipt(manifest, metadata):
    """Bounded, deterministic provenance emitted only after verified publication."""
    proof = {key: manifest[key] for key in ("repository", "source_sha", "source_tree", "workflow",
             "event", "ref", "run_id", "run_attempt", "release_tag")}
    proof.update(schema=PRODUCER_SCHEMA, release_id=metadata["id"], assets=[])
    for asset in sorted(metadata["assets"], key=lambda value: value["name"]):
        proof["assets"].append({"name": asset["name"], "id": asset["id"], "size": asset["size"],
                                "sha256": asset["digest"][7:]})
    return proof


def parse_producer_log(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= LOG_LIMIT, "Missing or oversized producer log.")
    marker = PRODUCER_MARKER.encode()
    require(raw.count(marker) == 1, "Producer log must contain exactly one runtime receipt marker.")
    line = next(line for line in raw.splitlines() if marker in line)
    require(len(line) <= 16384, "Producer receipt marker exceeds the safe bound.")
    # Actions job log responses prefix each output line with an RFC3339 UTC timestamp.
    match = re.fullmatch(rb"(?:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z )?"
                         + re.escape(marker) + rb"(.+)", line)
    require(match is not None, "Malformed producer log receipt marker.")
    proof = strict_json(match[1])
    require(isinstance(proof, dict) and canonical(proof).rstrip(b"\n") == match[1],
            "Producer receipt is not canonical JSON.")
    return proof


def completed_producer_receipt(client, *, source, run_id, attempt):
    document = client.api(f"actions/runs/{number(run_id)}/attempts/{number(attempt)}/jobs?per_page=100")
    require(isinstance(document, dict) and document.get("total_count") == 2
            and isinstance(document.get("jobs"), list) and len(document["jobs"]) == 2,
            "Exact runtime attempt must contain only verify and handoff jobs.")
    jobs = document["jobs"]
    require(all(isinstance(job, dict) for job in jobs)
            and {job.get("name") for job in jobs} == {"verify", "handoff"},
            "Runtime verification jobs missing or duplicated.")
    identifiers = set()
    for job in jobs:
        identifier = number(job.get("id"))
        require(type(job.get("id")) is int and identifier not in identifiers
                and type(job.get("run_id")) is int and job["run_id"] == number(run_id)
                and job.get("head_sha") == source and job.get("status") == "completed"
                and job.get("conclusion") == "success",
                "Runtime attempt contains a failed, skipped or mismatched job.")
        # Some API versions omit run_attempt on jobs; the attempt-specific endpoint is mandatory.
        require("run_attempt" not in job or (type(job["run_attempt"]) is int
                and job["run_attempt"] == number(attempt)), "Runtime job attempt mismatch.")
        identifiers.add(identifier)
    verify = next(job for job in jobs if job["name"] == "verify")
    steps = verify.get("steps")
    require(isinstance(steps, list), "Producer publish step missing.")
    publish_steps = [step for step in steps if isinstance(step, dict) and step.get("name") == PUBLISH_STEP]
    require(len(publish_steps) == 1 and publish_steps[0].get("status") == "completed"
            and publish_steps[0].get("conclusion") == "success", "Producer publish step did not succeed exactly once.")
    return verify["id"], parse_producer_log(client.job_log(verify["id"]))

def verify_local_receipt(directory, *, source, source_tree, run_id, attempt):
    """Recheck the online download's local consistency, without contacting GitHub."""
    directory = Path(directory)
    manifest = validate_local(directory, source=source, source_tree=source_tree, run_id=run_id, attempt=attempt)
    regular_file(directory / RECEIPT, 65536)
    receipt = strict_json((directory / RECEIPT).read_bytes())
    require(isinstance(receipt, dict) and set(receipt) == {"schema", "manifest", "release", "producer_job_id", "producer_receipt"}
            and receipt["schema"] == RECEIPT_SCHEMA and receipt["manifest"] == manifest,
            "Runtime release receipt identity mismatch.")
    assets = validate_release(receipt["release"], manifest)
    require(receipt["release"] == release_snapshot(receipt["release"]), "Unexpected receipt metadata.")
    check_asset_bytes(directory, assets)
    require(type(receipt["producer_job_id"]) is int, "Producer job ID is invalid.")
    number(receipt["producer_job_id"])
    require(receipt["producer_receipt"] == producer_receipt(manifest, receipt["release"]),
            "Completed producer log receipt differs from the downloaded release.")
    return receipt


def git(*args):
    try:
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise TransportError("Cannot verify the local Git checkout.") from error


def publish(directory, client=None):
    env = os.environ
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("GITHUB_SERVER_URL") == "https://github.com"
            and env.get("GITHUB_REPOSITORY") == REPOSITORY and env.get("GITHUB_EVENT_NAME") == "push"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_WORKFLOW_REF") == f"{REPOSITORY}/{WORKFLOW}@refs/heads/main",
            "Only the Tickets main-push runtime workflow may publish.")
    source = sha(env.get("GITHUB_SHA"))
    run_id, attempt = number(env.get("GITHUB_RUN_ID")), number(env.get("GITHUB_RUN_ATTEMPT"))
    require(env.get("GITHUB_WORKFLOW_SHA") == source and git("rev-parse", "HEAD") == source,
            "Producer workflow and checkout must match the exact source.")
    require(not git("diff", "--name-only", "HEAD", "--"), "Producer tracked files are dirty.")
    tree = sha(git("rev-parse", "HEAD^{tree}"))
    client = client or GitHub()
    verify_repository(client)
    require(verify_source(client, source) == tree, "Producer Git tree differs from remote commit.")
    manifest = generate_manifest(directory, source=source, source_tree=tree, run_id=run_id, attempt=attempt)
    tag = manifest["release_tag"]
    existing = find_release(client, tag)
    if existing is None:
        require(not verify_ref(client, tag, source, allow_missing=True),
                "A Git tag already exists without the expected release; refusing collision.")
        verify_repository(client)
        # No blind retry after a timeout: the next invocation must inspect the draft.
        existing = client.api("releases", method="POST", payload={
            "tag_name": tag, "target_commitish": source, "name": tag, "body": release_body(manifest),
            "draft": True, "prerelease": True, "make_latest": "false"})
        require(existing.get("draft") is True and existing.get("assets") == [], "New draft is not empty.")
        validate_release(existing, manifest, allow_draft=True, allow_empty=True)
        release_id = number(existing["id"])
        verify_repository(client)
        client.command(["release", "upload", tag, "--repo", REPOSITORY,
                        *[str((Path(directory) / name).resolve()) for name in NAMES]], timeout=600)
        existing = client.api(f"releases/{release_id}")
    # Resume only an already complete, identical package; never repair or replace assets.
    assets = validate_release(existing, manifest, allow_draft=True)
    check_asset_bytes(directory, assets)
    verify_ref(client, tag, source, allow_missing=existing["draft"])
    if existing["draft"]:
        verify_repository(client)
        existing = client.api(f"releases/{number(existing['id'])}", method="PATCH", payload={
            "draft": False, "prerelease": True, "make_latest": "false"})
    final = client.api(f"releases/{number(existing['id'])}")
    require(release_snapshot(final) == release_snapshot(existing), "Release changed during publication.")
    check_asset_bytes(directory, validate_release(final, manifest))
    verify_ref(client, tag, source)
    verify_repository(client)
    print(PRODUCER_MARKER + canonical(producer_receipt(manifest, final)).decode().rstrip("\n"), flush=True)
    return manifest


def download(directory, *, source, run_id, attempt, client=None):
    source, run_id, attempt = sha(source), number(run_id), number(attempt)
    directory = Path(directory)
    # Refuse partial outputs and overwrites, including symlinks. Consumers use a fresh directory.
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(directory.is_dir() and not directory.is_symlink() and not any(directory.iterdir()),
            "Download requires an empty real directory.")
    client = client or GitHub()
    verify_repository(client)
    verify_run(client, source=source, run_id=run_id, attempt=attempt, completed=True)
    tree = verify_source(client, source)
    producer_job_id, proof = completed_producer_receipt(client, source=source, run_id=run_id, attempt=attempt)
    tag = release_tag(source, run_id, attempt)
    # This endpoint deliberately excludes unpublished drafts from consumption.
    release = client.api("releases/tags/" + tag)
    expected = identity(source, tree, run_id, attempt)
    # A manifest digest is not known until download; first validate every other field.
    require(isinstance(release, dict) and isinstance(release.get("body"), str), "Missing release metadata.")
    require(re.fullmatch(r"Tickets VPS runtime transport v1\nManifest SHA-256: [a-f0-9]{64}\n", release["body"]),
            "Unexpected runtime release body.")
    # Validate initial metadata using its strict body hash; the actual hash is checked below.
    provisional = dict(release)
    provisional["body"] = release_body(expected)
    assets = validate_release(provisional, expected)
    require(proof == producer_receipt(expected, release),
            "Release no longer matches the immutable completed producer-job log receipt.")
    verify_ref(client, tag, source)
    with tempfile.TemporaryDirectory(prefix=".runtime-download-", dir=directory) as temporary:
        staging = Path(temporary)
        # Fixed order and filenames; URLs/names in remote metadata never become destinations.
        for name in (MANIFEST, CHECKSUM, ARCHIVE):
            client.download_asset(assets[name]["id"], staging / name, assets[name]["size"])
        manifest = validate_local(staging, source=source, source_tree=tree, run_id=run_id, attempt=attempt)
        check_asset_bytes(staging, validate_release(release, manifest))
        require(proof == producer_receipt(manifest, release),
                "Release no longer matches the immutable completed producer-job log receipt.")
        final = client.api(f"releases/{number(release['id'])}")
        require(release_snapshot(final) == release_snapshot(release), "Release metadata changed during download.")
        verify_ref(client, tag, source)
        verify_repository(client)
        verify_run(client, source=source, run_id=run_id, attempt=attempt, completed=True)
        receipt = {"schema": RECEIPT_SCHEMA, "manifest": manifest, "release": release_snapshot(final),
                   "producer_job_id": producer_job_id, "producer_receipt": proof}
        write_once(staging / RECEIPT, canonical(receipt))
        verify_local_receipt(staging, source=source, source_tree=tree, run_id=run_id, attempt=attempt)
        for name in (*NAMES, RECEIPT):
            # Link is atomic and fails rather than replacing anything created concurrently.
            os.link(staging / name, directory / name)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    producer = subparsers.add_parser("publish", help="Publish the current main-push Actions runtime package")
    producer.add_argument("--directory", required=True)
    for command in ("manifest", "download", "verify-local"):
        sub = subparsers.add_parser(command)
        sub.add_argument("--directory", required=True)
        sub.add_argument("--source", required=True)
        sub.add_argument("--run-id", required=True)
        sub.add_argument("--attempt", required=True)
        if command != "download":
            sub.add_argument("--source-tree", required=True)
    args = parser.parse_args(argv)
    values = vars(args).copy()
    command = values.pop("command")
    directory = values.pop("directory")
    try:
        if command == "publish":
            result = publish(directory)
        elif command == "manifest":
            result = generate_manifest(directory, **values)
        elif command == "verify-local":
            result = verify_local_receipt(directory, **values)
        else:
            result = download(directory, **values)
        manifest = result.get("manifest", result)
        print("Verified private runtime package: " + manifest["release_tag"])
        return 0
    except (TransportError, OSError, subprocess.SubprocessError) as error:
        print("Runtime transport failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
