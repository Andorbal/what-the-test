package com.example.calc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CalculatorTest {
    private Calculator calculator;

    @BeforeEach
    void setUp() {
        calculator = new Calculator();
    }

    @Test
    void addsTwoNumbers() {
        assertEquals(3, calculator.add(1, 2));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3})
    void addsZero(int value) {
        assertEquals(value, calculator.add(value, 0));
    }

    @Nested
    class Sums {
        @Test
        void sumsAList() {
            assertEquals(6, calculator.sum(List.of(1, 2, 3)));
        }
    }
}
