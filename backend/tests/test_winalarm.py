from datetime import datetime

from app import winalarm


def test_an_alarm_is_a_task_whose_command_carries_no_text_of_his(tmp_path):
    ran = []
    winalarm.schedule(7, 'llamar a "mamá"; $(rm -rf)', datetime(2026, 10, 30, 7, 5), folder=tmp_path, run=ran.append)
    script = ran[0][-1]
    assert "mamá" not in script and "rm -rf" not in script  # what to say is read from its file, never from the command
    assert "2026-10-30T07:05:00" in script and "Alarma 7" in script and "\Capri\\" in script
    assert (tmp_path / "alarmas" / "7.txt").read_text(encoding="utf-8") == 'llamar a "mamá"; $(rm -rf)'
    assert (tmp_path / "alarma.ps1").exists()
    assert "Looping.Alarm" in (tmp_path / "alarma.ps1").read_text(encoding="utf-8")


def test_cancelling_removes_the_task_and_its_text(tmp_path):
    ran = []
    winalarm.schedule(3, "reunión", datetime(2026, 10, 30, 7, 0), folder=tmp_path, run=ran.append)
    winalarm.cancel(3, folder=tmp_path, run=ran.append)
    assert "Unregister-ScheduledTask" in ran[-1][-1] and "Alarma 3" in ran[-1][-1]
    assert not (tmp_path / "alarmas" / "3.txt").exists()
