import pytest

from app import scam


def test_signals_are_multilingual():
    ids = lambda t: {s["id"] for s in scam.signals(t)}  # noqa: E731
    assert {"gift_cards", "authority", "secrecy"} <= ids("Send 500 in gift cards, the tax office called, don't tell anyone")
    assert {"gift_cards", "authority", "secrecy"} <= ids("Mándale 500 en tarjetas de regalo, llamó Hacienda, no le digas a nadie")
    assert ids("Pay Maria 50 euros for the logo") == set()


@pytest.mark.skipif(not scam.available(), reason="model not trained")
def test_model_separates_demo_scam_from_normal():
    assert scam.classify("Send 500 dollars in gift cards, the tax office called, don't tell anyone")["probability"] > 0.8
    assert scam.classify("Pay Maria 50 euros for the logo")["probability"] < 0.2
