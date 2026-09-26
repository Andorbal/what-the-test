import pytest

from calc.calculator import Calculator


@pytest.fixture
def calculator():
    return Calculator()
