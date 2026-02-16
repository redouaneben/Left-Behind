// ═══════════════════════════════════════════════════════════════════
//  I18N — Dictionnaire centralisé de traductions
//  Toutes les clés utilisées dans l'app (Landing, ExplorePanel, GamePanel…)
// ═══════════════════════════════════════════════════════════════════

export const LANGS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "简体中文" },
] as const;

export type LangCode = (typeof LANGS)[number]["code"];

export interface I18nStrings {
  // ── Landing ──
  subtitle: string;
  body: string;
  cta: string;
  anonymous_badge: string;
  help_concept_title: string;
  help_concept_text: string;
  help_how_title: string;
  help_how_text: string;

  // ── Tabs ──
  tab_fragments: string;
  tab_history: string;

  // ── Fragments tab ──
  frag_random: string;
  frag_year: string;
  frag_country: string;
  frag_theme: string;
  frag_all: string;
  frag_search: string;
  frag_results: string;
  frag_back: string;
  frag_empty: string;
  frag_waiting: string;

  // ── History / Quiz tab ──
  quiz_title: string;
  quiz_difficulty: string;
  quiz_easy: string;
  quiz_expert: string;
  quiz_easy_desc: string;
  quiz_expert_desc: string;
  quiz_zone: string;
  quiz_local: string;
  quiz_world: string;
  quiz_category: string;
  quiz_epoch: string;
  quiz_all: string;
  quiz_launch: string;
  quiz_loading: string;
  quiz_available: string;
  quiz_challenges: string;
  quiz_no_events: string;
  quiz_move_globe: string;
  quiz_check_connection: string;

  // ── GamePanel (playing) ──
  game_question: string;
  game_hint: string;
  game_hint_pts: string;
  game_category_hint: string;
  game_year_hint: string;
  game_actions_hint: string;
  game_choose: string;
  game_type_answer: string;
  game_placeholder: string;
  game_validate: string;
  game_score: string;

  // ── GamePanel (result) ──
  result_correct: string;
  result_wrong: string;
  result_points_earned: string;
  result_points: string;
  result_hints_used: string;
  result_qcm: string;
  result_found: string;
  result_answer_was: string;
  result_view_story: string;
  result_next: string;
  result_retry: string;
  result_quit: string;
  result_discovered: string;
  result_added: string;
  result_collection_added: string;
  result_discover_story: string;

  // ── Misc ──
  misc_untitled: string;
  misc_no_description: string;
  misc_menu: string;
}

export const I18N: Record<LangCode, I18nStrings> = {
  en: {
    subtitle: "Leave your life's fragments where they happened.",
    body: "Memories fade, people pass, but moments can live forever. You are anonymous. Share what truly matters.",
    cta: "Get Started",
    anonymous_badge: "100% Anonymous",
    help_concept_title: "Concept",
    help_concept_text: "Drop your life fragments where they happened.",
    help_how_title: "How it works",
    help_how_text: "Explore the globe, discover others' emotions and leave your trace anonymously.",

    tab_fragments: "Fragments",
    tab_history: "History",

    frag_random: "Discover a Random Memory",
    frag_year: "Year",
    frag_country: "Country",
    frag_theme: "Theme",
    frag_all: "All",
    frag_search: "Search",
    frag_results: "Results",
    frag_back: "Edit search",
    frag_empty: "No fragment found in this time zone…",
    frag_waiting: "The globe awaits its first lights.",

    quiz_title: "Guess the History",
    quiz_difficulty: "Difficulty",
    quiz_easy: "Easy",
    quiz_expert: "Expert",
    quiz_easy_desc: "4 choices",
    quiz_expert_desc: "Free answer",
    quiz_zone: "Zone",
    quiz_local: "Local",
    quiz_world: "World",
    quiz_category: "Category",
    quiz_epoch: "Era",
    quiz_all: "All",
    quiz_launch: "Start Challenge",
    quiz_loading: "Exploring the world…",
    quiz_available: "available",
    quiz_challenges: "Challenges Won",
    quiz_no_events: "No event found — change era or zone.",
    quiz_move_globe: "Move across the globe to load events.",
    quiz_check_connection: "Check your connection.",

    game_question: "What event is this?",
    game_hint: "Hint",
    game_hint_pts: "(−30 pts)",
    game_category_hint: "Category",
    game_year_hint: "Year",
    game_actions_hint: "Actions",
    game_choose: "Choose your answer",
    game_type_answer: "Type your answer",
    game_placeholder: "Event name…",
    game_validate: "Submit",
    game_score: "Score",

    result_correct: "Congratulations!",
    result_wrong: "That's not the right answer…",
    result_points_earned: "points earned",
    result_points: "points",
    result_hints_used: "hint",
    result_qcm: "MCQ (×0.5)",
    result_found: "You found",
    result_answer_was: "The answer was",
    result_view_story: "View full story",
    result_next: "Next question",
    result_retry: "Retry",
    result_quit: "Quit",
    result_discovered: "Event discovered!",
    result_added: "Added to your collection",
    result_collection_added: "Event added to your collection!",
    result_discover_story: "Discover the story to learn more about this event.",
    misc_untitled: "Untitled",
    misc_no_description: "No description available.",
    misc_menu: "Menu",
  },
  fr: {
    subtitle: "Laissez les fragments de votre vie là où ils se sont produits.",
    body: "Les souvenirs s'effacent, les gens passent, mais les moments peuvent vivre pour toujours. Vous êtes anonyme. Partagez ce qui compte vraiment.",
    cta: "Commencer",
    anonymous_badge: "100% Anonyme",
    help_concept_title: "Concept",
    help_concept_text: "Déposez vos fragments de vie là où ils ont eu lieu.",
    help_how_title: "Fonctionnement",
    help_how_text: "Explorez le globe, découvrez les émotions des autres et laissez votre trace anonymement.",

    tab_fragments: "Fragments",
    tab_history: "Histoire",

    frag_random: "Découvrir un souvenir au hasard",
    frag_year: "Année",
    frag_country: "Pays",
    frag_theme: "Thème",
    frag_all: "Tous",
    frag_search: "Rechercher",
    frag_results: "Résultats",
    frag_back: "Modifier la recherche",
    frag_empty: "Aucun fragment trouvé dans cette zone du temps…",
    frag_waiting: "Le globe attend ses premières lumières.",

    quiz_title: "Devinez l'Histoire",
    quiz_difficulty: "Difficulté",
    quiz_easy: "Facile",
    quiz_expert: "Expert",
    quiz_easy_desc: "4 propositions",
    quiz_expert_desc: "Réponse libre",
    quiz_zone: "Zone",
    quiz_local: "Local",
    quiz_world: "Monde",
    quiz_category: "Catégorie",
    quiz_epoch: "Époque",
    quiz_all: "Toutes",
    quiz_launch: "Lancer le défi",
    quiz_loading: "Exploration du monde…",
    quiz_available: "dispo.",
    quiz_challenges: "Défis Réussis",
    quiz_no_events: "Aucun événement trouvé — changez d'époque ou de zone.",
    quiz_move_globe: "Déplacez-vous sur le globe pour charger des événements.",
    quiz_check_connection: "Vérifiez votre connexion.",

    game_question: "De quel événement s'agit-il ?",
    game_hint: "Indice",
    game_hint_pts: "(−30 pts)",
    game_category_hint: "Catégorie",
    game_year_hint: "Année",
    game_actions_hint: "Actions",
    game_choose: "Choisissez votre réponse",
    game_type_answer: "Tapez votre réponse",
    game_placeholder: "Nom de l'événement…",
    game_validate: "Valider",
    game_score: "Score",

    result_correct: "Félicitations !",
    result_wrong: "Ce n'est pas la bonne réponse…",
    result_points_earned: "points gagnés",
    result_points: "points",
    result_hints_used: "indice",
    result_qcm: "QCM (×0.5)",
    result_found: "Vous avez trouvé",
    result_answer_was: "La réponse était",
    result_view_story: "Voir l'histoire complète",
    result_next: "Question suivante",
    result_retry: "Retenter",
    result_quit: "Quitter",
    result_discovered: "Événement découvert !",
    result_added: "Ajouté à votre collection",
    result_collection_added: "Événement ajouté à votre collection !",
    result_discover_story: "Découvrez l'histoire pour mieux connaître cet événement.",
    misc_untitled: "Sans titre",
    misc_no_description: "Description non disponible.",
    misc_menu: "Menu",
  },
  es: {
    subtitle: "Deja los fragmentos de tu vida donde sucedieron.",
    body: "Los recuerdos se desvanecen, las personas pasan, pero los momentos pueden vivir para siempre. Eres anónimo. Comparte lo que realmente importa.",
    cta: "Comenzar",
    anonymous_badge: "100% Anónimo",
    help_concept_title: "Concepto",
    help_concept_text: "Deposita los fragmentos de tu vida donde sucedieron.",
    help_how_title: "Funcionamiento",
    help_how_text: "Explora el globo, descubre las emociones de otros y deja tu huella anónimamente.",

    tab_fragments: "Fragmentos",
    tab_history: "Historia",

    frag_random: "Descubrir un recuerdo al azar",
    frag_year: "Año",
    frag_country: "País",
    frag_theme: "Tema",
    frag_all: "Todos",
    frag_search: "Buscar",
    frag_results: "Resultados",
    frag_back: "Editar búsqueda",
    frag_empty: "Ningún fragmento encontrado en esta zona temporal…",
    frag_waiting: "El globo espera sus primeras luces.",

    quiz_title: "Adivina la Historia",
    quiz_difficulty: "Dificultad",
    quiz_easy: "Fácil",
    quiz_expert: "Experto",
    quiz_easy_desc: "4 opciones",
    quiz_expert_desc: "Respuesta libre",
    quiz_zone: "Zona",
    quiz_local: "Local",
    quiz_world: "Mundo",
    quiz_category: "Categoría",
    quiz_epoch: "Época",
    quiz_all: "Todas",
    quiz_launch: "Iniciar desafío",
    quiz_loading: "Explorando el mundo…",
    quiz_available: "disp.",
    quiz_challenges: "Desafíos Ganados",
    quiz_no_events: "No se encontraron eventos — cambia de época o zona.",
    quiz_move_globe: "Muévete por el globo para cargar eventos.",
    quiz_check_connection: "Verifica tu conexión.",

    game_question: "¿De qué evento se trata?",
    game_hint: "Pista",
    game_hint_pts: "(−30 pts)",
    game_category_hint: "Categoría",
    game_year_hint: "Año",
    game_actions_hint: "Acciones",
    game_choose: "Elige tu respuesta",
    game_type_answer: "Escribe tu respuesta",
    game_placeholder: "Nombre del evento…",
    game_validate: "Validar",
    game_score: "Puntuación",

    result_correct: "¡Felicidades!",
    result_wrong: "Esa no es la respuesta correcta…",
    result_points_earned: "puntos ganados",
    result_points: "puntos",
    result_hints_used: "pista",
    result_qcm: "Opción múltiple (×0.5)",
    result_found: "Encontraste",
    result_answer_was: "La respuesta era",
    result_view_story: "Ver historia completa",
    result_next: "Siguiente pregunta",
    result_retry: "Reintentar",
    result_quit: "Salir",
    result_discovered: "¡Evento descubierto!",
    result_added: "Añadido a tu colección",
    result_collection_added: "¡Evento añadido a tu colección!",
    result_discover_story: "Descubre la historia para saber más sobre este evento.",
    misc_untitled: "Sin título",
    misc_no_description: "Descripción no disponible.",
    misc_menu: "Menú",
  },
  de: {
    subtitle: "Hinterlasse die Fragmente deines Lebens dort, wo sie passiert sind.",
    body: "Erinnerungen verblassen, Menschen gehen, aber Momente können ewig leben. Du bist anonym. Teile, was wirklich zählt.",
    cta: "Starten",
    anonymous_badge: "100% Anonym",
    help_concept_title: "Konzept",
    help_concept_text: "Hinterlege deine Lebensfragmente dort, wo sie passiert sind.",
    help_how_title: "So funktioniert's",
    help_how_text: "Erkunde den Globus, entdecke die Emotionen anderer und hinterlasse anonym deine Spur.",

    tab_fragments: "Fragmente",
    tab_history: "Geschichte",

    frag_random: "Zufällige Erinnerung entdecken",
    frag_year: "Jahr",
    frag_country: "Land",
    frag_theme: "Thema",
    frag_all: "Alle",
    frag_search: "Suchen",
    frag_results: "Ergebnisse",
    frag_back: "Suche bearbeiten",
    frag_empty: "Kein Fragment in dieser Zeitzone gefunden…",
    frag_waiting: "Der Globus wartet auf seine ersten Lichter.",

    quiz_title: "Errate die Geschichte",
    quiz_difficulty: "Schwierigkeit",
    quiz_easy: "Leicht",
    quiz_expert: "Experte",
    quiz_easy_desc: "4 Optionen",
    quiz_expert_desc: "Freie Antwort",
    quiz_zone: "Zone",
    quiz_local: "Lokal",
    quiz_world: "Welt",
    quiz_category: "Kategorie",
    quiz_epoch: "Epoche",
    quiz_all: "Alle",
    quiz_launch: "Herausforderung starten",
    quiz_loading: "Welt erkunden…",
    quiz_available: "verfügb.",
    quiz_challenges: "Gewonnene Herausf.",
    quiz_no_events: "Keine Ereignisse gefunden — ändere Epoche oder Zone.",
    quiz_move_globe: "Bewege dich auf dem Globus, um Ereignisse zu laden.",
    quiz_check_connection: "Überprüfe deine Verbindung.",

    game_question: "Um welches Ereignis handelt es sich?",
    game_hint: "Hinweis",
    game_hint_pts: "(−30 Pkt.)",
    game_category_hint: "Kategorie",
    game_year_hint: "Jahr",
    game_actions_hint: "Aktionen",
    game_choose: "Wähle deine Antwort",
    game_type_answer: "Schreibe deine Antwort",
    game_placeholder: "Ereignisname…",
    game_validate: "Bestätigen",
    game_score: "Punktzahl",

    result_correct: "Glückwunsch!",
    result_wrong: "Das ist nicht die richtige Antwort…",
    result_points_earned: "Punkte verdient",
    result_points: "Punkte",
    result_hints_used: "Hinweis",
    result_qcm: "Multiple-Choice (×0.5)",
    result_found: "Du hast gefunden",
    result_answer_was: "Die Antwort war",
    result_view_story: "Ganze Geschichte ansehen",
    result_next: "Nächste Frage",
    result_retry: "Erneut versuchen",
    result_quit: "Beenden",
    result_discovered: "Ereignis entdeckt!",
    result_added: "Zu deiner Sammlung hinzugefügt",
    result_collection_added: "Ereignis zu deiner Sammlung hinzugefügt!",
    result_discover_story: "Entdecke die Geschichte, um mehr über dieses Ereignis zu erfahren.",
    misc_untitled: "Ohne Titel",
    misc_no_description: "Keine Beschreibung verfügbar.",
    misc_menu: "Menü",
  },
  it: {
    subtitle: "Lascia i frammenti della tua vita dove sono accaduti.",
    body: "I ricordi svaniscono, le persone passano, ma i momenti possono vivere per sempre. Sei anonimo. Condividi ciò che conta davvero.",
    cta: "Inizia",
    anonymous_badge: "100% Anonimo",
    help_concept_title: "Concetto",
    help_concept_text: "Deposita i frammenti della tua vita dove sono accaduti.",
    help_how_title: "Come funziona",
    help_how_text: "Esplora il globo, scopri le emozioni degli altri e lascia la tua traccia in modo anonimo.",

    tab_fragments: "Frammenti", tab_history: "Storia",
    frag_random: "Scopri un ricordo casuale", frag_year: "Anno", frag_country: "Paese", frag_theme: "Tema", frag_all: "Tutti", frag_search: "Cerca", frag_results: "Risultati", frag_back: "Modifica ricerca", frag_empty: "Nessun frammento trovato…", frag_waiting: "Il globo attende le sue prime luci.",
    quiz_title: "Indovina la Storia", quiz_difficulty: "Difficoltà", quiz_easy: "Facile", quiz_expert: "Esperto", quiz_easy_desc: "4 scelte", quiz_expert_desc: "Risposta libera", quiz_zone: "Zona", quiz_local: "Locale", quiz_world: "Mondo", quiz_category: "Categoria", quiz_epoch: "Epoca", quiz_all: "Tutte", quiz_launch: "Inizia la sfida", quiz_loading: "Esplorando il mondo…", quiz_available: "disp.", quiz_challenges: "Sfide Vinte", quiz_no_events: "Nessun evento trovato — cambia epoca o zona.", quiz_move_globe: "Spostati sul globo per caricare eventi.", quiz_check_connection: "Verifica la connessione.",
    game_question: "Di quale evento si tratta?", game_hint: "Indizio", game_hint_pts: "(−30 pt)", game_category_hint: "Categoria", game_year_hint: "Anno", game_actions_hint: "Azioni", game_choose: "Scegli la risposta", game_type_answer: "Scrivi la risposta", game_placeholder: "Nome dell'evento…", game_validate: "Conferma", game_score: "Punteggio",
    result_correct: "Congratulazioni!", result_wrong: "Non è la risposta giusta…", result_points_earned: "punti guadagnati", result_points: "punti", result_hints_used: "indizio", result_qcm: "Scelta multipla (×0.5)", result_found: "Hai trovato", result_answer_was: "La risposta era", result_view_story: "Vedi storia completa", result_next: "Prossima domanda", result_retry: "Riprova", result_quit: "Esci", result_discovered: "Evento scoperto!", result_added: "Aggiunto alla tua collezione",
    result_collection_added: "Evento aggiunto alla tua collezione!", result_discover_story: "Scopri la storia per saperne di più su questo evento.", misc_untitled: "Senza titolo", misc_no_description: "Nessuna descrizione disponibile.", misc_menu: "Menu",
  },
  pt: {
    subtitle: "Deixe os fragmentos da sua vida onde aconteceram.",
    body: "As memórias desvanecem, as pessoas passam, mas os momentos podem viver para sempre. Você é anônimo. Compartilhe o que realmente importa.",
    cta: "Começar",
    anonymous_badge: "100% Anônimo",
    help_concept_title: "Conceito",
    help_concept_text: "Deposite seus fragmentos de vida onde aconteceram.",
    help_how_title: "Como funciona",
    help_how_text: "Explore o globo, descubra as emoções dos outros e deixe sua marca anonimamente.",

    tab_fragments: "Fragmentos", tab_history: "História",
    frag_random: "Descobrir uma memória aleatória", frag_year: "Ano", frag_country: "País", frag_theme: "Tema", frag_all: "Todos", frag_search: "Pesquisar", frag_results: "Resultados", frag_back: "Editar pesquisa", frag_empty: "Nenhum fragmento encontrado…", frag_waiting: "O globo aguarda suas primeiras luzes.",
    quiz_title: "Adivinhe a História", quiz_difficulty: "Dificuldade", quiz_easy: "Fácil", quiz_expert: "Especialista", quiz_easy_desc: "4 opções", quiz_expert_desc: "Resposta livre", quiz_zone: "Zona", quiz_local: "Local", quiz_world: "Mundo", quiz_category: "Categoria", quiz_epoch: "Época", quiz_all: "Todas", quiz_launch: "Iniciar desafio", quiz_loading: "Explorando o mundo…", quiz_available: "disp.", quiz_challenges: "Desafios Ganhos", quiz_no_events: "Nenhum evento encontrado — mude de época ou zona.", quiz_move_globe: "Mova-se pelo globo para carregar eventos.", quiz_check_connection: "Verifique sua conexão.",
    game_question: "De que evento se trata?", game_hint: "Dica", game_hint_pts: "(−30 pts)", game_category_hint: "Categoria", game_year_hint: "Ano", game_actions_hint: "Ações", game_choose: "Escolha sua resposta", game_type_answer: "Digite sua resposta", game_placeholder: "Nome do evento…", game_validate: "Validar", game_score: "Pontuação",
    result_correct: "Parabéns!", result_wrong: "Essa não é a resposta certa…", result_points_earned: "pontos ganhos", result_points: "pontos", result_hints_used: "dica", result_qcm: "Múltipla escolha (×0.5)", result_found: "Você encontrou", result_answer_was: "A resposta era", result_view_story: "Ver história completa", result_next: "Próxima pergunta", result_retry: "Tentar novamente", result_quit: "Sair", result_discovered: "Evento descoberto!", result_added: "Adicionado à sua coleção",
    result_collection_added: "Evento adicionado à sua coleção!", result_discover_story: "Descubra a história para saber mais sobre este evento.", misc_untitled: "Sem título", misc_no_description: "Descrição não disponível.", misc_menu: "Menu",
  },
  ja: {
    subtitle: "人生の断片を、それが起きた場所に残そう。",
    body: "記憶は薄れ、人は去る。しかし瞬間は永遠に生き続けることができる。あなたは匿名です。本当に大切なものを共有してください。",
    cta: "はじめる",
    anonymous_badge: "100% 匿名",
    help_concept_title: "コンセプト",
    help_concept_text: "人生の断片を、起きた場所に残しましょう。",
    help_how_title: "使い方",
    help_how_text: "地球を探索し、他の人の感情を発見し、匿名で足跡を残しましょう。",

    tab_fragments: "フラグメント", tab_history: "歴史",
    frag_random: "ランダムな記憶を発見", frag_year: "年", frag_country: "国", frag_theme: "テーマ", frag_all: "すべて", frag_search: "検索", frag_results: "結果", frag_back: "検索を編集", frag_empty: "この時間帯にフラグメントが見つかりません…", frag_waiting: "地球は最初の光を待っています。",
    quiz_title: "歴史を当てよう", quiz_difficulty: "難易度", quiz_easy: "簡単", quiz_expert: "上級", quiz_easy_desc: "4択", quiz_expert_desc: "自由回答", quiz_zone: "ゾーン", quiz_local: "ローカル", quiz_world: "世界", quiz_category: "カテゴリ", quiz_epoch: "時代", quiz_all: "すべて", quiz_launch: "チャレンジ開始", quiz_loading: "世界を探索中…", quiz_available: "利用可能", quiz_challenges: "クリアしたチャレンジ", quiz_no_events: "イベントが見つかりません。", quiz_move_globe: "地球上を移動してイベントを読み込みます。", quiz_check_connection: "接続を確認してください。",
    game_question: "何のイベントですか？", game_hint: "ヒント", game_hint_pts: "(−30点)", game_category_hint: "カテゴリ", game_year_hint: "年", game_actions_hint: "アクション", game_choose: "回答を選択", game_type_answer: "回答を入力", game_placeholder: "イベント名…", game_validate: "送信", game_score: "スコア",
    result_correct: "おめでとう！", result_wrong: "正解ではありません…", result_points_earned: "獲得ポイント", result_points: "ポイント", result_hints_used: "ヒント", result_qcm: "選択式 (×0.5)", result_found: "正解", result_answer_was: "答えは", result_view_story: "全文を見る", result_next: "次の問題", result_retry: "もう一度", result_quit: "終了", result_discovered: "イベント発見！", result_added: "コレクションに追加",
    result_collection_added: "イベントがコレクションに追加されました！", result_discover_story: "このイベントについて詳しく知るには歴史を読みましょう。", misc_untitled: "無題", misc_no_description: "説明はありません。", misc_menu: "メニュー",
  },
  zh: {
    subtitle: "将你生命的碎片留在它们发生的地方。",
    body: "记忆会褪色，人会离去，但瞬间可以永远存在。你是匿名的。分享真正重要的事。",
    cta: "开始探索",
    anonymous_badge: "100% 匿名",
    help_concept_title: "概念",
    help_concept_text: "将你的生命片段留在它们发生的地方。",
    help_how_title: "如何使用",
    help_how_text: "探索地球，发现他人的情感，匿名留下你的足迹。",

    tab_fragments: "碎片", tab_history: "历史",
    frag_random: "随机发现一段记忆", frag_year: "年份", frag_country: "国家", frag_theme: "主题", frag_all: "全部", frag_search: "搜索", frag_results: "结果", frag_back: "编辑搜索", frag_empty: "未找到碎片…", frag_waiting: "地球正等待第一缕光。",
    quiz_title: "猜猜历史", quiz_difficulty: "难度", quiz_easy: "简单", quiz_expert: "专家", quiz_easy_desc: "4个选项", quiz_expert_desc: "自由回答", quiz_zone: "区域", quiz_local: "本地", quiz_world: "世界", quiz_category: "类别", quiz_epoch: "时代", quiz_all: "全部", quiz_launch: "开始挑战", quiz_loading: "探索世界中…", quiz_available: "可用", quiz_challenges: "挑战成功", quiz_no_events: "未找到事件——更换时代或区域。", quiz_move_globe: "在地球上移动以加载事件。", quiz_check_connection: "请检查网络连接。",
    game_question: "这是什么事件？", game_hint: "提示", game_hint_pts: "(−30分)", game_category_hint: "类别", game_year_hint: "年份", game_actions_hint: "行动", game_choose: "选择你的答案", game_type_answer: "输入你的答案", game_placeholder: "事件名称…", game_validate: "提交", game_score: "得分",
    result_correct: "恭喜！", result_wrong: "答案不正确…", result_points_earned: "获得积分", result_points: "积分", result_hints_used: "提示", result_qcm: "选择题 (×0.5)", result_found: "你找到了", result_answer_was: "答案是", result_view_story: "查看完整历史", result_next: "下一题", result_retry: "重试", result_quit: "退出", result_discovered: "事件已发现！", result_added: "已添加到你的收藏",
    result_collection_added: "事件已添加到你的收藏！", result_discover_story: "了解历史以更好地了解此事件。", misc_untitled: "无标题", misc_no_description: "暂无描述。", misc_menu: "菜单",
  },
};
