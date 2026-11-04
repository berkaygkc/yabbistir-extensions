/**
 * Kaomoji: short public strings, compiled by hand. One line per kaomoji: `kaomoji ‖ English words ‖ Turkish words`.
 * The words are what a person might type to find it, in each language.
 */
export interface KaomojiGroup {
  id: string;
  lines: string;
}

export const KAOMOJI_GROUPS: KaomojiGroup[] = [
  { id: "happy", lines: String.raw`
(＾▽＾) ‖ happy, smile, joy ‖ mutlu, gülümseme, neşe
(^_^) ‖ smile, happy, glad ‖ gülümseme, mutlu, memnun
(＾ω＾) ‖ happy, cute, cheerful ‖ mutlu, sevimli, neşeli
(≧▽≦) ‖ excited, laugh, joy ‖ heyecanlı, kahkaha, sevinç
(*^▽^*) ‖ happy, blush, cheerful ‖ mutlu, utangaç, neşeli
(^∀^) ‖ grin, happy, laugh ‖ sırıtma, mutlu, gülme
ヽ(´▽｀)/ ‖ cheer, hooray, happy ‖ sevinç, yaşasın, mutlu
(◕‿◕) ‖ sweet, happy, smile ‖ tatlı, mutlu, gülümseme
(＾◡＾) ‖ gentle, smile, calm ‖ nazik, gülümseme, sakin
٩(◕‿◕)۶ ‖ cheer, hooray, joy ‖ yaşasın, sevinç, coşku
\(^o^)/ ‖ hooray, banzai, cheer ‖ yaşasın, hurra, coşku
(ﾉ◕ヮ◕)ﾉ ‖ celebrate, wow, joy ‖ kutlama, vay, sevinç
(☆▽☆) ‖ starry eyes, wow, happy ‖ parlayan gözler, vay, mutlu
(＾Д＾) ‖ laugh, big smile, joy ‖ gülme, kocaman gülümseme, sevinç
`},
  { id: "love", lines: String.raw`
(♡´▽｀♡) ‖ love, heart, adore ‖ aşk, kalp, hayran
(｡♥‿♥｡) ‖ love, heart eyes, crush ‖ aşk, kalp gözler, hoşlanma
(´∀｀)♡ ‖ love, heart, happy ‖ aşk, kalp, mutlu
(♥ω♥) ‖ love, heart, cute ‖ aşk, kalp, sevimli
(*´▽｀*)♡ ‖ love, blush, heart ‖ aşk, utangaç, kalp
(づ｡◕‿‿◕｡)づ ‖ hug, love, cuddle ‖ sarılma, aşk, kucaklama
(っ´ω｀c) ‖ hug, cuddle, warm ‖ sarılma, kucaklama, sıcak
(つ≧▽≦)つ ‖ hug, big hug, joy ‖ sarılma, büyük sarılma, sevinç
( ˘ ³˘)♥ ‖ kiss, love, smooch ‖ öpücük, aşk, öpmek
(*￣3￣)╭ ‖ kiss, smooch, love ‖ öpücük, öpmek, aşk
(◍•ᴗ•◍)❤ ‖ love, heart, sweet ‖ aşk, kalp, tatlı
(♡ω♡) ‖ love, heart, adorable ‖ aşk, kalp, sevimli
(´,,•ω•,,)♡ ‖ love, shy, heart ‖ aşk, utangaç, kalp
(＾3＾)♡ ‖ kiss, love, blow a kiss ‖ öpücük, aşk, öpücük göndermek
`},
  { id: "sad", lines: String.raw`
(╥﹏╥) ‖ sad, cry, tears ‖ üzgün, ağlama, gözyaşı
(T_T) ‖ cry, sad, tears ‖ ağlama, üzgün, gözyaşı
(;_;) ‖ cry, sad, sob ‖ ağlama, üzgün, hıçkırık
(ಥ﹏ಥ) ‖ sob, sad, heartbroken ‖ hıçkırık, üzgün, kalbi kırık
(つ﹏⊂) ‖ sad, cry, hands on face ‖ üzgün, ağlama, yüzünü kapatma
(｡•́︿•̀｡) ‖ sad, upset, sorry ‖ üzgün, kırgın, özür
(´;ω;｀) ‖ cry, sad, tears ‖ ağlama, üzgün, gözyaşı
(︶︹︺) ‖ sad, disappointed, down ‖ üzgün, hayal kırıklığı, mutsuz
(._.) ‖ sad, quiet, gloomy ‖ üzgün, sessiz, kasvetli
orz ‖ defeated, despair, kneeling ‖ yenilgi, umutsuzluk, diz çökmek
(ノД｀) ‖ sob, weep, sad ‖ hıçkırık, ağlama, üzgün
(´-ω-｀) ‖ sigh, tired, resigned ‖ iç çekme, yorgun, teslimiyet
(；´Д｀) ‖ worried, sad, troubled ‖ endişeli, üzgün, sıkıntılı
(இ﹏இ｀) ‖ sad, tears, sorrow ‖ üzgün, gözyaşı, keder
`},
  { id: "angry", lines: String.raw`
(╬ಠ益ಠ) ‖ angry, furious, rage ‖ kızgın, öfkeli, hiddet
(｀Д´) ‖ angry, annoyed, mad ‖ kızgın, sinirli, deli
(ー_ー)!! ‖ annoyed, irritated, angry ‖ sinirli, rahatsız, kızgın
(＃｀Д´) ‖ angry, vein, mad ‖ kızgın, damar, öfke
ヽ(｀Д´)ﾉ ‖ rage, yelling, angry ‖ öfke, bağırma, kızgın
(ノಠ益ಠ)ノ ‖ rage, furious, throw ‖ öfke, çılgın, fırlatmak
(¬_¬) ‖ annoyed, side eye, unimpressed ‖ sinirli, yan bakış, etkilenmemiş
(눈_눈) ‖ glare, stare, annoyed ‖ sert bakış, bakmak, sinirli
(ಠ_ಠ) ‖ disapproval, stare, look ‖ onaylamama, bakış, dik dik bakmak
(︶︿︶)=σ ‖ grumpy, annoyed, flick ‖ huysuz, sinirli, fiske
(╯°□°)╯ ‖ angry, flip, rage ‖ kızgın, çevirme, öfke
(｀ε´) ‖ grumpy, pout, annoyed ‖ huysuz, surat asma, sinirli
(#｀皿´) ‖ furious, mad, steaming ‖ çılgın, deli, buharlaşmak
(｀皿´＃) ‖ rage, angry, mad ‖ öfke, kızgın, deli
`},
  { id: "surprised", lines: String.raw`
(⊙_⊙) ‖ surprised, shocked, wide eyes ‖ şaşkın, şok, iri gözler
(°o°) ‖ surprised, shocked, oh ‖ şaşkın, şok, ah
(ﾟдﾟ) ‖ shocked, gasp, surprised ‖ şok, nefes, şaşkın
Σ(ﾟДﾟ) ‖ shocked, startled, no way ‖ şok, ürkmüş, yok artık
(○□○) ‖ amazed, wow, surprised ‖ hayret, vay, şaşkın
(°ロ°) ‖ gasp, shocked, wow ‖ nefes, şok, vay
w(°o°)w ‖ shocked, startled, gasp ‖ şok, ürkmüş, nefes
(ﾟ∀ﾟ) ‖ surprised, hype, wow ‖ şaşkın, heyecan, vay
(◎_◎;) ‖ nervous, surprised, startled ‖ gergin, şaşkın, ürkmüş
(☉_☉) ‖ wide eyes, shocked, stunned ‖ iri gözler, şok, afallamış
(๑•̀ㅂ•́)و ‖ determined, ready, fight ‖ kararlı, hazır, savaş
(⊙ω⊙) ‖ curious, wow, surprised ‖ meraklı, vay, şaşkın
(◉_◉) ‖ staring, shocked, wide eyes ‖ bakış, şok, iri gözler
(´⊙ω⊙｀) ‖ surprised, curious, amazed ‖ şaşkın, meraklı, hayret
`},
  { id: "shrug", lines: String.raw`
¯\_(ツ)_/¯ ‖ shrug, whatever, idk ‖ omuz silkme, her neyse, bilmem
¯\(°_o)/¯ ‖ shrug, confused, idk ‖ omuz silkme, kafası karışık, bilmem
¯\_(⊙︿⊙)_/¯ ‖ shrug, puzzled, unsure ‖ omuz silkme, şaşkın, emin değil
┐(´д｀)┌ ‖ shrug, give up, whatever ‖ omuz silkme, pes, her neyse
┐(￣ヘ￣)┌ ‖ shrug, resigned, meh ‖ omuz silkme, teslimiyet, ıh
┐('～｀；)┌ ‖ shrug, helpless, sigh ‖ omuz silkme, çaresiz, iç çekme
╮(╯_╰)╭ ‖ shrug, helpless, oh well ‖ omuz silkme, çaresiz, n'apalım
╮(￣▽￣)╭ ‖ shrug, calm, oh well ‖ omuz silkme, sakin, n'apalım
(・_・ヾ ‖ confused, hm, unsure ‖ kafası karışık, hım, emin değil
(・・？) ‖ confused, question, huh ‖ kafası karışık, soru, hı
(￣～￣;) ‖ thinking, hmm, doubt ‖ düşünme, hmm, şüphe
(・～・) ‖ hmm, thinking, unsure ‖ hmm, düşünme, emin değil
(¬‿¬) ‖ smirk, sly, suspicious ‖ sırıtma, kurnaz, şüpheli
(⊙.☉)7 ‖ suspicious, wait, what ‖ şüpheli, dur, ne
`},
  { id: "tableflip", lines: String.raw`
(╯°□°)╯︵ ┻━┻ ‖ table flip, rage, flip ‖ masa çevirme, öfke, devirme
(ノಠ益ಠ)ノ彡┻━┻ ‖ table flip, furious, flip ‖ masa çevirme, çılgın, devirme
┬─┬ノ( º _ ºノ) ‖ put table back, calm, restore ‖ masayı geri koy, sakin, düzelt
┬─┬ ノ( ゜-゜ノ) ‖ put table back, calm, sorry ‖ masayı geri koy, sakin, özür
(ノ°ο°)ノ ‖ flip, throw, mad ‖ çevirme, fırlatma, deli
(╯°□°）╯︵ ┻━┻ ‖ table flip, angry, classic ‖ masa çevirme, kızgın, klasik
(ノ ゜Д゜)ノ ︵ ┻━┻ ‖ table flip, shocked, throw ‖ masa çevirme, şok, fırlatma
┻━┻ ︵ヽ(｀Д´)ﾉ︵ ┻━┻ ‖ double table flip, rage, flip ‖ çift masa çevirme, öfke, devirme
(ﾉಥ益ಥ)ﾉ ┻━┻ ‖ table flip, crying, flip ‖ masa çevirme, ağlayarak, devirme
(☞ﾟヮﾟ)☞ ┻━┻ ‖ table, point, flip ‖ masa, işaret, devirme
(ノ-_-)ノ~┻━┻ ‖ table flip, annoyed, toss ‖ masa çevirme, sinirli, atma
┬──┬ ¯\_(ツ)_/¯ ‖ table, shrug, shelf ‖ masa, omuz silkme, raf
(ﾉ≧∇≦)ﾉ ﾐ ┸━┸ ‖ table flip, happy, toss ‖ masa çevirme, mutlu, atma
(/¯◡ ‿ ◡)/¯ ~ ┻━┻ ‖ table flip, smooth, toss ‖ masa çevirme, rahat, atma
`},
  { id: "bear", lines: String.raw`
ʕ•ᴥ•ʔ ‖ bear, cute, teddy ‖ ayı, sevimli, oyuncak ayı
ʕ·͡ᴥ·ʔ ‖ bear, curious, cute ‖ ayı, meraklı, sevimli
ʕ◕ᴥ◕ʔ ‖ bear, big eyes, cute ‖ ayı, iri gözler, sevimli
ʕ ˘ᴥ˘ ʔ ‖ bear, sleepy, calm ‖ ayı, uykulu, sakin
ʕง•ᴥ•ʔง ‖ bear, fight, ready ‖ ayı, kavga, hazır
ʕ•̀ω•́ʔ✧ ‖ bear, proud, sparkle ‖ ayı, gururlu, parıltı
ʕっ•ᴥ•ʔっ ‖ bear, hug, cuddle ‖ ayı, sarılma, kucaklama
ʕ ᵔᴥᵔ ʔ ‖ bear, happy, smile ‖ ayı, mutlu, gülümseme
ʕ•ᴥ•ʔノ゛ ‖ bear, wave, hello ‖ ayı, el sallama, merhaba
ʕ´•ᴥ•｀ʔ ‖ bear, shy, soft ‖ ayı, utangaç, yumuşak
ʕ→ᴥ←ʔ ‖ bear, side eye, sneaky ‖ ayı, yan bakış, sinsi
ʕ>ᴥ<ʔ ‖ bear, squint, cringe ‖ ayı, kısık göz, ürperme
ʕ♥ᴥ♥ʔ ‖ bear, love, heart ‖ ayı, aşk, kalp
ʕ•͡ᴥ•ʔ ‖ bear, polite, cute ‖ ayı, kibar, sevimli
`},
  { id: "cat", lines: String.raw`
(=^･ω･^=) ‖ cat, neko, cute ‖ kedi, neko, sevimli
(=^･^=) ‖ cat, smile, cute ‖ kedi, gülümseme, sevimli
(=①ω①=) ‖ cat, wide eyes, curious ‖ kedi, iri gözler, meraklı
(=｀ω´=) ‖ cat, smug, sly ‖ kedi, kendini beğenmiş, kurnaz
(=ＴェＴ=) ‖ cat, sad, crying ‖ kedi, üzgün, ağlama
(=ↀωↀ=)✧ ‖ cat, sparkle, playful ‖ kedi, parıltı, oyuncu
(^･o･^)ﾉ" ‖ cat, wave, hello ‖ kedi, el sallama, merhaba
ฅ(＾・ω・＾ฅ) ‖ cat, paws, cute ‖ kedi, patiler, sevimli
ฅ^•ﻌ•^ฅ ‖ cat, paws, meow ‖ kedi, patiler, miyav
(ↀДↀ)✧ ‖ cat, surprised, sparkle ‖ kedi, şaşkın, parıltı
/ᐠ｡ꞈ｡ᐟ\ ‖ cat, sleepy, calm ‖ kedi, uykulu, sakin
(ฅ•ω•ฅ) ‖ cat, paws, cuddle ‖ kedi, patiler, kucaklama
(^≗ω≗^) ‖ cat, smug, whiskers ‖ kedi, kendini beğenmiş, bıyıklar
(≽^•⩊•^≼) ‖ cat, happy, ears ‖ kedi, mutlu, kulaklar
`},
  { id: "music", lines: String.raw`
♪(´▽｀) ‖ music, note, happy ‖ müzik, nota, mutlu
♪♪＼(^ω^＼) ‖ music, dance, sing ‖ müzik, dans, şarkı
(~˘▾˘)~ ‖ dance, groove, music ‖ dans, ritim, müzik
~(˘▾˘~) ‖ dance, groove, sway ‖ dans, ritim, sallanma
┌(・。・)┘♪ ‖ dance, music, move ‖ dans, müzik, hareket
└(＾＾)┐♪ ‖ dance, music, step ‖ dans, müzik, adım
♪(┌・。・)┌ ‖ dance, music, boogie ‖ dans, müzik, eğlence
(ﾉ´ヮ´)ﾉ*:･ﾟ✧ ‖ celebrate, sparkle, party ‖ kutlama, parıltı, parti
♬♩(＾◡＾) ‖ sing, music, melody ‖ şarkı, müzik, melodi
(♪﹃♪) ‖ sing, humming, music ‖ şarkı, mırıldanma, müzik
ヾ(⌐■_■)ノ♪ ‖ cool, music, sunglasses ‖ havalı, müzik, güneş gözlüğü
(⌐■_■) ‖ cool, sunglasses, deal with it ‖ havalı, güneş gözlüğü, alışın
♪d(´▽｀)b♪ ‖ headphones, music, groove ‖ kulaklık, müzik, ritim
(っ˘ω˘ς) ‖ chill, relaxed, music ‖ rahat, huzurlu, müzik
`},
  { id: "sleepy", lines: String.raw`
(-_-) zzz ‖ sleep, zzz, tired ‖ uyku, zzz, yorgun
(-ω-) zzz ‖ sleep, calm, zzz ‖ uyku, sakin, zzz
(－_－) zzz ‖ sleepy, bored, zzz ‖ uykulu, sıkılmış, zzz
(∪｡∪)｡｡｡zzz ‖ sleep, snooze, dreaming ‖ uyku, şekerleme, rüya
(ᴗ˳ᴗ) ‖ sleep, peaceful, calm ‖ uyku, huzurlu, sakin
(˘ω˘) ‖ sleep, content, peaceful ‖ uyku, memnun, huzurlu
(´～｀) zzz ‖ sleepy, tired, sigh ‖ uykulu, yorgun, iç çekme
(＿ ＿*) Z z z ‖ sleep, doze, snore ‖ uyku, uyuklama, horlama
(｡-ω-)zzz ‖ sleep, sweet dreams, zzz ‖ uyku, tatlı rüyalar, zzz
(~_~) ‖ tired, sleepy, yawn ‖ yorgun, uykulu, esneme
(-o-) ‖ yawn, tired, sleepy ‖ esneme, yorgun, uykulu
(´〜｀*) zzZ ‖ drowsy, nap, zzz ‖ uyku sersemi, şekerleme, zzz
(◡ ω ◡) ‖ cozy, rest, sleep ‖ rahat, dinlenme, uyku
(-.-)Zzz… ‖ sleep, snore, nap ‖ uyku, horlama, şekerleme
`},
  { id: "greeting", lines: String.raw`
(^_^)/ ‖ hello, wave, hi ‖ merhaba, el sallama, selam
(｡･∀･)ﾉﾞ ‖ hello, wave, hi ‖ merhaba, el sallama, selam
(＾▽＾)ノ ‖ hi, wave, greeting ‖ selam, el sallama, selamlama
ヾ(＾∇＾) ‖ hello, bye, wave ‖ merhaba, hoşça kal, el sallama
(*・ω・)ﾉ ‖ hello, shy wave, hi ‖ merhaba, utangaç el sallama, selam
(•ω•)ﾉ ‖ hi, wave, hello ‖ selam, el sallama, merhaba
(^_^)ﾉ~~ ‖ bye, wave, goodbye ‖ hoşça kal, el sallama, güle güle
(´・ω・)ノ ‖ bye, wave, see you ‖ hoşça kal, el sallama, görüşürüz
(ᵔ◡ᵔ)ノ ‖ hi, wave, smile ‖ selam, el sallama, gülümseme
m(_ _)m ‖ thanks, sorry, bow ‖ teşekkürler, özür, eğilme
(〃＾▽＾〃) ‖ welcome, blush, happy ‖ hoş geldin, utangaç, mutlu
(⌒‿⌒) ‖ good morning, smile, pleasant ‖ günaydın, gülümseme, hoş
(๑˃ᴗ˂)ﻭ ‖ cheers, good luck, go ‖ şerefe, bol şans, haydi
(^_−)☆ ‖ wink, ok, nice ‖ göz kırpma, tamam, güzel
`},
];
