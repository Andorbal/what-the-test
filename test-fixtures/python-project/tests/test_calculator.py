import unittest

import pytest

from calc.calculator import Calculator, shout


def test_add(calculator: Calculator):
    assert calculator.add(1, 2) == 3


@pytest.mark.parametrize(
    "values, expected",
    [([1, 2, 3], 6), ([], 0)],
)
def test_sum(
    calculator: Calculator,
    values,
    expected,
):
    assert calculator.sum(values) == expected


class TestShout:
    def test_shouts(self):
        assert shout("hi") == "HI!"


class CalculatorTestCase(unittest.TestCase):
    def setUp(self):
        self.calculator = Calculator()

    def test_add(self):
        self.assertEqual(self.calculator.add(2, 2), 4)
