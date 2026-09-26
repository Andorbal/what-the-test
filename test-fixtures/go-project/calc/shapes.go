package calc

// Shape is anything with an area.
type Shape interface {
	Area() int
}

// Square is a Shape.
type Square struct {
	Side int
}

// Area of the square.
func (s *Square) Area() int {
	return s.Side * s.Side
}

// TotalArea adds up the areas of the shapes.
func TotalArea(shapes ...Shape) int {
	total := 0
	for _, shape := range shapes {
		total += shape.Area()
	}
	return total
}

// IsLarge calls Area directly, but no test calls it.
func IsLarge(s *Square) bool {
	return s.Area() > 100
}
