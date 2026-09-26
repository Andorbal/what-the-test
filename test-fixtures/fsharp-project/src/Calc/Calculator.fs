namespace Calc

type Calculator() =
    member _.Add(a: int, b: int) =
        a + b

    member this.Sum(values: int seq) =
        values |> Seq.fold (fun total value -> this.Add(total, value)) 0

module Strings =
    let shout (text: string) =
        text.ToUpperInvariant() + "!"

    let untested () =
        "nobody calls me"
