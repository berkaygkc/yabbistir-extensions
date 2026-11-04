/**
 * The symbols, as a compilation of Unicode facts (code points and their names, written in English and Turkish by
 * hand). One line per symbol: `character ‖ English name ‖ Turkish name`. A character written as `U+XXXX` (several
 * code points are space-separated) stands for characters that would be invisible or confusing in a source file.
 */
export interface SymbolGroup {
  id: string;
  lines: string;
}

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { id: "mac", lines: String.raw`
⌘ ‖ Command ‖ Command
⌥ ‖ Option ‖ Option
⇧ ‖ Shift ‖ Shift
⌃ ‖ Control ‖ Control
⇪ ‖ Caps Lock ‖ Caps Lock
⏎ ‖ Return ‖ Return
↩ ‖ Return arrow (left arrow with hook) ‖ Return oku (kancalı sol ok)
⌅ ‖ Enter ‖ Enter
⌤ ‖ Enter (laptop) ‖ Enter (dizüstü)
⌫ ‖ Delete backward ‖ Geri sil
⌦ ‖ Delete forward ‖ İleri sil
⎋ ‖ Escape ‖ Escape
⇥ ‖ Tab ‖ Sekme
⇤ ‖ Back tab ‖ Geri sekme
␣ ‖ Space key ‖ Boşluk tuşu
⇞ ‖ Page up ‖ Sayfa yukarı
⇟ ‖ Page down ‖ Sayfa aşağı
↖ ‖ Home (up left arrow) ‖ Home (sol üst ok)
↘ ‖ End (down right arrow) ‖ End (sağ alt ok)
⏏ ‖ Eject ‖ Çıkar
⏻ ‖ Power ‖ Güç
⌨ ‖ Keyboard ‖ Klavye
U+1F310 ‖ Globe key ‖ Küre tuşu
⎈ ‖ Helm ‖ Dümen
⌧ ‖ Clear ‖ Temizle
⌀ ‖ Diameter sign ‖ Çap işareti
`},
  { id: "arrows", lines: String.raw`
← ‖ Left arrow ‖ Sol ok
→ ‖ Right arrow ‖ Sağ ok
↑ ‖ Up arrow ‖ Yukarı ok
↓ ‖ Down arrow ‖ Aşağı ok
↔ ‖ Left right arrow ‖ Sol sağ ok
↕ ‖ Up down arrow ‖ Yukarı aşağı ok
↗ ‖ Up right arrow ‖ Sağ üst ok
↙ ‖ Down left arrow ‖ Sol alt ok
⇐ ‖ Double left arrow ‖ Çift sol ok
⇒ ‖ Double right arrow (implies) ‖ Çift sağ ok (gerektirir)
⇑ ‖ Double up arrow ‖ Çift yukarı ok
⇓ ‖ Double down arrow ‖ Çift aşağı ok
⇔ ‖ Double left right arrow (if and only if) ‖ Çift yönlü ok (ancak ve ancak)
⇄ ‖ Right arrow over left arrow ‖ Sağ ok sol okun üstünde
⇆ ‖ Left arrow over right arrow ‖ Sol ok sağ okun üstünde
↺ ‖ Anticlockwise arrow ‖ Saat yönü tersi ok
↻ ‖ Clockwise arrow ‖ Saat yönü ok
↶ ‖ Anticlockwise curved arrow ‖ Saat yönü tersi kıvrık ok
↷ ‖ Clockwise curved arrow ‖ Saat yönü kıvrık ok
↪ ‖ Right arrow with hook ‖ Kancalı sağ ok
➡ ‖ Black right arrow ‖ Siyah sağ ok
⬅ ‖ Black left arrow ‖ Siyah sol ok
⬆ ‖ Black up arrow ‖ Siyah yukarı ok
⬇ ‖ Black down arrow ‖ Siyah aşağı ok
▶ ‖ Play triangle ‖ Oynat üçgeni
◀ ‖ Reverse triangle ‖ Ters üçgen
▲ ‖ Up triangle ‖ Yukarı üçgen
▼ ‖ Down triangle ‖ Aşağı üçgen
`},
  { id: "typography", lines: String.raw`
‘ ‖ Left single quote ‖ Sol tek tırnak
’ ‖ Right single quote (apostrophe) ‖ Sağ tek tırnak (kesme işareti)
“ ‖ Left double quote ‖ Sol çift tırnak
” ‖ Right double quote ‖ Sağ çift tırnak
‚ ‖ Low single quote ‖ Alt tek tırnak
„ ‖ Low double quote ‖ Alt çift tırnak
« ‖ Left guillemet ‖ Sol açılı tırnak
» ‖ Right guillemet ‖ Sağ açılı tırnak
‹ ‖ Single left guillemet ‖ Tek sol açılı tırnak
› ‖ Single right guillemet ‖ Tek sağ açılı tırnak
– ‖ En dash ‖ Kısa tire
— ‖ Em dash ‖ Uzun tire
― ‖ Horizontal bar ‖ Yatay çizgi
‐ ‖ Hyphen ‖ Kısa çizgi
U+2011 ‖ Non-breaking hyphen ‖ Bölünmeyen kısa çizgi
− ‖ Minus sign ‖ Eksi işareti
… ‖ Ellipsis ‖ Üç nokta
• ‖ Bullet ‖ Madde işareti
‣ ‖ Triangular bullet ‖ Üçgen madde işareti
◦ ‖ White bullet ‖ Beyaz madde işareti
▪ ‖ Small black square ‖ Küçük siyah kare
· ‖ Middle dot ‖ Orta nokta
∙ ‖ Bullet operator ‖ Madde işleci
′ ‖ Prime (feet, minutes) ‖ Tek üs (fit, dakika)
″ ‖ Double prime (inches, seconds) ‖ Çift üs (inç, saniye)
‴ ‖ Triple prime ‖ Üçlü üs
U+00A0 ‖ Non-breaking space ‖ Bölünmeyen boşluk
U+2002 ‖ En space ‖ Kısa boşluk
U+2003 ‖ Em space ‖ Uzun boşluk
U+2009 ‖ Thin space ‖ İnce boşluk
U+202F ‖ Narrow non-breaking space ‖ Dar bölünmeyen boşluk
U+200B ‖ Zero-width space ‖ Sıfır genişlikli boşluk
U+200D ‖ Zero-width joiner ‖ Sıfır genişlikli birleştirici
U+00AD ‖ Soft hyphen ‖ Yumuşak tire
¡ ‖ Inverted exclamation mark ‖ Ters ünlem işareti
¿ ‖ Inverted question mark ‖ Ters soru işareti
‽ ‖ Interrobang ‖ Ünlem soru işareti
⁂ ‖ Asterism ‖ Yıldız öbeği
⁃ ‖ Hyphen bullet ‖ Tire madde işareti
U+2016 ‖ Double vertical line ‖ Çift dikey çizgi
U+007C ‖ Vertical line (pipe) ‖ Dikey çizgi
¦ ‖ Broken bar ‖ Kırık çizgi
~ ‖ Tilde ‖ Yaklaşık işareti
˜ ‖ Small tilde ‖ Küçük tilde
´ ‖ Acute accent ‖ Akut vurgu
¨ ‖ Diaeresis ‖ Ünlü çift nokta
¯ ‖ Macron ‖ Makron
ˆ ‖ Circumflex accent ‖ Düzeltme işareti
`},
  { id: "math", lines: String.raw`
± ‖ Plus-minus ‖ Artı eksi
× ‖ Multiplication ‖ Çarpı
÷ ‖ Division ‖ Bölü
≠ ‖ Not equal to ‖ Eşit değildir
≈ ‖ Almost equal to ‖ Yaklaşık eşit
≅ ‖ Congruent to ‖ Eş
≡ ‖ Identical to ‖ Özdeş
≤ ‖ Less than or equal to ‖ Küçük eşit
≥ ‖ Greater than or equal to ‖ Büyük eşit
≪ ‖ Much less than ‖ Çok küçüktür
≫ ‖ Much greater than ‖ Çok büyüktür
∝ ‖ Proportional to ‖ Orantılı
∞ ‖ Infinity ‖ Sonsuz
√ ‖ Square root ‖ Karekök
∑ ‖ Summation ‖ Toplam
∏ ‖ Product ‖ Çarpım
∫ ‖ Integral ‖ İntegral
∂ ‖ Partial differential ‖ Kısmi türev
∆ ‖ Increment ‖ Artım
∇ ‖ Nabla ‖ Nabla
∈ ‖ Element of ‖ Elemanıdır
∉ ‖ Not an element of ‖ Elemanı değildir
∋ ‖ Contains as member ‖ Eleman olarak içerir
∅ ‖ Empty set ‖ Boş küme
∩ ‖ Intersection ‖ Kesişim
∪ ‖ Union ‖ Birleşim
⊂ ‖ Subset of ‖ Alt küme
⊃ ‖ Superset of ‖ Üst küme
⊆ ‖ Subset of or equal to ‖ Alt küme veya eşit
⊇ ‖ Superset of or equal to ‖ Üst küme veya eşit
∀ ‖ For all ‖ Her
∃ ‖ There exists ‖ Vardır
∄ ‖ There does not exist ‖ Yoktur
∧ ‖ Logical and ‖ Mantıksal ve
∨ ‖ Logical or ‖ Mantıksal veya
¬ ‖ Not sign ‖ Değil işareti
⊥ ‖ Perpendicular ‖ Dik
∥ ‖ Parallel to ‖ Paralel
∠ ‖ Angle ‖ Açı
∴ ‖ Therefore ‖ Dolayısıyla
∵ ‖ Because ‖ Çünkü
∘ ‖ Ring operator ‖ Halka işleci
⋅ ‖ Dot operator ‖ Nokta işleci
‰ ‖ Per mille ‖ Binde
% ‖ Percent ‖ Yüzde
℃ ‖ Degree Celsius ‖ Santigrat derece
℉ ‖ Degree Fahrenheit ‖ Fahrenhayt derece
`},
  { id: "currency", lines: String.raw`
₺ ‖ Turkish lira ‖ Türk lirası
€ ‖ Euro ‖ Euro
$ ‖ Dollar ‖ Dolar
£ ‖ Pound sterling ‖ İngiliz sterlini
¥ ‖ Yen / yuan ‖ Yen / yuan
¢ ‖ Cent ‖ Sent
₹ ‖ Indian rupee ‖ Hint rupisi
₽ ‖ Russian ruble ‖ Rus rublesi
₩ ‖ Korean won ‖ Güney Kore wonu
₪ ‖ Israeli new shekel ‖ İsrail şekeli
₫ ‖ Vietnamese dong ‖ Vietnam dongu
₴ ‖ Ukrainian hryvnia ‖ Ukrayna grivnası
₿ ‖ Bitcoin ‖ Bitcoin
฿ ‖ Thai baht ‖ Tayland bahtı
₱ ‖ Philippine peso ‖ Filipinler pesosu
₦ ‖ Nigerian naira ‖ Nijerya nairası
₡ ‖ Costa Rican colón ‖ Kosta Rika kolonu
₣ ‖ French franc ‖ Fransız frangı
₤ ‖ Lira sign ‖ Lira işareti
₸ ‖ Kazakhstani tenge ‖ Kazakistan tengesi
₾ ‖ Georgian lari ‖ Gürcistan larisi
¤ ‖ Generic currency sign ‖ Genel para birimi işareti
`},
  { id: "marks", lines: String.raw`
✓ ‖ Check mark ‖ Onay işareti
✔ ‖ Heavy check mark ‖ Kalın onay işareti
✗ ‖ Ballot x ‖ Oy çarpısı
✘ ‖ Heavy ballot x ‖ Kalın oy çarpısı
✕ ‖ Multiplication x ‖ Çarpma çarpısı
✖ ‖ Heavy multiplication x ‖ Kalın çarpma çarpısı
☐ ‖ Empty ballot box ‖ Boş onay kutusu
☑ ‖ Ballot box with check ‖ Onaylı kutu
☒ ‖ Ballot box with x ‖ Çarpılı kutu
★ ‖ Black star ‖ Dolu yıldız
☆ ‖ White star ‖ Boş yıldız
✦ ‖ Four-pointed star ‖ Dört köşeli yıldız
✱ ‖ Heavy asterisk ‖ Kalın yıldız işareti
◆ ‖ Black diamond ‖ Dolu elmas
◇ ‖ White diamond ‖ Boş elmas
● ‖ Black circle ‖ Dolu daire
○ ‖ White circle ‖ Boş daire
■ ‖ Black square ‖ Dolu kare
□ ‖ White square ‖ Boş kare
♠ ‖ Spade ‖ Maça
♣ ‖ Club ‖ Sinek
♥ ‖ Heart ‖ Kalp
♦ ‖ Diamond suit ‖ Karo
❤ ‖ Heavy black heart ‖ Kalın siyah kalp
♡ ‖ White heart ‖ Boş kalp
☀ ‖ Sun ‖ Güneş
☁ ‖ Cloud ‖ Bulut
☂ ‖ Umbrella ‖ Şemsiye
☃ ‖ Snowman ‖ Kardan adam
☎ ‖ Telephone ‖ Telefon
✉ ‖ Envelope ‖ Zarf
✂ ‖ Scissors ‖ Makas
✎ ‖ Pencil ‖ Kalem
✐ ‖ Upper right pencil ‖ Sağ üst kalem
☺ ‖ Smiling face ‖ Gülen yüz
☹ ‖ Frowning face ‖ Somurtan yüz
♪ ‖ Eighth note ‖ Sekizlik nota
♫ ‖ Beamed eighth notes ‖ Bağlı sekizlik notalar
♭ ‖ Flat ‖ Bemol
♯ ‖ Sharp ‖ Diyez
♮ ‖ Natural ‖ Natürel
♻ ‖ Recycling ‖ Geri dönüşüm
⚠ ‖ Warning ‖ Uyarı
⚡ ‖ High voltage ‖ Yüksek gerilim
☠ ‖ Skull and crossbones ‖ Kuru kafa
`},
  { id: "greek", lines: String.raw`
α ‖ Alpha ‖ Alfa
β ‖ Beta ‖ Beta
γ ‖ Gamma ‖ Gama
δ ‖ Delta ‖ Delta
ε ‖ Epsilon ‖ Epsilon
ζ ‖ Zeta ‖ Zeta
η ‖ Eta ‖ Eta
θ ‖ Theta ‖ Teta
ι ‖ Iota ‖ Iota
κ ‖ Kappa ‖ Kappa
λ ‖ Lambda ‖ Lambda
μ ‖ Mu (micro) ‖ Mü (mikro)
ν ‖ Nu ‖ Nü
ξ ‖ Xi ‖ Ksi
ο ‖ Omicron ‖ Omikron
ρ ‖ Rho ‖ Ro
σ ‖ Sigma ‖ Sigma
ς ‖ Final sigma ‖ Sondaki sigma
τ ‖ Tau ‖ Tau
υ ‖ Upsilon ‖ Upsilon
φ ‖ Phi ‖ Fi
χ ‖ Chi ‖ Ki
ψ ‖ Psi ‖ Psi
ω ‖ Omega ‖ Omega
Α ‖ Capital alpha ‖ Büyük alfa
Β ‖ Capital beta ‖ Büyük beta
Γ ‖ Capital gamma ‖ Büyük gama
Δ ‖ Capital delta ‖ Büyük delta
Ε ‖ Capital epsilon ‖ Büyük epsilon
Ζ ‖ Capital zeta ‖ Büyük zeta
Η ‖ Capital eta ‖ Büyük eta
Θ ‖ Capital theta ‖ Büyük teta
Ι ‖ Capital iota ‖ Büyük iota
Κ ‖ Capital kappa ‖ Büyük kappa
Λ ‖ Capital lambda ‖ Büyük lambda
Μ ‖ Capital mu ‖ Büyük mü
Ν ‖ Capital nu ‖ Büyük nü
Ξ ‖ Capital xi ‖ Büyük ksi
Ο ‖ Capital omicron ‖ Büyük omikron
Π ‖ Capital pi ‖ Büyük pi
Ρ ‖ Capital rho ‖ Büyük ro
Σ ‖ Capital sigma ‖ Büyük sigma
Τ ‖ Capital tau ‖ Büyük tau
Υ ‖ Capital upsilon ‖ Büyük upsilon
Φ ‖ Capital phi ‖ Büyük fi
Χ ‖ Capital chi ‖ Büyük ki
Ψ ‖ Capital psi ‖ Büyük psi
Ω ‖ Capital omega (ohm) ‖ Büyük omega (ohm)
`},
  { id: "scripts", lines: String.raw`
⁰ ‖ Superscript 0 ‖ Üst simge 0
¹ ‖ Superscript 1 ‖ Üst simge 1
² ‖ Superscript 2 (squared) ‖ Üst simge 2 (kare)
³ ‖ Superscript 3 (cubed) ‖ Üst simge 3 (küp)
⁴ ‖ Superscript 4 ‖ Üst simge 4
⁵ ‖ Superscript 5 ‖ Üst simge 5
⁶ ‖ Superscript 6 ‖ Üst simge 6
⁷ ‖ Superscript 7 ‖ Üst simge 7
⁸ ‖ Superscript 8 ‖ Üst simge 8
⁹ ‖ Superscript 9 ‖ Üst simge 9
⁺ ‖ Superscript plus ‖ Üst simge artı
⁻ ‖ Superscript minus ‖ Üst simge eksi
ⁿ ‖ Superscript n ‖ Üst simge n
₀ ‖ Subscript 0 ‖ Alt simge 0
₁ ‖ Subscript 1 ‖ Alt simge 1
₂ ‖ Subscript 2 ‖ Alt simge 2
₃ ‖ Subscript 3 ‖ Alt simge 3
₄ ‖ Subscript 4 ‖ Alt simge 4
₅ ‖ Subscript 5 ‖ Alt simge 5
₆ ‖ Subscript 6 ‖ Alt simge 6
₇ ‖ Subscript 7 ‖ Alt simge 7
₈ ‖ Subscript 8 ‖ Alt simge 8
₉ ‖ Subscript 9 ‖ Alt simge 9
₊ ‖ Subscript plus ‖ Alt simge artı
₋ ‖ Subscript minus ‖ Alt simge eksi
`},
  { id: "fractions", lines: String.raw`
½ ‖ One half ‖ Yarım
⅓ ‖ One third ‖ Üçte bir
⅔ ‖ Two thirds ‖ Üçte iki
¼ ‖ One quarter ‖ Çeyrek
¾ ‖ Three quarters ‖ Dörtte üç
⅕ ‖ One fifth ‖ Beşte bir
⅖ ‖ Two fifths ‖ Beşte iki
⅗ ‖ Three fifths ‖ Beşte üç
⅘ ‖ Four fifths ‖ Beşte dört
⅙ ‖ One sixth ‖ Altıda bir
⅚ ‖ Five sixths ‖ Altıda beş
⅛ ‖ One eighth ‖ Sekizde bir
⅜ ‖ Three eighths ‖ Sekizde üç
⅝ ‖ Five eighths ‖ Sekizde beş
⅞ ‖ Seven eighths ‖ Sekizde yedi
⅐ ‖ One seventh ‖ Yedide bir
⅑ ‖ One ninth ‖ Dokuzda bir
⅒ ‖ One tenth ‖ Onda bir
⁄ ‖ Fraction slash ‖ Kesir çizgisi
`},
  { id: "box", lines: String.raw`
─ ‖ Box light horizontal ‖ Kutu ince yatay
│ ‖ Box light vertical ‖ Kutu ince dikey
┌ ‖ Box light down and right ‖ Kutu ince sol üst köşe
┐ ‖ Box light down and left ‖ Kutu ince sağ üst köşe
└ ‖ Box light up and right ‖ Kutu ince sol alt köşe
┘ ‖ Box light up and left ‖ Kutu ince sağ alt köşe
├ ‖ Box light vertical and right ‖ Kutu ince dikey ve sağ
┤ ‖ Box light vertical and left ‖ Kutu ince dikey ve sol
┬ ‖ Box light down and horizontal ‖ Kutu ince yatay ve aşağı
┴ ‖ Box light up and horizontal ‖ Kutu ince yatay ve yukarı
┼ ‖ Box light cross ‖ Kutu ince artı
╭ ‖ Box rounded top left ‖ Kutu yuvarlak sol üst köşe
╮ ‖ Box rounded top right ‖ Kutu yuvarlak sağ üst köşe
╰ ‖ Box rounded bottom left ‖ Kutu yuvarlak sol alt köşe
╯ ‖ Box rounded bottom right ‖ Kutu yuvarlak sağ alt köşe
█ ‖ Full block ‖ Tam blok
▓ ‖ Dark shade ‖ Koyu gölge
░ ‖ Light shade ‖ Açık gölge
`},
  { id: "legal", lines: String.raw`
© ‖ Copyright ‖ Telif hakkı
® ‖ Registered trademark ‖ Tescilli marka
™ ‖ Trademark ‖ Ticari marka
℠ ‖ Service mark ‖ Hizmet markası
℗ ‖ Sound recording copyright ‖ Ses kaydı telif hakkı
§ ‖ Section sign ‖ Bölüm işareti
¶ ‖ Paragraph sign (pilcrow) ‖ Paragraf işareti
† ‖ Dagger ‖ Hançer işareti
‡ ‖ Double dagger ‖ Çift hançer işareti
° ‖ Degree ‖ Derece
№ ‖ Numero sign ‖ Numara işareti
℅ ‖ Care of ‖ Yoluyla
ª ‖ Feminine ordinal ‖ Dişil sıra işareti
º ‖ Masculine ordinal ‖ Eril sıra işareti
µ ‖ Micro sign ‖ Mikro işareti
Å ‖ Angstrom ‖ Angström
ℓ ‖ Script small l (liter) ‖ El yazısı l (litre)
@ ‖ At sign ‖ Et işareti
# ‖ Number sign (hash) ‖ Diyez işareti
& ‖ Ampersand ‖ Ve işareti
* ‖ Asterisk ‖ Yıldız işareti
`},
];
