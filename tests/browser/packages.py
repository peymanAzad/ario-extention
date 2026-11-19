"""Verify ZIP contents, production manifests, and bundled resource references."""

import json
import re
import struct
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


OUTPUT = Path(".output")
PACKAGE = json.loads(Path("package.json").read_text())
PREFIX = f"{PACKAGE['name']}-{PACKAGE['version']}"
PAGES = {"popup.html", "options.html", "confirmation.html"}
ICONS = {str(size): f"icon/{size}.png" for size in (16, 32, 48, 96, 128)}
CSP = "script-src 'self'; object-src 'none'; base-uri 'none'"


def assert_asset(url, files):
    path = url.removeprefix("/")
    assert path in files, f"Missing or external asset {url!r}"


class ExtensionPage(HTMLParser):
    def __init__(self, files):
        super().__init__()
        self.files = files
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        assert not any(name.startswith("on") for name in attrs), tag
        assert tag not in {"base", "embed", "iframe", "object"}, tag
        if tag == "script":
            assert attrs.get("src"), "Inline script in production page"
            self.scripts += 1
            assert_asset(attrs["src"], self.files)
        if tag == "link":
            assert_asset(attrs["href"], self.files)


def check_manifest(files, browser):
    manifest = json.loads(files["manifest.json"])
    assert manifest["manifest_version"] == 3
    assert manifest["version"] == PACKAGE["version"]
    assert set(manifest["permissions"]) == {"storage", "contextMenus", "alarms"}
    assert set(manifest["optional_permissions"]) == {"downloads", "cookies", "webRequest"}
    assert set(manifest["host_permissions"]) == {
        "http://127.0.0.1/*",
        "http://localhost/*",
        "http://[::1]/*",
    }
    assert set(manifest["optional_host_permissions"]) == {"http://*/*", "https://*/*"}
    assert manifest["incognito"] == "not_allowed"
    assert manifest["content_security_policy"] == {"extension_pages": CSP}
    assert not {"content_scripts", "externally_connectable", "web_accessible_resources", "sandbox"} & manifest.keys()
    assert manifest["action"]["default_popup"] == "popup.html"
    assert manifest["action"]["default_icon"] == {size: ICONS[size] for size in ("16", "32")}
    assert manifest["options_ui"]["page"] == "options.html"
    assert manifest["icons"] == ICONS
    if browser == "chrome":
        assert manifest["background"] == {"service_worker": "background.js"}
        assert "browser_specific_settings" not in manifest
    else:
        assert manifest["background"] == {"scripts": ["background.js"]}
        gecko = manifest["browser_specific_settings"]["gecko"]
        assert gecko["id"] == "ario-extension@ario.local"
        assert gecko["strict_min_version"] == "140.0"
        assert gecko["data_collection_permissions"] == {
            "required": ["browsingActivity", "websiteActivity", "websiteContent"]
        }


def unpack(path):
    with ZipFile(path) as zipped:
        names = zipped.namelist()
        assert len(set(names)) == len(names), f"Duplicate ZIP entries in {path}"
        return {name: zipped.read(name) for name in names}


def verify_package(browser):
    archive = OUTPUT / f"{PREFIX}-{browser}.zip"
    directory = OUTPUT / f"{browser}-mv3"
    files = unpack(archive)
    assert files == {
        file.relative_to(directory).as_posix(): file.read_bytes()
        for file in directory.rglob("*")
        if file.is_file()
    }, f"{archive} differs from the unpacked build"
    check_manifest(files, browser)
    notices = {"LICENSE-background.txt", "LICENSE-ui.txt"}
    root_files = PAGES | notices | {"manifest.json", "background.js"}
    assert notices <= files.keys()
    assert b"SIL OPEN FONT LICENSE" in files["LICENSE-ui.txt"]
    for name, data in files.items():
        path = PurePosixPath(name)
        assert name in root_files or name in ICONS.values() or (
            len(path.parts) == 2 and (
                (path.parent.name == "chunks" and path.suffix == ".js")
                or (path.parent.name == "assets" and path.suffix in {".css", ".woff2"})
            )
        ), f"Unexpected packaged file {name}"
        if name in PAGES:
            parser = ExtensionPage(files)
            parser.feed(data.decode())
            assert parser.scripts == 1, name
        if path.suffix == ".css":
            css = data.decode()
            assert not re.search(r"@import\s", css)
            for url in re.findall(r"url\(\s*[\"']?([^\"')]+)", css):
                assert_asset(url, files)
        if path.suffix == ".js":
            assert not re.search(rb"""\b(?:import\s*\(\s*|from\s*|importScripts\s*\(\s*)['"](?:https?:)?//""", data), name
    assert any(name.startswith("assets/inter-latin-wght-normal-") for name in files)
    for size, name in ICONS.items():
        data = files[name]
        assert data.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", data[16:24]) == (int(size), int(size))
    print(f"Verified {archive}")


def verify_source():
    archive = OUTPUT / f"{PREFIX}-firefox-sources.zip"
    files = unpack(archive)
    required = {
        ".nvmrc", "README.md", "package.json", "pnpm-lock.yaml",
        "pnpm-workspace.yaml", "tsconfig.json", "wxt.config.ts",
    }
    source = {path.as_posix() for path in Path("src").rglob("*") if path.is_file()}
    assert files.keys() == required | source, "Firefox source ZIP does not match the source allowlist"
    for name, contents in files.items():
        assert contents == Path(name).read_bytes(), f"Stale source ZIP entry {name}"
    print(f"Verified {archive}")


if __name__ == "__main__":
    verify_package("chrome")
    verify_package("firefox")
    verify_source()
