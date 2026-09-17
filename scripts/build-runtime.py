"""Build the current platform's frozen service and stage the VS Code assets."""
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    build = ROOT / "build"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--name",
            "dynamodb-tools-service",
            "--distpath",
            str(build / "runtime-dist"),
            "--workpath",
            str(build / "pyinstaller"),
            "--specpath",
            str(build),
            "--paths",
            str(ROOT),
            "--add-data",
            f"{ROOT / 'app/static'}:app/static",
            "--collect-data",
            "botocore",
            "--collect-data",
            "boto3",
            "--collect-data",
            "jsonschema_specifications",
            "--hidden-import",
            "uvicorn.loops.asyncio",
            "--hidden-import",
            "uvicorn.protocols.http.h11_impl",
            "--hidden-import",
            "uvicorn.lifespan.on",
            str(ROOT / "packaging/service.py"),
        ],
        cwd=ROOT,
        check=True,
    )
    source = build / "runtime-dist/dynamodb-tools-service"
    for dest in (build / "runtime/service", ROOT / "packaging/vscode/service"):
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest, symlinks=True)
    extension = ROOT / "packaging/vscode"
    shutil.copyfile(ROOT / "packaging/shared/service.cjs", extension / "host.cjs")
    shutil.copytree(ROOT / "app/static", extension / "static", dirs_exist_ok=True)
    shutil.copyfile(extension / "bridge.js", extension / "static/bridge.js")
    shutil.copyfile(ROOT / "packaging/desktop/icon.png", extension / "icon.png")
    license_path = next(ROOT.glob("LICENSE*"))
    shutil.copyfile(license_path, extension / "LICENSE")
    (build / "runtime/build-info.json").write_text(
        json.dumps(
            {
                "version": "0.3.0",
                "platform": sys.platform,
                "arch": {"aarch64": "arm64", "amd64": "x64", "x86_64": "x64"}.get(
                    platform.machine().lower(), platform.machine().lower()
                ),
                "python": sys.version.split()[0],
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
