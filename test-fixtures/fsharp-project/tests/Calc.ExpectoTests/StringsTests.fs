module Calc.ExpectoTests.StringsTests

open Expecto
open Calc

[<Tests>]
let tests =
    testList "strings" [
        testCase "shouts" <| fun _ ->
            Expect.equal (Strings.shout "hi") "HI!" "shouted"

        testList "sums" [
            test "sums with the calculator" {
                Expect.equal (Calculator().Sum [ 1; 2 ]) 3 "sum"
            }
        ]
    ]
