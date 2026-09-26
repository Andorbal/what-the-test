module Calc.Tests.CalculatorTests

open Xunit
open Calc

[<Fact>]
let ``Add returns the sum`` () =
    Assert.Equal(3, Calculator().Add(1, 2))

[<Fact>]
let ``Sum adds all values`` () =
    Assert.Equal(6, Calculator().Sum [ 1; 2; 3 ])
