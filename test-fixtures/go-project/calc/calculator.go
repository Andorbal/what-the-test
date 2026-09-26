// Package calc is a tiny calculator used by the What the Test integration tests.
package calc

// Add returns the sum of a and b.
func Add(a, b int) int {
	return a + b
}

// Sum adds up all values.
func Sum(values ...int) int {
	total := 0
	for _, v := range values {
		total = Add(total, v)
	}
	return total
}

// Untested isn't called by any test.
func Untested() string {
	return "nobody calls me"
}
