"""Alarms on Windows itself ("pon una alarma en el PC"): they ring even with Capri closed. Each is a one-time
Task Scheduler task (\\Capri\\Alarma <id>) that shows a Windows alarm notification (looping sound, a Listo
button), then removes itself. What it says lives in a file (%APPDATA%\\Capri\\alarmas\\<id>.txt): nothing he
said ever goes into a command line. Authorized 29/10/2026 with a normal click."""

import subprocess
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from app import settings

POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"  # 5.1: it has the WinRT toasts
# PowerShell's own app id, so the notification shows without registering one
APP_ID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
SCRIPT = r"""param([int]$Id)
$dir = Join-Path $env:APPDATA 'Capri\alarmas'
$file = Join-Path $dir "$Id.txt"
if (Test-Path $file) {
  $text = [Security.SecurityElement]::Escape((Get-Content -Raw -Encoding UTF8 $file).Trim())
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
  $xml = "<toast scenario='alarm'><visual><binding template='ToastGeneric'><text>Capri</text><text>$text</text></binding></visual>" +
         "<audio src='ms-winsoundevent:Notification.Looping.Alarm' loop='true'/>" +
         "<actions><action activationType='system' arguments='dismiss' content='Listo'/></actions></toast>"
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('%s').Show([Windows.UI.Notifications.ToastNotification]::new($doc))
  Remove-Item $file
}
Unregister-ScheduledTask -TaskName "Alarma $Id" -TaskPath '\Capri\' -Confirm:$false
""" % APP_ID


def _ps(command: str) -> list[str]:
    return [POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", command]


def _run(cmd: list[str]) -> None:
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if done.returncode:
        raise RuntimeError((done.stderr or done.stdout).strip()[:300] or f"código {done.returncode}")


def schedule(rid: int, texto: str, at: datetime, folder: Path | None = None, run: Callable[[list[str]], None] = _run) -> None:
    """The task for alarm `rid` at `at` (local time), saying `texto`."""
    root = folder or settings.path().parent
    (root / "alarmas").mkdir(parents=True, exist_ok=True)
    (root / "alarmas" / f"{rid}.txt").write_text(texto, encoding="utf-8")
    script = root / "alarma.ps1"
    script.write_text(SCRIPT, encoding="utf-8-sig")  # with a BOM: 5.1 reads it as UTF-8
    # a hidden console: conhost --headless runs it without a window flashing up
    args = f"--headless {POWERSHELL} -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Id {int(rid)}"
    run(_ps(
        f"$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '{args.replace("'", "''")}'; "
        f"$t = New-ScheduledTaskTrigger -Once -At ([datetime]'{at.isoformat(timespec='seconds')}'); "
        "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; "
        f"Register-ScheduledTask -TaskName 'Alarma {int(rid)}' -TaskPath '\\Capri\\' -Action $a -Trigger $t -Settings $s -Force | Out-Null"))


def cancel(rid: int, folder: Path | None = None, run: Callable[[list[str]], None] = _run) -> None:
    root = folder or settings.path().parent
    (root / "alarmas" / f"{rid}.txt").unlink(missing_ok=True)
    run(_ps(f"Unregister-ScheduledTask -TaskName 'Alarma {int(rid)}' -TaskPath '\\Capri\\' -Confirm:$false -ErrorAction SilentlyContinue"))
