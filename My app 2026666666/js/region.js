/* ============================================================
   NEXO · região (país e fuso horário)
   ------------------------------------------------------------
   · CATÁLOGO DE PAÍSES: código ISO 3166-1 alpha-2, nome em
     pt-BR, nome em inglês e nome local (nativo). A BANDEIRA é
     derivada do próprio código ISO (indicadores regionais
     Unicode), então nunca sai de sincronia com a lista;
   · NUNCA usa GPS, IP, endereço ou localização em tempo real:
     o país só existe se o próprio usuário escolher;
   · fusos são IANA (America/Sao_Paulo, Asia/Tokyo…);
   · o backend guarda o horário original (UTC/ms) intacto —
     a conversão acontece só na exibição (js/core.js).
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* bandeira derivada do código ISO de 2 letras */
  function flagOf(code) {
    const raw = String(code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(raw)) return "";
    const A = 0x1f1e6;
    return String.fromCharCode(
      A + (raw.charCodeAt(0) - 65),
      A + (raw.charCodeAt(1) - 65)
    );
  }

  /* ---------------- catálogo de países ----------------
     [código ISO, nome em pt-BR, nome em inglês, nome local] */
  const RAW = [
    ["AF", "Afeganistão", "Afghanistan", "افغانستان"],
    ["AL", "Albânia", "Albania", "Shqipëria"],
    ["DZ", "Argélia", "Algeria", "الجزائر"],
    ["AD", "Andorra", "Andorra", "Andorra"],
    ["AO", "Angola", "Angola", "Angola"],
    ["AG", "Antígua e Barbuda", "Antigua and Barbuda", "Antigua & Barbuda"],
    ["AR", "Argentina", "Argentina", "Argentina"],
    ["AM", "Armênia", "Armenia", "Հայաստան"],
    ["AU", "Austrália", "Australia", "Australia"],
    ["AT", "Áustria", "Austria", "Österreich"],
    ["AZ", "Azerbaijão", "Azerbaijan", "Azərbaycan"],
    ["BS", "Bahamas", "Bahamas", "The Bahamas"],
    ["BH", "Bahrein", "Bahrain", "البحرين"],
    ["BD", "Bangladesh", "Bangladesh", "বাংলাদেশ"],
    ["BB", "Barbados", "Barbados", "Barbados"],
    ["BY", "Bielorrússia", "Belarus", "Беларусь"],
    ["BE", "Bélgica", "Belgium", "België"],
    ["BZ", "Belize", "Belize", "Belize"],
    ["BJ", "Benin", "Benin", "Bénin"],
    ["BT", "Butão", "Bhutan", "བལ་ཡུལ་"],
    ["BO", "Bolívia", "Bolivia", "Bolivia"],
    ["BA", "Bósnia e Herzegovina", "Bosnia and Herzegovina", "Bosna i Hercegovina"],
    ["BW", "Botsuana", "Botswana", "Botswana"],
    ["BR", "Brasil", "Brazil", "Brasil"],
    ["BN", "Brunei", "Brunei", "Brunei"],
    ["BG", "Bulgária", "Bulgaria", "България"],
    ["BF", "Burkina Faso", "Burkina Faso", "Burkina Faso"],
    ["BI", "Burundi", "Burundi", "Burundi"],
    ["CV", "Cabo Verde", "Cape Verde", "Cabo Verde"],
    ["KH", "Camboja", "Cambodia", "ប្រទេសកម្ពុជា"],
    ["CM", "Camarões", "Cameroon", "Cameroun"],
    ["CA", "Canadá", "Canada", "Canada"],
    ["CF", "República Centro-Africana", "Central African Republic", "République centrafricaine"],
    ["TD", "Chade", "Chad", "Tchad"],
    ["CL", "Chile", "Chile", "Chile"],
    ["CN", "China", "China", "中国"],
    ["CO", "Colômbia", "Colombia", "Colombia"],
    ["KM", "Comores", "Comores", "القمر"],
    ["CG", "Congo", "Congo", "Congo"],
    ["CD", "República Democrática do Congo", "DR Congo", "République démocratique du Congo"],
    ["CR", "Costa Rica", "Costa Rica", "Costa Rica"],
    ["CI", "Costa do Marfim", "Côte d'Ivoire", "Côte d'Ivoire"],
    ["HR", "Croácia", "Croatia", "Hrvatska"],
    ["CU", "Cuba", "Cuba", "Cuba"],
    ["CY", "Chipre", "Cyprus", "Κύπρος"],
    ["CZ", "Chéquia", "Czechia", "Česko"],
    ["DK", "Dinamarca", "Denmark", "Danmark"],
    ["DJ", "Djibouti", "Djibouti", "جيبوتي"],
    ["DM", "Dominica", "Dominica", "Dominica"],
    ["DO", "República Dominicana", "Dominican Republic", "República Dominicana"],
    ["EC", "Equador", "Ecuador", "Ecuador"],
    ["EG", "Egito", "Egypt", "مصر"],
    ["SV", "El Salvador", "El Salvador", "El Salvador"],
    ["GQ", "Guiné Equatorial", "Equatorial Guinea", "Guinea Ecuatorial"],
    ["ER", "Eritreia", "Eritrea", "ኤርትራ"],
    ["EE", "Estônia", "Estonia", "Eesti"],
    ["SZ", "Essuatíni", "Eswatini", "eSwatini"],
    ["ET", "Etiópia", "Ethiopia", "ኢትዮጵያ"],
    ["FJ", "Fiji", "Fiji", "Fiji"],
    ["FI", "Finlândia", "Finland", "Suomi"],
    ["FR", "França", "France", "France"],
    ["GA", "Gabão", "Gabon", "Gabon"],
    ["GM", "Gâmbia", "Gambia", "The Gambia"],
    ["GE", "Geórgia", "Georgia", "საქართველო"],
    ["DE", "Alemanha", "Germany", "Deutschland"],
    ["GH", "Gana", "Ghana", "Ghana"],
    ["GR", "Grécia", "Greece", "Ελλάδα"],
    ["GD", "Granada", "Grenada", "Grenada"],
    ["GT", "Guatemala", "Guatemala", "Guatemala"],
    ["GN", "Guiné", "Guinea", "Guinée"],
    ["GW", "Guiné-Bissau", "Guinea-Bissau", "Guiné-Bissau"],
    ["GY", "Guiana", "Guyana", "Guyana"],
    ["HT", "Haiti", "Haiti", "Haïti"],
    ["HN", "Honduras", "Honduras", "Honduras"],
    ["HU", "Hungria", "Hungary", "Magyarország"],
    ["IS", "Islândia", "Iceland", "Ísland"],
    ["IN", "Índia", "India", "भारत"],
    ["ID", "Indonésia", "Indonesia", "Indonesia"],
    ["IR", "Irã", "Iran", "ایران"],
    ["IQ", "Iraque", "Iraq", "العراق"],
    ["IE", "Irlanda", "Ireland", "Ireland"],
    ["IL", "Israel", "Israel", "ישראל"],
    ["IT", "Itália", "Italy", "Italia"],
    ["JM", "Jamaica", "Jamaica", "Jamaica"],
    ["JP", "Japão", "Japan", "日本"],
    ["JO", "Jordânia", "Jordan", "الأردن"],
    ["KZ", "Cazaquistão", "Kazakhstan", "Қазақстан"],
    ["KE", "Quênia", "Kenya", "Kenya"],
    ["KI", "Kiribati", "Kiribati", "Kiribati"],
    ["KP", "Coreia do Norte", "North Korea", "조선"],
    ["KR", "Coreia do Sul", "South Korea", "대한민국"],
    ["KW", "Kuwait", "Kuwait", "الكويت"],
    ["KG", "Quirguistão", "Kyrgyzstan", "Кыргызстан"],
    ["LA", "Laos", "Laos", "ປະເທດລາວ"],
    ["LV", "Letônia", "Latvia", "Latvija"],
    ["LB", "Líbano", "Lebanon", "لبنان"],
    ["LS", "Lesoto", "Lesotho", "Lesotho"],
    ["LR", "Libéria", "Liberia", "Liberia"],
    ["LI", "Liechtenstein", "Liechtenstein", "Liechtenstein"],
    ["LT", "Lituânia", "Lithuania", "Lietuva"],
    ["LU", "Luxemburgo", "Luxembourg", "Luxembourg"],
    ["MG", "Madagascar", "Madagascar", "Madagascar"],
    ["MW", "Malaui", "Malawi", "Malawi"],
    ["MY", "Malásia", "Malaysia", "Malaysia"],
    ["MV", "Maldivas", "Maldives", "ދިވެހި"],
    ["ML", "Mali", "Mali", "Mali"],
    ["MT", "Malta", "Malta", "Malta"],
    ["MH", "Ilhas Marshall", "Marshall Islands", "Marshall Islands"],
    ["MR", "Mauritânia", "Mauritania", "موريتانيا"],
    ["MU", "Maurício", "Mauritius", "Maurice"],
    ["MX", "México", "Mexico", "México"],
    ["FM", "Micronésia", "Micronesia", "Micronesia"],
    ["MD", "Moldávia", "Moldova", "Moldova"],
    ["MC", "Mônaco", "Monaco", "Monaco"],
    ["MN", "Mongólia", "Mongolia", "Монгол"],
    ["ME", "Montenegro", "Montenegro", "Crna Gora"],
    ["MA", "Marrocos", "Morocco", "المغرب"],
    ["MZ", "Moçambique", "Mozambique", "Moçambique"],
    ["MM", "Mianmar", "Myanmar", "မြန်မာ"],
    ["NA", "Namíbia", "Namibia", "Namibia"],
    ["NR", "Nauru", "Nauru", "Nauru"],
    ["NP", "Nepal", "Nepal", "नेपाल"],
    ["NL", "Países Baixos", "Netherlands", "Nederland"],
    ["NZ", "Nova Zelândia", "New Zealand", "New Zealand"],
    ["NI", "Nicarágua", "Nicaragua", "Nicaragua"],
    ["NE", "Níger", "Niger", "Niger"],
    ["NG", "Nigéria", "Nigeria", "Nigeria"],
    ["MK", "Macedônia do Norte", "North Macedonia", "Северна Македонија"],
    ["NO", "Noruega", "Norway", "Norge"],
    ["OM", "Omã", "Oman", "عُمان"],
    ["PK", "Paquistão", "Pakistan", "پاکستان"],
    ["PW", "Palau", "Palau", "Palau"],
    ["PS", "Palestina", "Palestine", "فلسطين"],
    ["PA", "Panamá", "Panama", "Panamá"],
    ["PG", "Papua-Nova Guiné", "Papua New Guinea", "Papua New Guinea"],
    ["PY", "Paraguai", "Paraguay", "Paraguay"],
    ["PE", "Peru", "Peru", "Perú"],
    ["PH", "Filipinas", "Philippines", "Pilipinas"],
    ["PL", "Polônia", "Poland", "Polska"],
    ["PT", "Portugal", "Portugal", "Portugal"],
    ["QA", "Catar", "Qatar", "قطر"],
    ["RO", "Romênia", "Romania", "România"],
    ["RU", "Rússia", "Russia", "Россия"],
    ["RW", "Ruanda", "Rwanda", "Ruanda"],
    ["KN", "São Cristóvão e Nevis", "Saint Kitts and Nevis", "Saint Kitts & Nevis"],
    ["LC", "Santa Lúcia", "Saint Lucia", "Saint Lucia"],
    ["VC", "São Vicente e Granadinas", "Saint Vincent and the Grenadines", "St. Vincent & Grenadines"],
    ["WS", "Samoa", "Samoa", "Samoa"],
    ["SM", "San Marino", "San Marino", "San Marino"],
    ["ST", "São Tomé e Príncipe", "São Tomé and Príncipe", "São Tomé e Príncipe"],
    ["SA", "Arábia Saudita", "Saudi Arabia", "السعودية"],
    ["SN", "Senegal", "Senegal", "Sénégal"],
    ["RS", "Sérvbia", "Serbia", "Србија"],
    ["SC", "Seicheles", "Seychelles", "Seychelles"],
    ["SL", "Serra Leão", "Sierra Leone", "Sierra Leone"],
    ["SG", "Singapura", "Singapore", "Singapore"],
    ["SK", "Eslováquia", "Slovakia", "Slovensko"],
    ["SI", "Eslovênia", "Slovenia", "Slovenija"],
    ["SB", "Ilhas Salomão", "Solomon Islands", "Solomon Islands"],
    ["SO", "Somália", "Somalia", "Soomaaliya"],
    ["ZA", "África do Sul", "South Africa", "South Africa"],
    ["SS", "Sudão do Sul", "South Sudan", "South Sudan"],
    ["ES", "Espanha", "Spain", "España"],
    ["LK", "Sri Lanka", "Sri Lanka", "ශ්‍රී ලංකා"],
    ["SD", "Sudão", "Sudan", "السودان"],
    ["SR", "Suriname", "Suriname", "Suriname"],
    ["SE", "Suécia", "Sweden", "Sverige"],
    ["CH", "Suíça", "Switzerland", "Schweiz"],
    ["SY", "Síria", "Syria", "سوريا"],
    ["TW", "Taiwan", "Taiwan", "台灣"],
    ["TJ", "Tajiquistão", "Tajikistan", "Тоҷикистон"],
    ["TZ", "Tanzânia", "Tanzania", "Tanzania"],
    ["TH", "Tailândia", "Thailand", "ประเทศไทย"],
    ["TL", "Timor-Leste", "Timor-Leste", "Timor-Leste"],
    ["TG", "Togo", "Togo", "Togo"],
    ["TO", "Tonga", "Tonga", "Tonga"],
    ["TT", "Trinidad e Tobago", "Trinidad and Tobago", "Trinidad & Tobago"],
    ["TN", "Tunísia", "Tunisia", "تونس"],
    ["TR", "Turquia", "Turkey", "Türkiye"],
    ["TM", "Turcomenistão", "Turkmenistan", "Türkmenistan"],
    ["TV", "Tuvalu", "Tuvalu", "Tuvalu"],
    ["UG", "Uganda", "Uganda", "Uganda"],
    ["UA", "Ucrânia", "Ukraine", "Україна"],
    ["AE", "Emirados Árabes Unidos", "United Arab Emirates", "الإمارات"],
    ["GB", "Reino Unido", "United Kingdom", "United Kingdom"],
    ["US", "Estados Unidos", "United States", "United States"],
    ["UY", "Uruguai", "Uruguay", "Uruguay"],
    ["UZ", "Uzbequistão", "Uzbekistan", "Oʻzbekiston"],
    ["VU", "Vanuatu", "Vanuatu", "Vanuatu"],
    ["VA", "Vaticano", "Vatican City", "Città del Vaticano"],
    ["VE", "Venezuela", "Venezuela", "Venezuela"],
    ["VN", "Vietnã", "Vietnam", "Việt Nam"],
    ["YE", "Iêmen", "Yemen", "اليمن"],
    ["ZM", "Zâmbia", "Zambia", "Zambia"],
    ["ZW", "Zimbábue", "Zimbabwe", "Zimbabwe"],
    ["XK", "Kosovo", "Kosovo", "Kosovë"],
    ["HK", "Hong Kong", "Hong Kong", "香港"],
    ["MO", "Macau", "Macau", "澳門"],
    ["PR", "Porto Rico", "Puerto Rico", "Puerto Rico"],
    ["GL", "Groenlândia", "Greenland", "Kalaallit Nunaat"],
    ["FO", "Ilhas Faroé", "Faroe Islands", "Føroyar"],
    ["BM", "Bermuda", "Bermuda", "Bermuda"]
  ];

  const COUNTRIES = RAW.map(function (r) {
    return { code: r[0], name: r[1], en: r[2], native: r[3] || r[1], flag: flagOf(r[0]) };
  });

  const byCode = {};
  COUNTRIES.forEach((c) => {
    byCode[c.code] = c;
  });

  /* ---------------- fusos IANA ---------------- */
  const ZONES = [
    { id: "America/Sao_Paulo", label: "Brasil · São Paulo" },
    { id: "America/Argentina/Buenos_Aires", label: "Argentina · Buenos Aires" },
    { id: "America/Santiago", label: "Chile · Santiago" },
    { id: "America/Bogota", label: "Colômbia · Bogotá" },
    { id: "America/Lima", label: "Peru · Lima" },
    { id: "America/Caracas", label: "Venezuela · Caracas" },
    { id: "America/Mexico_City", label: "México · Cidade do México" },
    { id: "America/Panama", label: "Panamá" },
    { id: "America/New_York", label: "Estados Unidos · Nova York" },
    { id: "America/Chicago", label: "Estados Unidos · Chicago" },
    { id: "America/Denver", label: "Estados Unidos · Denver" },
    { id: "America/Los_Angeles", label: "Estados Unidos · Los Angeles" },
    { id: "America/Toronto", label: "Canadá · Toronto" },
    { id: "America/Vancouver", label: "Canadá · Vancouver" },
    { id: "Atlantic/Reykjavik", label: "Islândia · Reykjavík" },
    { id: "Europe/Lisbon", label: "Portugal · Lisboa" },
    { id: "Europe/London", label: "Reino Unido · Londres" },
    { id: "Europe/Madrid", label: "Espanha · Madri" },
    { id: "Europe/Paris", label: "França · Paris" },
    { id: "Europe/Berlin", label: "Alemanha · Berlim" },
    { id: "Europe/Rome", label: "Itália · Roma" },
    { id: "Europe/Amsterdam", label: "Países Baixos · Amsterdã" },
    { id: "Europe/Prague", label: "Chéquia · Praga" },
    { id: "Europe/Warsaw", label: "Polônia · Varsóvia" },
    { id: "Europe/Athens", label: "Grécia · Atenas" },
    { id: "Europe/Helsinki", label: "Finlândia · Helsinque" },
    { id: "Europe/Stockholm", label: "Suécia · Estocolmo" },
    { id: "Europe/Oslo", label: "Noruega · Oslo" },
    { id: "Europe/Copenhagen", label: "Dinamarca · Copenhague" },
    { id: "Europe/Kyiv", label: "Ucrânia · Kiev" },
    { id: "Europe/Istanbul", label: "Turquia · Istambul" },
    { id: "Europe/Moscow", label: "Rússia · Moscou" },
    { id: "Africa/Cairo", label: "Egito · Cairo" },
    { id: "Africa/Lagos", label: "Nigéria · Lagos" },
    { id: "Africa/Johannesburg", label: "África do Sul · Joanesburgo" },
    { id: "Africa/Nairobi", label: "Quênia · Nairóbi" },
    { id: "Asia/Dubai", label: "Emirados · Dubai" },
    { id: "Asia/Karachi", label: "Paquistão · Karachi" },
    { id: "Asia/Kolkata", label: "Índia · Mumbai" },
    { id: "Asia/Bangkok", label: "Tailândia · Bangkok" },
    { id: "Asia/Jakarta", label: "Indonésia · Jacarta" },
    { id: "Asia/Singapore", label: "Singapura" },
    { id: "Asia/Hong_Kong", label: "Hong Kong" },
    { id: "Asia/Shanghai", label: "China · Xangai" },
    { id: "Asia/Taipei", label: "Taiwan · Taipé" },
    { id: "Asia/Manila", label: "Filipinas · Manila" },
    { id: "Asia/Seoul", label: "Coreia do Sul · Seul" },
    { id: "Asia/Tokyo", label: "Japão · Tóquio" },
    { id: "Australia/Perth", label: "Austrália · Perth" },
    { id: "Australia/Sydney", label: "Austrália · Sydney" },
    { id: "Pacific/Auckland", label: "Nova Zelândia · Auckland" },
    { id: "UTC", label: "UTC · horário universal" }
  ];

  const region = {};

  region.COUNTRIES = COUNTRIES;
  region.ZONES = ZONES;
  region.flagOf = flagOf;

  /* lista de países para o idioma da interface.
     pt-BR/pt-PT → nome em português; en → inglês;
     demais idiomas → NOME LOCAL (nome nativo do país). */
  region.countries = function (lang) {
    const code = lang || "pt-BR";
    return COUNTRIES.map(function (c) {
      return {
        code: c.code,
        name: region.labelFor(c, code),
        native: c.native,
        en: c.en,
        pt: c.name,
        flag: c.flag,
      };
    });
  };

  region.labelFor = function (c, lang) {
    if (!c) return "";
    if (lang === "en") return c.en || c.name;
    if (lang === "pt-BR" || lang === "pt-PT") return c.name;
    return c.native || c.name;
  };

  region.country = function (code) {
    if (!code) return null;
    return byCode[String(code).toUpperCase()] || null;
  };

  /* rótulo do país no idioma escolhido (pt-BR por padrão) */
  region.countryLabel = function (code, lang) {
    const c = region.country(code);
    if (!c) return "";
    return region.labelFor(c, lang || "pt-BR");
  };

  region.flagOfCode = function (code) {
    const c = region.country(code);
    return c ? c.flag : "";
  };

  /* busca: nome no idioma atual, nome local OU código ISO */
  region.find = function (query, lang) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return null;
    return (
      region.countries(lang).filter(function (c) {
        const base = region.country(c.code);
        return (
          c.code.toLowerCase() === q ||
          String(c.name).toLowerCase().indexOf(q) > -1 ||
          String(base.native).toLowerCase().indexOf(q) > -1 ||
          String(base.en).toLowerCase().indexOf(q) > -1 ||
          String(base.name).toLowerCase().indexOf(q) > -1
        );
      })[0] || null
    );
  };

  region.zone = function (id) {
    if (!id) return null;
    const raw = String(id);
    return (
      ZONES.filter((z) => z.id === raw)[0] || { id: raw, label: raw.replace(/_/g, " ") }
    );
  };

  region.isValidZone = function (id) {
    if (!id) return false;
    if (id === "UTC") return true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: id });
      return true;
    } catch (e) {
      return false;
    }
  };

  region.offsetMinutes = function (tz, at) {
    if (!tz) return 0;
    const d = at ? new Date(at) : new Date();
    try {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const p = {};
      dtf.formatToParts(d).forEach((x) => {
        p[x.type] = x.value;
      });
      const asUTC = Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day,
        +p.hour % 24,
        +p.minute,
        +p.second
      );
      return Math.round((asUTC - d.getTime()) / 60000);
    } catch (e) {
      return 0;
    }
  };

  region.offsetLabel = function (tz, at) {
    const m = region.offsetMinutes(tz, at);
    const sign = m < 0 ? "-" : "+";
    const abs = Math.abs(m);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return "UTC" + sign + hh + ":" + mm;
  };

  region.zoneLabel = function (id, at) {
    return region.zone(id).label + " · " + region.offsetLabel(id, at);
  };

  region.fmtHM = function (ts, tz, locale) {
    /* formato fixo: HH:mm (24h) */
    const hourOpts = { hour: "2-digit", minute: "2-digit", hour12: false };
    try {
      return new Intl.DateTimeFormat(locale || "pt-BR", Object.assign({ timeZone: region.isValidZone(tz) ? tz : undefined }, hourOpts)).format(new Date(ts));
    } catch (e) {
      const d = new Date(ts);
      const mm = String(d.getMinutes()).padStart(2, "0");
      return String(d.getHours()).padStart(2, "0") + ":" + mm;
    }
  };

  region.fmt = function (ts, tz, opts, locale) {
    const o = Object.assign({}, opts || {});
    if (region.isValidZone(tz)) o.timeZone = tz;
    try {
      return new Intl.DateTimeFormat(locale || "pt-BR", o).format(new Date(ts));
    } catch (e) {
      return new Date(ts).toLocaleString(locale || "pt-BR", opts);
    }
  };

  region.dayParts = function (ts, tz) {
    const d = new Date(ts);
    if (!region.isValidZone(tz)) {
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
    }
    try {
      const dtf = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const p = {};
      dtf.formatToParts(d).forEach((x) => {
        p[x.type] = x.value;
      });
      return { y: +p.year, m: +p.month, d: +p.day };
    } catch (e) {
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
    }
  };

  /* detecta o fuso do PRÓPRIO navegador (sem rede, sem GPS).
      O idioma NÃO é detectado: o Nexo é somente pt-BR. */
  region.detect = function () {
    const out = { timezone: "America/Sao_Paulo", language: "pt-BR" };
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (region.isValidZone(tz)) out.timezone = tz;
    } catch (e) {
      /* mantém o padrão */
    }
    return out;
  };

  region.ensureZone = function (id) {
    if (!id || !region.isValidZone(id)) return;
    if (ZONES.some((z) => z.id === id)) return;
    ZONES.push({ id: id, label: id.replace(/_/g, " ") });
  };

  NX.region = region;
})(window.NX);
