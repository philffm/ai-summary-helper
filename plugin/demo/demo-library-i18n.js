// Localized reading history and feeds for the in-site demo (and the social videos), plus the topic names in each language.
// Loaded after demo-content.js / demo-i18n.js and before demo-shim.js; picks ?lang=… and falls back to English.
//
// - library: the English entries in demo-content.js keep their tags, dates and lengths; only the titles are translated
//   here (same order). EXTRAS adds real studies (original English titles, as they would sit in a real library) and a
//   few light-hearted pieces with made-up `.example` sources.
// - feeds: the same subscriptions and items, translated.
// - TOPICS: the learned topic lexicon (topicConcepts.js / topicLexicon.js) for the demo's tags, so History and the graph
//   show "Lesen" / "読書" / "Lectura" instead of a mix of translated built-in topics and raw English tags. Tags stay
//   English keys in the data, exactly as the extension stores them.
(function () {
  const D = window.AISH_DEMO;
  if (!D) return;
  const lang = new URLSearchParams(location.search).get('lang') || 'en';

  const TOPICS = {
    software: { en: 'Software', de: 'Software', es: 'Software', ja: 'ソフトウェア' , ko: '소프트웨어' },
    privacy: { en: 'Privacy', de: 'Datenschutz', es: 'Privacidad', ja: 'プライバシー' , ko: '개인정보' },
    'local-first': { en: 'Local-first', de: 'Local-first', es: 'Local-first', ja: 'ローカルファースト' , ko: '로컬 퍼스트' },
    ai: { en: 'AI', de: 'KI', es: 'IA', ja: 'AI' , ko: 'AI' },
    energy: { en: 'Energy', de: 'Energie', es: 'Energía', ja: 'エネルギー' , ko: '에너지' },
    memory: { en: 'Memory', de: 'Gedächtnis', es: 'Memoria', ja: '記憶' , ko: '기억' },
    web: { en: 'Web', de: 'Web', es: 'Web', ja: 'ウェブ' , ko: '웹' },
    media: { en: 'Media', de: 'Medien', es: 'Medios', ja: 'メディア' , ko: '미디어' },
    reading: { en: 'Reading', de: 'Lesen', es: 'Lectura', ja: '読書' , ko: '독서' },
    policy: { en: 'Policy', de: 'Regulierung', es: 'Regulación', ja: '規制' , ko: '규제' },
    law: { en: 'Law', de: 'Recht', es: 'Derecho', ja: '法律' , ko: '법' },
    llm: { en: 'LLM', de: 'LLM', es: 'LLM', ja: 'LLM' , ko: 'LLM' },
    ux: { en: 'UX', de: 'UX', es: 'UX', ja: 'UX' , ko: 'UX' },
    productivity: { en: 'Productivity', de: 'Produktivität', es: 'Productividad', ja: '生産性' , ko: '생산성' },
    notes: { en: 'Notes', de: 'Notizen', es: 'Notas', ja: 'ノート' , ko: '노트' },
    engineering: { en: 'Engineering', de: 'Softwaretechnik', es: 'Ingeniería', ja: 'エンジニアリング' , ko: '엔지니어링' },
    cities: { en: 'Cities', de: 'Städte', es: 'Ciudades', ja: '都市' , ko: '도시' },
    knowledge: { en: 'Knowledge', de: 'Wissen', es: 'Conocimiento', ja: 'ナレッジ' , ko: '지식' },
    humor: { en: 'Humor', de: 'Humor', es: 'Humor', ja: 'ユーモア' , ko: '유머' },
    work: { en: 'Work', de: 'Arbeit', es: 'Trabajo', ja: '仕事' , ko: '일' },
  };

  // Titles of demo-content.js's library, in the same order.
  const TITLES = {
    de: [
      'Warum Local-first-Software immer wiederkommt', 'Was eine einzige KI-Anfrage an Energie kostet', 'Wie Schlaf das Gedächtnis festigt',
      'Eine kurze Geschichte des RSS-Feeds', 'Wie ein faires Datenteilungsgesetz aussehen würde', 'Kleine Sprachmodelle holen auf',
      'Wärmepumpen: die Zahlen hinter dem Hype', 'Interface-Design für langsame Aufmerksamkeit', 'Inflation, ohne Fachchinesisch erklärt',
      'Warum deine Notiz-App nie hängen bleibt', 'Ein Plädoyer für langweilige Technik', 'Open-Source-Modelle und das Lizenzproblem',
      'Städte, die Bäume pflanzten und kühler wurden', 'Lesen am Bildschirm vs. auf Papier, neu betrachtet', 'Wie Browser entscheiden, was sie cachen',
      'Schrumpft unsere Aufmerksamkeit wirklich?', 'Datenschutz-Labels: Funktionieren sie?', 'Eine sanfte Einführung in Embeddings',
      'Was die Vier-Tage-Woche Arbeitgebern gezeigt hat', 'Warum Zinsen auch Mieter betreffen', 'Das Manifest für ein langsames Web',
      'Netzbatterien sind endlich günstig', 'Zusammenfassungen schreiben, denen man vertraut', 'Zettelkasten für Leute, die Regeln hassen',
      'Was zählt im Browser als personenbezogene Daten?', 'Lokale Modelle auf dem Laptop: ein Erfahrungsbericht', 'Dein Lesen kartieren: Ideen, die sich verbinden',
    ],
    es: [
      'Por qué el software local-first siempre vuelve', 'El coste energético de una sola consulta a la IA', 'Cómo el sueño consolida la memoria',
      'Una breve historia del RSS', 'Cómo sería una ley justa para compartir datos', 'Los modelos de lenguaje pequeños se ponen al día',
      'Bombas de calor: las cifras detrás del bombo', 'Diseño de interfaces para la atención lenta', 'La inflación, explicada sin jerga',
      'Por qué tu app de notas nunca cuaja', 'En defensa de la tecnología aburrida', 'Los modelos de código abierto y el problema de las licencias',
      'Ciudades que plantaron árboles y se refrescaron', 'Leer en pantalla o en papel, otra vez', 'Cómo deciden los navegadores qué guardar en caché',
      '¿De verdad se está reduciendo la atención?', 'Etiquetas de privacidad: ¿funcionan?', 'Una introducción amable a los embeddings',
      'Lo que la semana de cuatro días enseñó a las empresas', 'Por qué los tipos de interés afectan a quien alquila', 'El manifiesto de la web lenta',
      'Las baterías para la red por fin son baratas', 'Escribir resúmenes en los que la gente confíe', 'Zettelkasten para quien odia las reglas',
      '¿Qué cuenta como dato personal en un navegador?', 'Modelos locales en un portátil: un informe de campo', 'Mapear tus lecturas: ideas que se conectan',
    ],
    ja: [
      'ローカルファーストなソフトウェアが何度も戻ってくる理由', 'AIへの1回の質問にかかるエネルギー', '睡眠が記憶を定着させる仕組み',
      'RSSフィードの短い歴史', '公正なデータ共有法とはどんなものか', '小さな言語モデルが追い上げている',
      'ヒートポンプ：話題の裏にある数字', 'ゆっくりした注意のためのインターフェース設計', '専門用語なしで分かるインフレ',
      'メモアプリが続かない理由', '退屈な技術を選ぶべき理由', 'オープンソースモデルとライセンス問題',
      '木を植えて涼しくなった都市', '画面で読むか、紙で読むか（再考）', 'ブラウザは何をキャッシュするのか',
      '集中力は本当に短くなっているのか', 'プライバシーラベルは機能しているか', 'やさしい埋め込み（Embedding）入門',
      '週休3日制が企業に教えたこと', '金利が賃貸暮らしに関係する理由', 'スローウェブ宣言',
      '系統用蓄電池がついに安くなった', '信頼される要約の書き方', 'ルール嫌いのためのZettelkasten',
      'ブラウザで「個人データ」に当たるものは？', 'ノートPCでローカルモデル：使ってみた記録', '読書をマッピングする：つながるアイデア',
    ],
    ko: [
      '로컬 퍼스트 소프트웨어가 계속 돌아오는 이유',
      'AI 질문 한 번에 드는 에너지',
      '수면은 기억을 어떻게 굳힐까',
      'RSS 피드의 짧은 역사',
      '공정한 데이터 공유법은 어떤 모습일까',
      '작은 언어 모델이 따라잡고 있다',
      '히트펌프: 화제 뒤의 숫자',
      '느린 집중을 위한 인터페이스 디자인',
      '전문 용어 없이 설명한 인플레이션',
      '메모 앱이 늘 오래가지 못하는 이유',
      '지루한 기술을 위한 변론',
      '오픈소스 모델과 라이선스 문제',
      '나무를 심어 시원해진 도시들',
      '화면으로 읽기 vs 종이로 읽기, 다시 보기',
      '브라우저는 무엇을 캐시할까',
      '집중력은 정말 줄어들고 있을까?',
      '개인정보 라벨, 효과가 있을까?',
      '임베딩 쉽게 이해하기',
      '주 4일제가 기업에 알려준 것',
      '금리가 세입자에게 중요한 이유',
      '슬로 웹 선언',
      '계통용 배터리가 드디어 싸졌다',
      '사람들이 믿는 요약 쓰기',
      '규칙이 싫은 사람을 위한 제텔카스텐',
      '브라우저에서 개인 데이터란 무엇일까?',
      '노트북에서 로컬 모델 써 보기',
      '독서를 지도로 그리기: 이어지는 아이디어',
    ],
  };

  // Real studies (the ones the videos cite, CONTENT_PLAN.md) and a few light-hearted pieces. `title` per language;
  // a plain string is the same everywhere (papers keep their original title).
  const EXTRAS = [
    { title: 'Cognitive load during problem solving: Effects on learning', host: 'onlinelibrary.wiley.com', tags: ['science', 'memory', 'reading'], mood: 0.1, words: 9800, daysAgo: 8, hour: 21 },
    { title: 'Eye movement patterns in natural reading: A comparison of monolingual and bilingual reading of a novel', host: 'journals.plos.org', tags: ['science', 'reading'], mood: 0.2, words: 8700, daysAgo: 14, hour: 20 },
    { title: 'Learning with concept and knowledge maps: A meta-analysis', host: 'journals.sagepub.com', tags: ['science', 'knowledge', 'notes'], mood: 0.3, words: 11200, daysAgo: 17, hour: 9 },
    { title: 'Positive display polarity is advantageous for both younger and older adults', host: 'tandfonline.com', tags: ['science', 'design', 'reading'], mood: 0.2, words: 6900, daysAgo: 22, hour: 10 },
    { title: 'Lateral reading and the nature of expertise: Reading less and learning more when evaluating digital information', host: 'journals.sagepub.com', tags: ['media', 'reading', 'science'], mood: 0.1, words: 12500, daysAgo: 26, hour: 19 },
    {
      title: {
        en: 'Why the printer only jams right before a deadline', de: 'Warum der Drucker immer kurz vor der Abgabe streikt',
        es: 'Por qué la impresora solo se atasca justo antes de una entrega', ja: '締め切り直前に限ってプリンターが詰まる理由', ko: '마감 직전에만 프린터가 멈추는 이유',
      },
      host: 'officelife.example', tags: ['humor', 'work', 'productivity'], mood: 0.6, words: 900, daysAgo: 0, hour: 9,
    },
    {
      title: {
        en: 'I tried to read all 100 open tabs in one weekend', de: 'Ich habe versucht, 100 offene Tabs an einem Wochenende zu lesen',
        es: 'Intenté leer mis 100 pestañas abiertas en un fin de semana', ja: '開きっぱなしのタブ100個を週末で全部読んでみた', ko: '열어 둔 탭 100개를 주말에 다 읽어 봤다',
      },
      host: 'tabhoarders.example', tags: ['humor', 'reading', 'productivity'], mood: 0.5, words: 1600, daysAgo: 2, hour: 22,
    },
    {
      title: {
        en: 'The secret life of your read-later list', de: 'Das heimliche Leben deiner Später-lesen-Liste',
        es: 'La vida secreta de tu lista de «leer más tarde»', ja: '「あとで読む」リストの知られざる一生', ko: '‘나중에 읽기’ 목록의 숨겨진 일생',
      },
      host: 'readinglog.example', tags: ['humor', 'reading', 'notes'], mood: 0.4, words: 1200, daysAgo: 5, hour: 23,
    },
    {
      title: {
        en: 'A field guide to meetings that could have been an email', de: 'Bestimmungsbuch für Meetings, die eine Mail hätten sein können',
        es: 'Guía de campo de reuniones que pudieron ser un correo', ja: 'メールで済んだはずの会議・図鑑', ko: '메일로 끝났어야 할 회의 도감',
      },
      host: 'officelife.example', tags: ['humor', 'work'], mood: 0.5, words: 1100, daysAgo: 9, hour: 15,
    },
    {
      title: {
        en: 'How long an article fits into a packed commuter train', de: 'Wie lang ein Artikel sein darf, der in den vollen Pendlerzug passt',
        es: 'Cuánto artículo cabe en un tren de cercanías lleno', ja: '満員電車で読める記事の長さを測ってみた', ko: '만원 지하철에서 읽을 수 있는 글의 길이',
      },
      host: 'commute.example', tags: ['humor', 'reading', 'cities'], mood: 0.4, words: 1300, daysAgo: 12, hour: 8,
    },
  ];

  const FEEDS = {
    de: {
      subs: ['Technik-Notizen', 'Der Local-first-Brief', 'Klima-Desk', 'Gestaltung heute', 'Politik-Briefing', 'Hirn & Schlaf'],
      items: [
        ['Ein Browser, der auf deinem eigenen Rechner zusammenfasst', 'Warum Modelle auf dem Gerät für das meiste Lesen reichen, und wo sie noch scheitern.'],
        ['Sync ohne Server: CRDTs in einfachen Worten', 'Ein Rundgang durch die Ideen hinter Apps, die offline weiterlaufen und später zusammenführen.'],
        ['Wärmepumpen haben Gasheizungen wieder überholt', 'Neue Zahlen zeigen: Der Wandel ist in neun Ländern schneller als vorhergesagt.'],
        ['Typografie für Schnell-Leser', 'Was sich am Layout ändert, wenn die meisten erst überfliegen und dann lesen.'],
        ['Das Recht auf Datenübertragbarkeit, ein Jahr später', 'Wer es wirklich genutzt hat, und wie Unternehmen es erschwert haben.'],
        ['Warum ein Nickerchen beim Lernen hilft', 'Eine kleine Studie stützt: Kurze Pausen festigen neuen Stoff.'],
        ['Offene Gewichte, geschlossene Daten', 'Die Lizenzlücke zwischen veröffentlichten Modellen und ihren Trainingsdaten.'],
        ['Local-first-Apps brauchen ein besseres Onboarding', 'Sechs Muster, die erklären, warum Leute in der ersten Woche abspringen.'],
        ['Städte mit Bäumen kühlen: was die Zahlen sagen', 'Wo das Blätterdach dicht ist, sinkt die Temperatur auf Straßenhöhe um mehrere Grad.'],
        ['Dark Mode ist mehr als invertierte Farben', 'Kontrast, Ebenen und die Farben, die nachts nicht mehr funktionieren.'],
        ['Was die neuen Tracking-Regeln für Browser ändern', 'Eine einfache Zusammenfassung der Einwilligungspflichten ab nächstem Monat.'],
        ['Lesetempo und Verständnis, neu betrachtet', 'Schneller ist nicht immer schlechter, aber es kommt auf den Text an.'],
        ['Ein Bestimmungsbuch für kleine Sprachmodelle', 'Welche auf dem Laptop laufen, und welche Aufgaben sie gut können.'],
        ['Batterien werden wieder günstiger', 'Netzspeicher wurde dieses Jahr erneut zweistellig billiger.'],
        ['Ein Plädoyer für weniger Einstellungen', 'Jede Option ist eine Entscheidung, die du den Nutzern überlässt: wann sich das lohnt.'],
        ['Verschlüsselte Notizen, die man trotzdem durchsuchen kann', 'Wie man private Texte durchsucht, ohne sie irgendwohin zu schicken.'],
        ['Öffentliches Geld, öffentlicher Code', 'Kurz begründet: Open Source als Pflicht bei öffentlichen Aufträgen.'],
        ['Die Aufmerksamkeitsökonomie des Arbeitswegs', 'Was Menschen auf dem Weg zur Arbeit lesen, und wie lange sie dranbleiben.'],
      ],
    },
    es: {
      subs: ['Notas de Tecnología', 'La Carta Local-First', 'Mesa del Clima', 'Notas de Diseño', 'Revista de Políticas', 'Diario del Cerebro'],
      items: [
        ['Un navegador que resume en tu propio equipo', 'Por qué los modelos en el dispositivo bastan para casi toda la lectura, y dónde aún fallan.'],
        ['Sincronizar sin servidor: los CRDT en palabras sencillas', 'Un recorrido por las ideas detrás de las apps que funcionan sin conexión y se fusionan después.'],
        ['Las bombas de calor vuelven a superar a las calderas de gas', 'Nuevas cifras muestran que el cambio va más rápido de lo previsto en nueve países.'],
        ['Tipografía para quien lee rápido', 'Qué cambia en el diseño cuando la mayoría primero hojea y luego lee.'],
        ['El derecho a la portabilidad de datos, un año después', 'Quién lo usó de verdad y qué hicieron las empresas para ponerlo difícil.'],
        ['Por qué una siesta ayuda a aprender', 'Un pequeño ensayo suma pruebas de que los descansos cortos fijan lo aprendido.'],
        ['Pesos abiertos, datos cerrados', 'La brecha de licencias entre los modelos publicados y los datos que hay detrás.'],
        ['Las apps local-first necesitan un mejor onboarding', 'Seis patrones que explican por qué la gente las abandona en la primera semana.'],
        ['Refrescar ciudades con árboles: lo que dicen las cifras', 'Donde la copa es densa, la temperatura a pie de calle baja varios grados.'],
        ['El modo oscuro no es solo invertir colores', 'Contraste, elevación y los colores que dejan de funcionar de noche.'],
        ['Qué cambian las nuevas reglas de rastreo en el navegador', 'Un resumen sencillo de los requisitos de consentimiento que llegan el mes que viene.'],
        ['Velocidad de lectura y comprensión, otra vez', 'Más rápido no siempre es peor, pero depende del texto.'],
        ['Guía de campo de los modelos de lenguaje pequeños', 'Cuáles funcionan en un portátil y qué tareas hacen bien.'],
        ['Las baterías vuelven a abaratarse', 'El almacenamiento a escala de red bajó otro porcentaje de dos cifras este año.'],
        ['En defensa de menos ajustes', 'Cada opción es una decisión que le pasas al usuario: cuándo vale la pena.'],
        ['Notas cifradas en las que sí puedes buscar', 'Técnicas para buscar en textos privados sin enviarlos a ninguna parte.'],
        ['Dinero público, código público', 'Un breve argumento a favor de exigir código abierto en los contratos públicos.'],
        ['La economía de la atención del trayecto al trabajo', 'Qué lee la gente camino del trabajo y cuánto tiempo se queda.'],
      ],
    },
    ja: {
      subs: ['テック週報', 'ローカルファースト通信', '気候デスク', 'デザインノート', '政策レビュー', '脳と睡眠ジャーナル'],
      items: [
        ['自分のPCで要約するブラウザ', 'オンデバイスのモデルで、ほとんどの読書には十分な理由と、まだ足りない点。'],
        ['サーバーなしの同期：CRDTをやさしく解説', 'オフラインでも動き、あとで統合できるアプリの考え方を紹介。'],
        ['ヒートポンプが再びガスボイラーを上回る', '新しいデータでは、9か国で予測より速く移行が進んでいる。'],
        ['速く読む人のためのタイポグラフィ', '多くの人が「まず流し読み、次に精読」するとき、レイアウトはどう変わるか。'],
        ['データポータビリティ規則、1年後', '実際に誰が使い、企業はそれをどう難しくしたのか。'],
        ['昼寝が学習に効く理由', '短い休憩が新しい知識を定着させる、という証拠を小規模な試験が補強。'],
        ['公開された重み、非公開のデータ', 'モデル公開と学習データのあいだにあるライセンスの溝。'],
        ['ローカルファーストアプリにはもっと良いオンボーディングを', '最初の1週間で離脱される理由を説明する6つのパターン。'],
        ['木で都市を冷やす：数字が示すこと', '樹冠が密な場所では、路面付近の気温が数度下がる。'],
        ['ダークモードは色の反転ではない', 'コントラスト、奥行き、そして夜に機能しなくなる色。'],
        ['ブラウザの新しいトラッキング規則で何が変わるか', '来月から始まる同意要件をやさしくまとめました。'],
        ['読む速さと理解度、あらためて', '速いことが常に悪いわけではない。ただし文章次第。'],
        ['小さな言語モデル・フィールドガイド', 'ノートPCで動くのはどれか、得意な作業は何か。'],
        ['蓄電池がまた安くなった', '系統規模の蓄電コストは今年も2桁％下がった。'],
        ['設定は少ないほうがいい', 'すべての選択肢はユーザーに委ねる判断。それが見合うのはいつか。'],
        ['検索できる暗号化メモ', '個人的な文章を、どこにも送らずに検索する技術。'],
        ['公共のお金には公共のコードを', '公共調達でオープンソースを求めるべき理由を手短に。'],
        ['通勤時間のアテンションエコノミー', '人は通勤中に何を読み、どれくらい読み続けるのか。'],
      ],
    },
    ko: {
      subs: ['테크 노트', '로컬 퍼스트 레터', '기후 데스크', '디자인 노트', '정책 리뷰', '뇌와 수면 저널'],
      items: [
        ['내 컴퓨터에서 요약하는 브라우저', '대부분의 읽기에는 기기 내 모델로 충분한 이유, 그리고 아직 부족한 점.'],
        ['서버 없는 동기화: CRDT 쉽게 설명', '오프라인에서도 동작하고 나중에 합쳐지는 앱의 아이디어를 소개합니다.'],
        ['히트펌프가 다시 가스보일러를 앞질렀다', '새 수치에 따르면 9개국에서 예상보다 빠르게 전환이 진행 중입니다.'],
        ['빨리 읽는 사람을 위한 타이포그래피', '대부분이 먼저 훑어보고 나중에 읽을 때 레이아웃은 무엇이 달라질까.'],
        ['데이터 이동권 규정, 1년 후', '실제로 누가 썼고, 기업은 이를 어떻게 어렵게 만들었나.'],
        ['낮잠이 학습에 도움이 되는 이유', '짧은 휴식이 새로운 내용을 굳힌다는 근거를 작은 실험이 더합니다.'],
        ['공개된 가중치, 비공개 데이터', '모델 공개와 그 뒤의 데이터셋 사이에 있는 라이선스 공백.'],
        ['로컬 퍼스트 앱에는 더 나은 온보딩이 필요하다', '첫 주에 사용자가 떠나는 이유를 설명하는 여섯 가지 패턴.'],
        ['나무로 도시 식히기: 숫자가 말하는 것', '나무 그늘이 촘촘한 곳에서는 거리 온도가 몇 도 내려갑니다.'],
        ['다크 모드는 색 반전이 아니다', '대비, 깊이, 그리고 밤에 제대로 보이지 않는 색들.'],
        ['새 브라우저 추적 규정으로 바뀌는 것', '다음 달부터 시행되는 동의 요건을 쉽게 정리했습니다.'],
        ['읽기 속도와 이해도, 다시 보기', '빠르다고 항상 나쁜 건 아니지만, 글에 따라 다릅니다.'],
        ['작은 언어 모델 현장 가이드', '노트북에서 돌아가는 모델과 잘하는 일.'],
        ['배터리가 또 싸지고 있다', '계통 규모 저장 비용이 올해도 두 자릿수 퍼센트 떨어졌습니다.'],
        ['설정은 적을수록 좋다', '모든 옵션은 사용자에게 넘기는 결정입니다. 그만한 가치가 있을 때는 언제일까.'],
        ['검색할 수 있는 암호화 메모', '개인적인 글을 어디에도 보내지 않고 검색하는 기술.'],
        ['공공의 돈에는 공공의 코드를', '공공 계약에 오픈소스를 요구해야 하는 이유를 짧게 정리했습니다.'],
        ['출근길의 주목 경제', '사람들은 출근길에 무엇을 읽고, 얼마나 오래 머무를까.'],
      ],
    },
  };

  // The lexicon is the same for every language (it maps each tag to all its labels); seeded by demo-shim.js.
  D.topicLexicon = Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, { ...v }]));

  // The recorded "✨ Recap" briefing of a feed day (demo-shim.js answers the recap prompt with it).
  const RECAPS = {
    en: {
      overview: 'Local AI and offline-first apps lead the day, while clean energy keeps getting cheaper: heat pumps outsold gas boilers again and grid batteries dropped in price. Designers argue for fewer settings and calmer reading.',
      themes: ['On-device models are good enough for most reading (Hacker Noon Weekly)', 'Heat pumps and cheaper batteries (Climate Desk)', 'Why local-first apps lose people in week one (The Local-First Letter)', 'The data-portability rule, one year on (Policy Review)'],
      mood: 'positive',
    },
    de: {
      overview: 'Lokale KI und Offline-first-Apps prägen den Tag, saubere Energie wird weiter billiger: Wärmepumpen haben Gasheizungen wieder überholt, Netzbatterien sind günstiger geworden. Designer plädieren für weniger Einstellungen und ruhigeres Lesen.',
      themes: ['Modelle auf dem Gerät reichen fürs meiste Lesen (Technik-Notizen)', 'Wärmepumpen und günstigere Batterien (Klima-Desk)', 'Warum Local-first-Apps in Woche eins Nutzer verlieren (Der Local-first-Brief)', 'Das Recht auf Datenübertragbarkeit, ein Jahr später (Politik-Briefing)'],
      mood: 'positive',
    },
    es: {
      overview: 'La IA local y las apps que funcionan sin conexión marcan el día, mientras la energía limpia sigue abaratándose: las bombas de calor vuelven a superar a las calderas de gas y las baterías para la red bajan de precio. Los diseñadores piden menos ajustes y una lectura más tranquila.',
      themes: ['Los modelos en el dispositivo bastan para casi toda la lectura (Notas de Tecnología)', 'Bombas de calor y baterías más baratas (Mesa del Clima)', 'Por qué las apps local-first pierden usuarios en la primera semana (La Carta Local-First)', 'El derecho a la portabilidad de datos, un año después (Revista de Políticas)'],
      mood: 'positive',
    },
    ja: {
      overview: '今日はローカルAIとオフライン対応アプリが中心。クリーンエネルギーも安くなり続けています。ヒートポンプが再びガスボイラーを上回り、系統用蓄電池も値下がりしました。デザイナーは設定を減らし、落ち着いて読める画面を提案しています。',
      themes: ['オンデバイスのモデルで、ほとんどの読書には十分（テック週報）', 'ヒートポンプと安くなる蓄電池（気候デスク）', 'ローカルファーストアプリが最初の週に離脱される理由（ローカルファースト通信）', 'データポータビリティ規則、1年後（政策レビュー）'],
      mood: 'positive',
    },
    ko: {
      overview: '오늘은 로컬 AI와 오프라인 우선 앱이 중심입니다. 청정에너지는 계속 저렴해지고 있습니다. 히트펌프가 다시 가스보일러를 앞질렀고, 계통용 배터리 가격도 내려갔습니다. 디자이너들은 설정을 줄이고 차분하게 읽을 수 있는 화면을 제안합니다.',
      themes: ['기기 내 모델로 대부분의 읽기에는 충분 (테크 노트)', '히트펌프와 더 싸진 배터리 (기후 데스크)', '로컬 퍼스트 앱이 첫 주에 사용자를 잃는 이유 (로컬 퍼스트 레터)', '데이터 이동권 규정, 1년 후 (정책 리뷰)'],
      mood: 'positive',
    },
  };
  D.feedRecap = RECAPS[lang] || RECAPS.en;

  // The recorded "✨ Brief me on this topic" answer in the graph (topic "Reading"); {n} becomes a citation [n].
  const BRIEFINGS = {
    en: [
      '- Attention is not simply shrinking: people skim first and then decide what earns a full read {1} {2}',
      '- Screen or paper matters less than layout and contrast; dark text on a light background reads better {3} {4}',
      '- Checking who is behind a source beats reading one page very closely {5}',
      '- Notes stick when ideas are connected, not filed away in lists {6} {7}',
      '- And no: nobody reads all 100 open tabs {8}',
    ],
    de: [
      '- Aufmerksamkeit schrumpft nicht einfach: Wir überfliegen zuerst und entscheiden dann, was sich ganz lohnt {1} {2}',
      '- Bildschirm oder Papier ist weniger wichtig als Layout und Kontrast; dunkle Schrift auf hellem Grund liest sich besser {3} {4}',
      '- Zu prüfen, wer hinter einer Quelle steckt, bringt mehr als eine Seite sehr genau zu lesen {5}',
      '- Notizen bleiben hängen, wenn Ideen verbunden sind, nicht wenn sie in Listen landen {6} {7}',
      '- Und nein: Niemand liest alle 100 offenen Tabs {8}',
    ],
    es: [
      '- La atención no se reduce sin más: primero hojeamos y luego decidimos qué merece una lectura completa {1} {2}',
      '- Pantalla o papel importa menos que el diseño y el contraste; el texto oscuro sobre fondo claro se lee mejor {3} {4}',
      '- Comprobar quién está detrás de una fuente sirve más que leer una página con lupa {5}',
      '- Las notas se recuerdan cuando las ideas están conectadas, no archivadas en listas {6} {7}',
      '- Y no: nadie lee las 100 pestañas abiertas {8}',
    ],
    ja: [
      '- 集中力は単純に短くなっているわけではない。まず流し読みし、じっくり読む価値があるかを決めている {1} {2}',
      '- 画面か紙かより、レイアウトとコントラストが重要。明るい背景に暗い文字の方が読みやすい {3} {4}',
      '- 1ページを精読するより、情報源の背後に誰がいるかを確かめる方が効果的 {5}',
      '- メモが定着するのは、リストに整理したときではなく、アイデア同士がつながったとき {6} {7}',
      '- そして、開いたタブ100個を全部読む人はいない {8}',
    ],
    ko: [
      '- 집중력이 단순히 줄어드는 것은 아니다. 먼저 훑어보고, 끝까지 읽을 가치가 있는지 결정한다 {1} {2}',
      '- 화면이냐 종이냐보다 레이아웃과 대비가 중요하다. 밝은 배경의 어두운 글자가 더 잘 읽힌다 {3} {4}',
      '- 한 페이지를 꼼꼼히 읽는 것보다 출처 뒤에 누가 있는지 확인하는 편이 낫다 {5}',
      '- 메모는 목록에 정리할 때가 아니라 아이디어끼리 이어질 때 기억에 남는다 {6} {7}',
      '- 그리고 아니요, 열어 둔 탭 100개를 다 읽는 사람은 없다 {8}',
    ],
  };
  D.topicBriefing = BRIEFINGS[lang] || BRIEFINGS.en;

  // The summary of the demo article with tone "casual" + "Standup humor" + "Emojis & hashtags" (prompts video).
  const FUN = {
    en: {
      stream: 'Long reads are back, baby. After ten years of headline snacking, readers want the whole meal again.',
      html: '<h3>🎤 The long read’s comeback tour</h3><ul><li><strong>Long-form is back.</strong> The longest articles now get the most time on page. Plot twist of the decade 📈</li><li><strong>Readers want context</strong>, not one more headline that starts with “You won’t believe…”</li><li><strong>Time is the bouncer.</strong> Summaries decide who gets into the club of full reads 🚪</li></ul><p>🎙️ <em>Standup take:</em> “I have 100 tabs open. Not to read them. It’s a museum.”</p><p>#longreads #slowweb #tabhoarder</p>',
    },
    de: {
      stream: 'Lange Texte sind zurück, Baby. Nach zehn Jahren Schlagzeilen-Snacks wollen Leser wieder das ganze Menü.',
      html: '<h3>🎤 Die Comeback-Tour des Longreads</h3><ul><li><strong>Long-Form ist zurück.</strong> Die längsten Artikel bekommen jetzt die meiste Lesezeit. Plot-Twist des Jahrzehnts 📈</li><li><strong>Leser wollen Kontext</strong>, nicht noch eine Schlagzeile, die mit „Du wirst nicht glauben…“ anfängt</li><li><strong>Zeit ist der Türsteher.</strong> Zusammenfassungen entscheiden, wer in den Club der ganzen Texte kommt 🚪</li></ul><p>🎙️ <em>Standup-Take:</em> „Ich hab 100 Tabs offen. Nicht zum Lesen. Das ist ein Museum.“</p><p>#longreads #slowweb #tabsammler</p>',
    },
    es: {
      stream: 'La lectura larga ha vuelto. Tras diez años picoteando titulares, los lectores quieren el menú completo.',
      html: '<h3>🎤 La gira de regreso de la lectura larga</h3><ul><li><strong>Lo largo vuelve.</strong> Los artículos más largos se llevan ahora más tiempo de lectura. Giro de guion de la década 📈</li><li><strong>Los lectores quieren contexto</strong>, no otro titular que empiece con “No vas a creer…”</li><li><strong>El tiempo es el portero.</strong> Los resúmenes deciden quién entra al club de las lecturas completas 🚪</li></ul><p>🎙️ <em>Versión monólogo:</em> “Tengo 100 pestañas abiertas. No para leerlas. Es un museo.”</p><p>#lecturalarga #webslow #coleccionistadepestañas</p>',
    },
    ja: {
      stream: 'ロングリード、まさかの復活。10年間見出しをつまみ食いしてきた読者が、またフルコースを求めています。',
      html: '<h3>🎤 ロングリード復活ツアー</h3><ul><li><strong>長文が戻ってきた。</strong>いちばん長い記事が、いちばん長く読まれる時代に。10年に一度のどんでん返し 📈</li><li><strong>読者が欲しいのは文脈</strong>。「信じられないかもしれませんが…」で始まる見出しはもういらない</li><li><strong>時間は用心棒。</strong>全文読みのクラブに入れるかどうかは、要約が決める 🚪</li></ul><p>🎙️ <em>お笑い風に：</em>「タブを100個開いてます。読むためじゃない。もはや美術館です。」</p><p>#ロングリード #スローウェブ #タブ溜め込み</p>',
    },
    ko: {
      stream: '긴 글이 돌아왔습니다. 10년 동안 헤드라인만 집어 먹던 독자들이 다시 풀코스를 원해요.',
      html: '<h3>🎤 긴 글의 컴백 투어</h3><ul><li><strong>장문이 돌아왔다.</strong> 가장 긴 글이 이제 가장 오래 읽힌다. 10년 만의 반전 📈</li><li><strong>독자가 원하는 건 맥락</strong>, “믿기 힘들겠지만…”으로 시작하는 헤드라인이 또 하나 필요한 게 아니다</li><li><strong>시간은 클럽 문지기.</strong> 끝까지 읽을 글을 들여보낼지는 요약이 정한다 🚪</li></ul><p>🎙️ <em>스탠드업 한마디:</em> “탭을 100개 열어 뒀어요. 읽으려는 게 아니라, 이건 박물관이에요.”</p><p>#긴글 #슬로웹 #탭부자</p>',
    },
  };
  D.summaryFun = { ...D.summary, ...(FUN[lang] || FUN.en) };

  // "Ask about your highlights" (highlights video): the reader marks a passage, asks about it, the answer cites it.
  // `quote` must appear verbatim in that language's article (demo-i18n.js), like every recorded source.
  const HIGHLIGHT = {
    en: { quote: 'the pieces that survive that triage are read more carefully than before', text: 'Because a summary has already done the sorting: what is left is what you chose to spend time on, so you read it with intent, not out of habit. Try it: put the idea in your own words.', questions: ['What changes for writers?'] },
    de: { quote: 'die Texte, die diese Auswahl überstehen, werden sorgfältiger gelesen als früher', text: 'Weil die Zusammenfassung schon sortiert hat: Was übrig bleibt, hast du bewusst gewählt, also liest du es mit Absicht statt aus Gewohnheit. Probier es: Sag die Idee in eigenen Worten.', questions: ['Was ändert sich für Autoren?'] },
    es: { quote: 'los textos que superan esa selección se leen con más cuidado que antes', text: 'Porque el resumen ya ha hecho la criba: lo que queda lo elegiste tú, así que lo lees con intención y no por costumbre. Pruébalo: explica la idea con tus palabras.', questions: ['¿Qué cambia para quien escribe?'] },
    ja: { quote: 'その選別を通過した記事は以前より丁寧に読まれます', text: '要約がすでに選別しているからです。残った記事は自分で選んだものなので、習慣ではなく目的を持って読めます。試しに、その考えを自分の言葉で言い換えてみましょう。', questions: ['書き手にとって何が変わる？'] },
  };
  const H = HIGHLIGHT[lang] || HIGHLIGHT.en;
  if (Array.isArray(D.asks)) D.asks.unshift({ match: /highlight|markierung|resaltado|マーカー/i, text: H.text, sources: [H.quote], questions: H.questions });

  // The short summary the shim writes for each history entry.
  D.libraryText = {
    en: { keyPoints: 'Key points', tail: 'Context, evidence and what to read next.' },
    de: { keyPoints: 'Kernpunkte', tail: 'Kontext, Belege und was du als Nächstes lesen kannst.' },
    es: { keyPoints: 'Puntos clave', tail: 'Contexto, pruebas y qué leer después.' },
    ja: { keyPoints: '要点', tail: '背景、根拠、次に読むべきもの。' },
    ko: { keyPoints: '핵심 요약', tail: '배경, 근거, 그리고 다음에 읽을 것.' },
  }[lang];

  const pick = (t) => (typeof t === 'string' ? t : t[lang] || t.en);
  const titles = TITLES[lang];
  D.library = [
    ...D.library.map((a, i) => (titles && titles[i] ? { ...a, title: titles[i] } : a)),
    ...EXTRAS.map((e) => ({ ...e, title: pick(e.title) })),
  ];
  const F = FEEDS[lang];
  if (F && D.feeds) {
    D.feeds = {
      subs: D.feeds.subs.map((s, i) => ({ ...s, title: F.subs[i] || s.title })),
      items: D.feeds.items.map((it, i) => (F.items[i] ? { ...it, title: F.items[i][0], snippet: F.items[i][1] } : it)),
    };
  }
})();
