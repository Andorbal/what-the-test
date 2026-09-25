namespace Calc;

public class Calculator
{
    public int Add(int a, int b)
    {
        return a + b;
    }

    public int Sum(IEnumerable<int> values)
    {
        var total = 0;
        foreach (var value in values)
        {
            total = Add(total, value);
        }
        return total;
    }

    public string Untested()
    {
        return "nobody calls me";
    }
}
