package com.example.calc;

import java.util.List;

public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int sum(List<Integer> values) {
        int total = 0;
        for (int value : values) {
            total = add(total, value);
        }
        return total;
    }

    public String untested() {
        return "nobody calls me";
    }
}
