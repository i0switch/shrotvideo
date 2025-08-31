|i|m|p|o|r|t| |p|a|t|h| |f|r|o|m| |'|n|o|d|e|:|p|a|t|h|'|;|
|i|m|p|o|r|t| |f|s| |f|r|o|m| |'|n|o|d|e|:|f|s|/|p|r|o|m|i|s|e|s|'|;|
|i|m|p|o|r|t| |{| |m|k|d|i|r|S|y|n|c| |}| |f|r|o|m| |'|n|o|d|e|:|f|s|'|;|
|i|m|p|o|r|t| |o|s| |f|r|o|m| |'|n|o|d|e|:|o|s|'|;|
|i|m|p|o|r|t| |f|f|m|p|e|g| |f|r|o|m| |'|f|l|u|e|n|t|-|f|f|m|p|e|g|'|;|
|i|m|p|o|r|t| |f|f|m|p|e|g|S|t|a|t|i|c| |f|r|o|m| |'|f|f|m|p|e|g|-|s|t|a|t|i|c|'|;|
|i|m|p|o|r|t| |{| |e|x|e|c|F|i|l|e| |}| |f|r|o|m| |'|n|o|d|e|:|c|h|i|l|d|_|p|r|o|c|e|s|s|'|;|
|i|m|p|o|r|t| |{| |p|r|o|m|i|s|i|f|y| |}| |f|r|o|m| |'|n|o|d|e|:|u|t|i|l|'|;|
|i|m|p|o|r|t| |t|y|p|e| |{| |A|p|p|S|e|t|t|i|n|g|s|,| |P|l|a|t|f|o|r|m| |}| |f|r|o|m| |'|.|.|/|.|.|/|s|r|c|/|c|o|r|e|/|s|e|t|t|i|n|g|s|.|j|s|'|;|
|i|m|p|o|r|t| |{| |g|e|n|e|r|a|t|e|V|i|d|e|o| |}| |f|r|o|m| |'|.|.|/|t|a|s|k|s|/|v|i|d|e|o|-|g|e|n|e|r|a|t|o|r|.|j|s|'|;|
|
|c|o|n|s|t| |e|x|e|c|F|i|l|e|A|s|y|n|c| |=| |p|r|o|m|i|s|i|f|y|(|e|x|e|c|F|i|l|e|)|;|
|
|/|/| |E|n|s|u|r|e| |f|f|m|p|e|g| |b|i|n|a|r|y|
|t|r|y| |{|
| | |i|f| |(|f|f|m|p|e|g|S|t|a|t|i|c|)| |{|
| | | | |(|f|f|m|p|e|g| |a|s| |u|n|k|n|o|w|n| |a|s| |{| |s|e|t|F|f|m|p|e|g|P|a|t|h|:| |(|p|:| |s|t|r|i|n|g|)| |=|>| |v|o|i|d| |}|)|.|s|e|t|F|f|m|p|e|g|P|a|t|h|(|f|f|m|p|e|g|S|t|a|t|i|c| |a|s| |u|n|k|n|o|w|n| |a|s| |s|t|r|i|n|g|)|;|
| | |}|
|}| |c|a|t|c|h| |{| |/|*| |i|g|n|o|r|e| |*|/| |}|
|
|t|y|p|e| |A|c|c|o|u|n|t|I|n|p|u|t| |=| |{| |p|l|a|t|f|o|r|m|:| |P|l|a|t|f|o|r|m|;| |u|r|l|:| |s|t|r|i|n|g|;| |a|c|c|o|u|n|t|I|d|:| |s|t|r|i|n|g| |}|;|
|
|f|u|n|c|t|i|o|n| |d|e|t|e|c|t|P|l|a|t|f|o|r|m|A|n|d|A|c|c|o|u|n|t|(|u|r|l|:| |s|t|r|i|n|g|)|:| |A|c|c|o|u|n|t|I|n|p|u|t| ||| |n|u|l|l| |{|
| | |t|r|y| |{|
| | | | |c|o|n|s|t| |u| |=| |n|e|w| |U|R|L|(|u|r|l|)|;|
| | | | |c|o|n|s|t| |h|o|s|t| |=| |u|.|h|o|s|t|n|a|m|e|.|t|o|L|o|w|e|r|C|a|s|e|(|)|;|
| | | | |c|o|n|s|t| |p|a|r|t|s| |=| |u|.|p|a|t|h|n|a|m|e|.|s|p|l|i|t|(|'|/|'|)|.|f|i|l|t|e|r|(|B|o|o|l|e|a|n|)|;|
| | | | |i|f| |(|h|o|s|t|.|i|n|c|l|u|d|e|s|(|'|x|.|c|o|m|'|)| ||||| |h|o|s|t|.|i|n|c|l|u|d|e|s|(|'|t|w|i|t|t|e|r|.|c|o|m|'|)|)| |{|
| | | | | | |c|o|n|s|t| |i|d| |=| |p|a|r|t|s|[|0|]| ||||| |'|'|;|
| | | | | | |i|f| |(|!|i|d|)| |r|e|t|u|r|n| |n|u|l|l|;|
| | | | | | |r|e|t|u|r|n| |{| |p|l|a|t|f|o|r|m|:| |'|x|'|,| |u|r|l|,| |a|c|c|o|u|n|t|I|d|:| |i|d| |}|;|
| | | | |}|
| | | | |i|f| |(|h|o|s|t|.|i|n|c|l|u|d|e|s|(|'|t|i|k|t|o|k|.|c|o|m|'|)|)| |{|
| | | | | | |/|/| |/|@|u|s|e|r|n|a|m|e|
| | | | | | |c|o|n|s|t| |a|t| |=| |p|a|r|t|s|[|0|]| ||||| |'|'|;|
| | | | | | |c|o|n|s|t| |i|d| |=| |a|t|.|s|t|a|r|t|s|W|i|t|h|(|'|@|'|)| |?| |a|t|.|s|l|i|c|e|(|1|)| |:| |a|t|;|
| | | | | | |i|f| |(|!|i|d|)| |r|e|t|u|r|n| |n|u|l|l|;|
| | | | | | |r|e|t|u|r|n| |{| |p|l|a|t|f|o|r|m|:| |'|t|i|k|t|o|k|'|,| |u|r|l|,| |a|c|c|o|u|n|t|I|d|:| |i|d| |}|;|
| | | | |}|
| | | | |i|f| |(|h|o|s|t|.|i|n|c|l|u|d|e|s|(|'|y|o|u|t|u|b|e|.|c|o|m|'|)| ||||| |h|o|s|t|.|i|n|c|l|u|d|e|s|(|'|y|o|u|t|u|.|b|e|'|)|)| |{|
| | | | | | |/|/| |E|x|p|e|c|t| |/|@|h|a|n|d|l|e| |o|r| |c|h|a|n|n|e|l| |U|R|L|;| |p|r|e|f|e|r| |h|a|n|d|l|e| |w|i|t|h|o|u|t| |@| |f|o|r| |o|u|r| |s|e|t|t|i|n|g|s| |h|e|l|p|e|r|
| | | | | | |l|e|t| |i|d| |=| |'|'|;|
| | | | | | |c|o|n|s|t| |a|t|I|d|x| |=| |p|a|r|t|s|.|f|i|n|d|I|n|d|e|x|(|p| |=|>| |p|.|s|t|a|r|t|s|W|i|t|h|(|'|@|'|)|)|;|
| | | | | | |i|f| |(|a|t|I|d|x| |>|=| |0|)| |i|d| |=| |(|p|a|r|t|s|[|a|t|I|d|x|]| ||||| |'|'|)|.|r|e|p|l|a|c|e|(|/|^|@|/|,| |'|'|)|;|
| | | | | | |i|f| |(|!|i|d|)| |{|
| | | | | | | | |/|/| |f|a|l|l|b|a|c|k|:| |t|r|y| |c|h|a|n|n|e|l| |n|a|m|e| |s|e|g|m|e|n|t|
| | | | | | | | |i|d| |=| |p|a|r|t|s|[|0|]| ||||| |'|'|;|
| | | | | | |}|
| | | | | | |i|f| |(|!|i|d|)| |r|e|t|u|r|n| |n|u|l|l|;|
| | | | | | |r|e|t|u|r|n| |{| |p|l|a|t|f|o|r|m|:| |'|y|o|u|t|u|b|e|'|,| |u|r|l|,| |a|c|c|o|u|n|t|I|d|:| |i|d| |}|;|
| | | | |}|
| | |}| |c|a|t|c|h| |{| |/|*| |i|g|n|o|r|e| |*|/| |}|
| | |r|e|t|u|r|n| |n|u|l|l|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |e|n|s|u|r|e|D|i|r|(|p|:| |s|t|r|i|n|g|)| |{|
| | |a|w|a|i|t| |f|s|.|m|k|d|i|r|(|p|,| |{| |r|e|c|u|r|s|i|v|e|:| |t|r|u|e| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |y|t|d|l|p|J|s|o|n|(|u|r|l|:| |s|t|r|i|n|g|)|:| |P|r|o|m|i|s|e|<|R|e|c|o|r|d|<|s|t|r|i|n|g|,| |u|n|k|n|o|w|n|>|>| |{|
| | |/|/| |P|r|e|f|e|r| |s|y|s|t|e|m| |y|t|-|d|l|p| |i|f| |a|v|a|i|l|a|b|l|e| |v|i|a| |y|t|d|l|p|-|n|o|d|e|j|s| |b|i|n|
| | |c|o|n|s|t| |b|i|n| |=| |p|a|t|h|.|j|o|i|n|(|p|r|o|c|e|s|s|.|c|w|d|(|)|,| |'|n|o|d|e|_|m|o|d|u|l|e|s|'|,| |'|y|t|d|l|p|-|n|o|d|e|j|s|'|,| |'|b|i|n|'|,| |p|r|o|c|e|s|s|.|p|l|a|t|f|o|r|m| |=|=|=| |'|w|i|n|3|2|'| |?| |'|y|t|-|d|l|p|.|e|x|e|'| |:| |'|y|t|-|d|l|p|'|)|;|
| | |c|o|n|s|t| |a|r|g|s| |=| |[|'|-|J|'|,| |u|r|l|]|;|
| | |/|/| |I|m|p|r|o|v|e| |Y|o|u|T|u|b|e| |e|x|t|r|a|c|t|i|o|n| |b|y| |u|s|i|n|g| |m|o|b|i|l|e| |p|l|a|y|e|r| |c|l|i|e|n|t|
| | |i|f| |(|/|y|o|u|t|u|b|e|\|.|c|o|m|||y|o|u|t|u|\|.|b|e|/|i|.|t|e|s|t|(|u|r|l|)|)| |{|
| | | | |a|r|g|s|.|p|u|s|h|(|'|-|-|e|x|t|r|a|c|t|o|r|-|a|r|g|s|'|,| |'|y|o|u|t|u|b|e|:|p|l|a|y|e|r|_|c|l|i|e|n|t|=|a|n|d|r|o|i|d|,|i|o|s|'|)|;|
| | |}|
| | |c|o|n|s|t| |{| |s|t|d|o|u|t| |}| |=| |a|w|a|i|t| |e|x|e|c|F|i|l|e|A|s|y|n|c|(|b|i|n|,| |a|r|g|s|,| |{| |t|i|m|e|o|u|t|:| |1|2|0|_|0|0|0| |}|)|;|
| | |r|e|t|u|r|n| |J|S|O|N|.|p|a|r|s|e|(|s|t|d|o|u|t|)|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |d|o|w|n|l|o|a|d|V|i|d|e|o|(|p|a|g|e|U|r|l|:| |s|t|r|i|n|g|,| |d|e|s|t|D|i|r|:| |s|t|r|i|n|g|)|:| |P|r|o|m|i|s|e|<|s|t|r|i|n|g|>| |{|
| | |a|w|a|i|t| |e|n|s|u|r|e|D|i|r|(|d|e|s|t|D|i|r|)|;|
| | |c|o|n|s|t| |s|a|f|e|N|a|m|e| |=| |p|a|g|e|U|r|l|.|r|e|p|l|a|c|e|(|/|[|^|a|-|z|A|-|Z|0|-|9|_|-|]|+|/|g|,| |'|_|'|)|.|s|l|i|c|e|(|0|,| |8|0|)|;|
| | |c|o|n|s|t| |o|u|t|P|a|t|h| |=| |p|a|t|h|.|j|o|i|n|(|d|e|s|t|D|i|r|,| |`|$|{|s|a|f|e|N|a|m|e|}|.|m|p|4|`|)|;|
| | |c|o|n|s|t| |b|i|n| |=| |p|a|t|h|.|j|o|i|n|(|p|r|o|c|e|s|s|.|c|w|d|(|)|,| |'|n|o|d|e|_|m|o|d|u|l|e|s|'|,| |'|y|t|d|l|p|-|n|o|d|e|j|s|'|,| |'|b|i|n|'|,| |p|r|o|c|e|s|s|.|p|l|a|t|f|o|r|m| |=|=|=| |'|w|i|n|3|2|'| |?| |'|y|t|-|d|l|p|.|e|x|e|'| |:| |'|y|t|-|d|l|p|'|)|;|
| | |c|o|n|s|t| |a|r|g|s| |=| |[|
| | | | |p|a|g|e|U|r|l|,|
| | | | |'|-|o|'|,| |o|u|t|P|a|t|h|,|
| | | | |'|-|f|'|,| |'|b|e|s|t|v|i|d|e|o|[|e|x|t|=|m|p|4|]|+|b|e|s|t|a|u|d|i|o|[|e|x|t|=|m|4|a|]|/|b|e|s|t|[|e|x|t|=|m|p|4|]|/|b|e|s|t|'|,|
| | | | |'|-|-|m|e|r|g|e|-|o|u|t|p|u|t|-|f|o|r|m|a|t|'|,| |'|m|p|4|'|,|
| | | | |'|-|-|n|o|-|p|l|a|y|l|i|s|t|'|,|
| | | | |'|-|-|n|o|-|w|a|r|n|i|n|g|s|'|,|
| | |]|;|
| | |i|f| |(|/|y|o|u|t|u|b|e|\|.|c|o|m|||y|o|u|t|u|\|.|b|e|/|i|.|t|e|s|t|(|p|a|g|e|U|r|l|)|)| |{|
| | | | |a|r|g|s|.|p|u|s|h|(|'|-|-|e|x|t|r|a|c|t|o|r|-|a|r|g|s|'|,| |'|y|o|u|t|u|b|e|:|p|l|a|y|e|r|_|c|l|i|e|n|t|=|a|n|d|r|o|i|d|,|i|o|s|'|)|;|
| | |}|
| | |a|w|a|i|t| |e|x|e|c|F|i|l|e|A|s|y|n|c|(|b|i|n|,| |a|r|g|s|,| |{| |t|i|m|e|o|u|t|:| |3|0|0|_|0|0|0| |}|)|;|
| | |r|e|t|u|r|n| |o|u|t|P|a|t|h|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |c|o|l|l|e|c|t|Y|o|u|T|u|b|e|T|i|k|T|o|k|I|n|s|t|a|g|r|a|m|(|p|a|g|e|U|r|l|:| |s|t|r|i|n|g|,| |l|i|m|i|t|:| |n|u|m|b|e|r|)|:| |P|r|o|m|i|s|e|<|s|t|r|i|n|g|[|]|>| |{|
| | |c|o|n|s|t| |j|s|o|n| |=| |a|w|a|i|t| |y|t|d|l|p|J|s|o|n|(|p|a|g|e|U|r|l|)|;|
| | |c|o|n|s|t| |e|n|t|r|i|e|s| |=| |A|r|r|a|y|.|i|s|A|r|r|a|y|(|(|j|s|o|n| |a|s| |{| |e|n|t|r|i|e|s|?|:| |u|n|k|n|o|w|n| |}|)|.|e|n|t|r|i|e|s|)| |?| |(|j|s|o|n| |a|s| |{| |e|n|t|r|i|e|s|:| |a|n|y|[|]| |}|)|.|e|n|t|r|i|e|s| |:| |[|]|;|
| | |c|o|n|s|t| |u|r|l|s|:| |s|t|r|i|n|g|[|]| |=| |[|]|;|
| | |f|o|r| |(|c|o|n|s|t| |e| |o|f| |e|n|t|r|i|e|s|)| |{|
| | | | |c|o|n|s|t| |u| |=| |(|e|?|.|w|e|b|p|a|g|e|_|u|r|l| |a|s| |s|t|r|i|n|g|)| ||||| |(|e|?|.|o|r|i|g|i|n|a|l|_|u|r|l| |a|s| |s|t|r|i|n|g|)| ||||| |(|e|?|.|u|r|l| |a|s| |s|t|r|i|n|g|)|;|
| | | | |i|f| |(|u|)| |u|r|l|s|.|p|u|s|h|(|u|)|;|
| | | | |i|f| |(|u|r|l|s|.|l|e|n|g|t|h| |>|=| |l|i|m|i|t|)| |b|r|e|a|k|;|
| | |}|
| | |r|e|t|u|r|n| |u|r|l|s|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |c|o|l|l|e|c|t|X|S|c|r|e|e|n|s|h|o|t|s|(|p|a|g|e|U|r|l|:| |s|t|r|i|n|g|,| |l|i|m|i|t|:| |n|u|m|b|e|r|,| |d|e|s|t|D|i|r|:| |s|t|r|i|n|g|)|:| |P|r|o|m|i|s|e|<|s|t|r|i|n|g|[|]|>| |{|
| | |c|o|n|s|t| |{| |c|h|r|o|m|i|u|m| |}| |=| |a|w|a|i|t| |i|m|p|o|r|t|(|'|p|l|a|y|w|r|i|g|h|t|'|)|;|
| | |c|o|n|s|t| |b|r|o|w|s|e|r| |=| |a|w|a|i|t| |c|h|r|o|m|i|u|m|.|l|a|u|n|c|h|(|{| |h|e|a|d|l|e|s|s|:| |t|r|u|e| |}|)|;|
| | |c|o|n|s|t| |c|o|n|t|e|x|t| |=| |a|w|a|i|t| |b|r|o|w|s|e|r|.|n|e|w|C|o|n|t|e|x|t|(|{| |v|i|e|w|p|o|r|t|:| |{| |w|i|d|t|h|:| |1|2|0|0|,| |h|e|i|g|h|t|:| |2|0|0|0| |}| |}|)|;|
| | |c|o|n|s|t| |p|a|g|e| |=| |a|w|a|i|t| |c|o|n|t|e|x|t|.|n|e|w|P|a|g|e|(|)|;|
| | |c|o|n|s|t| |o|u|t|p|u|t|s|:| |s|t|r|i|n|g|[|]| |=| |[|]|;|
| | |t|r|y| |{|
| | | | |a|w|a|i|t| |p|a|g|e|.|g|o|t|o|(|p|a|g|e|U|r|l|,| |{| |w|a|i|t|U|n|t|i|l|:| |'|d|o|m|c|o|n|t|e|n|t|l|o|a|d|e|d|'|,| |t|i|m|e|o|u|t|:| |6|0|_|0|0|0| |}|)|;|
| | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|L|o|a|d|S|t|a|t|e|(|'|n|e|t|w|o|r|k|i|d|l|e|'|,| |{| |t|i|m|e|o|u|t|:| |3|0|_|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |c|o|n|s|t| |a|r|t|i|c|l|e|s| |=| |p|a|g|e|.|l|o|c|a|t|o|r|(|'|a|r|t|i|c|l|e|[|r|o|l|e|=|"|a|r|t|i|c|l|e|"|]|'|)|;|
| | | | |a|w|a|i|t| |a|r|t|i|c|l|e|s|.|f|i|r|s|t|(|)|.|w|a|i|t|F|o|r|(|{| |s|t|a|t|e|:| |'|v|i|s|i|b|l|e|'|,| |t|i|m|e|o|u|t|:| |6|0|_|0|0|0| |}|)|;|
|
| | | | |/|/| |T|r|y| |t|o| |l|o|a|d| |m|o|r|e| |b|y| |a|u|t|o|-|s|c|r|o|l|l|i|n|g| |u|n|t|i|l| |w|e| |h|a|v|e| |e|n|o|u|g|h| |o|r| |n|o| |p|r|o|g|r|e|s|s|
| | | | |l|e|t| |p|r|e|v|C|o|u|n|t| |=| |0|;|
| | | | |l|e|t| |s|t|a|g|n|a|n|t| |=| |0|;|
| | | | |f|o|r| |(|l|e|t| |a|t|t|e|m|p|t| |=| |0|;| |a|t|t|e|m|p|t| |<| |1|2|;| |a|t|t|e|m|p|t|+|+|)| |{|
| | | | | | |c|o|n|s|t| |c|o|u|n|t|N|o|w| |=| |a|w|a|i|t| |a|r|t|i|c|l|e|s|.|c|o|u|n|t|(|)|;|
| | | | | | |i|f| |(|c|o|u|n|t|N|o|w| |>|=| |l|i|m|i|t|)| |b|r|e|a|k|;|
| | | | | | |i|f| |(|c|o|u|n|t|N|o|w| |=|=|=| |p|r|e|v|C|o|u|n|t|)| |s|t|a|g|n|a|n|t|+|+|;|
| | | | | | |e|l|s|e| |s|t|a|g|n|a|n|t| |=| |0|;|
| | | | | | |i|f| |(|s|t|a|g|n|a|n|t| |>|=| |3|)| |b|r|e|a|k|;|
| | | | | | |p|r|e|v|C|o|u|n|t| |=| |c|o|u|n|t|N|o|w|;|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|m|o|u|s|e|.|w|h|e|e|l|(|0|,| |3|0|0|0|)|;|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|T|i|m|e|o|u|t|(|8|0|0|)|;|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|L|o|a|d|S|t|a|t|e|(|'|n|e|t|w|o|r|k|i|d|l|e|'|,| |{| |t|i|m|e|o|u|t|:| |5|_|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |}|
| | | | |c|o|n|s|t| |c|o|u|n|t| |=| |M|a|t|h|.|m|i|n|(|a|w|a|i|t| |a|r|t|i|c|l|e|s|.|c|o|u|n|t|(|)|,| |l|i|m|i|t|)|;|
| | | | |f|o|r| |(|l|e|t| |i| |=| |0|;| |i| |<| |c|o|u|n|t|;| |i|+|+|)| |{|
| | | | | | |c|o|n|s|t| |l|o|c| |=| |a|r|t|i|c|l|e|s|.|n|t|h|(|i|)|;|
| | | | | | |a|w|a|i|t| |l|o|c|.|s|c|r|o|l|l|I|n|t|o|V|i|e|w|I|f|N|e|e|d|e|d|(|)|;|
| | | | | | |c|o|n|s|t| |f|i|l|e| |=| |p|a|t|h|.|j|o|i|n|(|d|e|s|t|D|i|r|,| |`|x|s|h|o|t|-|$|{|i| |+| |1|}|.|p|n|g|`|)|;|
| | | | | | |a|w|a|i|t| |l|o|c|.|s|c|r|e|e|n|s|h|o|t|(|{| |p|a|t|h|:| |f|i|l|e| |}|)|;|
| | | | | | |o|u|t|p|u|t|s|.|p|u|s|h|(|f|i|l|e|)|;|
| | | | |}|
| | |}| |f|i|n|a|l|l|y| |{|
| | | | |a|w|a|i|t| |c|o|n|t|e|x|t|.|c|l|o|s|e|(|)|;|
| | | | |a|w|a|i|t| |b|r|o|w|s|e|r|.|c|l|o|s|e|(|)|;|
| | |}|
| | |r|e|t|u|r|n| |o|u|t|p|u|t|s|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |c|o|l|l|e|c|t|G|e|n|e|r|i|c|S|c|r|e|e|n|s|h|o|t|s|(|p|a|g|e|U|r|l|:| |s|t|r|i|n|g|,| |l|i|m|i|t|:| |n|u|m|b|e|r|,| |d|e|s|t|D|i|r|:| |s|t|r|i|n|g|,| |p|l|a|t|f|o|r|m|:| |'|t|i|k|t|o|k|'|||'|y|o|u|t|u|b|e|'|)|:| |P|r|o|m|i|s|e|<|s|t|r|i|n|g|[|]|>| |{|
| | |c|o|n|s|t| |{| |c|h|r|o|m|i|u|m| |}| |=| |a|w|a|i|t| |i|m|p|o|r|t|(|'|p|l|a|y|w|r|i|g|h|t|'|)|;|
| | |c|o|n|s|t| |b|r|o|w|s|e|r| |=| |a|w|a|i|t| |c|h|r|o|m|i|u|m|.|l|a|u|n|c|h|(|{| |h|e|a|d|l|e|s|s|:| |t|r|u|e| |}|)|;|
| | |/|/| |U|s|e| |m|o|b|i|l|e|-|l|i|k|e| |c|o|n|t|e|x|t| |b|y| |d|e|f|a|u|l|t| |f|o|r| |I|n|s|t|a|g|r|a|m| |t|o| |i|m|p|r|o|v|e| |i|n|f|i|n|i|t|e| |s|c|r|o|l|l|
| | |l|e|t| |c|o|n|t|e|x|t| |=| |a|w|a|i|t| |b|r|o|w|s|e|r|.|n|e|w|C|o|n|t|e|x|t|(|
| | | | |p|l|a|t|f|o|r|m| |=|=|=| |'|t|i|k|t|o|k|'|
| | | | | | |?| |(|{| |v|i|e|w|p|o|r|t|:| |{| |w|i|d|t|h|:| |4|3|0|,| |h|e|i|g|h|t|:| |9|0|0| |}|,| |u|s|e|r|A|g|e|n|t|:| |'|M|o|z|i|l|l|a|/|5|.|0| |(|i|P|h|o|n|e|;| |C|P|U| |i|P|h|o|n|e| |O|S| |1|7|_|0| |l|i|k|e| |M|a|c| |O|S| |X|)| |A|p|p|l|e|W|e|b|K|i|t|/|6|0|5|.|1|.|1|5| |(|K|H|T|M|L|,| |l|i|k|e| |G|e|c|k|o|)| |V|e|r|s|i|o|n|/|1|7|.|0| |M|o|b|i|l|e|/|1|5|E|1|4|8| |S|a|f|a|r|i|/|6|0|4|.|1|'|,| |i|s|M|o|b|i|l|e|:| |t|r|u|e|,| |d|e|v|i|c|e|S|c|a|l|e|F|a|c|t|o|r|:| |3| |}| |a|s| |a|n|y|)|
| | | | | | |:| |(|{| |v|i|e|w|p|o|r|t|:| |{| |w|i|d|t|h|:| |1|6|0|0|,| |h|e|i|g|h|t|:| |2|5|0|0| |}| |}|)|
| | |)|;|
| | |l|e|t| |p|a|g|e| |=| |a|w|a|i|t| |c|o|n|t|e|x|t|.|n|e|w|P|a|g|e|(|)|;|
| | |c|o|n|s|t| |o|u|t|p|u|t|s|:| |s|t|r|i|n|g|[|]| |=| |[|]|;|
| | |t|r|y| |{|
| | | | |/|/| |F|o|r| |I|n|s|t|a|g|r|a|m|,| |o|p|t|i|o|n|a|l|l|y| |p|r|e|l|o|a|d| |c|o|o|k|i|e|s| |o|r| |l|o|g|i|n| |t|o| |a|v|o|i|d| |e|a|r|l|y| |m|o|d|a|l|/|l|o|g|i|n| |w|a|l|l|
| | | | |a|w|a|i|t| |p|a|g|e|.|g|o|t|o|(|p|a|g|e|U|r|l|,| |{| |w|a|i|t|U|n|t|i|l|:| |'|d|o|m|c|o|n|t|e|n|t|l|o|a|d|e|d|'|,| |t|i|m|e|o|u|t|:| |6|0|_|0|0|0| |}|)|;|
| | | | |/|/| |T|r|y| |t|o| |d|i|s|m|i|s|s| |r|e|g|i|o|n|a|l| |c|o|o|k|i|e| |b|a|n|n|e|r|s| |o|r| |l|o|g|i|n| |n|a|g|s| |t|h|a|t| |o|b|s|c|u|r|e| |c|o|n|t|e|n|t|
| | | | |c|o|n|s|t| |d|i|s|m|i|s|s|o|r|s| |=| |[|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|A|c|c|e|p|t| |A|l|l|"|)|'|,|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|A|l|l|o|w| |a|l|l|"|)|'|,|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|A|c|c|e|p|t|"|)|'|,|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|同|意|"|)|'|,|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|許|可|"|)|'|,|
| | | | | | |'|b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|N|o|t| |N|o|w|"|)|'|,|
| | | | | | |'|d|i|v|[|r|o|l|e|=|"|d|i|a|l|o|g|"|]| |b|u|t|t|o|n|:|h|a|s|-|t|e|x|t|(|"|N|o|t| |N|o|w|"|)|'|,|
| | | | |]|;|
| | | | |f|o|r| |(|c|o|n|s|t| |s|e|l| |o|f| |d|i|s|m|i|s|s|o|r|s|)| |{|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|l|o|c|a|t|o|r|(|s|e|l|)|.|f|i|r|s|t|(|)|.|c|l|i|c|k|(|{| |t|i|m|e|o|u|t|:| |2|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |}|
| | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|L|o|a|d|S|t|a|t|e|(|'|n|e|t|w|o|r|k|i|d|l|e|'|,| |{| |t|i|m|e|o|u|t|:| |3|0|_|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |l|e|t| |l|o|c|a|t|o|r|S|t|r| |=| |'|'|;|
| | |i|f| |(|p|l|a|t|f|o|r|m| |=|=|=| |'|t|i|k|t|o|k|'|)| |{|
| | | | | | |l|o|c|a|t|o|r|S|t|r| |=| |'|a|[|h|r|e|f|*|=|"|/|v|i|d|e|o|/|"|]|'|;|
| | | | |}| |e|l|s|e| |{|
| | | | | | |/|/| |y|o|u|t|u|b|e| |s|h|o|r|t|s| |s|h|e|l|f|
| | | | | | |l|o|c|a|t|o|r|S|t|r| |=| |'|y|t|d|-|r|e|e|l|-|i|t|e|m|-|r|e|n|d|e|r|e|r|,| |a|[|h|r|e|f|^|=|"|/|s|h|o|r|t|s|/|"|]|'|;|
| | | | |}|
| | | | |/|/| |O|n| |I|n|s|t|a|g|r|a|m|,| |w|a|i|t| |e|x|p|l|i|c|i|t|l|y| |f|o|r| |g|r|i|d|;| |i|f| |n|o|t| |f|o|u|n|d|,| |t|r|y| |m|i|t|i|g|a|t|i|o|n|s|
| | | | |l|e|t| |i|t|e|m|s| |=| |p|a|g|e|.|l|o|c|a|t|o|r|(|l|o|c|a|t|o|r|S|t|r|)|;|
| | | | |t|r|y| |{|
| | | | | | |a|w|a|i|t| |i|t|e|m|s|.|f|i|r|s|t|(|)|.|w|a|i|t|F|o|r|(|{| |s|t|a|t|e|:| |'|v|i|s|i|b|l|e|'|,| |t|i|m|e|o|u|t|:| |6|0|_|0|0|0| |}|)|;|
| | | | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | | | |t|h|r|o|w| |e|;|
| | | | |}|
|
| | | | |/|/| |A|u|t|o|-|s|c|r|o|l|l| |t|o| |l|o|a|d| |m|o|r|e| |t|i|l|e|s| |u|n|t|i|l| |r|e|a|c|h|i|n|g| |l|i|m|i|t| |o|r| |s|t|a|l|l|i|n|g|
| | | | |l|e|t| |p|r|e|v|C|o|u|n|t| |=| |0|;|
| | | | |l|e|t| |s|t|a|g|n|a|n|t| |=| |0|;|
| | | | |f|o|r| |(|l|e|t| |a|t|t|e|m|p|t| |=| |0|;| |a|t|t|e|m|p|t| |<| |5|0|;| |a|t|t|e|m|p|t|+|+|)| |{|
| | | | | | |c|o|n|s|t| |c|o|u|n|t|N|o|w| |=| |a|w|a|i|t| |i|t|e|m|s|.|c|o|u|n|t|(|)|;|
| | | | | | |i|f| |(|c|o|u|n|t|N|o|w| |>|=| |l|i|m|i|t|)| |b|r|e|a|k|;|
| | | | | | |i|f| |(|c|o|u|n|t|N|o|w| |=|=|=| |p|r|e|v|C|o|u|n|t|)| |s|t|a|g|n|a|n|t|+|+|;|
| | | | | | |e|l|s|e| |s|t|a|g|n|a|n|t| |=| |0|;|
| | | | | | |i|f| |(|s|t|a|g|n|a|n|t| |>|=| |8|)| |b|r|e|a|k|;|
| | | | | | |p|r|e|v|C|o|u|n|t| |=| |c|o|u|n|t|N|o|w|;|
| | | | | | |/|/| |S|c|r|o|l|l| |c|o|n|t|a|i|n|e|r|/|p|a|g|e| |d|e|p|e|n|d|i|n|g| |o|n| |p|l|a|t|f|o|r|m|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|e|v|a|l|u|a|t|e|(|(|)| |=|>| |{|
| | | | | | | | |c|o|n|s|t| |e|l| |=| |d|o|c|u|m|e|n|t|.|s|c|r|o|l|l|i|n|g|E|l|e|m|e|n|t| ||||| |d|o|c|u|m|e|n|t|.|d|o|c|u|m|e|n|t|E|l|e|m|e|n|t|;|
| | | | | | | | |e|l|.|s|c|r|o|l|l|B|y|(|0|,| |M|a|t|h|.|m|a|x|(|1|2|0|0|,| |M|a|t|h|.|f|l|o|o|r|(|w|i|n|d|o|w|.|i|n|n|e|r|H|e|i|g|h|t| |*| |1|.|7|5|)|)|)|;|
| | | | | | |}|)|;|
| | | | | | |/|/| |A|l|s|o| |s|e|n|d| |P|a|g|e|D|o|w|n|/|E|n|d| |t|o| |t|r|i|g|g|e|r| |l|o|a|d|i|n|g|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|k|e|y|b|o|a|r|d|.|p|r|e|s|s|(|'|P|a|g|e|D|o|w|n|'|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | | | |i|f| |(|a|t|t|e|m|p|t| |%| |5| |=|=|=| |4|)| |{|
| | | | | | | | |a|w|a|i|t| |p|a|g|e|.|k|e|y|b|o|a|r|d|.|p|r|e|s|s|(|'|E|n|d|'|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | | | |}|
| | | | | | |/|/| |R|e|c|o|m|p|u|t|e| |i|t|e|m|s| |i|n| |c|a|s|e| |D|O|M| |c|h|a|n|g|e|d| |(|I|G| |o|f|t|e|n| |r|e|-|r|e|n|d|e|r|s|)|
| | | | | | |i|t|e|m|s| |=| |p|a|g|e|.|l|o|c|a|t|o|r|(|l|o|c|a|t|o|r|S|t|r|)|;|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|T|i|m|e|o|u|t|(|1|2|0|0|)|;|
| | | | | | |a|w|a|i|t| |p|a|g|e|.|w|a|i|t|F|o|r|L|o|a|d|S|t|a|t|e|(|'|n|e|t|w|o|r|k|i|d|l|e|'|,| |{| |t|i|m|e|o|u|t|:| |5|_|0|0|0| |}|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |}|
| | | | |c|o|n|s|t| |c|o|u|n|t| |=| |M|a|t|h|.|m|i|n|(|a|w|a|i|t| |i|t|e|m|s|.|c|o|u|n|t|(|)|,| |l|i|m|i|t|)|;|
| | | | |f|o|r| |(|l|e|t| |i| |=| |0|;| |i| |<| |c|o|u|n|t|;| |i|+|+|)| |{|
| | | | | | |c|o|n|s|t| |l|o|c| |=| |i|t|e|m|s|.|n|t|h|(|i|)|;|
| | | | | | |a|w|a|i|t| |l|o|c|.|s|c|r|o|l|l|I|n|t|o|V|i|e|w|I|f|N|e|e|d|e|d|(|)|;|
| | | | | | |c|o|n|s|t| |f|i|l|e| |=| |p|a|t|h|.|j|o|i|n|(|d|e|s|t|D|i|r|,| |`|$|{|p|l|a|t|f|o|r|m|}|-|s|h|o|t|-|$|{|i| |+| |1|}|.|p|n|g|`|)|;|
| | | | | | |a|w|a|i|t| |l|o|c|.|s|c|r|e|e|n|s|h|o|t|(|{| |p|a|t|h|:| |f|i|l|e| |}|)|;|
| | | | | | |o|u|t|p|u|t|s|.|p|u|s|h|(|f|i|l|e|)|;|
| | | | |}|
| | |}| |f|i|n|a|l|l|y| |{|
| | | | |a|w|a|i|t| |c|o|n|t|e|x|t|.|c|l|o|s|e|(|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | |a|w|a|i|t| |b|r|o|w|s|e|r|.|c|l|o|s|e|(|)|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | |}|
| | |r|e|t|u|r|n| |o|u|t|p|u|t|s|;|
|}|
|
|a|s|y|n|c| |f|u|n|c|t|i|o|n| |m|a|i|n|(|)| |{|
| | |c|o|n|s|t| |a|r|g|s| |=| |p|r|o|c|e|s|s|.|a|r|g|v|.|s|l|i|c|e|(|2|)|;|
| | |i|f| |(|a|r|g|s|.|l|e|n|g|t|h| |=|=|=| |0|)| |{|
| | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|U|s|a|g|e|:| |n|o|d|e| |g|e|n|e|r|a|t|e|-|b|a|t|c|h|-|a|c|c|o|u|n|t|s|.|j|s| |<|a|c|c|o|u|n|t|U|r|l|1|>| |<|a|c|c|o|u|n|t|U|r|l|2|>| |.|.|.|'|)|;|
| | | | |p|r|o|c|e|s|s|.|e|x|i|t|(|1|)|;|
| | |}|
|
| | |/|/| |P|r|e|p|a|r|e| |I|O| |d|i|r|s|
| | |c|o|n|s|t| |c|w|d| |=| |p|r|o|c|e|s|s|.|c|w|d|(|)|;|
| | |c|o|n|s|t| |t|e|s|t|D|a|t|a|D|i|r| |=| |p|a|t|h|.|j|o|i|n|(|c|w|d|,| |'|t|e|s|t|-|d|a|t|a|'|)|;|
| | |c|o|n|s|t| |b|a|c|k|g|r|o|u|n|d| |=| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|D|i|r|,| |'|b|a|c|k|g|r|o|u|n|d|.|m|p|4|'|)|;|
| | |c|o|n|s|t| |b|g|m| |=| |p|a|t|h|.|j|o|i|n|(|t|e|s|t|D|a|t|a|D|i|r|,| |'|b|g|m|.|m|p|3|'|)|;|
| | |c|o|n|s|t| |o|u|t|R|o|o|t| |=| |p|a|t|h|.|j|o|i|n|(|c|w|d|,| |'|t|e|s|t|-|r|e|s|u|l|t|s|'|,| |`|b|a|t|c|h|-|$|{|D|a|t|e|.|n|o|w|(|)|}|`|)|;|
| | |m|k|d|i|r|S|y|n|c|(|o|u|t|R|o|o|t|,| |{| |r|e|c|u|r|s|i|v|e|:| |t|r|u|e| |}|)|;|
|
| | |/|/| |C|h|e|c|k| |o|p|t|i|o|n|a|l| |a|s|s|e|t|s|
| | |c|o|n|s|t| |h|a|s|B|g|m| |=| |a|w|a|i|t| |f|s|.|a|c|c|e|s|s|(|b|g|m|)|.|t|h|e|n|(|(|)| |=|>| |t|r|u|e|)|.|c|a|t|c|h|(|(|)| |=|>| |f|a|l|s|e|)|;|
| | |i|f| |(|!|h|a|s|B|g|m|)| |{|
| | | | |c|o|n|s|o|l|e|.|w|a|r|n|(|'|[|b|a|t|c|h|]| |b|g|m|.|m|p|3| |n|o|t| |f|o|u|n|d| |u|n|d|e|r| |t|e|s|t|-|d|a|t|a|.| |P|r|o|c|e|e|d|i|n|g| |w|i|t|h|o|u|t| |B|G|M|.|'|)|;|
| | |}|
|
| | |c|o|n|s|t| |b|a|s|e|S|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | |g|e|n|e|r|a|l|:| |{| |o|u|t|p|u|t|P|a|t|h|:| |o|u|t|R|o|o|t| |}|,|
| | | | |p|l|a|t|f|o|r|m|s|:| |{|
| | | | | | |x|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | | | |t|i|k|t|o|k|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | | | |y|o|u|t|u|b|e|:| |{| |e|n|a|b|l|e|d|:| |f|a|l|s|e|,| |a|c|c|o|u|n|t|s|:| |[|]|,| |i|n|t|e|r|v|a|l|M|i|n|u|t|e|s|:| |1|5|,| |s|c|r|a|p|e|D|e|l|a|y|M|s|:| |0| |}|,|
| | | | |}|,|
| | | | |r|e|n|d|e|r|:| |{|
| | | | | | |r|e|s|o|l|u|t|i|o|n|:| |{| |w|i|d|t|h|:| |1|0|8|0|,| |h|e|i|g|h|t|:| |1|9|2|0| |}|,|
| | | | | | |d|u|r|a|t|i|o|n|S|e|c|:| |1|0|,|
| | | | | | |b|g|m|P|a|t|h|:| |h|a|s|B|g|m| |?| |b|g|m| |:| |'|'|,|
| | | | | | |b|a|c|k|g|r|o|u|n|d|V|i|d|e|o|P|a|t|h|:| |b|a|c|k|g|r|o|u|n|d|,|
| | | | | | |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |'|'|,| |b|o|t|t|o|m|:| |'|'| |}|,|
| | | | | | |s|c|a|l|e|:| |0|.|8|5|,|
| | | | | | |t|e|l|e|T|e|x|t|B|g|:| |'|#|0|0|0|0|0|0|'|,|
| | | | | | |q|u|a|l|i|t|y|P|r|e|s|e|t|:| |'|s|t|a|n|d|a|r|d|'|,|
| | | | | | |o|v|e|r|l|a|y|P|o|s|i|t|i|o|n|:| |'|c|e|n|t|e|r|'|,|
| | | | | | |t|o|p|C|a|p|t|i|o|n|H|e|i|g|h|t|:| |1|2|0|,|
| | | | | | |b|o|t|t|o|m|C|a|p|t|i|o|n|H|e|i|g|h|t|:| |1|6|0|,|
| | | | | | |c|a|p|t|i|o|n|B|g|O|p|a|c|i|t|y|:| |1|,|
| | | | |}|,|
| | |}|;|
|
| | |c|o|n|s|t| |t|a|s|k|s|:| |A|r|r|a|y|<|P|r|o|m|i|s|e|<|v|o|i|d|>|>| |=| |[|]|;|
| | |f|o|r| |(|c|o|n|s|t| |r|a|w|U|r|l| |o|f| |a|r|g|s|)| |{|
| | | | |c|o|n|s|t| |a|c|c| |=| |d|e|t|e|c|t|P|l|a|t|f|o|r|m|A|n|d|A|c|c|o|u|n|t|(|r|a|w|U|r|l|)|;|
| | | | |i|f| |(|!|a|c|c|)| |{|
| | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|S|k|i|p| |(|u|n|r|e|c|o|g|n|i|z|e|d|)|:|'|,| |r|a|w|U|r|l|)|;|
| | | | | | |c|o|n|t|i|n|u|e|;|
| | | | |}|
| | | | |c|o|n|s|t| |a|c|c|O|u|t|D|i|r| |=| |p|a|t|h|.|j|o|i|n|(|o|u|t|R|o|o|t|,| |`|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|-|$|{|a|c|c|.|a|c|c|o|u|n|t|I|d|}|`|)|;|
| | | | |a|w|a|i|t| |e|n|s|u|r|e|D|i|r|(|a|c|c|O|u|t|D|i|r|)|;|
|
| | | | |i|f| |(|a|c|c|.|p|l|a|t|f|o|r|m| |=|=|=| |'|x|'|)| |{|
| | | | | | |/|/| |X|:| |c|o|l|l|e|c|t| |s|c|r|e|e|n|s|h|o|t|s| |f|o|r| |f|i|r|s|t| |1|5| |p|o|s|t|s|
| | | | | | |t|a|s|k|s|.|p|u|s|h|(|(|a|s|y|n|c| |(|)| |=|>| |{|
| | | | | | | | |c|o|n|s|t| |s|h|o|t|s| |=| |a|w|a|i|t| |c|o|l|l|e|c|t|X|S|c|r|e|e|n|s|h|o|t|s|(|r|a|w|U|r|l|,| |1|5|,| |a|c|c|O|u|t|D|i|r|)|;|
| | | | | | | | |l|e|t| |i|d|x| |=| |0|;|
| | | | | | | | |f|o|r| |(|c|o|n|s|t| |s|s| |o|f| |s|h|o|t|s|)| |{|
| | | | | | | | | | |c|o|n|s|t| |s|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|,|
| | | | | | | | | | | | |r|e|n|d|e|r|:| |{|
| | | | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|.|r|e|n|d|e|r|,|
| | | | | | | | | | | | | | |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |`|X| |#|$|{|+|+|i|d|x|}|`|,| |b|o|t|t|o|m|:| |a|c|c|.|a|c|c|o|u|n|t|I|d| |}|,|
| | | | | | | | | | | | |}|,|
| | | | | | | | | | |}| |a|s| |A|p|p|S|e|t|t|i|n|g|s|;|
| | | | | | | | | | |t|r|y| |{|
| | | | | | | | | | | | |c|o|n|s|t| |o|u|t| |=| |a|w|a|i|t| |g|e|n|e|r|a|t|e|V|i|d|e|o|(|s|s|,| |s|e|t|t|i|n|g|s|)|;|
| | | | | | | | | | | | |c|o|n|s|o|l|e|.|l|o|g|(|'|[|X|]| |o|u|t|:|'|,| |o|u|t|)|;|
| | | | | | | | | | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | | | | | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|[|X|]| |g|e|n|e|r|a|t|e| |f|a|i|l|e|d|:|'|,| |(|e| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | | | | | | | | | |}|
| | | | | | | | |}|
| | | | | | |}|)|(|)|)|;|
| | | | |}| |e|l|s|e| |{|
| | | | | | |/|/| |O|t|h|e|r|s|:| |f|e|t|c|h| |r|e|c|e|n|t| |1|5| |v|i|d|e|o| |p|a|g|e| |U|R|L|s|,| |d|o|w|n|l|o|a|d|,| |t|h|e|n| |r|e|n|d|e|r|.| |F|a|l|l|b|a|c|k| |t|o| |s|c|r|e|e|n|s|h|o|t|s| |i|f| |l|i|s|t|i|n|g| |f|a|i|l|s|.|
| | | | | | |t|a|s|k|s|.|p|u|s|h|(|(|a|s|y|n|c| |(|)| |=|>| |{|
| | | | | | | | |l|e|t| |p|a|g|e|s|:| |s|t|r|i|n|g|[|]| |=| |[|]|;|
| | | | | | | | |t|r|y| |{|
| | | | | | | | | | |p|a|g|e|s| |=| |a|w|a|i|t| |c|o|l|l|e|c|t|Y|o|u|T|u|b|e|T|i|k|T|o|k|I|n|s|t|a|g|r|a|m|(|r|a|w|U|r|l|,| |1|5|)|;|
| | | | | | | | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | | | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |l|i|s|t| |f|a|i|l|e|d|:|`|,| |(|e| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | | | | | | | | | |/|/| |F|a|l|l|b|a|c|k|:| |t|r|y| |s|c|r|e|e|n|s|h|o|t|s| |o|f| |t|i|l|e|s|
| | | | | | | | | | |t|r|y| |{|
| | | | | | | | | | | | |c|o|n|s|t| |s|h|o|t|s| |=| |a|w|a|i|t| |c|o|l|l|e|c|t|G|e|n|e|r|i|c|S|c|r|e|e|n|s|h|o|t|s|(|r|a|w|U|r|l|,| |1|5|,| |a|c|c|O|u|t|D|i|r|,| |a|c|c|.|p|l|a|t|f|o|r|m| |a|s| |'|t|i|k|t|o|k|'|||'|y|o|u|t|u|b|e|'|)|;|
| | | | | | | | | | | | |l|e|t| |i|d|x| |=| |0|;|
| | | | | | | | | | | | |f|o|r| |(|c|o|n|s|t| |s|s| |o|f| |s|h|o|t|s|)| |{|
| | | | | | | | | | | | | | |c|o|n|s|t| |s|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | | | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|,|
| | | | | | | | | | | | | | | | |r|e|n|d|e|r|:| |{|
| | | | | | | | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|.|r|e|n|d|e|r|,|
| | | | | | | | | | | | | | | | | | |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |`|$|{|a|c|c|.|p|l|a|t|f|o|r|m|.|t|o|U|p|p|e|r|C|a|s|e|(|)|}| |#|$|{|+|+|i|d|x|}|`|,| |b|o|t|t|o|m|:| |a|c|c|.|a|c|c|o|u|n|t|I|d| |}|,|
| | | | | | | | | | | | | | | | |}|,|
| | | | | | | | | | | | | | |}| |a|s| |A|p|p|S|e|t|t|i|n|g|s|;|
| | | | | | | | | | | | | | |t|r|y| |{|
| | | | | | | | | | | | | | | | |c|o|n|s|t| |o|u|t| |=| |a|w|a|i|t| |g|e|n|e|r|a|t|e|V|i|d|e|o|(|s|s|,| |s|e|t|t|i|n|g|s|)|;|
| | | | | | | | | | | | | | | | |c|o|n|s|o|l|e|.|l|o|g|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |(|f|a|l|l|b|a|c|k| |s|c|r|e|e|n|s|h|o|t|)| |o|u|t|:|`|,| |o|u|t|)|;|
| | | | | | | | | | | | | | |}| |c|a|t|c|h| |(|e|2|)| |{|
| | | | | | | | | | | | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |f|a|l|l|b|a|c|k| |g|e|n|e|r|a|t|e| |f|a|i|l|e|d|:|`|,| |(|e|2| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|2|)|)|;|
| | | | | | | | | | | | | | |}|
| | | | | | | | | | | | |}|
| | | | | | | | | | |}| |c|a|t|c|h| |(|e|2|)| |{|
| | | | | | | | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |f|a|l|l|b|a|c|k| |s|c|r|e|e|n|s|h|o|t|s| |f|a|i|l|e|d|:|`|,| |(|e|2| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|2|)|)|;|
| | | | | | | | | | |}|
| | | | | | | | | | |r|e|t|u|r|n|;|
| | | | | | | | |}|
| | | | | | | | |l|e|t| |i|d|x| |=| |0|;|
| | | | | | | | |f|o|r| |(|c|o|n|s|t| |p|a|g|e|U|r|l| |o|f| |p|a|g|e|s|)| |{|
| | | | | | | | | | |t|r|y| |{|
| | | | | | | | | | | | |c|o|n|s|t| |f|i|l|e| |=| |a|w|a|i|t| |d|o|w|n|l|o|a|d|V|i|d|e|o|(|p|a|g|e|U|r|l|,| |p|a|t|h|.|j|o|i|n|(|a|c|c|O|u|t|D|i|r|,| |'|d|o|w|n|l|o|a|d|s|'|)|)|;|
| | | | | | | | | | | | |c|o|n|s|t| |s|e|t|t|i|n|g|s|:| |A|p|p|S|e|t|t|i|n|g|s| |=| |{|
| | | | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|,|
| | | | | | | | | | | | | | |r|e|n|d|e|r|:| |{|
| | | | | | | | | | | | | | | | |.|.|.|b|a|s|e|S|e|t|t|i|n|g|s|.|r|e|n|d|e|r|,|
| | | | | | | | | | | | | | | | |c|a|p|t|i|o|n|s|:| |{| |t|o|p|:| |`|$|{|a|c|c|.|p|l|a|t|f|o|r|m|.|t|o|U|p|p|e|r|C|a|s|e|(|)|}| |#|$|{|+|+|i|d|x|}|`|,| |b|o|t|t|o|m|:| |a|c|c|.|a|c|c|o|u|n|t|I|d| |}|,|
| | | | | | | | | | | | | | |}|,|
| | | | | | | | | | | | |}| |a|s| |A|p|p|S|e|t|t|i|n|g|s|;|
| | | | | | | | | | | | |c|o|n|s|t| |o|u|t| |=| |a|w|a|i|t| |g|e|n|e|r|a|t|e|V|i|d|e|o|(|'|'|,| |s|e|t|t|i|n|g|s|,| |f|i|l|e|)|;|
| | | | | | | | | | | | |c|o|n|s|o|l|e|.|l|o|g|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |o|u|t|:|`|,| |o|u|t|)|;|
| | | | | | | | | | |}| |c|a|t|c|h| |(|e|)| |{|
| | | | | | | | | | | | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|`|[|$|{|a|c|c|.|p|l|a|t|f|o|r|m|}|]| |g|e|n|e|r|a|t|e| |f|a|i|l|e|d|:|`|,| |(|e| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | | | | | | | | | |}|
| | | | | | | | |}|
| | | | | | |}|)|(|)|)|;|
| | | | |}|
| | |}|
|
| | |/|/| |R|u|n| |t|a|s|k|s| |i|n| |p|a|r|a|l|l|e|l| |b|u|t| |a|v|o|i|d| |o|v|e|r|w|h|e|l|m|i|n|g| |n|e|t|w|o|r|k|/|C|P|U|:| |c|a|p| |c|o|n|c|u|r|r|e|n|c|y|
| | |c|o|n|s|t| |c|o|n|c|u|r|r|e|n|c|y| |=| |M|a|t|h|.|m|a|x|(|1|,| |M|a|t|h|.|m|i|n|(|4|,| |N|u|m|b|e|r|(|p|r|o|c|e|s|s|.|e|n|v|.|C|O|N|C|U|R|R|E|N|C|Y| ||||| |'|2|'|)|)|)|;|
| | |c|o|n|s|t| |q|u|e|u|e| |=| |t|a|s|k|s|.|s|l|i|c|e|(|)|;|
| | |c|o|n|s|t| |r|u|n|n|e|r|s|:| |A|r|r|a|y|<|P|r|o|m|i|s|e|<|v|o|i|d|>|>| |=| |[|]|;|
| | |f|o|r| |(|l|e|t| |i| |=| |0|;| |i| |<| |c|o|n|c|u|r|r|e|n|c|y|;| |i|+|+|)| |{|
| | | | |r|u|n|n|e|r|s|.|p|u|s|h|(|(|a|s|y|n|c| |(|)| |=|>| |{|
| | | | | | |w|h|i|l|e| |(|q|u|e|u|e|.|l|e|n|g|t|h|)| |{|
| | | | | | | | |c|o|n|s|t| |t| |=| |q|u|e|u|e|.|s|h|i|f|t|(|)|;|
| | | | | | | | |i|f| |(|!|t|)| |b|r|e|a|k|;|
| | | | | | | | |a|w|a|i|t| |t|.|c|a|t|c|h|(|(|)| |=|>| |{|}|)|;|
| | | | | | |}|
| | | | |}|)|(|)|)|;|
| | |}|
| | |a|w|a|i|t| |P|r|o|m|i|s|e|.|a|l|l|(|r|u|n|n|e|r|s|)|;|
|
| | |c|o|n|s|o|l|e|.|l|o|g|(|'|D|o|n|e|.| |O|u|t|p|u|t|s| |u|n|d|e|r|:|'|,| |o|u|t|R|o|o|t|)|;|
|}|
|
|m|a|i|n|(|)|.|c|a|t|c|h|(|(|e|)| |=|>| |{|
| | |c|o|n|s|o|l|e|.|e|r|r|o|r|(|'|B|a|t|c|h| |f|a|i|l|e|d|:|'|,| |(|e| |a|s| |E|r|r|o|r|)|?|.|m|e|s|s|a|g|e| ||||| |S|t|r|i|n|g|(|e|)|)|;|
| | |p|r|o|c|e|s|s|.|e|x|i|t|(|1|)|;|
|}|)|;|
|