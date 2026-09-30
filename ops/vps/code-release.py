#!/usr/bin/env python3
"""Explicit, code-only Tickets VPS release. No install, handover or data mutation.

The CI verifier binds successful main-runtime and browser runs to exact Git trees.
The host transaction runs under the existing deployment lock, keeps private rollback
snapshots, and never edits the private credential bridge or original handover fields.
"""
import argparse
import copy
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
NUMBER = re.compile(r"[1-9][0-9]*\Z")
HOST = "tickets.becoreops.com"
SERVICE = "becore-tickets.service"
ORIGINAL_TRANSFER_REVISION = "8a46eeaae8296ab588104ea2406f5287c08e5fb6"
ROUTES = (("/", 200), ("/events", 200), ("/api/public/events", 200),
          ("/api/version", 200), ("/api/admin/events", 403))
# retention.py protects current/previous and has a two-day grace. A release must
# retain at least one hour of that grace before any pointer can lose protection.
RETENTION_SAFE_AGE = 2 * 86400 - 3600
# This release intentionally cannot carry database, migration, runtime, handover
# protocol, routing, service-unit, or arbitrary build-script changes.
APPLICATION_FILES = {
    "app/api/payments/initialize/route.ts", "app/checkout/[slug]/checkout-form.tsx",
    "app/checkout/[slug]/page.tsx", "app/globals.css", "lib/seevplus.ts",
    "app/checkout-preview/page.tsx", "app/checkout-preview/preview.css",
    "app/api/payments/preview/route.ts", "lib/checkout-preview.ts", "lib/retired-checkout.ts",
    "cloudflare-env.d.ts", ".dev.vars.example", "README.md",
    "scripts/browser-worker.mjs", "scripts/prepare-seev-browser-fixture.mjs",
    "playwright.seev-crypto.config.ts", "package.json", "package-lock.json",
    "ops/vps/code-release.py", "ops/vps/test_code_release.py",
    ".github/workflows/tickets-code-release.yml",
    ".github/workflows/tickets-release-operator-checks.yml", "mobile/package-lock.json",
    ".github/workflows/candidate-checks.yml", ".github/workflows/tickets-backup.yml",
    ".github/workflows/tickets-vps-diagnostics.yml",
}
BROWSERS = {"desktop-chromium", "mobile-chromium", "mobile-webkit"}


class ReleaseError(RuntimeError):
    """An intentionally non-secret operational failure."""


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key rejected.")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError) as exc:
        raise ReleaseError("Invalid JSON document.") from exc


def digest_file(path):
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def atomic_write(path, data, mode=0o600):
    """Replace rather than follow a link; fsync both file and containing directory."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=".code-release-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic_write(path, (json.dumps(value, sort_keys=True) + "\n").encode())


def replace_link(path, target):
    fd, temporary = tempfile.mkstemp(prefix=".code-release-link-", dir=path.parent)
    os.close(fd)
    os.unlink(temporary)
    try:
        os.symlink(target, temporary)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def configuration(raw):
    values = strict_json(raw)
    require(isinstance(values, dict) and all(isinstance(v, str) for v in values.values()),
            "Runtime configuration must be an object containing only strings.")
    return values


def enable_crypto_bytes(raw):
    """Change only the selected JSON value's bytes; preserve all other bytes."""
    values = configuration(raw)
    text = raw.decode("utf-8")
    decoder = json.JSONDecoder()
    index = text.index("{") + 1
    while True:
        while text[index].isspace():
            index += 1
        if text[index] == "}":
            addition = ("," if values else "") + '"SEEV_CRYPTO_ENABLED":"true"'
            result = text[:index] + addition + text[index:]
            break
        key, index = decoder.raw_decode(text, index)
        while text[index].isspace():
            index += 1
        require(text[index] == ":", "Invalid configuration separator.")
        index += 1
        while text[index].isspace():
            index += 1
        start = index
        _, index = decoder.raw_decode(text, index)
        if key == "SEEV_CRYPTO_ENABLED":
            result = text[:start] + '"true"' + text[index:]
            break
        while text[index].isspace():
            index += 1
        if text[index] == ",":
            index += 1
    expected = dict(values, SEEV_CRYPTO_ENABLED="true")
    require(configuration(result.encode()) == expected, "Configuration edit was not isolated.")
    return result.encode()


def release_override(raw, previous, candidate):
    """Accept the known scanner unit shape and preserve its comments/formatting."""
    old, new = str(previous), str(candidate)
    expected = ["[Service]", "WorkingDirectory=" + old, "ExecStart=",
                "ExecStart=/usr/bin/flock --nonblock /var/lib/becore-tickets/instance.lock "
                + old + "/bin/node " + old + "/server.mjs"]
    try:
        text = raw.decode("utf-8")
    except UnicodeError as exc:
        raise ReleaseError("Unexpected scanner override encoding.") from exc
    directives = [line.strip() for line in text.splitlines()
                  if line.strip() and not line.lstrip().startswith(("#", ";"))]
    require(directives == expected and text.count(old) == 3,
            "Scanner override has unvetted directives or release paths.")
    return text.replace(old, new).encode()


def git(*args):
    return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL).strip()


def vetted_changes(expected, source):
    subprocess.run(["git", "merge-base", "--is-ancestor", expected, source], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    changed = git("diff", "--name-only", expected, source).splitlines()
    for name in changed:
        require(name in APPLICATION_FILES or name.startswith(("docs/", "tests/"))
                or name in ("worker/handover.ts", "worker/security-response.ts"), "Unvetted source path: " + name)
    if "worker/handover.ts" in changed:
        before = git("show", expected + ":worker/handover.ts")
        after = git("show", source + ":worker/handover.ts")
        original = "'SEEV_ENABLED', 'SEEV_ENVIRONMENT',"
        require(before.count(original) == 1 and after == before.replace(
            original, "'SEEV_ENABLED', 'SEEV_CRYPTO_ENABLED', 'SEEV_ENVIRONMENT',"),
            "Only the vetted crypto configuration-name addition is permitted.")
    if "worker/security-response.ts" in changed:
        before = git("show", expected + ":worker/security-response.ts")
        after = git("show", source + ":worker/security-response.ts")
        anchor = '  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");\n'
        addition = ('  if (path === "/checkout-preview" || path.startsWith("/checkout-preview/") || path === "/api/payments/preview") {\n'
                    '    headers.set("Cache-Control", "no-store");\n'
                    '    headers.set("X-Robots-Tag", "noindex, nofollow");\n'
                    '  }\n')
        require(before.count(anchor) == 1 and after == before.replace(anchor, anchor + addition),
                "Only the vetted preview privacy-header rule is permitted.")
    if ".github/workflows/tickets-release-operator-checks.yml" in changed:
        # Already-reviewed operator-only CI from the current main baseline.
        require(git("rev-parse", source + ":.github/workflows/tickets-release-operator-checks.yml")
                == "2dcca50f2a8403e2f06c8aa871fcaa15ecf6c0ea",
                "Only the reviewed release-operator checks workflow is permitted.")
    if "mobile/package-lock.json" in changed:
        before = strict_json(git("show", expected + ":mobile/package-lock.json"))
        after = strict_json(git("show", source + ":mobile/package-lock.json"))
        package = before["packages"]["node_modules/brace-expansion"]
        require(package.get("version") == "5.0.9"
                and package.get("resolved") == "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz"
                and package.get("integrity") == "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
                "Mobile security patch baseline changed.")
        package.update(version="5.0.12",
                       resolved="https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.12.tgz",
                       integrity="sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==")
        require(before == after, "Only the reviewed mobile brace-expansion lock update may change.")
    # Next 16.3.6 security remediation, including npm's reviewed lock metadata.
    # Pin both complete inputs and outputs: scripts, other dependency versions,
    # and every unrelated byte must match this reviewed patch exactly.
    root_dependency_patch = {
        "package.json": ("f5b97ad99e9f3c5c74abfde84ed87b03577b1a24",
                         "dc6e4e1cfa53b05beb3b5f70c7a5d07dd5e07b23"),
        "package-lock.json": ("3916f840669463f8ac586dc25d715456a5d9d0b8",
                              "759d34af76287e214f03def74be98ddefb33780a"),
    }
    if root_dependency_patch.keys() & set(changed):
        require(root_dependency_patch.keys() <= set(changed),
                "The reviewed root dependency patch requires both package files.")
        for name, (baseline, reviewed) in root_dependency_patch.items():
            require(git("rev-parse", expected + ":" + name) == baseline
                    and git("rev-parse", source + ":" + name) == reviewed,
                    "Root dependency files differ from the reviewed security patch: " + name)
    return changed


def verify_run(run, *, workflow, source=None, repository):
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "Required workflow has not succeeded.")
    require(run.get("path") == ".github/workflows/" + workflow,
            "Unexpected workflow identity.")
    require(run.get("repository", {}).get("full_name") == repository
            and run.get("head_repository", {}).get("full_name") == repository,
            "Workflow repository identity mismatch.")
    require(SHA.fullmatch(run.get("head_sha", "")), "Workflow SHA missing.")
    if source:
        require(run["head_sha"] == source and run.get("head_branch") == "main"
                and run.get("event") == "push", "Runtime must verify exact main source.")
    else:
        require(run.get("event") in ("pull_request", "workflow_dispatch"),
                "Unexpected browser workflow event.")


def verify_jobs(runtime_jobs, candidate_jobs):
    require(all(job.get("conclusion") == "success" for job in runtime_jobs),
            "Runtime contains a failed or skipped job.")
    require({job.get("name") for job in runtime_jobs} == {"verify", "handoff"},
            "Runtime verification jobs missing.")
    require(len(candidate_jobs) == len(BROWSERS), "Browser matrix incomplete.")
    require({job.get("name") for job in candidate_jobs}
            == {"verify (" + browser + ")" for browser in BROWSERS}
            and all(job.get("conclusion") == "success" for job in candidate_jobs),
            "All browser matrix jobs must succeed.")
    required_steps = {"Verify every browser journey before release",
                      "Verify optional SeevPlus checkout on desktop and mobile",
                      "Verify opt-in USDC checkout without provider traffic"}
    for job in candidate_jobs:
        steps = {step.get("name"): step.get("conclusion") for step in job.get("steps", [])}
        require(all(steps.get(name) == "success" for name in required_steps),
                "Required browser journeys were skipped or failed.")


def verify_ci(args):
    require(SHA.fullmatch(args.source) and SHA.fullmatch(args.expected), "Exact SHAs required.")
    require(os.environ.get("GITHUB_REF") == "refs/heads/main", "Dispatch must target main.")
    require(git("rev-parse", "HEAD") == args.source and not git("status", "--porcelain"),
            "Release checkout must be clean and exact.")
    subprocess.run(["git", "merge-base", "--is-ancestor", args.source, "origin/main"], check=True)
    metadata = Path(args.metadata)
    runtime = strict_json((metadata / "runtime.json").read_bytes())
    candidate = strict_json((metadata / "candidate.json").read_bytes())
    verify_run(runtime, workflow="vps-runtime.yml", source=args.source, repository=args.repository)
    verify_run(candidate, workflow="candidate-checks.yml", repository=args.repository)
    require(str(runtime.get("id")) == args.runtime_run and str(candidate.get("id")) == args.candidate_run,
            "Workflow run IDs do not match inputs.")
    verify_jobs(strict_json((metadata / "runtime-jobs.json").read_bytes()),
                strict_json((metadata / "candidate-jobs.json").read_bytes()))
    source_tree = git("rev-parse", args.source + "^{tree}")
    require(source_tree == git("rev-parse", candidate["head_sha"] + "^{tree}"),
            "Candidate browser source tree differs from runtime source tree.")
    changes = vetted_changes(args.expected, args.source)
    archive = Path(args.archive)
    checksum = (archive.parent / (archive.name + ".sha256")).read_text().strip()
    require(re.fullmatch(r"[a-f0-9]{64}  tickets-vps-runtime\.tar\.gz", checksum),
            "Unexpected artifact checksum format.")
    digest = digest_file(archive)
    require(checksum.split()[0] == digest, "Runtime artifact checksum mismatch.")
    provenance = {"version": 1, "source": args.source, "expectedActive": args.expected,
                  "sourceTree": source_tree, "candidateTree": source_tree,
                  "candidateSha": candidate["head_sha"], "runtimeRun": args.runtime_run,
                  "candidateRun": args.candidate_run, "archiveSha256": digest,
                  "repository": args.repository, "ancestryVerified": True,
                  "changedFiles": changes}
    write_json(args.output, provenance)
    print("Exact runtime/browser CI, ancestry, source scope and artifact digest verified.")


class NoRouteRedirect(urllib.request.HTTPRedirectHandler):
    """Health and the selected public/privacy probes must answer directly."""
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ReleaseError("Unexpected health/route redirect.")


class System:
    """Small host boundary so rollback behavior can be tested without a host."""
    def run(self, *args):
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=90).strip()

    def property(self, name):
        return self.run("systemctl", "show", SERVICE, "--property=" + name, "--value")

    def verify_credential_binding(self):
        # LoadCredential is D-Bus a(ss), which systemctl show's generic property
        # printer cannot represent. Inspect the typed value, not unit-file text.
        try:
            value = strict_json(self.run(
                "busctl", "--system", "--timeout=10", "--no-pager", "--json=short",
                "get-property", "org.freedesktop.systemd1",
                "/org/freedesktop/systemd1/unit/becore_2dtickets_2eservice",
                "org.freedesktop.systemd1.Service", "LoadCredential"))
        except (OSError, subprocess.SubprocessError, UnicodeError, ReleaseError) as exc:
            raise ReleaseError("Canonical credential bridge could not be verified.") from exc
        require(value == {"type": "a(ss)", "data": [
            ["runtime.json", "/etc/becore-tickets/runtime.json"]]},
            "Canonical credential bridge binding is unexpected.")

    def restart(self):
        self.run("systemctl", "daemon-reload")
        self.run("systemctl", "restart", SERVICE)

    def request(self, path, public=False):
        base = "https://" + HOST if public else "http://127.0.0.1:3119"
        request = urllib.request.Request(base + path, headers={
            "Host": HOST, "User-Agent": "Mozilla/5.0 (compatible; BeCoreTicketsHealth/1.0)",
            "Cache-Control": "no-cache"})
        try:
            opener = urllib.request.build_opener(NoRouteRedirect())
            response = opener.open(request, timeout=15)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            require(response.geturl() == base + path, "Unexpected health/route redirect.")
            return response.status, response.read(1024 * 1024)

    def application_uid(self):
        return pwd.getpwnam("becore-tickets").pw_uid

    def verify_effective_config(self, expected):
        pid = self.property("MainPID")
        require(NUMBER.fullmatch(pid), "Tickets service PID missing.")
        environ = Path("/proc") / pid / "environ"
        values = dict(item.split(b"=", 1) for item in environ.read_bytes().split(b"\0") if b"=" in item)
        require(values.get(b"TICKETS_CONFIG") == b"/run/becore-tickets-runtime/runtime.json",
                "Service is not using the preserved private credential bridge.")
        effective = Path("/run/becore-tickets-runtime/runtime.json")
        metadata = effective.lstat()
        require(stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) == 0o600
                and metadata.st_uid == self.application_uid()
                and metadata.st_nlink == 1, "Effective configuration is not private.")
        require(effective.read_bytes() == expected, "Effective configuration differs from canonical configuration.")

    def sleep(self):
        time.sleep(1)


def health(system, revision, public=False):
    status_code, body = system.request("/healthz", public)
    value = strict_json(body)
    require(status_code == 200 and value.get("service") == "becore-tickets"
            and value.get("runtime") == "vps" and value.get("active") is True
            and value.get("revision") == revision, "Unexpected live health identity.")


def ready(system, revision, *, candidate=False):
    for _ in range(30):
        try:
            health(system, revision)
            break
        except Exception:
            system.sleep()
    else:
        raise ReleaseError("Local release readiness failed.")
    health(system, revision, public=True)
    for public in (False, True):
        for route, expected in ROUTES:
            code, body = system.request(route, public)
            require(code == expected, "Route verification failed: " + route)
            if route == "/api/version":
                version = strict_json(body)
                require(version.get("service") == "becore-tickets" and version.get("revision") == revision,
                        "Version route does not identify the active release.")
        if candidate:
            # Deleted routes must answer directly with 404. This is candidate-only:
            # the previous release may still expose its preview during rollback.
            for route in ("/checkout-preview", "/api/payments/preview"):
                code, _ = system.request(route, public)
                require(code == 404, "Retired checkout preview route is still available: " + route)


class Deployment:
    def __init__(self, *, source, expected, run_id, attempt, archive, provenance,
                 archive_digest, provenance_digest, enable_crypto=False, recover_prepared=None,
                 root=Path("/"), system=None):
        require(SHA.fullmatch(source) and SHA.fullmatch(expected) and source != expected,
                "Distinct exact release SHAs required.")
        require(NUMBER.fullmatch(run_id) and NUMBER.fullmatch(attempt), "Invalid deployment identity.")
        require(DIGEST.fullmatch(archive_digest) and DIGEST.fullmatch(provenance_digest),
                "Verified artifact and provenance digests required.")
        self.source, self.expected = source, expected
        self.identity = run_id + "-" + attempt
        self.run_id, self.attempt = run_id, attempt
        self.recover_prepared = recover_prepared or None
        require(self.recover_prepared is None or (
            re.fullmatch(r"[1-9][0-9]*-[1-9][0-9]*", self.recover_prepared)
            and self.recover_prepared != self.identity), "Invalid prepared recovery identity.")
        self.archive, self.provenance = Path(archive), Path(provenance)
        self.archive_digest, self.provenance_digest = archive_digest, provenance_digest
        self.enable_crypto = enable_crypto
        self.root, self.system = Path(root), system or System()
        self.home = self.root / "srv/becore-tickets"
        self.releases = self.home / "releases"
        self.release = self.releases / source
        self.old_release = self.releases / expected
        self.journal = self.root / "var/lib/becore-tickets-handover/live-transfer.json"
        self.handoff = self.root / "var/lib/becore-tickets/handoff.json"
        self.config = self.root / "etc/becore-tickets/runtime.json"
        self.override = self.root / "etc/systemd/system/becore-tickets.service.d/scanner-release.conf"
        self.bridge = self.override.parent / "private-configuration.conf"
        self.snapshot = self.journal.parent / ("code-release-" + self.identity)
        self.lock = self.root / "run/lock/becore-tickets-deploy.lock"

    def file(self, path, private=False, owner=None):
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == (os.geteuid() if owner is None else owner),
                "Expected owned regular file: " + str(path))
        require(not private or stat.S_IMODE(info.st_mode) == 0o600,
                "Private file must have mode 0600: " + str(path))
        return path.read_bytes()

    def manifest(self, release, revision):
        require(release.is_dir() and not release.is_symlink(), "Expected real release directory.")
        value = strict_json(self.file(release / "release.json"))
        require(value.get("revision") == revision and value.get("dirty") is False,
                "Manifest does not identify a clean exact release.")

    def preflight(self):
        for directory in (self.home, self.releases, self.journal.parent, self.override.parent):
            require(directory.is_dir() and not directory.is_symlink(), "Unsafe deployment directory.")
        require((not os.path.lexists(self.release) or self.recover_prepared)
                and not os.path.lexists(self.snapshot),
                "Release or evidence already exists; inspect before retrying.")
        self.file(self.archive)
        require(digest_file(self.archive) == self.archive_digest
                and digest_file(self.provenance) == self.provenance_digest, "Transferred digest mismatch.")
        self.proof = strict_json(self.file(self.provenance))
        require(self.proof.get("version") == 1 and self.proof.get("source") == self.source
                and self.proof.get("expectedActive") == self.expected
                and self.proof.get("archiveSha256") == self.archive_digest
                and self.proof.get("ancestryVerified") is True
                and SHA.fullmatch(self.proof.get("sourceTree", ""))
                and self.proof.get("candidateTree") == self.proof["sourceTree"],
                "Release provenance does not match the transaction.")
        self.before = {"journal": self.file(self.journal, private=True),
                       "handoff": self.file(self.handoff, private=True, owner=self.system.application_uid()),
                       "config": self.file(self.config, private=True),
                       "override": self.file(self.override), "bridge": self.file(self.bridge)}
        self.modes = {"override": stat.S_IMODE(self.override.stat().st_mode)}
        self.next_override = release_override(self.before["override"], self.old_release, self.release)
        self.record = strict_json(self.before["journal"])
        require(self.record.get("phase") == "active"
                and self.record.get("activeRevision") == self.expected
                and self.record.get("revision") == ORIGINAL_TRANSFER_REVISION
                and DIGEST.fullmatch(self.record.get("configurationHash", "")),
                "Handover journal is not the expected active transfer.")
        self.manifest(self.old_release, self.expected)
        self.links = {}
        self.rollback_releases = set()
        for name in ("current", "previous"):
            link = self.home / name
            require(link.is_symlink(), "Release pointers must already be symlinks.")
            target = link.resolve(strict=True)
            require(target.parent == self.releases and SHA.fullmatch(target.name),
                    "Release pointer escapes verified releases.")
            self.manifest(target, target.name)
            self.rollback_releases.add(target)
            self.links[name] = os.readlink(link)
            if name == "current":
                require(target == self.old_release, "Current pointer is not the active release.")
        self.retention_safe()
        require(self.system.property("WorkingDirectory") == str(self.old_release),
                "Service working directory drifted.")
        require(self.system.property("ActiveState") == "active", "Tickets service is not active.")
        require(self.system.property("NeedDaemonReload") == "no",
                "Tickets service has a pending or unknown daemon-reload state.")
        self.system.verify_credential_binding()
        config = configuration(self.before["config"])
        require(config.get("ENVIRONMENT") == "production", "Expected production configuration.")
        if self.enable_crypto:
            require(config.get("SEEV_ENABLED") == "true" and config.get("SEEV_ENVIRONMENT") == "production"
                    and bool(config.get("SEEV_CHECKOUT_API_KEY")) and bool(config.get("SEEV_WEBHOOK_SECRET")),
                    "Existing production Seev configuration is not ready.")
        self.system.verify_effective_config(self.before["config"])
        self.next_config = enable_crypto_bytes(self.before["config"]) if self.enable_crypto else self.before["config"]
        health(self.system, self.expected)
        health(self.system, self.expected, public=True)
        if self.recover_prepared:
            self.check_prepared_recovery()

    def check_prepared_recovery(self):
        """Prove an explicitly selected failure never reached live activation."""
        failed = self.journal.parent / ("code-release-" + self.recover_prepared)
        for directory in (failed, self.release):
            info = directory.lstat()
            mode = stat.S_IMODE(info.st_mode)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and (mode == 0o700 if directory == failed else
                         mode & 0o700 == 0o700 and mode & ~0o755 == 0),
                    "Prepared recovery requires owned real directories with original modes.")
        require(not any(self.release.iterdir()), "Prepared recovery requires an empty candidate directory.")
        expected_files = {name + ".before" for name in self.before} | {
            "pointers.before.json", "modes.before.json", "provenance.json", "result.json"}
        require({path.name for path in failed.iterdir()} == expected_files,
                "Prepared recovery evidence contains missing or unexpected entries.")
        run_id, attempt = self.recover_prepared.split("-")
        require(strict_json(self.file(failed / "result.json", private=True)) == {
            "version": 1, "phase": "prepared", "runId": run_id, "attempt": attempt,
            "source": self.source, "previous": self.expected,
            "archiveSha256": self.archive_digest, "provenanceSha256": self.provenance_digest,
            "cryptoEnabledRequested": self.enable_crypto, "dataMigration": False},
            "Prepared recovery evidence does not match this exact failed transaction.")
        for name, raw in self.before.items():
            require(self.file(failed / (name + ".before"), private=True) == raw,
                    "Prepared recovery snapshot differs from live inputs.")
        require(strict_json(self.file(failed / "pointers.before.json", private=True)) == self.links
                and strict_json(self.file(failed / "modes.before.json", private=True)) == self.modes
                and self.file(failed / "provenance.json", private=True) == self.file(self.provenance),
                "Prepared recovery pointers, modes or provenance do not match.")
        self.preserved()
        for name, path in (("config", self.config), ("journal", self.journal), ("override", self.override)):
            require(self.file(path, private=(name != "override")) == self.before[name],
                    "Live input drifted during prepared recovery.")
        require(all(os.readlink(self.home / name) == target for name, target in self.links.items()),
                "Live pointers drifted during prepared recovery.")
        return failed

    def quarantine_prepared(self):
        # Validate the replacement archive before preserving the empty failed
        # candidate. Never delete/overwrite old evidence or a populated release.
        with tarfile.open(self.archive, "r:gz") as archive:
            self.archive_members(archive)
        failed = self.check_prepared_recovery()
        print(json.dumps({"preparedRecovery": self.recover_prepared, "phase": "prepared",
                          "emptyCandidateConfirmed": True, "originalStateHashesMatch": True}, sort_keys=True))
        self.release.rename(failed / "empty-release.quarantined")
        for directory in (self.releases, failed):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def retention_safe(self):
        require(all(target.is_dir() and not target.is_symlink()
                    and time.time() - target.stat().st_mtime < RETENTION_SAFE_AGE
                    for target in self.rollback_releases),
                "Rollback release is outside the safe retention grace; inspect before releasing.")

    def archive_members(self, archive):
        """Validate the whole archive before creating any extraction directory."""
        members = archive.getmembers()
        seen = {}
        for item in members:
            name = PurePosixPath(item.name)
            require(not name.is_absolute() and ".." not in name.parts,
                    "Archive path escapes release.")
            require(str(name) not in seen and (str(name) != "." or item.isdir()),
                    "Archive has a duplicate or invalid root member.")
            require(item.isfile() or item.isdir() or item.issym() or item.islnk(),
                    "Unsafe archive member.")
            if item.islnk():
                target = PurePosixPath(item.linkname)
                require(not target.is_absolute() and ".." not in target.parts
                        and str(target) in seen and seen[str(target)].isfile()
                        and str(target) != "release.json" and item.size == 0,
                        "Archive hardlink must reference an earlier internal regular file.")
            # Preserve data_filter both here and at extraction time. GNU tar
            # deduplicates esbuild as a hardlink to its earlier packaged binary.
            tarfile.data_filter(item, str(self.release))
            seen[str(name)] = item
        for name in seen:
            require(all(str(parent) not in seen or seen[str(parent)].isdir()
                        for parent in PurePosixPath(name).parents),
                    "Archive member has a non-directory parent.")
        return members

    def unpack(self):
        with tarfile.open(self.archive, "r:gz") as archive:
            members = self.archive_members(archive)
            needed = sum(item.size for item in members if item.isfile())
            require(shutil.disk_usage(self.releases).free > needed + 512 * 1024 * 1024,
                    "Insufficient free space for safe release extraction.")
            self.release.mkdir(mode=0o755)
            archive.extractall(self.release, filter="data")
        self.manifest(self.release, self.source)
        require((self.release / "bin/node").is_file() and not (self.release / "bin/node").is_symlink()
                and (self.release / "server.mjs").is_file() and not (self.release / "server.mjs").is_symlink(),
                "Runtime executables missing or unsafe.")
        self.system.run(str(self.release / "bin/node"), "--check", str(self.release / "server.mjs"))

    def evidence(self, phase):
        write_json(self.snapshot / "result.json", {
            "version": 1, "phase": phase, "runId": self.run_id, "attempt": self.attempt,
            "source": self.source, "previous": self.expected,
            "archiveSha256": self.archive_digest, "provenanceSha256": self.provenance_digest,
            "cryptoEnabledRequested": self.enable_crypto, "dataMigration": False})

    def preserved(self):
        require(self.file(self.handoff, private=True, owner=self.system.application_uid()) == self.before["handoff"], "Handoff state changed.")
        require(self.file(self.bridge) == self.before["bridge"], "Private credential bridge changed.")

    def transact(self):
        self.preflight()
        if self.recover_prepared:
            self.quarantine_prepared()
        self.snapshot.mkdir(mode=0o700)
        for name, raw in self.before.items():
            atomic_write(self.snapshot / (name + ".before"), raw)
        write_json(self.snapshot / "pointers.before.json", self.links)
        write_json(self.snapshot / "modes.before.json", self.modes)
        atomic_write(self.snapshot / "provenance.json", self.provenance.read_bytes())
        self.evidence("prepared")
        self.unpack()  # no service/configuration changes before archive validation
        journal_after = None
        try:
            self.evidence("activating")
            self.preserved()
            for name, path in (("config", self.config), ("journal", self.journal), ("override", self.override)):
                require(self.file(path, private=(name != "override")) == self.before[name],
                        "Deployment input drifted before activation.")
            require(all(os.readlink(self.home / name) == target for name, target in self.links.items()),
                    "Release pointers drifted before activation.")
            health(self.system, self.expected)
            health(self.system, self.expected, public=True)
            if self.next_config != self.before["config"]:
                atomic_write(self.config, self.next_config)
            atomic_write(self.override, self.next_override, self.modes["override"])
            self.system.restart()
            require(self.system.property("WorkingDirectory") == str(self.release), "Candidate unit did not load.")
            ready(self.system, self.source, candidate=True)
            self.system.verify_effective_config(self.next_config)
            self.preserved()
            require(self.file(self.config, private=True) == self.next_config, "Configuration drifted during release.")
            require(self.file(self.journal, private=True) == self.before["journal"], "Handover journal drifted.")
            # Keep both old pointers pinned through health verification. Only after
            # readiness, and with one hour of retention grace left, commit pointers.
            self.retention_safe()
            replace_link(self.home / "previous", str(self.old_release))
            replace_link(self.home / "current", str(self.release))
            record = copy.deepcopy(self.record)
            record["activeRevision"] = self.source
            record["lastCodeRelease"] = {
                "runId": self.run_id, "attempt": self.attempt, "previous": self.expected,
                "revision": self.source, "archiveSha256": self.archive_digest,
                "provenanceSha256": self.provenance_digest,
                "cryptoEnabledRequested": self.enable_crypto}
            require(self.file(self.journal, private=True) == self.before["journal"], "Handover journal drifted before commit.")
            journal_after = (json.dumps(record, sort_keys=True) + "\n").encode()
            atomic_write(self.journal, journal_after)
            self.evidence("verified")
            return {"released": self.source, "previous": self.expected, "active": True,
                    "runtime": "vps", "publicVerified": True, "dataMigration": False,
                    "cryptoEnabledRequested": self.enable_crypto}
        except BaseException as failure:
            try:
                # Restore only bytes/pointers owned by this transaction. An outside
                # update must survive even when it is what caused the release to fail.
                conflicts = []
                for path, original, written, mode in (
                    (self.override, self.before["override"], self.next_override, self.modes["override"]),
                    (self.config, self.before["config"], self.next_config, 0o600),
                    (self.journal, self.before["journal"], journal_after, 0o600),
                ):
                    try:
                        present = self.file(path, private=(path != self.override))
                        if present != original:
                            require(written is not None and present == written, "External file drift preserved.")
                            atomic_write(path, original, mode)
                    except Exception:
                        conflicts.append(path.name)
                for name, written in (("current", str(self.release)), ("previous", str(self.old_release))):
                    try:
                        link = self.home / name
                        require(link.is_symlink(), "External pointer drift preserved.")
                        present = os.readlink(link)
                        if present != self.links[name]:
                            require(present == written, "External pointer drift preserved.")
                            replace_link(link, self.links[name])
                    except Exception:
                        conflicts.append(name)
                require(not conflicts, "External drift preserved; operator review required.")
                self.system.restart()
                require(self.system.property("WorkingDirectory") == str(self.old_release), "Rollback unit did not load.")
                ready(self.system, self.expected)
                self.system.verify_effective_config(self.before["config"])
                self.preserved()
                self.evidence("rolled-back")
            except BaseException as rollback_failure:
                self.evidence("rollback-needs-attention")
                raise ReleaseError("Rollback verification failed; inspect private release evidence.") from rollback_failure
            raise ReleaseError("Candidate failed; previous release restored and verified.") from failure

    def apply(self):
        require(os.geteuid() == 0, "Root access required.")
        fd = os.open(self.lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "a") as lock:
            require(stat.S_ISREG(os.fstat(lock.fileno()).st_mode), "Deployment lock must be regular.")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ReleaseError("Another Tickets deployment holds the lock.") from exc
            return self.transact()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify-ci")
    for name in ("source", "expected", "repository", "metadata", "runtime-run", "candidate-run", "archive", "output"):
        verify.add_argument("--" + name, required=True)
    apply = commands.add_parser("apply")
    for name in ("source", "expected", "run-id", "attempt", "archive", "provenance", "archive-digest", "provenance-digest"):
        apply.add_argument("--" + name, required=True)
    apply.add_argument("--enable-crypto", choices=("true", "false"), default="false")
    apply.add_argument("--recover-prepared", default="",
                       help="Exact failed run-attempt identity; only a proven prepared empty release is quarantined.")
    args = parser.parse_args()
    try:
        if args.command == "verify-ci":
            verify_ci(args)
        else:
            values = vars(args)
            values.pop("command")
            values["enable_crypto"] = values["enable_crypto"] == "true"
            def interrupted(_number, _frame):
                raise ReleaseError("Release interrupted.")
            signal.signal(signal.SIGTERM, interrupted)
            signal.signal(signal.SIGINT, interrupted)
            print(json.dumps(Deployment(**values).apply(), sort_keys=True))
    except BaseException as exc:
        # Do not print exception chains, commands, systemctl output or config values.
        print(str(exc) if isinstance(exc, ReleaseError) else "Release failed; inspect private evidence.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
