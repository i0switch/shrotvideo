|i|m|p|o|r|t| |{| |C|o|m|m|a|n|d| |}| |f|r|o|m| |'|c|o|m|m|a|n|d|e|r|'|;|
|i|m|p|o|r|t| |p|a|t|h| |f|r|o|m| |'|n|o|d|e|:|p|a|t|h|'|;|
|i|m|p|o|r|t| |f|s| |f|r|o|m| |'|n|o|d|e|:|f|s|/|p|r|o|m|i|s|e|s|'|;|
|i|m|p|o|r|t| |o|s| |f|r|o|m| |'|n|o|d|e|:|o|s|'|;|
|i|m|p|o|r|t| |{| |s|p|a|w|n| |}| |f|r|o|m| |'|n|o|d|e|:|c|h|i|l|d|_|p|r|o|c|e|s|s|'|;|
|i|m|p|o|r|t| |f|f|m|p|e|g|S|t|a|t|i|c| |f|r|o|m| |'|f|f|m|p|e|g|-|s|t|a|t|i|c|'|;|
|
|i|m|p|o|r|t| |{| |g|e|n|e|r|a|t|e|V|i|d|e|o| |}| |f|r|o|m| |'|.|.|/|t|a|s|k|s|/|v|i|d|e|o|-|g|e|n|e|r|a|t|o|r|.|j|s|'|;|
|i|m|p|o|r|t| |t|y|p|e| |{| |A|p|p|S|e|t|t|i|n|g|s| |}| |f|r|o|m| |'|.|.|/|.|.|/|s|r|c|/|c|o|r|e|/|s|e|t|t|i|n|g|s|.|j|s|'|;|
|i|m|p|o|r|t| |{| |c|r|e|a|t|e|C|o|o|k|i|e|F|i|l|e|I|f|A|n|y| |}| |f|r|o|m| |'|.|.|/|u|t|i|l|s|/|c|o|o|k|i|e|-|u|t|i|l|s|.|j|s|'|;|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |e|n|s|u|r|e|D|i|r|(|p|:| |s|t|r|i|n|g|)| |{|
| | |a|w|a|i|t| |f|s|.|m|k|d|i|r|(|p|,| |{| |r|e|c|u|r|s|i|v|e|:| |t|r|u|e| |}|)|;|
|}|
|
|/|/| |H|e|l|p|e|r|:| |d|o|w|n|l|o|a|d| |a| |v|i|d|e|o| |f|i|l|e| |u|s|i|n|g| |y|t|-|d|l|p| |b|i|n|a|r|y|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |d|o|w|n|l|o|a|d|V|i|d|e|o|(|p|a|g|e|U|r|l|:| |s|t|r|i|n|g|,| |d|e|s|t|D|i|r|:| |s|t|r|i|n|g|,| |c|o|o|k|i|e|P|a|t|h|?|:| |s|t|r|i|n|g|)|:| |P|r|o|m|i|s|e|<|s|t|r|i|n|g|>| |{|
| | |a|w|a|i|t| |e|n|s|u|r|e|D|i|r|(|d|e|s|t|D|i|r|)|;|
| | |c|o|n|s|t| |s|a|f|e|N|a|m|e| |=| |p|a|g|e|U|r|l|.|r|e|p|l|a|c|e|(|/|[|^|a|-|z|A|-|Z|0|-|9|_|-|]|+|/|g|,| |'|_|'|)|.|s|l|i|c|e|(|0|,| |8|0|)|;|
| | |c|o|n|s|t| |o|u|t|P|a|t|h| |=| |p|a|t|h|.|j|o|i|n|(|d|e|s|t|D|i|r|,| |`|$|{|s|a|f|e|N|a|m|e|}|.|m|p|4|`|)|;|
| | |c|o|n|s|t| |b|i|n| |=| |p|a|t|h|.|j|o|i|n|(|p|r|o|c|e|s|s|.|c|w|d|(|)|,| |'|n|o|d|e|_|m|o|d|u|l|e|s|'|,| |'|y|t|d|l|p|-|n|o|d|e|j|s|'|,| |'|b|i|n|'|,| |p|r|o|c|e|s|s|.|p|l|a|t|f|o|r|m| |=|=|=| |'|w|i|n|3|2|'| |?| |'|y|t|-|d|l|p|.|e|x|e|'| |:| |'|y|t|-|d|l|p|'|)|;|
|
| | |c|o|n|s|t| |a|r|g|s| |=| |[|
| | | | |p|a|g|e|U|r|l|,|
| | | | |'|-|o|'|,| |o|u|t|P|a|t|h|,|
| | | | |'|-|f|'|,| |'|b|e|s|t|v|i|d|e|o|[|e|x|t|=|m|p|4|]|+|b|e|s|t|a|u|d|i|o|[|e|x|t|=|m|4|a|]|/|b|e|s|t|[|e|x|t|=|m|p|4|]|/|b|e|s|t|'|,|
| | | | |'|-|-|m|e|r|g|e|-|o|u|t|p|u|t|-|f|o|r|m|a|t|'|,| |'|m|p|4|'|,|
| | | | |'|-|-|n|o|-|p|l|a|y|l|i|s|t|'|,|
| | | | |'|-|-|n|o|-|w|a|r|n|i|n|g|s|'|
| | |]|;|
| | |i|f| |(|c|o|o|k|i|e|P|a|t|h|)| |{|
| | | | |a|r|g|s|.|p|u|s|h|(|'|-|-|c|o|o|k|i|e|s|'|,| |c|o|o|k|i|e|P|a|t|h|)|;|
| | |}|
|
| | |r|e|t|u|r|n| |n|e|w| |P|r|o|m|i|s|e|(|(|r|e|s|o|l|v|e|,| |r|e|j|e|c|t|)| |=|>| |{|
| | | | |c|o|n|s|o|l|e|.|l|o|g|(|`|[|d|o|w|n|l|o|a|d|e|r|]| |S|p|a|w|n|i|n|g| |y|t|-|d|l|p| |w|i|t|h| |a|r|g|s|:| |$|{|a|r|g|s|.|j|o|i|n|(|'| |'|)|}|`|)|;|
| | | | |c|o|n|s|t| |p|r|o|c|e|s|s| |=| |s|p|a|w|n|(|b|i|n|,| |a|r|g|s|,| |{| |t|i|m|e|o|u|t|:| |1|8|0|_|0|0|0| |}|)|;|
| | | | |l|e|t| |s|t|d|e|r|r| |=| |'|'|;|
| | | | |p|r|o|c|e|s|s|.|s|t|d|e|r|r|.|o|n|(|'|d|a|t|a|'|,| |(|d|a|t|a|)| |=|>| |{| |s|t|d|e|r|r| |+|=| |d|a|t|a|.|t|o|S|t|r|i|n|g|(|)|;| |}|)|;|
| | | | |p|r|o|c|e|s|s|.|o|n|(|'|c|l|o|s|e|'|,| |(|c|o|d|e|)| |=|>| |{|
| | | | | | |i|f| |(|c|o|d|e| |=|=|=| |0|)| |{|
| | | | | | | | |r|e|s|o|l|v|e|(|o|u|t|P|a|t|h|)|;|
| | | | | | |}| |e|l|s|e| |{|
| | | | | | | | |r|e|j|e|c|t|(|n|e|w| |E|r|r|o|r|(|`|y|t|-|d|l|p| |e|x|i|t|e|d| |w|i|t|h| |c|o|d|e| |$|{|c|o|d|e|}|:| |$|{|s|t|d|e|r|r|}|`|)|)|;|
| | | | | | |}|
| | | | |}|)|;|
| | | | |p|r|o|c|e|s|s|.|o|n|(|'|e|r|r|o|r|'|,| |(|e|r|r|)| |=|>| |r|e|j|e|c|t|(|e|r|r|)|)|;|
| | |}|)|;|
|}|
|
|/|/| |H|e|l|p|e|r|:| |c|a|p|t|u|r|e| |X| |p|o|s|t| |s|c|r|e|e|n|s|h|o|t| |u|s|i|n|g| |P|l|a|y|w|r|i|g|h|t|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |c|a|p|t|u|r|e|X|P|o|s|t|S|c|r|e|e|n|s|h|o|t|(|p|o|s|t|U|r|l|:| |s|t|r|i|n|g|,| |d|e|s|t|P|a|t|h|:| |s|t|r|i|n|g|)|:| |P|r|o|m|i|s|e|<|b|o|o|l|e|a|n|>| |{|
| | |c|o|n|s|t| |{| |c|h|r|o|m|i|u|m| |}| |=| |r|e|q|u|i|r|e|(|'|p|l|a|y|w|r|i|g|h|t|'|)|;|
| | |c|o|n|s|t| |b|r|o|w|s|e|r| |=| |a|w|a|i|t| |c|h|r|o|m|i|u|m|.|l|a|u|n|c|h|(|{| |h|e|a|d|l|e|s|s|:| |t|r|u|e| |}|)|;|
| | |c|o|n|s|t| |c|o|n|t|e|x|t| |=| |a|w|a|i|t| |b|r|o|w|s|e|r|.|n|e|w|C|o|n|t|e|x|t|(|{| |v|i|e|w|p|o|r|t|:| |{| |w|i|d|t|h|:| |1|2|0|0|,| |h|e|i|g|h|t|:| |2|0|0|0| |}| |}|)|;|
| | |c|o|n|s|t| |p|a|g|e|:| |a|n|y| |=| |a|w|a|i|t| |c|o|n|t|e|x|t|.|n|e|w|P|a|g|e|(|)|;|
| | |t|r|y| |{|
| | | | |a|w|a|i|t| |p|a|g|e|.|g|o|t|o|(|p|o|s|t|U|r|l|,| |{| |w|a|i|t|U|n|t|i|l|:| |'|d|o|m|c|o|n|t|e|n|t|l|o|a|d|e|d|'|,| |t|i|m|e|o|u|t|:| |6|0|_|0|0|0| |}|)|;|
| | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|L|o|a|d|S|t|a|t|e|(|'|n|e|t|w|o|r|k|i|d|l|e|'|,| |{| |t|i|m|e|o|u|t|:| |3|0|_|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |c|o|n|s|t| |a|r|t|i|c|l|e| |=| |p|a|g|e|.|l|o|c|a|t|o|r|(|'|a|r|t|i|c|l|e|[|r|o|l|e|=|"|a|r|t|i|c|l|e|"|]|'|)|.|f|i|r|s|t|(|)|;|
| | | | |a|w|a|i|t| |a|r|t|i|c|l|e|.|w|a|i|t|F|o|r|(|{| |s|t|a|t|e|:| |'|v|i|s|i|b|l|e|'|,| |t|i|m|e|o|u|t|:| |3|0|_|0|0|0| |}|)|;|
| | | | |a|w|a|i|t| |a|r|t|i|c|l|e|.|s|c|r|e|e|n|s|h|o|t|(|{| |p|a|t|h|:| |d|e|s|t|P|a|t|h| |}|)|;|
| | | | |r|e|t|u|r|n| |t|r|u|e|;|
| | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | |c|o|n|s|t| |e|r|r| |=| |e| |a|s| |E|r|r|o|r|;|
| | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|X| |s|c|r|e|e|n|s|h|o|t| |f|a|i|l|e|d|:|'|,| |e|r|r|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | | | |t|r|y| |{|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|s|c|r|e|e|n|s|h|o|t|(|{| |p|a|t|h|:| |d|e|s|t|P|a|t|h|,| |f|u|l|l|P|a|g|e|:| |t|r|u|e| |}|)|;|
| | | | | | |r|e|t|u|r|n| |t|r|u|e|;|
| | | | |}| |c|a|t|c|h| |{| |/|*| |s|w|a|l|l|o|w| |*|/| |}|
| | | | |r|e|t|u|r|n| |f|a|l|s|e|;|
| | |}| |f|i|n|a|l|l|y| |{|
| | | | |a|w|a|i|t| |c|o|n|t|e|x|t|.|c|l|o|s|e|(|)|;|
| | | | |a|w|a|i|t| |b|r|o|w|s|e|r|.|c|l|o|s|e|(|)|;|
| | |}|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |m|a|i|n|(|)| |{|
| | |c|o|n|s|t| |p|r|o|g|r|a|m| |=| |n|e|w| |C|o|m|m|a|n|d|(|)|;|
| | |p|r|o|g|r|a|m|
| | | | |.|r|e|q|u|i|r|e|d|O|p|t|i|o|n|(|'|-|p|,| |-|-|p|l|a|t|f|o|r|m| |<|t|y|p|e|>|'|,| |'|P|l|a|t|f|o|r|m| |(|y|o|u|t|u|b|e|,| |t|i|k|t|o|k|,| |x|)|'|)|
| | | | |.|r|e|q|u|i|r|e|d|O|p|t|i|o|n|(|'|-|u|,| |-|-|u|r|l| |<|u|r|l|>|'|,| |'|U|R|L| |o|f| |t|h|e| |v|i|d|e|o| |o|r| |p|o|s|t|'|)|;|
|
| | |p|r|o|g|r|a|m|.|p|a|r|s|e|(|p|r|o|c|e|s|s|.|a|r|g|v|)|;|
|
| | |c|o|n|s|t| |o|p|t|i|o|n|s| |=| |p|r|o|g|r|a|m|.|o|p|t|s|(|)|;|
| | |c|o|n|s|t| |{| |p|l|a|t|f|o|r|m|,| |u|r|l| |}| |=| |o|p|t|i|o|n|s|;|
|
| | |c|o|n|s|t| |t|m|p|R|o|o|t| |=| |p|a|t|h|.|j|o|i|n|(|o|s|.|t|m|p|d|i|r|(|)|,| |'|s|v|t|_|r|u|n|s|'|)|;|
| | |c|o|n|s|t| |t|e|s|t|D|a|t|a| |=| |p|a|t|h|.|j|o|i|n|(|t|m|p|R|o|o|t|,| |'|d|a|t|a|'|)|;|
| | |c|o|n|s|t| |o|u|t|D|i|r| |=| |p|a|t|h|.|j|o|i|n|(|t|m|p|R|o|o|t|,| |'|o|u|t|'|)|;|
| | |a|w|a|i|t| |e|n|s|u|r|e|D|i|r|(|t|e|s|t|D|a|t|a|)|;|
| | |a|w|a|i|t| |e|n|s|u|r|e|D|i|r|(|o|u|t|D|i|r|)|;|
|
| | |c|o|n|s|t| |b|a|s|e|S|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | |g|e|n|e|r|a|l|:| |{| |o|u|t|p|u|t|P|a|t|h|:| |o|u|t|D|i|r| |}|,|
| | | | |p|l|a|t|f|o|r|m|s|:| |{|
| | | | | | |x|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | | | |t|i|k|t|o|k|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | | | |y|o|u|t|u|b|e|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | |}|,|
| | | | |r|e|n|d|e|r|:| |{|
| | | | | | |r|e|s|o|l|u|t|i|o|n|:| |{| |w|i|d|t|h|:| |1|0|8|0|,| |h|e|i|g|h|t|:| |1|9|2|0| |}|,|
| | | | | | |d|u|r|a|t|i|o|n|S|e|c|:| |1|0|,|
| | | | | | |b|g|m|P|a|t|h|:| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|,| |'|b|g|m|.|w|a|v|'|)|,|
| | | | | | |b|a|c|k|g|r|o|u|n|d|V|i|d|e|o|P|a|t|h|:| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|,| |'|b|a|c|k|g|r|o|u|n|d|.|m|p|4|'|)|,|
| | | | | | |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |'|A|U|T|O|_|T|O|P|'|,| |b|o|t|t|o|m|:| |'|A|U|T|O|_|B|O|T|T|O|M|'| |}|,|
| | | | | | |s|c|a|l|e|:| |0|.|8|,|
| | | | | | |t|e|l|e|T|e|x|t|B|g|:| |'|#|0|0|0|0|0|0|'|,|
| | | | | | |q|u|a|l|i|t|y|P|r|e|s|e|t|:| |'|s|t|a|n|d|a|r|d|'|,|
| | | | | | |o|v|e|r|l|a|y|P|o|s|i|t|i|o|n|:| |'|c|e|n|t|e|r|'|,|
| | | | | | |t|o|p|C|a|p|t|i|o|n|H|e|i|g|h|t|:| |1|2|0|,|
| | | | | | |b|o|t|t|o|m|C|a|p|t|i|o|n|H|e|i|g|h|t|:| |1|6|0|,|
| | | | | | |c|a|p|t|i|o|n|B|g|O|p|a|c|i|t|y|:| |1|,|
| | | | |}|,|
| | |}|;|
|
| | |l|e|t| |c|o|o|k|i|e|P|a|t|h|:| |s|t|r|i|n|g| ||| |u|n|d|e|f|i|n|e|d|;|
| | |t|r|y| |{|
| | | | |c|o|n|s|t| |i|d| |=| |u|r|l|.|s|p|l|i|t|(|'|/|'|)|.|p|o|p|(|)|?|.|s|p|l|i|t|(|'|?|'|)|[|0|]| ||||| |'|'|;|
| | | | |c|o|n|s|t| |s|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|,|
| | | | | | |r|e|n|d|e|r|:| |{| |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|.|r|e|n|d|e|r|,| |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |p|l|a|t|f|o|r|m|,| |b|o|t|t|o|m|:| |i|d| |}| |}|,|
| | | | |}| |a|s| |A|p|p|S|e|t|t|i|n|g|s|;|
|
| | | | |c|o|o|k|i|e|P|a|t|h| |=| |a|w|a|i|t| |c|r|e|a|t|e|C|o|o|k|i|e|F|i|l|e|I|f|A|n|y|(|p|l|a|t|f|o|r|m|)|;|
|
| | | | |i|f| |(|p|l|a|t|f|o|r|m| |=|=|=| |'|x|'|)| |{|
| | | | | | |c|o|n|s|t| |s|s|P|a|t|h| |=| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|,| |`|x|s|h|o|t|-|$|{|D|a|t|e|.|n|o|w|(|)|}|.|p|n|g|`|)|;|
| | | | | | |c|o|n|s|t| |o|k| |=| |a|w|a|i|t| |c|a|p|t|u|r|e|X|P|o|s|t|S|c|r|e|e|n|s|h|o|t|(|u|r|l|,| |s|s|P|a|t|h|)|;|
| | | | | | |c|o|n|s|t| |s|c|r|e|e|n|s|h|o|t|T|o|U|s|e| |=| |o|k| |?| |s|s|P|a|t|h| |:| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|,| |'|s|c|r|e|e|n|s|h|o|t|.|p|n|g|'|)|;|
| | | | | | |c|o|n|s|t| |o|u|t| |=| |a|w|a|i|t| |g|e|n|e|r|a|t|e|V|i|d|e|o|(|s|c|r|e|e|n|s|h|o|t|T|o|U|s|e|,| |s|e|t|t|i|n|g|s|)|;|
| | | | | | |c|o|n|s|o|l|e|.|l|o|g|(|'|O|u|t|p|u|t|:|'|,| |o|u|t|)|;|
| | | | |}| |e|l|s|e| |{|
| | | | | | |c|o|n|s|t| |d|o|w|n|l|o|a|d|e|d| |=| |a|w|a|i|t| |d|o|w|n|l|o|a|d|V|i|d|e|o|(|u|r|l|,| |p|a|t|h|.|j|o|i|n|(|t|m|p|R|o|o|t|,| |'|d|o|w|n|l|o|a|d|s|'|)|,| |c|o|o|k|i|e|P|a|t|h|)|;|
| | | | | | |c|o|n|s|t| |o|u|t| |=| |a|w|a|i|t| |g|e|n|e|r|a|t|e|V|i|d|e|o|(|'|'|,| |s|e|t|t|i|n|g|s|,| |d|o|w|n|l|o|a|d|e|d|)|;|
| | | | | | |c|o|n|s|o|l|e|.|l|o|g|(|'|O|u|t|p|u|t|:|'|,| |o|u|t|)|;|
| | | | |}|
| | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | |c|o|n|s|t| |e|r|r| |=| |e| |a|s| |E|r|r|o|r|;|
| | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|F|a|i|l|e|d| |t|o| |g|e|n|e|r|a|t|e| |f|o|r| |U|R|L|:|'|,| |u|r|l|,| |'|\|n|'|,| |e|r|r|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | |}| |f|i|n|a|l|l|y| |{|
| | | | |i|f| |(|c|o|o|k|i|e|P|a|t|h|)| |{|
| | | | | | |a|w|a|i|t| |f|s|.|u|n|l|i|n|k|(|c|o|o|k|i|e|P|a|t|h|)|.|c|a|t|c|h|(|e| |=|>| |c|o|n|s|o|l|e|.|w|a|r|n|(|`|F|a|i|l|e|d| |t|o| |c|l|e|a|n|u|p| |c|o|o|k|i|e| |f|i|l|e|:| |$|{|c|o|o|k|i|e|P|a|t|h|}|`|,| |e|)|)|;|
| | | | |}|
| | |}|
|}|
|
|m|a|i|n|(|)|.|c|a|t|c|h|(|(|e|)| |=|>| |{|
| | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|e|)|;|
| | |p|r|o|c|e|s|s|.|e|x|i|t|(|1|)|;|
|}|)|;|
|