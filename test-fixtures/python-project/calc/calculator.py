class Calculator:
    def __init__(self):
        self.history = []

    def add(self, a, b):
        return a + b

    def sum(self, values):
        total = 0
        for value in values:
            total = self.add(total, value)
        return total


def shout(text):
    return text.upper() + "!"


def untested():
    return "nobody calls me"
