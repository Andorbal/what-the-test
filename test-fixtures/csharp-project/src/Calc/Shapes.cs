namespace Calc;

public interface IShape
{
    int Area();
}

public abstract class Polygon : IShape
{
    public abstract int Area();

    public string Describe()
    {
        return $"a polygon with area {Area()}";
    }
}

public class Square : Polygon
{
    private readonly int _side;

    public Square(int side)
    {
        _side = side;
    }

    public override int Area()
    {
        return _side * _side;
    }
}

public static class Shapes
{
    public static int TotalArea(IEnumerable<IShape> shapes)
    {
        return shapes.Sum(shape => shape.Area());
    }

    public static bool IsLarge(Square square)
    {
        return square.Area() > 100;
    }
}
