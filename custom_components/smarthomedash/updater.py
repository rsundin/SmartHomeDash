"""Self-update from a (private) GitHub repository.

The `smarthomedash.update` action downloads the repository as a tarball with a
read-only token and installs it:

- custom_components/smarthomedash is replaced as a whole.
- For every configured site, files from sites/<site>/ that are missing on
  Home Assistant are added. Existing files, above all a site.json saved from
  placement mode, are kept unless `overwrite_site` is set (then the old
  site.json is kept as site.json.bak).

Frontend changes show on the next page load. When the Python code or the
manifest changed, Home Assistant has to be restarted; the result says so and a
notification is shown.
"""

from __future__ import annotations

import io
import logging
import shutil
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path

from aiohttp import ClientError, ClientTimeout

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

MAX_DOWNLOAD = 100 * 1024 * 1024
# Files whose change needs a Home Assistant restart to take effect.
RESTART_FILES = ("__init__.py", "config_flow.py", "const.py", "views.py", "updater.py", "manifest.json", "services.yaml", "strings.json")


@dataclass
class UpdateResult:
    commit: str
    restart_required: bool
    added_site_files: list[str]


async def async_download(hass: HomeAssistant, repository: str, ref: str, token: str | None) -> bytes:
    """Download the repository at `ref` as a .tar.gz."""
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://api.github.com/repos/{repository}/tarball/{ref}"
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, headers=headers, timeout=ClientTimeout(total=120)) as resp:
            if resp.status in (401, 403, 404):
                raise HomeAssistantError(
                    f"GitHub answered {resp.status} for {repository}@{ref}. "
                    "Check github_token (read access to Contents) and the repository name."
                )
            resp.raise_for_status()
            data = await resp.content.read(MAX_DOWNLOAD + 1)
    except ClientError as err:
        raise HomeAssistantError(f"Could not download {repository}: {err}") from err
    if len(data) > MAX_DOWNLOAD:
        raise HomeAssistantError("The download is larger than expected; refusing to install it")
    return data


def install(archive: bytes, integration_dir: Path, sites_dir: Path, sites: list[str], overwrite_site: bool) -> UpdateResult:
    """Unpack the archive and install it. Runs in an executor thread."""
    with tempfile.TemporaryDirectory(prefix="smarthomedash-") as tmp:
        tmp_path = Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            tar.extractall(tmp_path, filter="data")  # refuses absolute paths and ../
        tops = [p for p in tmp_path.iterdir() if p.is_dir()]
        if len(tops) != 1:
            raise HomeAssistantError("Unexpected archive layout")
        top = tops[0]
        commit = top.name.rsplit("-", 1)[-1][:7]
        new_integration = top / "custom_components" / "smarthomedash"
        if not (new_integration / "manifest.json").is_file():
            raise HomeAssistantError("The repository has no custom_components/smarthomedash")

        restart = any(_differs(integration_dir / f, new_integration / f) for f in RESTART_FILES)
        _replace_dir(new_integration, integration_dir)

        added: list[str] = []
        for site in sites:
            src = top / "sites" / site
            if not src.is_dir():
                continue
            dst = sites_dir / site
            dst.mkdir(parents=True, exist_ok=True)
            for f in src.rglob("*"):
                if not f.is_file():
                    continue
                rel = f.relative_to(src)
                target = dst / rel
                if target.exists():
                    if not (overwrite_site and rel.as_posix() == "site.json"):
                        continue
                    shutil.copy2(target, target.with_suffix(".json.bak"))
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, target)
                added.append(f"{site}/{rel.as_posix()}")
    return UpdateResult(commit=commit, restart_required=restart, added_site_files=added)


def _differs(old: Path, new: Path) -> bool:
    if not old.exists() and not new.exists():
        return False
    if not old.exists() or not new.exists():
        return True
    return old.read_bytes() != new.read_bytes()


def _replace_dir(src: Path, target: Path) -> None:
    """Swap target for a copy of src, keeping the old copy until the swap succeeded."""
    staging = target.with_name(f".{target.name}.new")
    old = target.with_name(f".{target.name}.old")
    for p in (staging, old):
        if p.exists():
            shutil.rmtree(p)
    shutil.copytree(src, staging, ignore=shutil.ignore_patterns("__pycache__"))
    target.rename(old)
    try:
        staging.rename(target)
    except OSError:
        old.rename(target)
        raise
    shutil.rmtree(old, ignore_errors=True)
