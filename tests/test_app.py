from __future__ import annotations

from streamlit.testing.v1 import AppTest


def load_app() -> AppTest:
    return AppTest.from_file("app.py", default_timeout=30).run()


def test_dashboard_loads_without_exceptions() -> None:
    app = load_app()

    assert not app.exception
    assert [title.value for title in app.title] == ["Integrity Risk Modelling Lab"]
    assert "Analytics Dashboard" in [header.value for header in app.header]
    assert len(app.metric) == 4


def test_default_case_predicts_low_priority() -> None:
    app = load_app()
    app.button[0].click().run()

    assert not app.exception
    assert [message.value for message in app.success] == ["Predicted risk level: Low"]


def test_high_signal_case_predicts_critical_priority() -> None:
    app = load_app()
    app.selectbox[2].set_value("Direct Award")

    values = [50_000.0, 100_000.0, 200, 100, 1, 1, 4, 4, 20_000.0, 60]
    for widget, value in zip(app.number_input, values, strict=True):
        widget.set_value(value)

    app.checkbox[0].uncheck()  # no checker
    app.checkbox[1].uncheck()  # no approver
    app.checkbox[2].check()  # COI declared
    app.checkbox[3].check()  # duplicate invoice
    app.checkbox[5].check()  # split purchase
    app.button[0].click().run()

    assert not app.exception
    assert [message.value for message in app.success] == ["Predicted risk level: Critical"]
