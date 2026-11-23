from typer.testing import CliRunner

from timetrace.interfaces.cli.commands import cli_app


def test_stop_cli_requires_explicit_target_when_ambiguous(monkeypatch):
    import timetrace.interfaces.cli.commands as commands

    class Response:
        status_code = 200

        def json(self):
            return {"timers": [{"id": "timer-one"}, {"id": "timer-two"}]}

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, path):
            return Response()

        def post(self, *args, **kwargs):
            raise AssertionError("Ambiguous CLI must send no mutation")

    monkeypatch.setattr(commands, "get_client", lambda: Client())
    monkeypatch.setattr(commands, "ensure_daemon_running", lambda: None)
    result = CliRunner().invoke(cli_app, ["stop"])
    assert result.exit_code != 0
    assert "--timer" in result.stdout
    assert "timer-one" in result.stdout
    assert "timer-two" in result.stdout
