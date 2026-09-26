package calc

import "testing"

func TestAdd(t *testing.T) {
	if Add(1, 2) != 3 {
		t.Fatal("bad")
	}
}

func TestSum(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if Sum() != 0 {
			t.Fatal("bad")
		}
	})
	t.Run("several values", func(t *testing.T) {
		if Sum(1, 2, 3) != 6 {
			t.Fatal("bad")
		}
	})
}

func TestTotalArea(t *testing.T) {
	if TotalArea(&Square{Side: 2}, &Square{Side: 3}) != 13 {
		t.Fatal("bad")
	}
}
