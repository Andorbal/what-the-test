package com.example.calc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class SquareTest {
    @Test
    void addsUpAreas() {
        assertEquals(13, Square.totalArea(List.of(new Square(2), new Square(3))));
    }
}
