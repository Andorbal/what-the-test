package com.example.calc;

import java.util.List;

public class Square implements Shape {
    private final int side;

    public Square(int side) {
        this.side = side;
    }

    @Override
    public int area() {
        return side * side;
    }

    public static int totalArea(List<Shape> shapes) {
        return shapes.stream().mapToInt(Shape::area).sum();
    }

    public static boolean isLarge(Square square) {
        return square.area() > 100;
    }
}
