namespace Calc.Tests;

public class ShapesTests
{
    [Fact]
    public void TotalArea_AddsUpAreas()
    {
        Assert.Equal(13, Shapes.TotalArea(new IShape[] { new Square(2), new Square(3) }));
    }

    [Fact]
    public void Describe_IncludesArea()
    {
        Assert.Contains("4", new Square(2).Describe());
    }
}
