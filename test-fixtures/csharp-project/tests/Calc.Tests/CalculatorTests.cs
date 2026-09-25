namespace Calc.Tests;

public class CalculatorTests
{
    private readonly Calculator _calculator = new();

    [Fact]
    public void Add_ReturnsSum()
    {
        Assert.Equal(3, _calculator.Add(1, 2));
    }

    [Theory]
    [InlineData(new[] { 1, 2, 3 }, 6)]
    [InlineData(new int[0], 0)]
    public void Sum_AddsAllValues(int[] values, int expected)
    {
        Assert.Equal(expected, _calculator.Sum(values));
    }
}
