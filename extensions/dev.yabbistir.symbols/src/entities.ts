/**
 * HTML entities for the symbols that have a name in the HTML standard (https://html.spec.whatwg.org/multipage/named-characters.html),
 * keyed by code point. Every other character gets its numeric form, `&#x…;`.
 */
const NAMED: Record<number, string> = {};

/** `code point = entity name` pairs, written as "XXXX=name". */
const TABLE = `
A9=copy AE=reg 2122=trade A7=sect B6=para 2020=dagger 2021=Dagger B0=deg 2116=numero B5=micro AA=ordf BA=ordm
A1=iexcl BF=iquest 2018=lsquo 2019=rsquo 201C=ldquo 201D=rdquo 201A=sbquo 201E=bdquo AB=laquo BB=raquo
2039=lsaquo 203A=rsaquo 2013=ndash 2014=mdash 2026=hellip 2022=bull B7=middot 2032=prime 2033=Prime 2034=tprime
A0=nbsp 2002=ensp 2003=emsp 2009=thinsp 200B=ZeroWidthSpace 200D=zwj AD=shy A6=brvbar A8=uml B4=acute AF=macr
2C6=circ 2DC=tilde 2030=permil 26=amp 7C=verbar 2016=Verbar 2044=frasl 2212=minus 2010=hyphen
B1=plusmn 2213=mnplus D7=times F7=divide 2260=ne 2248=asymp 2245=cong 2261=equiv 2262=nequiv 2264=le 2265=ge
226A=Lt 226B=Gt 221D=prop 221E=infin 221A=radic 2211=sum 220F=prod 222B=int 222C=Int 222E=conint 2202=part
2207=nabla 2208=isin 2209=notin 220B=ni 2205=empty 2229=cap 222A=cup 2282=sub 2283=sup 2286=sube 2287=supe
2200=forall 2203=exist 2204=nexist 2227=and 2228=or AC=not 2295=oplus 2297=otimes 22A5=perp 2225=par 2220=ang
2234=there4 2235=becaus 2135=aleph 2218=compfn 22C5=sdot
20AC=euro A3=pound A5=yen A2=cent A4=curren
2190=larr 2192=rarr 2191=uarr 2193=darr 2194=harr 2195=varr 2196=nwarr 2197=nearr 2198=searr 2199=swarr
21D0=lArr 21D2=rArr 21D1=uArr 21D3=dArr 21D4=hArr 21A6=map
BD=frac12 BC=frac14 BE=frac34 2153=frac13 2154=frac23 2155=frac15 2156=frac25 2157=frac35 2158=frac45
2159=frac16 215A=frac56 215B=frac18 215C=frac38 215D=frac58 215E=frac78 B9=sup1 B2=sup2 B3=sup3
2660=spades 2663=clubs 2665=hearts 2666=diams 266A=sung 266D=flat 266E=natural 266F=sharp 2713=check 2717=cross
2605=starf 2606=star 260E=phone 2113=ell 2105=incare 2117=copysr
2500=boxh 2502=boxv 250C=boxdr 2510=boxdl 2514=boxur 2518=boxul 251C=boxvr 2524=boxvl 252C=boxhd 2534=boxhu
253C=boxvh 2550=boxH 2551=boxV 2554=boxDR 2557=boxDL 255A=boxUR 255D=boxUL
2588=block 2593=blk34 2592=blk12 2591=blk14 2580=uhblk 2584=lhblk
`;

for (const pair of TABLE.split(/\s+/)) {
  const at = pair.indexOf("=");
  if (at > 0) NAMED[parseInt(pair.slice(0, at), 16)] = pair.slice(at + 1);
}

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi",
  "omicron", "pi", "rho", "", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];
// Capitals start at U+0391 and lowercase letters at U+03B1, in the same order. The empty name is the gap at U+03A2
// (capitals) and U+03C2 (the final sigma, named below).
GREEK.forEach((name, index) => {
  if (name === "") return;
  NAMED[0x3b1 + index] = name;
  NAMED[0x391 + index] = name.charAt(0).toUpperCase() + name.slice(1);
});
NAMED[0x3c2] = "sigmaf";

/** The HTML form of one character: `&name;` where the standard has a name, `&#x…;` otherwise. */
export function entityOf(codePoint: number): string {
  const name = NAMED[codePoint];
  if (name !== undefined) return `&${name};`;
  return `&#x${codePoint.toString(16).toUpperCase()};`;
}
