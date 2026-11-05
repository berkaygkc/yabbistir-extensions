// Every list here was written for this extension from common, generic words. No person, company or address
// is taken from a real record. The bank codes and the card test numbers are public facts, see the README.

export type Locale = "tr" | "en";

export const firstNames: Record<Locale, readonly string[]> = {
  tr: [
    "Ahmet", "Mehmet", "Mustafa", "Ali", "Hasan", "Hüseyin", "İbrahim", "Emre", "Burak", "Can",
    "Cem", "Deniz", "Eren", "Furkan", "Kerem", "Murat", "Onur", "Serkan", "Tolga", "Yusuf",
    "Ayşe", "Fatma", "Zeynep", "Elif", "Merve", "Büşra", "Esra", "Derya", "Selin", "Ceren",
    "Gamze", "Hande", "İrem", "Melis", "Nehir", "Özge", "Pınar", "Sibel", "Tuğba", "Yağmur",
    "Defne", "Ece", "Gizem", "Hilal", "Aylin", "Berna", "Damla", "Ebru", "Aslı", "Burcu",
  ],
  en: [
    "James", "John", "Robert", "Michael", "William", "David", "Daniel", "Matthew", "Andrew", "Thomas",
    "Ryan", "Kevin", "Brian", "Adam", "Nathan", "Oliver", "Henry", "Samuel", "Ethan", "Lucas",
    "Emma", "Olivia", "Sophia", "Isabella", "Charlotte", "Amelia", "Grace", "Hannah", "Chloe", "Lily",
    "Ella", "Natalie", "Rachel", "Megan", "Laura", "Sarah", "Emily", "Jessica", "Nora", "Claire",
    "Alice", "Maya", "Julia", "Abigail", "Victoria", "Eleanor", "Paige", "Tessa", "Holly", "Ruth",
  ],
};

export const lastNames: Record<Locale, readonly string[]> = {
  tr: [
    "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir",
    "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek",
    "Polat", "Korkmaz", "Çakır", "Güneş", "Aksoy", "Avcı", "Tekin", "Bulut", "Ünal", "Türk",
    "Acar", "Taş", "Karaca", "Uçar", "Güler", "Bozkurt", "Erdem", "Sezer", "Yavuz", "Keskin",
    "Özer", "Duman", "Altun", "Soylu", "Tunç", "Balcı", "Kaplan", "Işık", "Sönmez", "Eren",
  ],
  en: [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Moore", "Taylor",
    "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Clark", "Lewis", "Walker",
    "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson",
    "Hill", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips", "Evans", "Turner", "Parker", "Collins",
    "Edwards", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan", "Cooper", "Reed", "Bailey",
  ],
};

/** RFC 2606 reserves these names for documentation and tests; mail to them never reaches anyone. */
export const emailDomains = ["example.com", "example.org", "example.net"] as const;

export interface Place {
  city: string;
  /** Turkish licence-plate code of the city (also the first two digits of its postal codes). */
  plate?: string;
  /** Districts for Turkish cities, the state code for English ones. */
  areas: readonly string[];
}

export const places: Record<Locale, readonly Place[]> = {
  tr: [
    { city: "İstanbul", plate: "34", areas: ["Kadıköy", "Beşiktaş", "Üsküdar", "Şişli", "Bakırköy"] },
    { city: "Ankara", plate: "06", areas: ["Çankaya", "Keçiören", "Yenimahalle", "Mamak"] },
    { city: "İzmir", plate: "35", areas: ["Karşıyaka", "Bornova", "Konak", "Buca"] },
    { city: "Bursa", plate: "16", areas: ["Nilüfer", "Osmangazi", "Yıldırım"] },
    { city: "Antalya", plate: "07", areas: ["Muratpaşa", "Konyaaltı", "Kepez"] },
    { city: "Eskişehir", plate: "26", areas: ["Tepebaşı", "Odunpazarı"] },
    { city: "Gaziantep", plate: "27", areas: ["Şehitkamil", "Şahinbey"] },
    { city: "Trabzon", plate: "61", areas: ["Ortahisar", "Akçaabat"] },
    { city: "Konya", plate: "42", areas: ["Selçuklu", "Meram", "Karatay"] },
    { city: "Adana", plate: "01", areas: ["Seyhan", "Çukurova"] },
  ],
  en: [
    { city: "Portland", areas: ["OR"] },
    { city: "Seattle", areas: ["WA"] },
    { city: "Austin", areas: ["TX"] },
    { city: "Denver", areas: ["CO"] },
    { city: "Chicago", areas: ["IL"] },
    { city: "Boston", areas: ["MA"] },
    { city: "Atlanta", areas: ["GA"] },
    { city: "Madison", areas: ["WI"] },
    { city: "Raleigh", areas: ["NC"] },
    { city: "Phoenix", areas: ["AZ"] },
  ],
};

/** Street names: a plain word, and the suffix is added per locale. */
export const streetNames: Record<Locale, readonly string[]> = {
  tr: ["Gül", "Papatya", "Lale", "Menekşe", "Çınar", "Meşe", "Akasya", "Bahçe", "Okul", "Çiçek", "Fidan", "Yıldız", "Güneş", "Barış", "Cumhuriyet", "Atatürk", "İnönü", "Gökkuşağı"],
  en: ["Maple", "Oak", "Cedar", "Elm", "Pine", "Willow", "Lake", "Hill", "Park", "River", "Sunset", "Church", "Mill", "Spring", "Highland", "Meadow", "Forest", "Garden"],
};
export const streetSuffixes: Record<Locale, readonly string[]> = {
  tr: ["Sokak", "Caddesi"],
  en: ["Street", "Avenue", "Road", "Lane", "Drive"],
};

/** Company names: [first words, second words, legal forms]. */
export const companyParts: Record<Locale, readonly [readonly string[], readonly string[], readonly string[]]> = {
  tr: [
    ["Yıldız", "Mavi", "Anka", "Kuzey", "Ege", "Boğaz", "Çınar", "Doruk", "Ufuk", "Akın", "Zirve", "Pusula"],
    ["Yazılım", "Lojistik", "Danışmanlık", "Teknoloji", "Mühendislik", "Gıda", "Tekstil", "Enerji", "Dijital", "Yapı"],
    ["A.Ş.", "Ltd. Şti."],
  ],
  en: [
    ["Bright", "Harbor", "Summit", "Pine", "Cobalt", "Juniper", "Lantern", "Meridian", "Granite", "Alder", "Beacon", "Copper"],
    ["Labs", "Systems", "Works", "Logistics", "Analytics", "Software", "Studio", "Robotics", "Foods", "Partners"],
    ["Inc.", "LLC", "Ltd."],
  ],
};

export const jobTitles: Record<Locale, readonly string[]> = {
  tr: [
    "Yazılım Mühendisi", "Ürün Yöneticisi", "Grafik Tasarımcı", "Muhasebe Uzmanı", "İnsan Kaynakları Uzmanı",
    "Satış Temsilcisi", "Proje Yöneticisi", "Veri Analisti", "Müşteri Temsilcisi", "Pazarlama Uzmanı",
    "Sistem Yöneticisi", "Test Mühendisi", "İçerik Editörü", "Lojistik Sorumlusu", "Mimar",
  ],
  en: [
    "Software Engineer", "Product Manager", "Graphic Designer", "Accountant", "HR Specialist",
    "Sales Representative", "Project Manager", "Data Analyst", "Customer Support Agent", "Marketing Specialist",
    "Systems Administrator", "QA Engineer", "Content Editor", "Logistics Coordinator", "Architect",
  ],
};

/** Mobile prefixes used for fake Turkish numbers. */
export const trMobilePrefixes = ["501", "505", "506", "507", "530", "531", "532", "533", "534", "535", "536", "537", "538", "539", "541", "542", "543", "544", "545", "546", "547", "548", "549", "551", "552", "553", "554", "555", "559"] as const;

/** US area codes for fake numbers; the line is always in the 555-0100 to 555-0199 range set aside for fiction. */
export const usAreaCodes = ["212", "303", "312", "404", "415", "503", "512", "617", "720", "206"] as const;

/** Five-digit bank codes from the Central Bank of the Republic of Türkiye's published list. */
export const trBankCodes = ["00010", "00012", "00015", "00032", "00046", "00062", "00064", "00067", "00099", "00111", "00134"] as const;

/** The test card numbers that card networks publish for testing. They never belong to a real account. */
export const testCards = {
  visa: "4111111111111111",
  mastercard: "5555555555554444",
  amex: "378282246310005",
} as const;

/** The classic Latin placeholder words (Cicero, 45 BC: public domain). */
export const loremWords = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
  "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim",
  "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip",
  "ex", "ea", "commodo", "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate",
  "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur", "sint", "occaecat",
  "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia", "deserunt", "mollit", "anim", "id", "est", "laborum",
] as const;
