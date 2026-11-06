from app.voice.challenge import match


def test_matches_digits_as_words_or_numbers_in_en_and_es():
    assert match("blue 4 7 9 2", "Blue, four seven nine two.")["match"]
    assert match("blue 4 7 9 2", "blue 4792")["match"]
    assert match("azul 4 7 9 2", "Azul, cuatro siete nueve dos")["match"]
    assert match("verde 2 1 5 8", "verde dos uno cinco ocho")["match"]


def test_colour_is_reported_but_not_required():
    r = match("blue 5 3 7 1", "5, 3, 7, 1.")  # colour misheard/dropped by speech-to-text
    assert r["match"] and not r["color_ok"]


def test_replayed_old_command_fails():
    # A recording of an earlier command can't contain today's random phrase.
    r = match("blue 4 7 9 2", "Pay Maria fifty euros for the logo.")
    assert not r["match"] and not r["digits_ok"]


def test_wrong_order_missing_digit_or_digit_spraying_fails():
    assert not match("blue 4 7 9 2", "blue two nine seven four")["match"]
    assert not match("blue 4 7 9 2", "blue four seven nine")["match"]
    assert not match("blue 4 7 9 2", "blue zero one two three four five six seven eight nine")["match"]
